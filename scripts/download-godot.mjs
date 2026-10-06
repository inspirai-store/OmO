import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import yauzl from "yauzl";
await fs.mkdir(".data/tools", { recursive: true });
for (const version of ["4.7.2", "4.6.3"]) {
  const dir = path.resolve(".data/tools", version);
  await fs.mkdir(dir, { recursive: true });
  const filename = path.join(dir, "godot.zip");
  if (!(await fs.stat(filename).catch(() => null))) {
    const url = `https://downloads.godotengine.org/?flavor=stable&platform=windows.64&slug=win64.exe.zip&version=${version}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!response.ok) throw new Error(`${response.status} ${url}`);
    await pipeline(response.body, createWriteStream(filename));
    console.log("downloaded", version);
  }
  await new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.on("entry", (e) => {
        if (!/^[a-z0-9_.-]+\.exe$/i.test(e.fileName)) {
          zip.readEntry();
          return;
        }
        zip.openReadStream(e, async (err, s) => {
          if (err) return reject(err);
          try {
            await pipeline(s, createWriteStream(path.join(dir, e.fileName)));
            zip.readEntry();
          } catch (e) {
            reject(e);
          }
        });
      });
      zip.readEntry();
    });
  });
  console.log("extracted", version);
}
