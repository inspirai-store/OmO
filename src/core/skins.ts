import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import sharp from "sharp";
import {
  atomicJSON,
  extractZip,
  inside,
  inspectZip,
  readJSON,
  uid,
  walk,
} from "./files";
import {
  appearanceSchema,
  builtinSkins,
  defaultAppearance,
  validateSkin,
  type AppearancePreferences,
  type SkinDefinition,
  type SkinManifest,
} from "../shared/skins";

export async function validateSkinDirectory(directory: string) {
  const entries = await walk(directory, { exclude: [] });
  if (
    entries.length > 4096 ||
    entries.reduce((n, f) => n + f.bytes, 0) > 256 * 1024 ** 2
  )
    throw new Error("皮肤目录超过 256 MiB 或 4096 文件上限");
  const manifest = validateSkin(
    await readJSON(path.join(directory, "skin.json")),
  );
  for (const resource of manifest.resources) {
    const filename = inside(directory, resource.path),
      stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 ** 2)
      throw new Error(`资源不是有效图片或超过 32 MiB：${resource.path}`);
    if (/\.svg$/i.test(filename)) {
      const source = await fs.readFile(filename, "utf8");
      if (
        /<(?:script|foreignObject)\b|<!DOCTYPE|<!ENTITY|\bon\w+\s*=|(?:href|url)\s*(?:=|\()\s*["']?\s*(?!#)[^\s"')]+/i.test(
          source,
        )
      )
        throw new Error(`SVG 仅允许自包含图形：${resource.path}`);
    }
    const meta = await sharp(filename, {
      limitInputPixels: 8192 ** 2,
    }).metadata();
    if (
      meta.format !== path.extname(resource.path).slice(1).toLowerCase() ||
      meta.width !== resource.width * resource.scale ||
      meta.height !== resource.height * resource.scale
    )
      throw new Error(`资源尺寸与协议不一致：${resource.path}`);
  }
  return manifest;
}
export async function zipSkin(directory: string, target: string) {
  const zip = new yazl.ZipFile();
  for (const file of await walk(directory, { exclude: [] }))
    zip.addFile(inside(directory, file.path), file.path);
  const temporary = target + ".partial";
  await fs.mkdir(path.dirname(target), { recursive: true });
  zip.end();
  try {
    await pipeline(zip.outputStream, createWriteStream(temporary));
    await fs.rename(temporary, target);
  } catch (e) {
    await fs.rm(temporary, { force: true });
    throw e;
  }
}
export interface SkinSelection {
  resourceId: string;
  filename: string;
  crop?: { x: number; y: number; width: number; height: number };
}
export class SkinStore {
  preferences: AppearancePreferences = { ...defaultAppearance };
  warning = "";
  private installed: string[] = [];
  private definitions = new Map<string, SkinDefinition>();
  private writes: Promise<unknown> = Promise.resolve();
  constructor(public directory: string) {}
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    await fs.rm(inside(this.directory, "staging"), {
      recursive: true,
      force: true,
    });
    let keys: unknown;
    try {
      keys = await readJSON<unknown>(
        path.join(this.directory, "installed-skins.json"),
        [],
      );
    } catch {
      this.warning = "已安装皮肤列表损坏，已恢复漫画主题。";
      await this.persist();
      return this;
    }
    this.installed = Array.isArray(keys)
      ? keys.filter((k) => typeof k === "string" && /^[a-f0-9]{64}$/.test(k))
      : [];
    try {
      this.preferences = appearanceSchema.parse(
        await readJSON(
          path.join(this.directory, "appearance.json"),
          defaultAppearance,
        ),
      );
      await this.get(this.preferences.skinKey);
    } catch (error) {
      this.preferences = { ...defaultAppearance };
      this.warning = `保存的皮肤不可用，已恢复漫画主题。${error instanceof Error ? error.message.slice(0, 250) : ""}`;
      await this.persist();
    }
    return this;
  }
  private async persist() {
    await atomicJSON(
      path.join(this.directory, "appearance.json"),
      this.preferences,
    );
    await atomicJSON(
      path.join(this.directory, "installed-skins.json"),
      this.installed,
    );
  }
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writes.then(work, work);
    this.writes = next.catch(() => {});
    return next;
  }
  async get(key: string): Promise<SkinDefinition> {
    const builtin = builtinSkins.find((s) => s.key === key);
    if (builtin) return builtin;
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("无效皮肤引用");
    if (this.definitions.has(key)) return this.definitions.get(key)!;
    const dir = inside(this.directory, `skins/${key}`),
      manifest = await validateSkinDirectory(dir);
    const urls = Object.fromEntries(
      manifest.resources.map((r) => [
        r.id,
        `workshop://skins/${key}/cache/${r.id}.png`,
      ]),
    );
    for (const r of manifest.resources) {
      const cached = path.join(dir, "cache", `${r.id}.png`);
      try {
        const meta = await sharp(cached).metadata();
        if (
          meta.width !== r.width * r.scale ||
          meta.height !== r.height * r.scale
        )
          throw new Error("缓存尺寸失效");
      } catch {
        await fs.mkdir(path.dirname(cached), { recursive: true });
        await sharp(inside(dir, r.path)).png().toFile(cached);
      }
    }
    const skin = { key, builtin: false, manifest, urls };
    this.definitions.set(key, skin);
    return skin;
  }
  async list() {
    const skins = [...builtinSkins];
    for (const key of this.installed) {
      try {
        skins.push(await this.get(key));
      } catch {
        /* A damaged optional theme remains unapplied. */
      }
    }
    return skins;
  }
  async appearance() {
    return {
      preferences: this.preferences,
      skin: await this.get(this.preferences.skinKey),
      warning: this.warning,
    };
  }
  async update(input: AppearancePreferences) {
    return this.serialize(async () => {
      const preferences = appearanceSchema.parse(input);
      if (
        !preferences.skinKey.startsWith("builtin:") &&
        !this.installed.includes(preferences.skinKey)
      )
        throw new Error("请先安装皮肤");
      await this.get(preferences.skinKey);
      this.preferences = preferences;
      this.warning = "";
      await this.persist();
      return this.appearance();
    });
  }
  async prepare(filename: string): Promise<SkinDefinition> {
    let directory = filename,
      temporary: string | undefined;
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink()) throw new Error("请选择真实皮肤包");
    try {
      if (stat.isFile() && /\.(awskin|zip)$/i.test(filename)) {
        const contents = await inspectZip(filename);
        if (contents.bytes > 256 * 1024 ** 2 || contents.files.length > 4096)
          throw new Error("皮肤包超过 256 MiB 或 4096 文件上限");
        temporary = path.join(this.directory, "staging", uid());
        await extractZip(filename, temporary);
        directory = temporary;
      } else if (stat.isFile() && path.basename(filename) === "skin.json")
        directory = path.dirname(filename);
      else if (!stat.isDirectory())
        throw new Error("请选择 .awskin、ZIP 或皮肤目录");
      const manifest = await validateSkinDirectory(directory);
      const hash = createHash("sha256").update(JSON.stringify(manifest));
      for (const r of manifest.resources)
        hash.update(await fs.readFile(inside(directory, r.path)));
      const key = hash.digest("hex"),
        dest = inside(this.directory, `skins/${key}`);
      const build = inside(this.directory, `staging/build-${uid()}`);
      await fs.mkdir(path.join(build, "cache"), { recursive: true });
      try {
        for (const r of manifest.resources) {
          const source = inside(directory, r.path),
            output = inside(build, r.path);
          await fs.mkdir(path.dirname(output), { recursive: true });
          await fs.copyFile(source, output);
          await sharp(source, { limitInputPixels: 8192 ** 2 })
            .png()
            .toFile(path.join(build, "cache", `${r.id}.png`));
        }
        await atomicJSON(path.join(build, "skin.json"), manifest);
        for (const file of await walk(directory, { exclude: [] })) {
          if (
            !/^(?:preview|exports)\//.test(file.path) ||
            !/\.(?:png|webp|svg|json)$/i.test(file.path)
          )
            continue;
          const output = inside(build, file.path);
          await fs.mkdir(path.dirname(output), { recursive: true });
          await fs.copyFile(inside(directory, file.path), output);
        }
        await fs.mkdir(path.dirname(dest), { recursive: true });
        try {
          await fs.rename(build, dest);
        } catch (e: any) {
          if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(e.code)) throw e;
          await validateSkinDirectory(dest);
        }
      } finally {
        await fs.rm(build, { recursive: true, force: true });
      }
      this.definitions.delete(key);
      return this.get(key);
    } finally {
      if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  async install(skin: SkinDefinition) {
    return this.serialize(async () => {
      if (!skin.builtin && !this.installed.includes(skin.key))
        this.installed.push(skin.key);
      await this.persist();
      return skin;
    });
  }
  async remove(key: string) {
    return this.serialize(async () => {
      if (key.startsWith("builtin:")) throw new Error("内置皮肤不能删除");
      if (this.preferences.skinKey === key)
        this.preferences = { ...this.preferences, skinKey: "builtin:comic" };
      this.installed = this.installed.filter((k) => k !== key);
      await this.persist();
      // Cache stays available to previews that may still be open.
      return this.appearance();
    });
  }
  async resolve(key: string, rel: string) {
    const skin = await this.get(key);
    if (!skin.manifest.resources.some((r) => rel === `cache/${r.id}.png`))
      throw new Error("皮肤资源未登记");
    return inside(this.directory, `skins/${key}/${rel}`);
  }
  async create(value: unknown, selections: SkinSelection[]) {
    const manifest = validateSkin(value),
      build = inside(this.directory, `builds/${uid()}`);
    await fs.mkdir(build, { recursive: true });
    try {
      for (const r of manifest.resources) {
        const selected = selections.find((s) => s.resourceId === r.id);
        if (!selected) throw new Error(`请选择素材：${r.id}`);
        const target = inside(build, r.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        if (/\.svg$/i.test(r.path) && !selected.crop)
          await fs.copyFile(selected.filename, target);
        else {
          let image = sharp(selected.filename, { limitInputPixels: 8192 ** 2 });
          if (selected.crop) {
            const c = selected.crop;
            if (
              ![c.x, c.y, c.width, c.height].every(Number.isInteger) ||
              c.x < 0 ||
              c.y < 0 ||
              c.width < 1 ||
              c.height < 1
            )
              throw new Error("图集区域无效");
            image = image.extract({
              left: c.x,
              top: c.y,
              width: c.width,
              height: c.height,
            });
          }
          image = image
            .resize(r.width * r.scale, r.height * r.scale)
            .ensureAlpha();
          await (
            /\.webp$/i.test(r.path)
              ? image.webp({ lossless: true })
              : image.png()
          ).toFile(target);
        }
      }
      await atomicJSON(path.join(build, "skin.json"), manifest);
      await validateSkinDirectory(build);
      return { directory: build, skin: await this.prepare(build) };
    } catch (e) {
      await fs.rm(build, { recursive: true, force: true });
      throw e;
    }
  }
  async exportPackage(key: string, target: string) {
    const skin = await this.get(key),
      temporary = inside(this.directory, `staging/export-${uid()}`);
    await fs.mkdir(temporary, { recursive: true });
    try {
      await atomicJSON(path.join(temporary, "skin.json"), skin.manifest);
      for (const r of skin.manifest.resources) {
        const dest = inside(temporary, r.path);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(
          inside(this.directory, `skins/${key}/${r.path}`),
          dest,
        );
      }
      if (!skin.builtin)
        for (const file of await walk(inside(this.directory, `skins/${key}`), {
          exclude: [],
        })) {
          if (!/^(?:preview|exports)\//.test(file.path)) continue;
          const target = inside(temporary, file.path);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.copyFile(
            inside(this.directory, `skins/${key}/${file.path}`),
            target,
          );
        }
      await zipSkin(temporary, target);
      return target;
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
}
