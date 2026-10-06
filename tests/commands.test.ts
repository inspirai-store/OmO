import { beforeEach, afterEach, test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { Runtime } from "../src/core/runtime";
import {
  inspectImport,
  runImport,
  type JobContext,
} from "../src/core/importer";
import { inspectExport, runExport, sourcePath } from "../src/core/exporter";
import { uid } from "../src/core/files";
import { FBX_PREVIEW_VERSION } from "../src/shared/fbx";
import {
  defaultVariant,
  type Asset,
  type AssetSelection,
  type ExportPlan,
} from "../src/shared/types";
let base: string, rt: Runtime, events: { type: string; data: any }[];
const ctx = (): JobContext => ({
  job: {
    id: uid(),
    type: "test",
    title: "",
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
  base = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-menus-"));
  events = [];
  rt = await new Runtime(path.join(base, "library"), (type, data) =>
    events.push({ type, data }),
  ).init();
});
afterEach(async () => {
  await rt.shutdown();
  await fs.rm(base, { recursive: true, force: true });
});
async function fixture(count = 2) {
  const source = path.join(base, "交付");
  await fs.mkdir(source, { recursive: true });
  const png = await sharp({
    create: { width: 4, height: 4, channels: 4, background: "#936b42" },
  })
    .png()
    .toBuffer();
  for (let i = 0; i < count; i++)
    await fs.writeFile(
      path.join(source, `图-${String(i).padStart(3, "0")}.png`),
      png,
    );
  await fs.writeFile(
    path.join(source, "model.gltf"),
    JSON.stringify({
      asset: { version: "2.0" },
      images: [{ uri: "图-000.png" }],
      meshes: [
        {
          primitives: [
            { attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 },
          ],
        },
      ],
      accessors: [{ count: 3 }, { count: 3 }],
      materials: [{ name: "标准材质" }],
    }),
  );
  const result = await runImport(
    rt.catalog,
    await inspectImport([source]),
    ctx(),
  );
  return result.assets.map((id: string) => rt.catalog.get(id)) as Asset[];
}
async function waitJob(id: string) {
  for (let i = 0; i < 300; i++) {
    const j = rt.catalog.jobs().find((j) => j.id === id)!;
    if (["completed", "failed", "cancelled"].includes(j.status)) return j;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("job timeout");
}
test("selection resolves the complete filter beyond loaded pages and aggregates mixed types", async () => {
  await fixture(260);
  const s = (await rt.handle("assets.selection", {
    query: { showRelated: true },
  })) as AssetSelection;
  expect(s.count).toBe(261);
  expect(new Set(s.ids).size).toBe(261);
  expect(s.sample).toHaveLength(12);
  expect(s.allImages).toBe(false);
  const page = await rt.handle("assets.selectedPage", {
    ids: s.ids,
    offset: 200,
  });
  expect(page).toHaveLength(61);
});
test("organize validates every change then commits metadata and associations with one event", async () => {
  const all = await fixture(),
    images = all.filter((a) => a.extension === ".png"),
    ids = images.map((a) => a.id);
  const p = rt.catalog.saveProject({ name: "项目" }),
    collection = rt.catalog.saveCollection("收藏集");
  events.length = 0;
  await rt.handle("assets.organize", {
    ids,
    tags: ["木材"],
    title: { prefix: "场景-", numbering: true, start: 7 },
    projectId: p.id,
    collectionId: collection,
    category: "ui",
  });
  expect(events.filter((e) => e.type === "catalog.changed")).toHaveLength(1);
  expect(rt.catalog.get(ids[0]).title).toContain(" 7");
  expect(rt.catalog.get(ids[1]).tags).toContain("木材");
  expect(rt.catalog.query({ projectId: p.id, showRelated: true }).total).toBe(
    2,
  );
  expect(rt.catalog.collections()[0].count).toBe(2);
  const before = rt.catalog.get(ids[0]).title;
  events.length = 0;
  await expect(
    rt.handle("assets.organize", {
      ids: [ids[0], "missing"],
      title: { prefix: "bad-" },
    }),
  ).rejects.toThrow("不存在");
  expect(rt.catalog.get(ids[0]).title).toBe(before);
  expect(events).toEqual([]);
  await expect(
    rt.handle("assets.organize", {
      ids: all.map((a) => a.id),
      auxiliaryRole: "preview",
    }),
  ).rejects.toThrow("只支持图片");
  expect(rt.catalog.stats().auxiliaryAssets).toBe(0);
});
test("auxiliary images hide from search/counts while dependencies and portable round trips survive", async () => {
  const all = await fixture(),
    model = all.find((a) => a.extension === ".gltf")!,
    image = all.find((a) => a.path === "图-000.png")!;
  const p = rt.catalog.saveProject({ name: "项目" });
  rt.catalog.attach(p.id, [image.id]);
  await rt.handle("assets.organize", {
    ids: [image.id],
    auxiliaryRole: "preview",
  });
  expect(rt.catalog.query({ search: "图-000" }).total).toBe(0);
  expect(
    rt.catalog.query({ search: "图-000", includeAuxiliary: true }).total,
  ).toBe(1);
  expect(rt.catalog.stats().auxiliaryAssets).toBe(1);
  expect(rt.catalog.stats().files).toBe(3);
  expect(rt.catalog.projects()[0].assetCount).toBe(0);
  const target = path.join(base, "godot");
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "project.godot"), "config_version=5\n");
  const godot = await runExport(
    rt.catalog,
    inspectExport(rt.catalog, {
      assetIds: [model.id, image.id],
      mode: "godot",
      target,
    }),
    ctx(),
  );
  expect(godot.entries).toHaveLength(1);
  await fs.access(
    path.join(godot.target, godot.entries[0].entry, "..", "图-000.png"),
  );
  const portable = await runExport(
    rt.catalog,
    inspectExport(rt.catalog, {
      assetIds: [model.id],
      mode: "generic",
      target: path.join(base, "portable"),
      zip: true,
    }),
    ctx(),
  );
  const imported = await runImport(
    rt.catalog,
    await inspectImport([portable.zipPath!]),
    ctx(),
  );
  expect(
    imported.assets
      .map((id: string) => rt.catalog.get(id))
      .some((a: Asset) => a.metadata.auxiliaryRole === "preview"),
  ).toBe(true);
  const backup = await rt.backup(path.join(base, "backups"), ctx());
  const restored = path.join(base, "restored");
  await rt.restore(backup.target, restored, ctx());
  const recovered = await new Runtime(restored).init();
  try {
    expect(recovered.catalog.stats().auxiliaryAssets).toBe(
      rt.catalog.stats().auxiliaryAssets,
    );
  } finally {
    await recovered.shutdown();
  }
});
test("collection management respects rule membership and deletes organization only", async () => {
  const all = await fixture(),
    collection = rt.catalog.saveCollection("手工"),
    smart = rt.catalog.saveCollection("智能", { imageOnly: true });
  await rt.handle("collections.attach", {
    collectionId: collection,
    assetIds: [all[0].id],
  });
  await rt.handle("collections.update", { id: collection, name: "改名" });
  expect(rt.catalog.collections().find((c) => c.id === collection)!.name).toBe(
    "改名",
  );
  await expect(
    rt.handle("collections.attach", {
      collectionId: smart,
      assetIds: [all[0].id],
    }),
  ).rejects.toThrow("规则");
  await rt.handle("collections.detach", {
    collectionId: collection,
    assetIds: [all[0].id],
  });
  expect(rt.catalog.collections().find((c) => c.id === collection)!.count).toBe(
    0,
  );
  await rt.handle("collections.delete", { id: collection });
  expect(rt.catalog.get(all[0].id).id).toBe(all[0].id);
});
test("saved variant copy/rename persists JSON and referenced deletion is refused", async () => {
  const model = (await fixture()).find((a) => a.extension === ".gltf")!,
    v = await rt.handle("materials.save", defaultVariant(model));
  const copy = await rt.handle("materials.manage", {
    id: v.id,
    action: "copy",
  });
  expect(copy.id).not.toBe(v.id);
  await rt.handle("materials.manage", {
    id: copy.id,
    action: "rename",
    name: "秋季",
  });
  expect(
    JSON.parse(
      await fs.readFile(path.join(rt.root, `variants/${copy.id}.json`), "utf8"),
    ).name,
  ).toBe("秋季");
  const p = rt.catalog.saveProject({ name: "项目" });
  rt.catalog.attach(p.id, [model.id], copy.id);
  await expect(
    rt.handle("materials.manage", { id: copy.id, action: "delete" }),
  ).rejects.toThrow("引用");
  rt.catalog.detach(p.id, [model.id]);
  await rt.handle("materials.manage", { id: copy.id, action: "delete" });
  expect(rt.catalog.variants().some((v) => v.id === copy.id)).toBe(false);
  await expect(
    fs.access(path.join(rt.root, `variants/${copy.id}.json`)),
  ).rejects.toThrow();
});
test("quick export uses persistent project binding after restart and opens conflict inspection", async () => {
  const model = (await fixture()).find((a) => a.extension === ".gltf")!,
    target = path.join(base, "Godot");
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "project.godot"), "config_version=5\n");
  const p = rt.catalog.saveProject({ name: "游戏", godotPath: target });
  rt.catalog.attach(p.id, [model.id]);
  await rt.shutdown();
  rt = await new Runtime(rt.root).init();
  const first = await rt.handle("exports.quick", { projectId: p.id });
  expect(first.jobId).toBeTruthy();
  const job = await waitJob(first.jobId);
  expect(job.status).toBe("completed");
  const edited = path.join(job.result.target, job.result.entries[0].entry);
  await fs.writeFile(edited, "manual change");
  const second = await rt.handle("exports.quick", { projectId: p.id });
  expect(second.jobId).toBeUndefined();
  expect(second.plan.issues.join()).toContain("修改");
  expect(await fs.readFile(edited, "utf8")).toBe("manual change");
});
test("selected thumbnail rebuild changes its URL locally, retains old image on failure, and never creates assets", async () => {
  const image = (await fixture()).find((a) => a.extension === ".png")!,
    before = rt.catalog.stats();
  events.length = 0;
  let job = await waitJob(
    await rt.handle("previews.rebuild", { ids: [image.id] }),
  );
  expect(job.status).toBe("completed");
  const url = rt.catalog.get(image.id).thumbnailUrl!;
  expect(url).not.toBe(image.thumbnailUrl);
  expect(events.filter((e) => e.type === "thumbnail.ready")).toHaveLength(1);
  expect(events.some((e) => e.type === "catalog.changed")).toBe(false);
  expect(rt.catalog.stats().assets).toBe(before.assets);
  await fs.rm(sourcePath(rt.catalog, image));
  job = await waitJob(await rt.handle("previews.rebuild", { ids: [image.id] }));
  expect(job.status).toBe("failed");
  expect(rt.catalog.get(image.id).thumbnailUrl).toBe(url);
});

test("FBX parser upgrade retries old failures once and successful thumbnails clear the failure without refreshing the catalog", async () => {
  const source = path.join(base, "bridge.fbx");
  await fs.copyFile(
    "tests/fixtures/kenney-nature/bridge_center_wood.fbx",
    source,
  );
  const result = await runImport(
    rt.catalog,
    await inspectImport([source]),
    ctx(),
  );
  const id = result.assets[0];
  rt.catalog.update([id], { metadata: { thumbnailError: true } });
  events.length = 0;
  await rt.handle("previews.request", { assetId: id });
  await rt.handle("previews.request", { assetId: id });
  expect(events.filter((e) => e.type === "thumbnail.request")).toHaveLength(1);
  await rt.handle("previews.thumbnailFailed", { assetId: id });
  expect(rt.catalog.get(id).metadata.thumbnailErrorVersion).toBe(
    FBX_PREVIEW_VERSION,
  );
  await rt.handle("previews.request", { assetId: id });
  expect(events.filter((e) => e.type === "thumbnail.request")).toHaveLength(1);
  const png = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "#936b42" },
  })
    .png()
    .toBuffer();
  await rt.handle("previews.thumbnail", {
    assetId: id,
    base64: png.toString("base64"),
  });
  expect(rt.catalog.get(id).metadata.thumbnailError).toBe(false);
  expect(rt.catalog.get(id).thumbnailUrl).toBeTruthy();
  expect(events.filter((e) => e.type === "thumbnail.ready")).toHaveLength(1);
  expect(events.some((e) => e.type === "catalog.changed")).toBe(false);
});
