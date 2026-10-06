import { beforeEach, afterEach, describe, expect, test } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import yazl from "yazl";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Catalog } from "../src/core/catalog";
import { Runtime } from "../src/core/runtime";
import {
  inspectImport,
  runImport,
  type JobContext,
} from "../src/core/importer";
import {
  inspectExport,
  runExport,
  materialTextures,
} from "../src/core/exporter";
import {
  safeRelative,
  inside,
  hashFile,
  uid,
  extractZip,
  resolveDependency,
} from "../src/core/files";
import { defaultVariant, type Asset } from "../src/shared/types";
let base: string, root: string, catalog: Catalog;
const context = (): JobContext => ({
  job: {
    id: uid(),
    type: "test",
    title: "test",
    status: "running",
    stage: "",
    progress: 0,
    done: 0,
    total: 1,
    request: {},
    createdAt: "",
    updatedAt: "",
  },
  check: async () => {},
  progress: () => {},
  event: () => {},
});
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-tests-"));
  root = path.join(base, "素材库");
  catalog = new Catalog(root);
  await fs.mkdir(path.join(root, "cache"), { recursive: true });
});
afterEach(async () => {
  catalog.close();
  await fs.rm(base, { recursive: true, force: true });
});
async function fixture() {
  const dir = path.join(base, "含 空格中文");
  await fs.mkdir(dir, { recursive: true });
  await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 127, g: 64, b: 32, alpha: 0.5 },
    },
  })
    .png()
    .toFile(path.join(dir, "木材_Color.png"));
  await fs.writeFile(path.join(dir, "说明.txt"), "许可证说明");
  return dir;
}
async function imported(dir?: string) {
  return runImport(
    catalog,
    await inspectImport([dir ?? (await fixture())]),
    context(),
  );
}
describe("managed library", () => {
  test("copies originals; deleting source leaves previews and hashes intact", async () => {
    const dir = await fixture(),
      r = await imported(dir),
      a = catalog.get(r.assets[0]);
    await fs.rm(dir, { recursive: true });
    const f = inside(
      path.join(root, "packages", a.packageId, a.revisionId, "source"),
      a.path,
    );
    expect(await hashFile(f)).toBe(a.sha256);
    expect(a.metadata.width).toBe(4);
    expect(a.thumbnailUrl).toContain("workshop://cache/");
  });
  test("content duplicates reuse package and retain new provenance", async () => {
    const dir = await fixture(),
      r = await imported(dir),
      p = await inspectImport([dir]);
    p.source = {
      provider: "local",
      author: "新作者",
      license: "CC0",
      pageUrl: "https://example.com",
    };
    const same = await runImport(catalog, p, context());
    expect(same.duplicate).toBe(true);
    expect(same.assets).toEqual(r.assets);
    expect(catalog.stats().packages).toBe(1);
    expect(
      catalog.db.prepare("SELECT count(*) n FROM provenance").get().n,
    ).toBe(1);
  });
  test("same filename with different content is a separate revision", async () => {
    const dir = await fixture();
    await imported(dir);
    await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#ff0000" },
    })
      .png()
      .toFile(path.join(dir, "木材_Color.png"));
    await imported(dir);
    expect(catalog.stats().packages).toBe(2);
  });
  test("Chinese short words, trigram words and punctuation are literal", async () => {
    const r = await imported();
    catalog.update(r.assets, {
      title: '红木地板 100%_ "木材"',
      tags: ["wood", "木材"],
    });
    expect(catalog.query({ search: "木" }).total).toBe(1);
    expect(catalog.query({ search: "红木地板" }).total).toBe(1);
    expect(catalog.query({ search: "%_" }).total).toBe(1);
    expect(catalog.query({ search: '"木材"' }).total).toBe(1);
    expect(catalog.query({ search: "' OR 1=1 --" }).total).toBe(0);
  });
  test("projects share a fixed revision; deleting project retains assets", async () => {
    const r = await imported(),
      a = catalog.saveProject({ name: "项目A" }),
      b = catalog.saveProject({ name: "项目B" });
    catalog.attach(a.id, r.assets);
    catalog.attach(b.id, r.assets);
    expect(catalog.query({ projectId: a.id }).total).toBe(1);
    catalog.db.prepare("DELETE FROM projects WHERE id=?").run(a.id);
    expect(catalog.get(r.assets[0])).toBeTruthy();
    expect(catalog.query({ projectId: b.id }).total).toBe(1);
  });
  test("smart collections apply saved filter", async () => {
    await imported();
    const id = catalog.saveCollection("木材", { search: "木材" });
    expect(catalog.query({ collectionId: id }).total).toBe(1);
  });
  test("corrupt image is retained with a capability explanation", async () => {
    const dir = await fixture();
    await fs.writeFile(path.join(dir, "broken.png"), "bad");
    const r = await imported(dir);
    expect(
      r.assets
        .map((id: string) => catalog.get(id))
        .find((a: Asset) => a.title === "broken")?.metadata.previewError,
    ).toBeTruthy();
  });
  test("missing and remote glTF dependencies are reported", async () => {
    const dir = await fixture();
    await fs.writeFile(
      path.join(dir, "模型.gltf"),
      JSON.stringify({
        asset: { version: "2.0" },
        buffers: [{ uri: "missing.bin", byteLength: 4 }],
        images: [{ uri: "https://example.com/remote.png" }],
      }),
    );
    const r = await imported(dir),
      a = r.assets
        .map((id: string) => catalog.get(id))
        .find((a: Asset) => a.extension === ".gltf")!;
    expect(a.metadata.missing).toHaveLength(2);
    expect(
      inspectExport(catalog, { assetIds: [a.id], target: base, mode: "godot" })
        .issues,
    ).toHaveLength(1);
  });
  test("TexturePacker object frames associate with the image", async () => {
    const dir = await fixture();
    await fs.writeFile(
      path.join(dir, "atlas.json"),
      JSON.stringify({
        meta: { image: "木材_Color.png" },
        frames: { a: { frame: { x: 0, y: 0, w: 2, h: 2 } } },
      }),
    );
    const r = await imported(dir);
    expect(catalog.get(r.assets[0]).metadata.atlas).toEqual([
      { name: "a", x: 0, y: 0, width: 2, height: 2 },
    ]);
  });
  test("cancelled copying does not commit any asset", async () => {
    const dir = await fixture(),
      ctx = context();
    ctx.check = async () => {
      throw new Error("cancel");
    };
    await expect(
      runImport(catalog, await inspectImport([dir]), ctx),
    ).rejects.toThrow("cancel");
    expect(catalog.stats().assets).toBe(0);
  });
});
describe("paths and exports", () => {
  test.each([
    "../escape",
    "a/../../escape",
    "C:/secret",
    "/etc/passwd",
    "a\0b",
  ])("rejects unsafe path %s", (value) =>
    expect(() => safeRelative(value)).toThrow(),
  );
  test("relative parent reference inside a package is permitted", () => {
    expect(
      resolveDependency("models/model.gltf", "../textures/a.png").path,
    ).toBe("textures/a.png");
    expect(() => resolveDependency("model.gltf", "../escape.bin")).toThrow();
  });
  test("ZIP case conflicts are rejected without overwriting", async () => {
    const zip = new yazl.ZipFile();
    zip.addBuffer(Buffer.from("a"), "A.png");
    zip.addBuffer(Buffer.from("b"), "a.png");
    zip.end();
    const filename = path.join(base, "bad.zip");
    await pipeline(zip.outputStream, createWriteStream(filename));
    await expect(
      extractZip(filename, path.join(base, "extract")),
    ).rejects.toThrow("冲突");
  });
  test("DirectX green conversion and ORM channels use actual data", async () => {
    const r = await imported(),
      a = catalog.get(r.assets[0]),
      v = defaultVariant(a);
    v.normalConvention = "dx";
    const binding = {
      assetId: a.id,
      revisionId: a.revisionId,
      channel: "g" as const,
      uv: 0 as const,
    };
    v.bindings = {
      normal: { ...binding, channel: "rgb" },
      roughness: binding,
      metallic: { ...binding, channel: "b" },
      ao: { ...binding, channel: "r" },
    };
    const dest = path.join(base, "textures");
    await materialTextures(catalog, v, dest);
    const normal = await sharp(path.join(dest, "normal.png")).raw().toBuffer(),
      orm = await sharp(path.join(dest, "orm.png")).raw().toBuffer();
    expect(normal[1]).toBe(191);
    expect([...orm.subarray(0, 3)]).toEqual([127, 64, 32]);
  });
  test("Godot export retains dependencies and refuses modified originals", async () => {
    const r = await imported(),
      target = path.join(base, "godot");
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, "project.godot"), "config_version=5");
    const p = inspectExport(catalog, {
        assetIds: r.assets,
        target,
        mode: "godot",
      }),
      out = await runExport(catalog, p, context());
    const filename = inside(out.target, out.entries[0].entry);
    expect(await hashFile(filename)).toBe(catalog.get(r.assets[0]).sha256);
    await fs.writeFile(filename, "human");
    await expect(runExport(catalog, p, context())).rejects.toThrow("已被修改");
    expect(await fs.readFile(filename, "utf8")).toBe("human");
  });
  test("backup snapshot restores tags, projects, variants and all hashes", async () => {
    catalog.close();
    const runtime = await new Runtime(root).init();
    catalog = runtime.catalog;
    try {
      const r = await imported(),
        a = catalog.get(r.assets[0]);
      await expect(
        runtime.handle("materials.save", defaultVariant(a)),
      ).rejects.toThrow("PBR 套组");
      catalog.update([a.id], {
        tags: ["测试"],
        metadata: { ...a.metadata, materialSet: { baseColor: a.path } },
      });
      const p = catalog.saveProject({ name: "项目" });
      catalog.attach(p.id, [a.id]);
      const v = await runtime.handle("materials.save", {
        ...defaultVariant(a),
        name: "材质",
      });
      const backup = await runtime.backup(path.join(base, "备份"), context()),
        target = path.join(base, "恢复");
      await runtime.restore(backup.target, target, context());
      const restored = new Catalog(target);
      expect(restored.get(a.id).tags).toEqual(["测试"]);
      expect(restored.projects()[0].assetCount).toBe(1);
      expect(restored.variants()[0].id).toBe(v.id);
      restored.close();
      await fs.writeFile(
        path.join(backup.target, "variants", v.id + ".json"),
        "tampered",
      );
      await expect(
        runtime.restore(backup.target, path.join(base, "恢复2"), context()),
      ).rejects.toThrow("校验失败");
    } finally {
      await runtime.shutdown();
      catalog = new Catalog(root);
    }
  });
  test("library lock excludes a second writer", async () => {
    catalog.close();
    const a = await new Runtime(root).init();
    await expect(new Runtime(root).init()).rejects.toThrow("另一个");
    await a.shutdown();
    catalog = new Catalog(root);
  });
});
