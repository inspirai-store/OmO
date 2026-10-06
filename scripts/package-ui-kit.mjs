import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import yazl from "yazl";
import { workspace } from "./ui-art.mjs";

export async function packageUIKit() {
  const output = path.join(workspace, "docs/ui-kit-bundle.zip");
  const zip = new yazl.ZipFile();
  let files = 0;
  const add = (file, name) => {
    zip.addFile(file, name.replaceAll("\\", "/"));
    files++;
  };
  const tree = async (directory, prefix) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name),
        name = path.join(prefix, entry.name);
      if (name.replaceAll("\\", "/").startsWith("ui-kit/preview/assets"))
        continue;
      if (entry.isDirectory()) await tree(file, name);
      else add(file, name);
    }
  };
  await tree(path.join(workspace, "docs/ui-kit"), "ui-kit");
  await tree(
    path.join(workspace, "src/renderer/src/ui-kit"),
    "source/src/renderer/src/ui-kit",
  );
  await tree(
    path.join(workspace, "src/renderer/public/ui-art"),
    "source/src/renderer/public/ui-art",
  );
  for (const file of [
    "src/renderer/ui-kit.html",
    "ui-kit.vite.config.ts",
    "electron.vite.config.ts",
    "tsconfig.json",
    "package.json",
    "scripts/ui-art.mjs",
    "scripts/ui-kit-runtime.mjs",
    "scripts/export-ui-kit.mjs",
    "scripts/qa-ui-kit.mjs",
    "scripts/package-ui-kit.mjs",
  ])
    add(path.join(workspace, file), "source/" + file);
  add(path.join(workspace, "LICENSE"), "LICENSE");
  const done = new Promise((resolve, reject) => {
    const stream = createWriteStream(output);
    stream.on("close", resolve);
    stream.on("error", reject);
    zip.outputStream.on("error", reject);
    zip.outputStream.pipe(stream);
  });
  zip.end();
  await done;
  const bytes = (await fs.stat(output)).size;
  console.log(
    `UI bundle: ${files} files, ${(bytes / 1024 / 1024).toFixed(2)} MiB. ${output}`,
  );
  return { files, bytes, output };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
)
  await packageUIKit();
