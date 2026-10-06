import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

const packageInfo = JSON.parse(await fs.readFile("package.json", "utf8"));
async function hashes(filename) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return {
    path: filename.replaceAll("\\", "/"),
    bytes: (await fs.stat(filename)).size,
    sha256: hash.digest("hex"),
  };
}
const installer = `release/素材工坊 Setup ${packageInfo.version}.exe`;
if ((await fs.stat(installer)).size < 100_000_000)
  throw new Error("Windows 安装包大小异常，不能生成交付清单");
const files = await Promise.all(
  [
    installer,
    `${installer}.blockmap`,
    "release/win-unpacked/素材工坊.exe",
    "release/win-unpacked/resources/app.asar",
    "启动示例工坊.cmd",
    "examples/godot-2d/project.godot",
    "examples/godot-3d/project.godot",
    "release/win-unpacked/resources/resources/licenses/draco/LICENSE",
    "release/win-unpacked/resources/resources/licenses/basis-universal/LICENSE",
  ].map(hashes),
);
async function folderSize(folder) {
  let bytes = 0;
  let count = 0;
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const filename = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      const child = await folderSize(filename);
      bytes += child.bytes;
      count += child.files;
    } else if (entry.isFile()) {
      bytes += (await fs.stat(filename)).size;
      count++;
    }
  }
  return { bytes, files: count };
}
const desktop = JSON.parse(
  await fs.readFile("docs/desktop-validation.json", "utf8"),
);
if (desktop.stats.unexpected || !desktop.stats.expected)
  throw new Error("最终桌面验证未通过");
const samples = JSON.parse(
  await fs.readFile("docs/sample-downloads.json", "utf8"),
);
const manifest = {
  createdAt: new Date().toISOString(),
  version: packageInfo.version,
  files,
  unpacked: await folderSize("release/win-unpacked"),
  library: {
    path: ".data/library",
    sourceGroups: samples.samples.filter((s) => s.installed).length,
    assets: samples.stats.assets,
    files: samples.stats.files,
    originalBytes: samples.stats.bytes,
    projects: samples.stats.projects,
    variants: 3,
    separateFromInstaller: true,
  },
  verification: {
    windowsX64PackagedFlow: "passed",
    desktopReport: "docs/desktop-validation.json",
    godotReport: "docs/godot-validation.json",
    macOS: "configured; awaiting platform build and desktop verification",
    linux: "configured; awaiting platform build and desktop verification",
    signed: false,
  },
};
await fs.writeFile(
  "docs/distribution.json",
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(
  `交付清单：${packageInfo.version}，安装包 ${(files[0].bytes / 1024 ** 2).toFixed(1)} MiB，Windows 桌面验证通过`,
);
