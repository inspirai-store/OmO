import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { DatabaseSync } from "node:sqlite";
import { _electron as electron, expect } from "@playwright/test";
const dir = path.resolve(".data/large-model/source");
await fs.mkdir(dir, { recursive: true });
const columns = 500,
  rows = 250,
  count = (columns + 1) * (rows + 1),
  positions = new Float32Array(count * 3),
  normals = new Float32Array(count * 3),
  uvs = new Float32Array(count * 2),
  indices = new Uint32Array(columns * rows * 6);
let minY = 10,
  maxY = -10;
for (let y = 0; y <= rows; y++)
  for (let x = 0; x <= columns; x++) {
    const i = y * (columns + 1) + x,
      h = 0.15 * Math.sin(x * 0.04) * Math.cos(y * 0.04);
    positions.set([(x / columns - 0.5) * 4, h, (y / rows - 0.5) * 2], i * 3);
    minY = Math.min(minY, h);
    maxY = Math.max(maxY, h);
    normals[i * 3 + 1] = 1;
    uvs.set([x / columns, y / rows], i * 2);
  }
let k = 0;
for (let y = 0; y < rows; y++)
  for (let x = 0; x < columns; x++) {
    const a = y * (columns + 1) + x,
      b = a + 1,
      c = a + columns + 1,
      d = c + 1;
    indices.set([a, c, b, b, c, d], k);
    k += 6;
  }
const arrays = [
    positions,
    normals,
    uvs,
    indices,
    new Float32Array([0, 2]),
    new Float32Array([0, 0, 0, 1, 0, 0.7071068, 0, 0.7071068]),
  ],
  views = [];
let offset = 0;
for (const a of arrays) {
  views.push({ buffer: 0, byteOffset: offset, byteLength: a.byteLength });
  offset += a.byteLength;
}
await fs.writeFile(
  path.join(dir, "geometry.bin"),
  Buffer.concat(arrays.map((a) => Buffer.from(a.buffer))),
);
const db = new DatabaseSync(path.resolve(".data/library/catalog.sqlite")),
  asset = db
    .prepare(
      "SELECT path,package_id,revision_id FROM assets WHERE json_extract(source,'$.assetId')='WoodFloor051' AND path LIKE '%Color.png' LIMIT 1",
    )
    .get();
db.close();
if (!asset) throw new Error("请先安装木地板示例");
await fs.copyFile(
  path.join(
    ".data/library/packages",
    asset.package_id,
    asset.revision_id,
    "source",
    asset.path,
  ),
  path.join(dir, "wood-2k.png"),
);
const accessors = [
  {
    bufferView: 0,
    componentType: 5126,
    count,
    type: "VEC3",
    min: [-2, minY, -1],
    max: [2, maxY, 1],
  },
  { bufferView: 1, componentType: 5126, count, type: "VEC3" },
  { bufferView: 2, componentType: 5126, count, type: "VEC2" },
  { bufferView: 3, componentType: 5125, count: indices.length, type: "SCALAR" },
  {
    bufferView: 4,
    componentType: 5126,
    count: 2,
    type: "SCALAR",
    min: [0],
    max: [2],
  },
  { bufferView: 5, componentType: 5126, count: 2, type: "VEC4" },
];
await fs.writeFile(
  path.join(dir, "250000-triangles.gltf"),
  JSON.stringify({
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0 },
          metallicFactor: 0,
          roughnessFactor: 0.7,
        },
        doubleSided: true,
      },
    ],
    textures: [{ source: 0 }],
    images: [{ uri: "wood-2k.png" }],
    buffers: [{ uri: "geometry.bin", byteLength: offset }],
    bufferViews: views,
    accessors,
    animations: [
      {
        name: "GPU压力旋转",
        samplers: [{ input: 4, output: 5 }],
        channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }],
      },
    ],
  }),
);
const root = path.resolve(".data/large-model/library-" + Date.now()),
  app = await electron.launch({
    args: ["out/main/index.cjs"],
    env: { ...process.env, WORKSHOP_LIBRARY: root },
  }),
  page = await app.firstWindow(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.waitForSelector(".asset-browser");
  await app.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
  }, dir);
  await page.getByRole("button", { name: "导入素材", exact: true }).click();
  await page.getByRole("button", { name: "开始导入", exact: true }).click();
  await expect(page.locator(".asset-card")).toHaveCount(1, { timeout: 30000 });
  await page.locator(".asset-card").dblclick();
  await expect(page.getByRole("dialog").locator(".viewer-message")).toHaveCount(
    0,
    { timeout: 30000 },
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "播放动画", exact: true })
    .click();
  await page.waitForTimeout(1000);
  const result = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0;
        const start = performance.now();
        function tick(time) {
          if (time - start >= 5000)
            resolve({
              frames,
              elapsedMs: time - start,
              fps: (frames * 1000) / (time - start),
            });
          else {
            frames++;
            requestAnimationFrame(tick);
          }
        }
        requestAnimationFrame(tick);
      }),
  );
  const report = {
    date: new Date().toISOString(),
    cpu: os.cpus()[0].model,
    ramGiB: os.totalmem() / 1024 ** 3,
    triangles: 250000,
    texture: "ambientCG WoodFloor051 2K PNG",
    method:
      "rAF scheduling rate during continuously rendered model animation; desktop Chromium, two viewer contexts",
    result,
    errors,
  };
  await fs.writeFile(
    "docs/large-model-performance.json",
    JSON.stringify(report, null, 2),
  );
  await page.screenshot({ path: "docs/screenshots/large-model.png" });
  console.log("25万三角形", result);
  if (errors.length) process.exitCode = 1;
} finally {
  await app.close();
}
