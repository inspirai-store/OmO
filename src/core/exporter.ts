import fs from "node:fs/promises";
import path from "node:path";
import { formatKey } from "./aggregation";
import sharp from "sharp";
import yazl from "yazl";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createHash } from "node:crypto";
import {
  atomicJSON,
  copyVerified,
  hashFile,
  inside,
  now,
  uid,
  WorkshopError,
  walk,
  resolveDependency,
} from "./files";
import { readGltf } from "./media";
import type { Catalog } from "./catalog";
import type {
  Asset,
  ExportPlan,
  ExportRequest,
  MaterialVariant,
  TextureBinding,
  TextureSlot,
} from "../shared/types";
import type { JobContext } from "./importer";

export const sourcePath = (catalog: Catalog, a: Asset) =>
  inside(
    path.join(catalog.root, "packages", a.packageId, a.revisionId, "source"),
    a.path,
  );
const slug = (s: string) =>
  s
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/[. ]+$/, "")
    .slice(0, 64) || "asset";
export function inspectExport(
  catalog: Catalog,
  request: ExportRequest,
): ExportPlan {
  let assets = request.assetIds
    .map((id) => catalog.get(id))
    .filter(
      (a) => request.mode !== "godot" || a.metadata.auxiliaryRole !== "preview",
    );
  const variants = catalog
      .variants()
      .filter((v) => request.variantIds?.includes(v.id)),
    issues: string[] = [];
  if (request.mode === "godot" && (request.preferGLTF ?? request.aggregate)) {
    const preferred = new Map<string, Asset>();
    const variantModels = new Set(variants.map((v) => v.assetId));
    for (const a of assets) {
      if (![".glb", ".gltf"].includes(a.extension)) continue;
      const key = `${a.revisionId}:${formatKey(a.path)}`,
        old = preferred.get(key);
      if (
        !old ||
        (a.extension === ".glb" && !variantModels.has(old.id)) ||
        variantModels.has(a.id)
      )
        preferred.set(key, a);
    }
    assets = assets.filter((a) => {
      if (
        variantModels.has(a.id) ||
        ![".glb", ".gltf", ".fbx", ".obj", ".blend"].includes(a.extension)
      )
        return true;
      const best = preferred.get(`${a.revisionId}:${formatKey(a.path)}`);
      return !best || best.id === a.id;
    });
  }
  if (request.mode === "generic") {
    const revisions = [...new Set(assets.map((a) => a.revisionId))];
    for (const revision of revisions)
      for (const row of catalog.db
        .prepare(
          "SELECT id FROM assets WHERE revision_id=? AND json_extract(metadata,'$.auxiliaryRole')='preview' AND trashed=0",
        )
        .all(revision))
        if (!assets.some((a) => a.id === row.id))
          assets.push(catalog.get(row.id));
  }
  if (!assets.length)
    issues.push("没有可导出的普通素材；辅助预览图不单独交付到 Godot");
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    for (const s of a.metadata.stateGroup ?? []) {
      if (!assets.some((a) => a.id === s.id)) assets.push(catalog.get(s.id));
    }
  }
  for (const v of variants)
    for (const b of Object.values(v.bindings)) {
      if (!assets.some((a) => a.id === b!.assetId))
        assets.push(catalog.get(b!.assetId));
    }
  for (const a of assets) {
    if (a.trashed) issues.push(`${a.title} 已进入回收站`);
    if (a.metadata.missing?.length)
      issues.push(`${a.title} 缺少依赖：${a.metadata.missing.join("、")}`);
  }
  if (request.familyBatchId) {
    const members = assets.filter(
      (a) => a.metadata.family?.batchId === request.familyBatchId,
    );
    if (!members.length) issues.push("选中素材不包含指定的同类批次");
    const keys = new Set<string>();
    for (const a of members) {
      const f = a.metadata.family,
        key = `${f.key}:${f.size}`;
      if (
        !/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(f.key) ||
        ![512, 128, 64].includes(f.size) ||
        a.extension !== ".png" ||
        a.metadata.width !== f.size ||
        a.metadata.height !== f.size ||
        !a.metadata.hasAlpha ||
        typeof f.familyId !== "string" ||
        typeof f.templateId !== "string" ||
        !Number.isInteger(f.templateVersion) ||
        f.templateVersion < 1
      )
        issues.push(`${a.title} 同类条目或规格无效`);
      if (keys.has(key)) issues.push(`${a.title} 同类条目与尺寸重复`);
      keys.add(key);
    }
    for (const key of new Set(members.map((a) => a.metadata.family.key)))
      if (![512, 128, 64].every((size) => keys.has(`${key}:${size}`)))
        issues.push(`${key} 缺少标准图或派生尺寸`);
  }
  for (const v of variants) {
    const a = catalog.get(v.assetId);
    if (
      v.normalConvention === "dx" &&
      !v.bindings.normal &&
      !a.metadata.materialSet
    )
      issues.push(`${v.name}：DirectX 法线转换需要明确绑定法线贴图`);
    if (![".glb", ".gltf"].includes(a.extension) && !a.metadata.materialSet)
      issues.push(`${a.title} 的变体需要先转换为 glTF`);
    if (!assets.some((a) => a.id === v.assetId))
      issues.push(`变体 ${v.name} 的模型未被选中`);
    for (const b of Object.values(v.bindings)) {
      const t = catalog.get(b!.assetId);
      if (t.revisionId !== b!.revisionId)
        issues.push(`贴图 ${t.title} 版本不一致`);
    }
    if (
      a.metadata.materialSet &&
      (v.rotation !== 0 || Object.values(v.bindings).some((b) => b!.uv !== 0))
    )
      issues.push(`${v.name} 的独立 Godot 材质暂不支持 UV1 或 UV 旋转`);
  }
  return {
    id: uid(),
    request,
    assets,
    variants,
    issues,
    bytes: assets.reduce((n, a) => n + a.bytes, 0),
  };
}
async function safeCopy(
  source: string,
  target: string,
  hash: string,
  ctx: JobContext,
) {
  if (await fs.stat(target).catch(() => null)) {
    if ((await hashFile(target, () => ctx.check())) !== hash)
      throw new WorkshopError(
        "EXPORT_CONFLICT",
        `目标文件已被修改，保留原文件：${target}`,
      );
    return;
  }
  const actual = await copyVerified(source, target, () => ctx.check());
  if (actual !== hash)
    throw new WorkshopError("SOURCE_CHANGED", "库内原件校验失败，请修复原件");
}
function closure(catalog: Catalog, a: Asset) {
  const manifest = catalog.revision(a.revisionId),
    selected = new Set<string>([
      a.path,
      ...a.dependencies,
      ...(a.relatedPaths ?? []),
    ]),
    queue = [...selected];
  while (queue.length) {
    const from = queue.pop()!;
    for (const d of manifest.dependencies.filter(
      (d) => d.from === from && d.status === "resolved",
    ))
      if (!selected.has(d.target)) {
        selected.add(d.target);
        queue.push(d.target);
      }
  }
  return manifest.files.filter((f) => selected.has(f.path));
}
async function bindingImage(
  catalog: Catalog,
  b: TextureBinding,
  size?: { width: number; height: number },
) {
  const a = catalog.get(b.assetId);
  if (a.revisionId !== b.revisionId) throw new Error("贴图版本不匹配");
  let image = sharp(sourcePath(catalog, a), {
    limitInputPixels: 100000000,
  }).ensureAlpha();
  if (size) image = image.resize(size.width, size.height, { fit: "fill" });
  return image.raw().toBuffer({ resolveWithObject: true });
}
export async function materialTextures(
  catalog: Catalog,
  v: MaterialVariant,
  dest: string,
  originalORM?: Buffer,
) {
  await fs.mkdir(dest, { recursive: true });
  const paths: Partial<Record<TextureSlot | "orm", string>> = {};
  for (const slot of ["baseColor", "normal", "emission"] as TextureSlot[]) {
    const binding = v.bindings[slot];
    if (!binding) continue;
    const { data, info } = await bindingImage(catalog, binding);
    if (slot === "normal" && v.normalConvention === "dx")
      for (let i = 1; i < data.length; i += 4) data[i] = 255 - data[i];
    const name = `${slot}.png`;
    await sharp(data, {
      raw: { width: info.width, height: info.height, channels: 4 },
    })
      .png()
      .toFile(path.join(dest, name));
    paths[slot] = name;
  }
  const bindings = ["ao", "roughness", "metallic"].map(
    (s) => v.bindings[s as TextureSlot],
  );
  const present = bindings.filter(Boolean) as TextureBinding[];
  if (present.length) {
    const dimensions = await Promise.all(
      present.map((b) =>
        sharp(sourcePath(catalog, catalog.get(b.assetId))).metadata(),
      ),
    );
    const width = Math.max(...dimensions.map((d) => d.width ?? 1)),
      height = Math.max(...dimensions.map((d) => d.height ?? 1));
    if (width > 8192 || height > 8192)
      throw new Error("材质通道合并支持最大 8K 贴图");
    const output = Buffer.alloc(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      output[i * 3] = 255;
      output[i * 3 + 1] = 255;
      output[i * 3 + 2] = 255;
    }
    if (originalORM) {
      const data = await sharp(originalORM)
        .resize(width, height, { fit: "fill" })
        .ensureAlpha()
        .raw()
        .toBuffer();
      for (let i = 0; i < width * height; i++) {
        output[i * 3 + 1] = data[i * 4 + 1];
        output[i * 3 + 2] = data[i * 4 + 2];
      }
    }
    for (const [channel, b] of bindings.entries()) {
      if (!b) continue;
      const { data } = await bindingImage(catalog, b, { width, height });
      const index = { r: 0, g: 1, b: 2, a: 3, rgb: 0 }[b.channel];
      for (let i = 0; i < width * height; i++)
        output[i * 3 + channel] = data[i * 4 + index];
    }
    await sharp(output, { raw: { width, height, channels: 3 } })
      .png()
      .toFile(path.join(dest, "orm.png"));
    paths.orm = "orm.png";
  }
  return paths;
}
function color(hex: string) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}
function srgbToLinear(c: number) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
export async function exportVariant(
  catalog: Catalog,
  a: Asset,
  v: MaterialVariant,
  folder: string,
) {
  let originalORM: Buffer | undefined;
  const gltf = a.metadata.materialSet
    ? undefined
    : await readGltf(sourcePath(catalog, a));
  const mr =
    gltf?.document.materials?.[v.materialIndex]?.pbrMetallicRoughness
      ?.metallicRoughnessTexture;
  if (mr && (v.bindings.roughness || v.bindings.metallic)) {
    const doc = gltf!.document,
      texture = doc.textures?.[mr.index],
      image = doc.images?.[texture?.source];
    if (image?.uri) {
      if (image.uri.startsWith("data:"))
        originalORM = Buffer.from(image.uri.split(",")[1], "base64");
      else {
        const rel = resolveDependency(a.path, image.uri);
        if (!rel.remote)
          originalORM = await fs.readFile(
            inside(
              path.dirname(sourcePath(catalog, { ...a, path: "__root__" })),
              rel.path,
            ),
          );
      }
    } else if (image?.bufferView !== undefined) {
      const view = doc.bufferViews[image.bufferView];
      let bin = gltf!.bin;
      if (!bin) {
        const rel = resolveDependency(a.path, doc.buffers[view.buffer].uri);
        if (rel.remote) throw new Error("不能读取远程缓冲");
        bin = await fs.readFile(
          inside(
            path.dirname(sourcePath(catalog, { ...a, path: "__root__" })),
            rel.path,
          ),
        );
      }
      originalORM = bin!.subarray(
        view.byteOffset ?? 0,
        (view.byteOffset ?? 0) + view.byteLength,
      );
    }
  }
  const variantKey =
    v.id +
    "-" +
    createHash("sha256")
      .update("exporter-v2\n" + JSON.stringify(v))
      .digest("hex")
      .slice(0, 10);
  const textureFolder = path.join(folder, "variants", variantKey),
    maps = await materialTextures(catalog, v, textureFolder, originalORM);
  if (a.metadata.materialSet) {
    await writeGodotMaterial(
      path.join(textureFolder, "material.tres"),
      v,
      maps,
    );
    return path
      .relative(folder, path.join(textureFolder, "material.tres"))
      .replace(/\\/g, "/");
  }
  const { document, bin } = gltf!;
  const doc = structuredClone(document);
  if (!doc.materials?.[v.materialIndex]) throw new Error("所选材质索引不存在");
  const original = doc.materials[v.materialIndex];
  const unsupported = Object.keys(original.extensions ?? {}).filter(
    (k) => k !== "KHR_materials_unlit",
  );
  if (unsupported.length)
    throw new Error(`此材质扩展只读：${unsupported.join(", ")}`);
  if (original.extensions?.KHR_materials_unlit)
    throw new Error("无光照材质只读，标准 PBR 变体需要使用 PBR 模型");
  const modelFolder = path.dirname(path.join(folder, a.path));
  await fs.mkdir(modelFolder, { recursive: true });
  if (bin) {
    doc.buffers[0].uri = `${path.basename(a.path, path.extname(a.path))}-${variantKey}.bin`;
    await fs.writeFile(
      path.join(modelFolder, doc.buffers[0].uri),
      bin.subarray(0, doc.buffers[0].byteLength),
    );
  }
  doc.images ??= [];
  doc.textures ??= [];
  doc.samplers ??= [];
  const sampler = doc.samplers.length;
  doc.samplers.push({
    magFilter: v.textureFilter === "nearest" ? 9728 : 9729,
    minFilter: v.textureFilter === "nearest" ? 9984 : 9987,
    wrapS: 10497,
    wrapT: 10497,
  });
  const addTexture = (file: string, uv: number) => {
    const image = doc.images.length;
    doc.images.push({
      uri: path
        .relative(modelFolder, path.join(textureFolder, file))
        .replace(/\\/g, "/"),
    });
    const index = doc.textures.length;
    doc.textures.push({ source: image, sampler });
    const info: any = { index, texCoord: uv };
    if (
      v.repeat[0] !== 1 ||
      v.repeat[1] !== 1 ||
      v.offset[0] ||
      v.offset[1] ||
      v.rotation
    ) {
      info.extensions = {
        KHR_texture_transform: {
          offset: v.offset,
          scale: v.repeat,
          rotation: v.rotation,
        },
      };
      doc.extensionsUsed = [
        ...new Set([...(doc.extensionsUsed ?? []), "KHR_texture_transform"]),
      ];
    }
    return info;
  };
  const mrUV = v.bindings.roughness?.uv ?? v.bindings.metallic?.uv ?? 0;
  if (
    v.bindings.roughness &&
    v.bindings.metallic &&
    v.bindings.roughness.uv !== v.bindings.metallic.uv
  )
    throw new Error("粗糙度和金属度需要相同 UV 通道");
  const m: any = {
    ...original,
    pbrMetallicRoughness: {
      ...original.pbrMetallicRoughness,
      baseColorFactor: [...color(v.baseColor).map(srgbToLinear), 1],
      roughnessFactor: v.roughness,
      metallicFactor: v.metallic,
    },
    alphaMode: v.alphaMode,
    alphaCutoff: v.alphaCutoff,
    doubleSided: v.doubleSided,
    emissiveFactor: color(v.emission).map(srgbToLinear),
  };
  if (v.emissionStrength !== 1) {
    m.extensions = {
      ...m.extensions,
      KHR_materials_emissive_strength: { emissiveStrength: v.emissionStrength },
    };
    doc.extensionsUsed = [
      ...new Set([
        ...(doc.extensionsUsed ?? []),
        "KHR_materials_emissive_strength",
      ]),
    ];
  }
  if (maps.baseColor)
    m.pbrMetallicRoughness.baseColorTexture = addTexture(
      maps.baseColor,
      v.bindings.baseColor?.uv ?? 0,
    );
  if (maps.normal)
    m.normalTexture = {
      ...addTexture(maps.normal, v.bindings.normal?.uv ?? 0),
      scale: v.normalScale,
    };
  else if (m.normalTexture)
    m.normalTexture = { ...m.normalTexture, scale: v.normalScale };
  if (m.occlusionTexture)
    m.occlusionTexture = { ...m.occlusionTexture, strength: v.aoStrength };
  if (maps.emission)
    m.emissiveTexture = addTexture(maps.emission, v.bindings.emission?.uv ?? 0);
  if (maps.orm) {
    const mr = addTexture(maps.orm, mrUV);
    if (v.bindings.roughness || v.bindings.metallic)
      m.pbrMetallicRoughness.metallicRoughnessTexture = mr;
    if (v.bindings.ao)
      m.occlusionTexture = {
        ...addTexture(maps.orm, v.bindings.ao.uv),
        strength: v.aoStrength,
      };
  }
  doc.materials[v.materialIndex] = m;
  for (const info of [
    m.pbrMetallicRoughness.baseColorTexture,
    m.pbrMetallicRoughness.metallicRoughnessTexture,
    m.normalTexture,
    m.occlusionTexture,
    m.emissiveTexture,
  ].filter(Boolean))
    if (
      v.repeat[0] !== 1 ||
      v.repeat[1] !== 1 ||
      v.offset[0] ||
      v.offset[1] ||
      v.rotation
    ) {
      info.extensions = {
        ...info.extensions,
        KHR_texture_transform: {
          offset: v.offset,
          scale: v.repeat,
          rotation: v.rotation,
        },
      };
      doc.extensionsUsed = [
        ...new Set([...(doc.extensionsUsed ?? []), "KHR_texture_transform"]),
      ];
    }
  const name = `${path.basename(a.path, path.extname(a.path))}-${slug(v.name)}-${variantKey}.gltf`;
  await atomicJSON(path.join(modelFolder, name), doc);
  await atomicJSON(path.join(textureFolder, "variant.json"), v);
  return path
    .relative(folder, path.join(modelFolder, name))
    .replace(/\\/g, "/");
}
async function writeGodotMaterial(
  filename: string,
  v: MaterialVariant,
  maps: Partial<Record<string, string>>,
) {
  const ext: string[] = [];
  const properties: string[] = [];
  properties.push(`texture_filter = ${v.textureFilter === "nearest" ? 0 : 1}`);
  let id = 1;
  const add = (file: string, property: string) => {
    ext.push(`[ext_resource type="Texture2D" path="${file}" id="${id}"]`);
    properties.push(`${property} = ExtResource("${id}")`);
    id++;
  };
  if (maps.baseColor) add(maps.baseColor, "albedo_texture");
  if (maps.normal) {
    add(maps.normal, "normal_texture");
    properties.push("normal_enabled = true", `normal_scale = ${v.normalScale}`);
  }
  if (maps.emission) {
    add(maps.emission, "emission_texture");
    properties.push("emission_enabled = true");
  }
  if (maps.orm) {
    add(maps.orm, "metallic_texture");
    properties.push("metallic_texture_channel = 2");
    properties.push(
      `roughness_texture = ExtResource("${id - 1}")`,
      "roughness_texture_channel = 1",
      `ao_texture = ExtResource("${id - 1}")`,
      "ao_enabled = true",
      "ao_texture_channel = 0",
    );
  }
  const c = color(v.baseColor),
    e = color(v.emission);
  await fs.writeFile(
    filename,
    `[gd_resource type="StandardMaterial3D" load_steps=${id} format=3]\n\n${ext.join("\n")}\n\n[resource]\nalbedo_color = Color(${c.join(", ")}, 1)\nmetallic = ${v.metallic}\nroughness = ${v.roughness}\nemission = Color(${e.join(", ")}, 1)\nemission_energy_multiplier = ${v.emissionStrength}\nuv1_scale = Vector3(${v.repeat[0]}, ${v.repeat[1]}, 1)\nuv1_offset = Vector3(${v.offset[0]}, ${v.offset[1]}, 0)\ncull_mode = ${v.doubleSided ? 2 : 0}\ntransparency = ${v.alphaMode === "BLEND" ? 1 : v.alphaMode === "MASK" ? 2 : 0}\nalpha_scissor_threshold = ${v.alphaCutoff}\n${properties.join("\n")}\n`,
    "utf8",
  );
}
export async function runExport(
  catalog: Catalog,
  plan: ExportPlan,
  ctx: JobContext,
  inspectOnly = false,
) {
  if (plan.issues.length)
    throw new WorkshopError("EXPORT_VALIDATION", plan.issues.join("\n"));
  const target = path.resolve(plan.request.target),
    isProject =
      plan.request.mode === "godot" &&
      !!(await fs.stat(path.join(target, "project.godot")).catch(() => null));
  const finalRoot = isProject
    ? path.join(target, "assets", "workshop")
    : path.join(
        target,
        plan.request.mode === "godot"
          ? "workshop-assets"
          : `workshop-export-${ctx.job.id.slice(0, 8)}`,
      );
  const root = path.join(catalog.root, "staging", ctx.job.id + "-export");
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  const exported: any[] = [],
    portable: any[] = [],
    outputFiles: any[] = [];
  let done = 0;
  for (const a of plan.assets) {
    await ctx.check();
    const family = a.metadata.family;
    const rel =
        plan.request.familyBatchId &&
        family?.batchId === plan.request.familyBatchId
          ? `families/${slug(family.familyId)}/v${family.templateVersion}-${family.batchId.slice(0, 8)}/${slug(family.key)}`
          : plan.request.aggregate
            ? `${slug(catalog.revision(a.revisionId).name)}-${a.revisionId.slice(0, 8)}`
            : `${slug(a.title)}-${a.id.slice(0, 8)}/${a.revisionId.slice(0, 8)}`,
      folder = inside(root, rel);
    await fs.mkdir(folder, { recursive: true });
    for (const f of closure(catalog, a)) {
      await safeCopy(
        inside(
          path.dirname(sourcePath(catalog, { ...a, path: "__root__" })),
          f.path,
        ),
        inside(folder, f.path),
        f.sha256,
        ctx,
      );
      outputFiles.push({
        path: `${rel}/${f.path}`,
        sha256: f.sha256,
        bytes: f.bytes,
      });
    }
    if (a.source)
      await atomicJSON(path.join(folder, "licenses", "source.json"), a.source);
    const revisionDir = path.join(
      catalog.root,
      "packages",
      a.packageId,
      a.revisionId,
      "licenses",
    );
    if (await fs.stat(revisionDir).catch(() => null))
      await fs.cp(revisionDir, path.join(folder, "licenses"), {
        recursive: true,
        force: false,
      });
    const variants = [];
    for (const v of plan.variants.filter((v) => v.assetId === a.id))
      variants.push({
        id: v.id,
        name: v.name,
        path: await exportVariant(catalog, a, v, folder),
      });
    exported.push({
      assetId: a.id,
      revisionId: a.revisionId,
      title: a.title,
      entry: `${rel}/${a.path}`,
      variants: variants.map((v) => ({ ...v, path: `${rel}/${v.path}` })),
      source: a.source,
    });
    portable.push({
      ...a,
      path: `${rel}/${a.path}`,
      dependencies: a.dependencies.map((d) => `${rel}/${d}`),
      relatedPaths: a.relatedPaths?.map((d) => `${rel}/${d}`),
    });
    ctx.progress("导出素材与依赖", ++done, plan.assets.length);
  }
  const manifest = {
    schemaVersion: 1,
    exportId: ctx.job.id,
    createdAt: now(),
    mode: plan.request.mode,
    assets: portable,
    files: [...new Map(outputFiles.map((f) => [f.path, f])).values()],
    variants: plan.variants,
    entries: exported,
  };
  await atomicJSON(path.join(root, "workshop-manifest.json"), manifest);
  await atomicJSON(path.join(root, "workshop-export.json"), manifest);
  if (plan.request.familyBatchId) {
    const items: Record<string, any> = Object.create(null);
    for (const a of portable.filter(
      (a) => a.metadata.family?.batchId === plan.request.familyBatchId,
    )) {
      const f = a.metadata.family;
      const item = (items[f.key] ??= {
        name: a.metadata.assetGroup?.name ?? a.title,
        familyId: f.familyId,
        templateId: f.templateId,
        templateVersion: f.templateVersion,
        sizes: {},
      });
      item.sizes[String(f.size)] = {
        path: a.path,
        width: f.size,
        height: f.size,
        format: "png",
        transparent: true,
        sha256: a.sha256,
        assetId: a.id,
      };
    }
    await atomicJSON(path.join(root, "workshop-family-index.json"), {
      schemaVersion: 1,
      batchId: plan.request.familyBatchId,
      exportId: ctx.job.id,
      createdAt: now(),
      items,
    });
  }
  await fs.writeFile(
    path.join(root, "README.txt"),
    "素材工坊资源导出\n\n复制整个资源目录，保留相对路径。Godot 推荐 glTF/GLB。\n像素素材请在 Godot 4 节点或项目默认 Texture Filter 中选择 Nearest。\n来源与许可证见各资源 licenses/ 目录。\n材质参数可保持一致，渲染引擎与光照产生的画面差异属于正常情况。\n",
    "utf8",
  );
  const written = [] as { path: string; sha256: string; bytes: number }[];
  const previous = catalog.db
    .prepare("SELECT data FROM exports")
    .all()
    .map((r: any) => JSON.parse(r.data))
    .filter((e: any) => e.target === finalRoot);
  for (const f of await walk(root, { exclude: [] })) {
    await ctx.check();
    const sha256 = await hashFile(inside(root, f.path)),
      dest = inside(finalRoot, f.path);
    if (await fs.stat(dest).catch(() => null)) {
      const existing = await hashFile(dest);
      if (existing !== sha256) {
        const metadata = [
          "workshop-manifest.json",
          "workshop-export.json",
          "workshop-family-index.json",
          "README.txt",
        ].includes(f.path);
        if (
          !metadata ||
          !previous.some((e: any) =>
            e.outputFiles?.some(
              (o: any) => o.path === f.path && o.sha256 === existing,
            ),
          )
        )
          throw new WorkshopError(
            "EXPORT_CONFLICT",
            `目标文件已被修改，保留原文件：${dest}`,
          );
      }
    }
    written.push({ path: f.path, sha256, bytes: f.bytes });
  }
  if (inspectOnly) {
    await fs.rm(root, { recursive: true, force: true });
    return { target: finalRoot, inspection: true, entries: exported };
  }
  await fs.mkdir(finalRoot, { recursive: true });
  for (const f of written) {
    await ctx.check();
    const dest = inside(finalRoot, f.path);
    if (
      (await fs.stat(dest).catch(() => null)) &&
      (await hashFile(dest)) === f.sha256
    )
      continue;
    await copyVerified(inside(root, f.path), dest, () => ctx.check());
  }
  await fs.rm(root, { recursive: true, force: true });
  let zipPath: string | undefined;
  if (plan.request.zip) {
    zipPath = `${finalRoot}.zip`;
    if (await fs.stat(zipPath).catch(() => null))
      throw new Error("ZIP 输出已存在");
    const zip = new yazl.ZipFile();
    for (const f of await walk(finalRoot, { exclude: [] }))
      zip.addFile(inside(finalRoot, f.path), f.path);
    zip.end();
    await pipeline(zip.outputStream, createWriteStream(zipPath));
  }
  catalog.db.prepare("INSERT INTO exports VALUES(?,?)").run(
    ctx.job.id,
    JSON.stringify({
      ...manifest,
      target: finalRoot,
      zipPath,
      outputFiles: written,
    }),
  );
  await catalog.snapshot();
  return { target: finalRoot, zipPath, entries: exported };
}
