import { beforeEach, afterEach, test, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import yazl from "yazl";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { writePsdBuffer } from "ag-psd";
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
  exportVariant,
  materialTextures,
} from "../src/core/exporter";
import { downloadOne } from "../src/core/sources";
import { rebuildLibrary } from "../src/core/recovery";
import { MediaPool } from "../src/core/media-pool";
import { inside, uid, safeRelative, hashFile } from "../src/core/files";
import { defaultVariant, type Asset } from "../src/shared/types";
let base: string, catalog: Catalog, root: string;
test("SVG refuses relative file references and material IDs cannot escape the variants directory", async () => {
  const folder = path.join(base, "不可信交付");
  await fs.mkdir(folder);
  await png(path.join(folder, "valid.png"));
  await fs.writeFile(
    path.join(folder, "external.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><image href="../../private.png" width="2" height="2"/></svg>',
  );
  const result = await importFolder(folder),
    assets = result.assets.map((id: string) => catalog.get(id)) as Asset[];
  expect(
    assets.find((a) => a.extension === ".svg")!.metadata.previewError,
  ).toContain("外部");
  const runtime = new Runtime(root);
  runtime.catalog = catalog;
  await expect(
    runtime.handle("materials.save", {
      ...defaultVariant(assets.find((a) => a.extension === ".png")!),
      id: "../../escape",
    }),
  ).rejects.toThrow();
});
const ctx = (): JobContext => ({
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
  base = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-reliability-"));
  root = path.join(base, "库");
  catalog = new Catalog(root);
  await fs.mkdir(path.join(root, "cache"), { recursive: true });
});
afterEach(async () => {
  vi.unstubAllGlobals();
  catalog.close();
  await fs.rm(base, { recursive: true, force: true });
});
async function png(file: string, color = "#806040") {
  await sharp({
    create: { width: 2, height: 2, channels: 4, background: color },
  })
    .png()
    .toFile(file);
}
async function importFolder(folder: string) {
  return runImport(catalog, await inspectImport([folder]), ctx());
}
test.each(["a/con.png", "a/b?.png", "a/line:1.png", "a/trailing.", "a/b "])(
  "cross-platform names are rejected: %s",
  (p) => expect(() => safeRelative(p)).toThrow(),
);
test("new revision retains edited metadata; project only upgrades explicitly", async () => {
  const folder = path.join(base, "交付");
  await fs.mkdir(folder);
  await png(path.join(folder, "按钮.png"));
  const initial = await importFolder(folder),
    old = catalog.get(initial.assets[0]);
  catalog.update([old.id], {
    title: "开始按钮",
    category: "controls",
    tags: ["start"],
  });
  const project = catalog.saveProject({ name: "游戏" });
  catalog.attach(project.id, [old.id]);
  await png(path.join(folder, "按钮.png"), "#ff0000");
  const plan = await inspectImport([folder]);
  plan.parentAssetId = old.id;
  const result = await runImport(catalog, plan, ctx()),
    latest = catalog.get(result.assets[0]);
  expect(latest.packageId).toBe(old.packageId);
  expect(latest.revisionId).not.toBe(old.revisionId);
  expect(latest.title).toBe("开始按钮");
  expect(latest.category).toBe("controls");
  expect(latest.tags).toContain("start");
  expect(catalog.query({ projectId: project.id }).items[0].id).toBe(old.id);
  const runtime = new Runtime(root);
  runtime.catalog = catalog;
  await runtime.handle("projects.upgrade", {
    projectId: project.id,
    fromAssetId: old.id,
    toAssetId: latest.id,
  });
  expect(catalog.query({ projectId: project.id }).items[0].id).toBe(latest.id);
});
test("portable ZIP retains state references and variant bindings after ID collision", async () => {
  const folder = path.join(base, "UI");
  await fs.mkdir(folder);
  await png(path.join(folder, "button_normal.png"));
  await png(path.join(folder, "button_hover.png"), "#bb7722");
  await fs.writeFile(
    path.join(folder, "model.gltf"),
    JSON.stringify({
      asset: { version: "2.0" },
      materials: [{}],
      accessors: [{ count: 3 }],
      meshes: [{ primitives: [{ attributes: { TEXCOORD_0: 0 } }] }],
    }),
  );
  const result = await importFolder(folder),
    a = catalog.get(result.assets[0]),
    b = catalog.get(result.assets[1]),
    model = result.assets
      .map((id: string) => catalog.get(id))
      .find((a: Asset) => a.extension === ".gltf")!;
  catalog.update([a.id, b.id], {
    metadata: {
      stateGroup: [
        { id: a.id, label: "normal" },
        { id: b.id, label: "hover" },
      ],
      nineSlice: { top: 2, right: 2, bottom: 2, left: 2 },
    },
  });
  const v = catalog.saveVariant({
    ...defaultVariant(model),
    name: "贴图变体",
    bindings: {
      baseColor: {
        assetId: b.id,
        revisionId: b.revisionId,
        channel: "rgb",
        uv: 0,
      },
    },
  });
  const exported = await runExport(
    catalog,
    inspectExport(catalog, {
      assetIds: [a.id, model.id],
      variantIds: [v.id],
      target: path.join(base, "输出"),
      mode: "generic",
      zip: true,
    }),
    ctx(),
  );
  const reimported = await importFolder(exported.zipPath!);
  const mapped = reimported.idMapping;
  expect(mapped[a.id]).not.toBe(a.id);
  expect(catalog.get(mapped[a.id]).metadata.stateGroup[1].id).toBe(
    mapped[b.id],
  );
  expect(
    catalog.variants(mapped[model.id])[0].bindings.baseColor?.assetId,
  ).toBe(mapped[b.id]);
  expect(catalog.get(mapped[a.id]).metadata.nineSlice.top).toBe(2);
});
test("rebuilding from manifests survives a corrupt catalog and restores project relations", async () => {
  const folder = path.join(base, "UI");
  await fs.mkdir(folder);
  await png(path.join(folder, "icon.png"));
  await png(path.join(folder, "remove.png"), "#ff7722");
  const result = await importFolder(folder),
    p = catalog.saveProject({ name: "项目" });
  catalog.attach(p.id, result.assets);
  catalog.detach(p.id, [result.assets[1]]);
  catalog.update([result.assets[1]], { trashed: true });
  const runtime = new Runtime(root);
  runtime.catalog = catalog;
  await runtime.handle("assets.purge", { ids: [result.assets[1]] });
  catalog.update([result.assets[0]], { tags: ["图标"], notes: "保存备注" });
  await catalog.snapshot();
  await fs.writeFile(
    path.join(root, "library.json"),
    JSON.stringify({ id: uid(), schemaVersion: 1, cacheGB: 20 }),
  );
  catalog.close();
  await fs.writeFile(path.join(root, "catalog.sqlite"), "corrupt");
  const target = path.join(base, "重建");
  await rebuildLibrary(root, target);
  const rebuilt = new Catalog(target);
  expect(rebuilt.projects()[0].assetCount).toBe(1);
  expect(rebuilt.stats().assets).toBe(1);
  expect(rebuilt.get(result.assets[0]).tags).toEqual(["图标"]);
  expect(rebuilt.get(result.assets[0]).notes).toBe("保存备注");
  rebuilt.close();
  await fs.rm(path.join(root, "catalog.sqlite"), { force: true });
  await fs.rm(path.join(root, "catalog.sqlite-wal"), { force: true });
  await fs.rm(path.join(root, "catalog.sqlite-shm"), { force: true });
  catalog = new Catalog(root);
});
test("partial roughness rebinding keeps the original metallic channel", async () => {
  const folder = path.join(base, "PBR");
  await fs.mkdir(folder);
  await png(path.join(folder, "new.png"), "#7f4020");
  await png(path.join(folder, "orm.png"), "#336699");
  await fs.writeFile(
    path.join(folder, "model.gltf"),
    JSON.stringify({
      asset: { version: "2.0" },
      accessors: [{ count: 3 }, { count: 3 }],
      meshes: [
        { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 } }] },
      ],
      materials: [
        {
          pbrMetallicRoughness: {
            metallicRoughnessTexture: { index: 0 },
            metallicFactor: 1,
          },
        },
      ],
      textures: [{ source: 0 }],
      images: [{ uri: "orm.png" }],
    }),
  );
  const result = await importFolder(folder),
    assets = result.assets.map((id: string) => catalog.get(id)) as Asset[],
    model = assets.find((a) => a.extension === ".gltf")!,
    tex = assets.find((a) => a.path === "new.png")!,
    v = {
      ...defaultVariant(model),
      name: "保留金属",
      bindings: {
        roughness: {
          assetId: tex.id,
          revisionId: tex.revisionId,
          channel: "g" as const,
          uv: 0 as const,
        },
      },
    };
  const folderOut = path.join(base, "out");
  await fs.mkdir(folderOut);
  await exportVariant(catalog, model, v, folderOut);
  const files = await fs.readdir(path.join(folderOut, "variants"), {
    recursive: true,
  });
  const file = files.find((f) => f.endsWith("orm.png"))!;
  const raw = await sharp(path.join(folderOut, "variants", file))
    .raw()
    .toBuffer();
  expect(raw[1]).toBe(64);
  expect(raw[2]).toBe(153);
});
test("Range resume uses validators and restarts when the server returns 200", async () => {
  const folder = path.join(base, "下载");
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, "data.bin.partial"), "abc");
  await fs.writeFile(
    path.join(folder, "data.bin.http.json"),
    JSON.stringify({ etag: '"v1"', url: "https://example.org/data" }),
  );
  const fetcher = vi.fn(
    async () =>
      new Response("def", {
        status: 206,
        headers: {
          "content-range": "bytes 3-5/6",
          "content-length": "3",
          etag: '"v1"',
        },
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  await downloadOne(
    { path: "data.bin", url: "https://example.org/data", bytes: 6 },
    folder,
    ctx(),
    0,
    1,
  );
  expect((fetcher.mock.calls[0] as any)[1].headers.Range).toBe("bytes=3-");
  expect(await fs.readFile(path.join(folder, "data.bin"), "utf8")).toBe(
    "abcdef",
  );
  await fs.rm(path.join(folder, "data.bin"));
  await fs.writeFile(path.join(folder, "data.bin.partial"), "old");
  fetcher.mockImplementation(
    async () =>
      new Response("newone", {
        headers: { "content-length": "6", etag: '"v2"' },
      }),
  );
  await downloadOne(
    { path: "data.bin", url: "https://example.org/data", bytes: 6 },
    folder,
    ctx(),
    0,
    1,
  );
  expect(await fs.readFile(path.join(folder, "data.bin"), "utf8")).toBe(
    "newone",
  );
});
test("a failed parser child is isolated and the next parser request recovers", async () => {
  const worker = path.join(base, "worker.cjs");
  await fs.writeFile(
    worker,
    "process.on('message',m=>{if(m.filename==='crash')process.exit(1);else process.send({metadata:{width:4}})});",
  );
  const pool = new MediaPool(worker),
    file = {
      id: uid(),
      path: "a.png",
      sha256: "0".repeat(64),
      bytes: 1,
      extension: ".png",
      metadata: {},
    };
  try {
    expect(
      (await pool.inspect("crash", file, root)).metadata.previewError,
    ).toContain("异常退出");
    expect((await pool.inspect("ok", file, root)).metadata.width).toBe(4);
  } finally {
    pool.close();
  }
});
test("PSD, TGA, KRA and multipage TIFF create real previews", async () => {
  const folder = path.join(base, "格式");
  await fs.mkdir(folder);
  const data = new Uint8ClampedArray(16).fill(255);
  await fs.writeFile(
    path.join(folder, "composite.psd"),
    writePsdBuffer({
      width: 2,
      height: 2,
      imageData: { width: 2, height: 2, data },
      children: [],
    }),
  );
  const tga = Buffer.alloc(30);
  tga[2] = 2;
  tga.writeUInt16LE(2, 12);
  tga.writeUInt16LE(2, 14);
  tga[16] = 24;
  tga.fill(128, 18);
  await fs.writeFile(path.join(folder, "raw.tga"), tga);
  const pngData = await sharp({
    create: { width: 2, height: 2, channels: 4, background: "#008080" },
  })
    .png()
    .toBuffer();
  const zip = new yazl.ZipFile();
  zip.addBuffer(pngData, "mergedimage.png");
  zip.end();
  await pipeline(
    zip.outputStream,
    createWriteStream(path.join(folder, "paint.kra")),
  );
  const tiff = Buffer.alloc(296);
  tiff.write("II");
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  for (const [n, start] of [8, 152].entries()) {
    tiff.writeUInt16LE(10, start);
    const entries = [
      [256, 4, 1, 2],
      [257, 4, 1, 2],
      [258, 3, 3, start + 126],
      [259, 3, 1, 1],
      [262, 3, 1, 2],
      [273, 4, 1, start + 132],
      [277, 3, 1, 3],
      [278, 4, 1, 2],
      [279, 4, 1, 12],
      [284, 3, 1, 1],
    ];
    entries.forEach(([tag, type, count, value], i) => {
      const p = start + 2 + i * 12;
      tiff.writeUInt16LE(tag, p);
      tiff.writeUInt16LE(type, p + 2);
      tiff.writeUInt32LE(count, p + 4);
      tiff.writeUInt32LE(value, p + 8);
    });
    tiff.writeUInt32LE(n ? 0 : 152, start + 122);
    for (let i = 0; i < 3; i++) tiff.writeUInt16LE(8, start + 126 + i * 2);
    tiff.fill(n ? 64 : 128, start + 132, start + 144);
  }
  await fs.writeFile(path.join(folder, "pages.tiff"), tiff);
  const result = await importFolder(folder);
  for (const id of result.assets) {
    const a = catalog.get(id);
    expect(a.metadata.previewError, a.path).toBeUndefined();
    expect(a.metadata.width).toBe(2);
    expect(a.thumbnailUrl).toBeTruthy();
    expect(a.metadata.previewCache).toBeTruthy();
  }
  const tif = result.assets
    .map((id: string) => catalog.get(id))
    .find((a: Asset) => a.extension === ".tiff")!;
  expect(tif.metadata.pages).toBe(2);
  const runtime = new Runtime(root);
  runtime.catalog = catalog;
  const url = await runtime.handle("previews.imagePage", {
    assetId: tif.id,
    page: 1,
  });
  expect(url).toContain("preview-v2");
  const pixels = await sharp(
    inside(path.join(root, "cache"), url.split("/").at(-1)),
  )
    .raw()
    .toBuffer();
  expect(pixels[0]).toBe(64);
});
