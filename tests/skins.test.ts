import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { SkinStore, validateSkinDirectory } from "../src/core/skins";
import {
  builtinSkins,
  skinSlotRegistry,
  validateSkin,
  type SkinManifest,
} from "../src/shared/skins";
import { Runtime } from "../src/core/runtime";
let temp: string;
beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "aw-skin-test-"));
});
afterEach(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});
const manifest = (): SkinManifest => ({
  ...structuredClone(builtinSkins[1].manifest),
  id: "custom-fresh",
  name: "清爽定制",
  resources: [
    {
      id: "plate",
      path: "resources/plate.png",
      width: 90,
      height: 36,
      scale: 1,
      source: { author: "原作者", license: "CC0" },
    },
  ],
  bindings: [
    {
      component: "primary-button",
      slot: "background",
      state: "default",
      resource: "plate",
      fit: "nine-slice",
      slices: { top: 6, right: 6, bottom: 6, left: 6 },
      contentInsets: { top: 4, right: 12, bottom: 4, left: 12 },
      bleed: 0,
    },
  ],
});
describe("skin protocol and independent installation", () => {
  test("rejects ambiguous slots, unsafe paths, invalid dimensions and unsupported versions", () => {
    const m = manifest();
    expect(skinSlotRegistry).toHaveLength(32);
    expect(() => validateSkin({ ...m, schemaVersion: 2 })).toThrow();
    expect(() =>
      validateSkin({
        ...m,
        resources: [{ ...m.resources[0], width: 5000, scale: 2 }],
      }),
    ).toThrow("8192");
    expect(() =>
      validateSkin({
        ...m,
        resources: [
          {
            ...m.resources[0],
            atlasRegion: {
              x: 80,
              y: 0,
              width: 30,
              height: 20,
              sourceWidth: 100,
              sourceHeight: 100,
            },
          },
        ],
      }),
    ).toThrow("图集区域");
    expect(() =>
      validateSkin({
        ...m,
        resources: [{ ...m.resources[0], path: "../image.png" }],
      }),
    ).toThrow();
    expect(() =>
      validateSkin({ ...m, bindings: [m.bindings[0], m.bindings[0]] }),
    ).toThrow("重复");
    expect(() =>
      validateSkin({
        ...m,
        bindings: [{ ...m.bindings[0], resource: "missing" }],
      }),
    ).toThrow("找不到");
    expect(() =>
      validateSkin({
        ...m,
        bindings: [
          {
            ...m.bindings[0],
            slices: { top: 20, bottom: 20, left: 6, right: 6 },
          },
        ],
      }),
    ).toThrow("超出");
  });
  test("round trips a package, preserves license and slices, survives source deletion and reload", async () => {
    const source = path.join(temp, "plate.png");
    await sharp({
      create: { width: 90, height: 36, channels: 4, background: "#37adcc" },
    })
      .png()
      .toFile(source);
    const store = await new SkinStore(path.join(temp, "profile")).init();
    const built = await store.create(manifest(), [
      { resourceId: "plate", filename: source },
    ]);
    await store.install(built.skin);
    await store.update({
      skinKey: built.skin.key,
      density: "compact",
      motion: "reduced",
    });
    const zip = path.join(temp, "roundtrip.awskin");
    await store.exportPackage(built.skin.key, zip);
    await fs.rm(source);
    await fs.rm(built.directory, { recursive: true });
    await fs.rm(path.join(temp, "profile", "skins", built.skin.key, "cache"), {
      recursive: true,
    });
    const reloaded = await new SkinStore(path.join(temp, "profile")).init();
    expect(
      (
        await sharp(
          await reloaded.resolve(built.skin.key, "cache/plate.png"),
        ).metadata()
      ).width,
    ).toBe(90);
    expect((await reloaded.appearance()).preferences.density).toBe("compact");
    expect(
      (await reloaded.get(built.skin.key)).manifest.resources[0].source
        ?.license,
    ).toBe("CC0");
    const second = await new SkinStore(path.join(temp, "second")).init();
    const imported = await second.prepare(zip);
    expect(imported.key).toBe(built.skin.key);
    expect(imported.manifest.bindings[0].slices?.left).toBe(6);
    await second.install(imported);
    await second.install(imported);
    expect(await second.list()).toHaveLength(4);
    await reloaded.remove(built.skin.key);
    expect((await reloaded.appearance()).preferences.skinKey).toBe(
      "builtin:comic",
    );
  });
  test("rejects resource dimension mismatch and executable SVG; broken appearance falls back", async () => {
    const dir = path.join(temp, "bad");
    await fs.mkdir(path.join(dir, "resources"), { recursive: true });
    await fs.writeFile(path.join(dir, "skin.json"), JSON.stringify(manifest()));
    await sharp({
      create: { width: 20, height: 20, channels: 4, background: "white" },
    })
      .png()
      .toFile(path.join(dir, "resources/plate.png"));
    await expect(validateSkinDirectory(dir)).rejects.toThrow("尺寸");
    await fs.writeFile(
      path.join(dir, "resources/plate.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="36"><script>alert(1)</script></svg>',
    );
    await fs.writeFile(
      path.join(dir, "skin.json"),
      JSON.stringify({
        ...manifest(),
        resources: [
          { ...manifest().resources[0], path: "resources/plate.svg" },
        ],
      }),
    );
    await expect(validateSkinDirectory(dir)).rejects.toThrow("自包含");
    await fs.writeFile(
      path.join(temp, "appearance.json"),
      JSON.stringify({
        skinKey: "a".repeat(64),
        density: "regular",
        motion: "system",
      }),
    );
    const store = await new SkinStore(temp).init();
    expect(store.warning).toContain("恢复");
    await fs.writeFile(path.join(temp, "installed-skins.json"), "{broken");
    const recovered = await new SkinStore(temp).init();
    expect(recovered.warning).toContain("列表损坏");
  });
  test("imports .awskin as a searchable primary asset with reusable associated images", async () => {
    const source = path.join(temp, "plate.png");
    await sharp({
      create: { width: 90, height: 36, channels: 4, background: "#37adcc" },
    })
      .png()
      .toFile(source);
    const store = await new SkinStore(path.join(temp, "profile")).init();
    const twoX = manifest();
    Object.assign(twoX.resources[0], {
      width: 45,
      height: 18,
      scale: 2,
      atlasRegion: {
        name: "plate",
        x: 0,
        y: 0,
        width: 90,
        height: 36,
        sourceWidth: 90,
        sourceHeight: 36,
      },
    });
    const build = await store.create(twoX, [
      { resourceId: "plate", filename: source },
    ]);
    const zip = path.join(temp, "pack.awskin");
    await store.exportPackage(build.skin.key, zip);
    const runtime = await new Runtime(path.join(temp, "library")).init();
    try {
      const p = await runtime.handle("imports.inspect", { paths: [zip] });
      const jobId = await runtime.handle("imports.start", { planId: p.id });
      for (let tries = 0; tries < 100; tries++) {
        const jobs = await runtime.handle("jobs.list");
        const j = jobs.find((j: any) => j.id === jobId);
        if (j?.status === "completed") break;
        if (j?.status === "failed") throw new Error(j.error);
        await new Promise((r) => setTimeout(r, 30));
      }
      const result = await runtime.handle("assets.query", { category: "skin" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].capabilities.preview).toBe("skin");
      const images = await runtime.handle("assets.query", {
        category: "controls",
        showRelated: true,
      });
      expect(images.items).toHaveLength(1);
      expect(images.items[0].metadata.nineSlice.left).toBe(12);
      expect(images.items[0].metadata.skinResource.scale).toBe(2);
      expect(images.items[0].metadata.skinResource.atlasRegion.name).toBe(
        "plate",
      );
      expect(images.items[0].source.license).toBe("CC0");
    } finally {
      await runtime.shutdown();
    }
  });
});
