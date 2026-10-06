import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { FBXLoader } from "three/addons/loaders/FBXLoader.js";
import { normalizeFBX, FBX_PREVIEW_VERSION } from "../src/shared/fbx.ts";

// Read-only parser validation of the real Nature Kit. The argument is the
// official package's source/Models/FBX format folder, not a running database.
const folder = process.argv[2];
if (!folder) throw new Error("请提供 Nature Kit 的 FBX 目录");
const files = (await fs.readdir(folder))
  .filter((f) => /\.fbx$/i.test(f))
  .sort();
const results = [];
for (const file of files) {
  const result = { file, passed: false };
  try {
    const source = await fs.readFile(path.join(folder, file));
    const hash = () => createHash("sha256").update(source).digest("hex");
    result.sha256 = hash();
    const buffer = source.buffer.slice(
      source.byteOffset,
      source.byteOffset + source.byteLength,
    );
    const root = new FBXLoader().parse(normalizeFBX(buffer), "");
    result.meshes = 0;
    result.triangles = 0;
    result.uvMeshes = 0;
    root.traverse((node) => {
      if (!node.isMesh) return;
      result.meshes++;
      const geometry = node.geometry;
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      result.triangles +=
        (geometry.index?.count ?? geometry.attributes.position.count) / 3;
      if (geometry.attributes.uv) result.uvMeshes++;
      for (const attr of Object.values(geometry.attributes))
        if (!Array.from(attr.array).every(Number.isFinite))
          throw new Error("几何属性含非有限数值");
      for (const group of geometry.groups)
        if (
          !Number.isInteger(group.materialIndex) ||
          !materials[group.materialIndex]
        )
          throw new Error("材质分组索引无效");
      if (
        geometry.groups.length &&
        geometry.groups.reduce((n, g) => n + g.count, 0) !==
          (geometry.index?.count ?? geometry.attributes.position.count)
      )
        throw new Error("材质分组未覆盖全部几何");
      geometry.dispose();
      materials.forEach((m) => m.dispose());
    });
    if (!result.meshes || !result.triangles) throw new Error("没有几何体");
    if (hash() !== result.sha256) throw new Error("输入数据被修改");
    result.passed = true;
  } catch (error) {
    result.error = error.message;
  }
  results.push(result);
}
const report = {
  date: new Date().toISOString(),
  previewParserVersion: FBX_PREVIEW_VERSION,
  source: "Kenney Nature Kit — CC0-1.0",
  sourcePage: "https://kenney.nl/assets/nature-kit",
  scope:
    "ASCII FBX parsing; finite attributes; valid complete material groups; originals unchanged. Desktop rendering is verified separately.",
  total: results.length,
  passed: results.filter((r) => r.passed).length,
  failed: results.filter((r) => !r.passed).length,
  results,
};
await fs.writeFile(
  "docs/fbx-parser-validation.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    total: report.total,
    passed: report.passed,
    failed: report.failed,
  }),
);
if (report.failed || !report.total) process.exitCode = 1;
