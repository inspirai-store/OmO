import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

export class WorkshopError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
export const slash = (value: string) => value.replace(/\\/g, "/");
export function safeRelative(value: string) {
  const normalized = slash(value);
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.startsWith("/") ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split("/").some((s) => s === "..")
  )
    throw new WorkshopError("UNSAFE_PATH", `不安全的相对路径：${value}`);
  if (
    normalized
      .split("/")
      .some(
        (s) =>
          /[<>:"|?*]/.test(s) ||
          (/[. ]$/.test(s) && s !== ".") ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s),
      )
  )
    throw new WorkshopError(
      "INVALID_FILENAME",
      `文件名不能跨平台保存：${value}`,
    );
  return normalized
    .split("/")
    .filter((s) => s && s !== ".")
    .join("/");
}
export function inside(root: string, relative: string) {
  const result = path.resolve(root, safeRelative(relative));
  const rel = path.relative(path.resolve(root), result);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel))
    throw new WorkshopError("UNSAFE_PATH", "路径超出素材目录");
  return result;
}
export async function atomicJSON(filename: string, data: unknown) {
  await fs.mkdir(path.dirname(filename), { recursive: true });
  const temporary = `${filename}.${uid()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(temporary, filename);
}
export async function readJSON<T>(filename: string, fallback?: T): Promise<T> {
  try {
    return JSON.parse(
      (await fs.readFile(filename, "utf8")).replace(/^\uFEFF/, ""),
    );
  } catch (error: any) {
    if (error.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}
export async function hashFile(filename: string, check?: () => Promise<void>) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename, {
    highWaterMark: 1024 * 1024,
  })) {
    if (check) await check();
    hash.update(chunk);
  }
  return hash.digest("hex");
}
export async function walk(
  root: string,
  options: { exclude?: string[]; check?: () => Promise<void> } = {},
) {
  const files: { path: string; bytes: number }[] = [];
  const queue = [""];
  const excluded = new Set(
    options.exclude ?? [".git", ".godot", "node_modules"],
  );
  while (queue.length) {
    const prefix = queue.pop()!;
    if (options.check) await options.check();
    const entries = await fs.readdir(path.join(root, prefix), {
      withFileTypes: true,
    });
    for (const entry of entries) {
      if (entry.isSymbolicLink())
        throw new WorkshopError(
          "SYMLINK",
          `请将链接替换为真实文件：${path.join(prefix, entry.name)}`,
        );
      const rel = slash(path.join(prefix, entry.name));
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name)) queue.push(rel);
      } else if (entry.isFile()) {
        const stat = await fs.stat(path.join(root, rel));
        files.push({ path: rel, bytes: stat.size });
      }
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
export async function folderBytes(root: string) {
  try {
    return (await walk(root, { exclude: [] })).reduce((n, f) => n + f.bytes, 0);
  } catch {
    return 0;
  }
}
export function openZip(filename: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(
      filename,
      { lazyEntries: true, decodeStrings: true, validateEntrySizes: true },
      (error, zip) => (error ? reject(error) : resolve(zip!)),
    ),
  );
}
export async function extractZip(
  filename: string,
  target: string,
  check?: () => Promise<void>,
  onFile?: (name: string) => void,
) {
  await fs.mkdir(target, { recursive: true });
  const zip = await openZip(filename);
  const names = new Set<string>();
  let bytes = 0,
    count = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: unknown) => {
      if (!settled) {
        settled = true;
        zip.close();
        reject(error);
      }
    };
    zip.on("error", fail);
    zip.on("end", () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    });
    zip.on("entry", (entry: yauzl.Entry) => {
      void (async () => {
        await check?.();
        const rel = safeRelative(entry.fileName);
        const unixMode = entry.externalFileAttributes >>> 16;
        if ((unixMode & 0xf000) === 0xa000)
          throw new WorkshopError("ZIP_SYMLINK", "ZIP 中包含符号链接");
        if (entry.generalPurposeBitFlag & 1)
          throw new WorkshopError("ZIP_ENCRYPTED", "不支持加密 ZIP");
        if (entry.fileName.endsWith("/")) {
          await fs.mkdir(inside(target, rel), { recursive: true });
          zip.readEntry();
          return;
        }
        bytes += entry.uncompressedSize;
        count++;
        if (bytes > 20 * 1024 ** 3 || count > 100000)
          throw new WorkshopError(
            "ZIP_LIMIT",
            "压缩包超过 20 GB 或 10 万文件解压上限",
          );
        const key = rel.normalize("NFC").toLowerCase();
        if (names.has(key))
          throw new WorkshopError(
            "PATH_COLLISION",
            `ZIP 路径大小写冲突：${rel}`,
          );
        names.add(key);
        const output = inside(target, rel);
        await fs.mkdir(path.dirname(output), { recursive: true });
        const stream = await new Promise<NodeJS.ReadableStream>((res, rej) =>
          zip.openReadStream(entry, (err, value) =>
            err ? rej(err) : res(value!),
          ),
        );
        await pipeline(
          stream,
          async function* (input) {
            for await (const chunk of input) {
              await check?.();
              yield chunk;
            }
          },
          createWriteStream(output),
        );
        await check?.();
        onFile?.(rel);
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}
export async function copyVerified(
  source: string,
  target: string,
  check?: () => Promise<void>,
) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.partial`;
  const hash = createHash("sha256");
  try {
    await pipeline(
      createReadStream(source, { highWaterMark: 1024 * 1024 }),
      async function* (input) {
        for await (const chunk of input) {
          await check?.();
          hash.update(chunk);
          yield chunk;
        }
      },
      createWriteStream(temporary),
    );
    await fs.rename(temporary, target);
    return hash.digest("hex");
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}
export async function inspectZip(filename: string) {
  const zip = await openZip(filename),
    files: { path: string; bytes: number }[] = [],
    names = new Set<string>();
  let bytes = 0;
  await new Promise<void>((resolve, reject) => {
    const fail = (e: unknown) => {
      zip.close();
      reject(e);
    };
    zip.on("error", fail);
    zip.on("end", resolve);
    zip.on("entry", (entry: yauzl.Entry) => {
      try {
        const rel = safeRelative(entry.fileName),
          mode = entry.externalFileAttributes >>> 16;
        if ((mode & 0xf000) === 0xa000)
          throw new WorkshopError("ZIP_SYMLINK", "ZIP 中包含符号链接");
        if (entry.generalPurposeBitFlag & 1)
          throw new WorkshopError("ZIP_ENCRYPTED", "不支持加密 ZIP");
        if (!entry.fileName.endsWith("/")) {
          const key = rel.normalize("NFC").toLowerCase();
          if (names.has(key))
            throw new WorkshopError(
              "PATH_COLLISION",
              `ZIP 路径大小写冲突：${rel}`,
            );
          names.add(key);
          bytes += entry.uncompressedSize;
          files.push({ path: rel, bytes: entry.uncompressedSize });
          if (bytes > 20 * 1024 ** 3 || files.length > 100000)
            throw new WorkshopError(
              "ZIP_LIMIT",
              "压缩包超过 20 GB 或 10 万文件解压上限",
            );
        }
        zip.readEntry();
      } catch (e) {
        fail(e);
      }
    });
    zip.readEntry();
  });
  return { files, bytes };
}
export function resolveDependency(
  from: string,
  uri: string,
): { path: string; remote: boolean } {
  if (/^data:/i.test(uri)) return { path: "", remote: false };
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith("//"))
    return { path: uri, remote: true };
  const decoded = decodeURIComponent(uri.split(/[?#]/)[0]);
  const combined = path.posix.normalize(
    path.posix.join(path.posix.dirname(slash(from)), slash(decoded)),
  );
  return { path: safeRelative(combined), remote: false };
}
