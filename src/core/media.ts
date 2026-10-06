import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { readPsd, getCompositeImageData, initializeCanvas } from "ag-psd";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  openZip,
  safeRelative,
  resolveDependency,
  WorkshopError,
} from "./files";
import type { Category, Dependency, FileRecord } from "../shared/types";

sharp.concurrency(2);
sharp.cache({ memory: 64, files: 0, items: 100 });
initializeCanvas(
  () => {
    throw new Error("PSD 仅支持读取已有合成图");
  },
  (width, height) => {
    if (width * height > 100000000)
      throw new Error("PSD 合成图超过 1 亿像素上限");
    return {
      width,
      height,
      data: new Uint8ClampedArray(width * height * 4),
      colorSpace: "srgb",
    };
  },
);
export const imageExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".svg",
  ".tif",
  ".tiff",
  ".psd",
  ".kra",
  ".tga",
]);
export const modelExtensions = new Set([
  ".glb",
  ".gltf",
  ".obj",
  ".fbx",
  ".blend",
]);
export function categoryOf(filename: string): Category {
  const ext = path.extname(filename).toLowerCase(),
    name = filename.toLowerCase();
  if ([".hdr", ".exr"].includes(ext)) return "environment";
  if (modelExtensions.has(ext)) return "model";
  if (
    /normal|roughness|metallic|ambientocclusion|_ao[._]|_nor_|_arm_|woodfloor|bricks.*_color/.test(
      name,
    )
  )
    return "texture";
  if (/input.?prompts|gamepad|keyboard/.test(name)) return "controls";
  if (/(^|\/)(ui|interface)|button|panel|cursor/.test(name)) return "ui";
  if (/concept|reference|原画|设定/.test(name)) return "concept";
  return imageExtensions.has(ext) ? "sprite" : "other";
}
export async function readGltf(
  filename: string,
): Promise<{ document: any; bin?: Buffer }> {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".gltf")
    return {
      document: JSON.parse(
        (await fs.readFile(filename, "utf8")).replace(/^\uFEFF/, ""),
      ),
    };
  const buffer = await fs.readFile(filename);
  if (
    buffer.length < 20 ||
    buffer.toString("ascii", 0, 4) !== "glTF" ||
    buffer.readUInt32LE(4) !== 2 ||
    buffer.readUInt32LE(8) !== buffer.length
  )
    throw new WorkshopError("INVALID_GLB", "GLB 容器无效或不是 glTF 2.0");
  let offset = 12,
    document: any,
    bin: Buffer | undefined;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset),
      kind = buffer.readUInt32LE(offset + 4);
    offset += 8;
    if (offset + length > buffer.length)
      throw new WorkshopError("INVALID_GLB", "GLB 块长度无效");
    if (kind === 0x4e4f534a)
      document = JSON.parse(
        buffer.toString("utf8", offset, offset + length).replace(/\0+$/, ""),
      );
    else if (kind === 0x004e4942)
      bin = buffer.subarray(offset, offset + length);
    offset += length;
  }
  if (!document) throw new WorkshopError("INVALID_GLB", "GLB 缺少 JSON 数据");
  return { document, bin };
}
export function gltfMetadata(doc: any) {
  let triangles = 0,
    vertices = 0;
  const uvs = new Set<number>();
  for (const mesh of doc.meshes ?? [])
    for (const p of mesh.primitives ?? []) {
      const count =
        doc.accessors?.[p.indices]?.count ??
        doc.accessors?.[p.attributes?.POSITION]?.count ??
        0;
      triangles +=
        (p.mode ?? 4) === 4
          ? Math.floor(count / 3)
          : [5, 6].includes(p.mode)
            ? Math.max(0, count - 2)
            : 0;
      vertices += doc.accessors?.[p.attributes?.POSITION]?.count ?? 0;
      Object.keys(p.attributes ?? {})
        .filter((k) => k.startsWith("TEXCOORD_"))
        .forEach((k) => uvs.add(Number(k.split("_")[1])));
    }
  return {
    triangles,
    vertices,
    meshes: doc.meshes?.length ?? 0,
    materials: (doc.materials ?? []).map((m: any, i: number) => ({
      index: i,
      name: m.name ?? `材质 ${i + 1}`,
      extensions: Object.keys(m.extensions ?? {}),
    })),
    animations: (doc.animations ?? []).map((a: any, i: number) => ({
      name: a.name ?? `动画 ${i + 1}`,
    })),
    uvChannels: [...uvs].sort(),
    skeletons: doc.skins?.length ?? 0,
    extensions: doc.extensionsUsed ?? [],
  };
}
export async function dependenciesOf(
  filename: string,
  relative: string,
): Promise<Dependency[]> {
  const ext = path.extname(filename).toLowerCase(),
    result: Dependency[] = [];
  const push = (uri: string) => {
    try {
      const r = resolveDependency(relative, uri);
      if (r.path)
        result.push({
          from: relative,
          target: r.path,
          status: r.remote ? "remote" : "missing",
        });
    } catch {
      result.push({ from: relative, target: uri, status: "missing" });
    }
  };
  if ([".gltf", ".glb"].includes(ext)) {
    const { document } = await readGltf(filename);
    for (const item of [
      ...(document.buffers ?? []),
      ...(document.images ?? []),
    ])
      if (item.uri) push(item.uri);
  } else if (ext === ".obj" || ext === ".mtl") {
    const lines = createInterface({
      input: createReadStream(filename),
      crlfDelay: Infinity,
    });
    for await (const line of lines) {
      const m = line.match(
        ext === ".obj"
          ? /^\s*mtllib\s+(.+)$/i
          : /^\s*(?:map_\w+|bump|norm|disp)\s+(.+)$/i,
      );
      if (m) {
        let uri = m[1].trim();
        if (uri.startsWith("-")) uri = uri.split(/\s+/).at(-1)!;
        push(uri);
      }
    }
  } else if (ext === ".fbx") {
    const h = await fs.open(filename);
    try {
      const buf = Buffer.alloc(2 * 1024 * 1024);
      const { bytesRead } = await h.read(buf, 0, buf.length, 0);
      const text = buf.toString("latin1", 0, bytesRead);
      for (const m of text.matchAll(/RelativeFilename:\s*"([^"]+)"/g))
        push(m[1]);
    } finally {
      await h.close();
    }
  }
  return result;
}
async function kraPreview(filename: string) {
  const zip = await openZip(filename);
  return new Promise<Buffer>((resolve, reject) => {
    let settled = false;
    zip.on("error", reject);
    zip.on("end", () => {
      if (!settled) reject(new Error("KRA 缺少合成预览"));
    });
    zip.on("entry", (entry) => {
      if (entry.fileName === "mergedimage.png") {
        if (entry.uncompressedSize > 256 * 1024 ** 2) {
          zip.close();
          reject(new Error("KRA 预览过大"));
          return;
        }
        zip.openReadStream(entry, (err, stream) => {
          if (err) {
            zip.close();
            reject(err);
            return;
          }
          const chunks: Buffer[] = [];
          stream!.on("data", (c) => chunks.push(c));
          stream!.on("end", () => {
            settled = true;
            zip.close();
            resolve(Buffer.concat(chunks));
          });
          stream!.on("error", reject);
        });
      } else zip.readEntry();
    });
    zip.readEntry();
  });
}
async function tgaPreview(filename: string) {
  const b = await fs.readFile(filename),
    id = b[0],
    type = b[2],
    w = b.readUInt16LE(12),
    h = b.readUInt16LE(14),
    bits = b[16],
    channels = bits / 8;
  if (
    ![2, 3, 10, 11].includes(type) ||
    ![1, 3, 4].includes(channels) ||
    w * h > 100000000
  )
    throw new Error("暂不支持此 TGA 类型");
  const out = Buffer.alloc(w * h * 4);
  let pos = 18 + id,
    pixel = 0;
  const write = (sample: Buffer) => {
    const x = pixel % w,
      y = Math.floor(pixel / w),
      row = b[17] & 32 ? y : h - 1 - y,
      i = (row * w + x) * 4;
    out[i] = channels === 1 ? sample[0] : sample[2];
    out[i + 1] = channels === 1 ? sample[0] : sample[1];
    out[i + 2] = sample[0];
    out[i + 3] = channels === 4 ? sample[3] : 255;
    pixel++;
  };
  while (pixel < w * h) {
    if (pos >= b.length) throw new Error("TGA 文件不完整");
    if (type === 10 || type === 11) {
      const packet = b[pos++],
        count = (packet & 127) + 1;
      if (packet & 128) {
        const sample = b.subarray(pos, pos + channels);
        pos += channels;
        for (let j = 0; j < count && pixel < w * h; j++) write(sample);
      } else
        for (let j = 0; j < count && pixel < w * h; j++) {
          write(b.subarray(pos, pos + channels));
          pos += channels;
        }
    } else {
      write(b.subarray(pos, pos + channels));
      pos += channels;
    }
  }
  return { data: out, width: w, height: h };
}
export async function inspectMedia(
  filename: string,
  file: FileRecord,
  cacheRoot: string,
): Promise<{ metadata: Record<string, any>; thumbnail?: string }> {
  const ext = file.extension,
    metadata: Record<string, any> = {};
  try {
    if ([".gltf", ".glb"].includes(ext)) {
      if (file.bytes > 256 * 1024 ** 2)
        return {
          metadata: {
            previewError: "模型超过 256 MB，需手动加载",
            large: true,
          },
        };
      return { metadata: gltfMetadata((await readGltf(filename)).document) };
    }
    if (ext === ".obj") {
      let vertices = 0,
        triangles = 0,
        uvs = 0;
      const lines = createInterface({
        input: createReadStream(filename),
        crlfDelay: Infinity,
      });
      for await (const l of lines) {
        if (l.startsWith("v ")) vertices++;
        else if (l.startsWith("vt ")) uvs++;
        else if (l.startsWith("f "))
          triangles += Math.max(0, l.trim().split(/\s+/).length - 3);
      }
      return { metadata: { vertices, triangles, uvChannels: uvs ? [0] : [] } };
    }
    if (!imageExtensions.has(ext)) return { metadata };
    if (file.bytes > 256 * 1024 ** 2)
      return {
        metadata: { previewError: "图像超过 256 MB，保留原件并支持外部打开" },
      };
    const { input, options, layers } = await rasterInput(
      filename,
      Number(file.metadata.requestPage ?? 0),
    );
    if (layers !== undefined) metadata.layers = layers;
    const meta = await sharp(input, options).metadata();
    Object.assign(metadata, {
      width: meta.width,
      height: meta.height,
      channels: meta.channels,
      hasAlpha: meta.hasAlpha,
      space: meta.space,
      pages: meta.pages,
      format: meta.format,
    });
    await fs.mkdir(cacheRoot, { recursive: true });
    const thumbnail = `${file.sha256}-image-v1.webp`;
    await sharp(input, options)
      .rotate()
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(path.join(cacheRoot, thumbnail));
    if (![".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)) {
      const preview = `${file.sha256}-preview-v${Number(file.metadata.requestPage ?? 0) + 1}.png`;
      await sharp(input, options)
        .rotate()
        .resize(4096, 4096, { fit: "inside", withoutEnlargement: true })
        .png()
        .toFile(path.join(cacheRoot, preview));
      metadata.previewCache = preview;
    }
    return { metadata, thumbnail };
  } catch (error: any) {
    return { metadata: { ...metadata, previewError: error.message } };
  }
}
export function materialGroups(files: FileRecord[]) {
  const groups = new Map<string, Partial<Record<string, string>>>();
  for (const f of files) {
    if (!imageExtensions.has(f.extension)) continue;
    const base = path.basename(f.path, f.extension);
    const match = base.match(
      /^(.*?)(?:[_ .-])(Color|BaseColor|Albedo|Diffuse|diff|NormalGL|NormalDX|Normal|nor_gl|nor_dx|Roughness|Rough|Metalness|Metallic|Metal|AmbientOcclusion|AO|arm)(?:[_ .-].*)?$/i,
    );
    if (!match) continue;
    const name = match[1].replace(/[_ .-](?:\d+k)$/i, ""),
      key = path.posix.join(path.posix.dirname(f.path), name),
      group = groups.get(key) ?? {};
    const token = match[2].toLowerCase();
    const slot = /color|albedo|diff/.test(token)
      ? "baseColor"
      : /normal|nor_/.test(token)
        ? "normal"
        : /rough/.test(token)
          ? "roughness"
          : /metal/.test(token)
            ? "metallic"
            : token === "arm"
              ? "orm"
              : "ao";
    group[slot] = f.path;
    if (slot === "normal")
      group.normalConvention = /dx/.test(token) ? "dx" : "gl";
    groups.set(key, group);
  }
  return [...groups]
    .filter(([, g]) => g.normal || g.roughness || g.metallic || g.orm)
    .map(([name, set]) => ({ name, set }));
}

export async function rasterInput(
  filename: string,
  page = 0,
  limitInputPixels = 100000000,
) {
  const ext = path.extname(filename).toLowerCase();
  let layers: number | undefined;
  let input: any = filename,
    raw: any;
  if (ext === ".svg") {
    const text = await fs.readFile(filename, "utf8");
    for (const match of text.matchAll(
      /(?:href|src)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)/gi,
    )) {
      const ref = (match[1] ?? match[2]).trim();
      if (
        !ref.startsWith("#") &&
        !/^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(ref)
      )
        throw new Error("SVG 含外部或相对资源引用");
    }
    if (/@import|xml:base\s*=/i.test(text))
      throw new Error("SVG 含外部资源定义");
    if (
      /<script|<foreignObject|<!DOCTYPE|(?:href|src)\s*=\s*["'](?:https?:|file:|\/\/)|url\(\s*["']?(?:https?:|file:|\/\/)/i.test(
        text,
      )
    )
      throw new Error("SVG 含脚本、外部资源或不支持的嵌入内容");
    input = Buffer.from(text);
  }
  if (ext === ".psd") {
    const psd = readPsd(await fs.readFile(filename), {
      skipLayerImageData: true,
      skipThumbnail: true,
      useRawData: true,
      useImageData: true,
    });
    if (psd.colorMode !== 3 || psd.bitsPerChannel !== 8)
      throw new Error("PSD 合成预览支持 8 位 RGB；其他颜色模式或位深保留原件");
    const composite = getCompositeImageData(psd);
    if (!composite) throw new Error("PSD 缺少可读取的合成图");
    input = Buffer.from(composite.data);
    raw = { width: psd.width, height: psd.height, channels: 4 };
    layers = psd.children?.length ?? 0;
  }
  if (ext === ".kra") input = await kraPreview(filename);
  if (ext === ".tga") {
    const t = await tgaPreview(filename);
    input = t.data;
    raw = { width: t.width, height: t.height, channels: 4 };
  }
  if (ext === ".bmp") {
    const bmp = await import("bmp-js");
    const decoded = bmp.default.decode(await fs.readFile(filename));
    const data = Buffer.from(decoded.data);
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i],
        blue = data[i + 1],
        green = data[i + 2],
        red = data[i + 3];
      data[i] = red;
      data[i + 1] = green;
      data[i + 2] = blue;
      data[i + 3] = a || 255;
    }
    input = data;
    raw = { width: decoded.width, height: decoded.height, channels: 4 };
  }
  const options = {
    limitInputPixels,
    ...(raw ? { raw } : {}),
    animated: false,
    page,
  };
  return { input, options, layers };
}
