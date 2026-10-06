import { _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import yauzl from "yauzl";
const output = path.resolve("docs/skins"),
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "aw-skin-export-"));
await fs.mkdir(output, { recursive: true });
const app = await electron.launch({
  args: ["out/main/index.cjs", `--user-data-dir=${path.join(temp, "profile")}`],
  env: { ...process.env, WORKSHOP_LIBRARY: path.join(temp, "library") },
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector(".asset-browser");
  const skins = await page.evaluate(() => window.workshop.call("skins.list"));
  const protocol = await page.evaluate(() =>
    window.workshop.call("skins.protocol"),
  );
  await fs.writeFile(
    path.join(output, "slots-v1.json"),
    JSON.stringify(protocol.slots, null, 2),
  );
  await fs.writeFile(
    path.join(output, "skin.schema.json"),
    JSON.stringify(protocol.manifestSchema, null, 2),
  );
  for (const skin of skins) {
    const filename = path.join(output, skin.manifest.basePreset + ".awskin");
    await app.evaluate(({ dialog }, filename) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: filename,
      });
    }, filename);
    await page.evaluate(() => window.workshop.choose({ kind: "save" }));
    await page.evaluate(
      ([key, target]) =>
        window.workshop.call("skins.export", { key, target, mode: "package" }),
      [skin.key, filename],
    );
    console.log("EXPORTED", filename);
    const images = [];
    let files = 0;
    await new Promise((resolve, reject) =>
      yauzl.open(filename, { lazyEntries: true }, (err, zip) => {
        if (err) return reject(err);
        zip.on("error", reject);
        zip.on("entry", (entry) => {
          files++;
          if (!entry.fileName.endsWith("@1x.png")) return zip.readEntry();
          zip.openReadStream(entry, (err, stream) => {
            if (err) return reject(err);
            const chunks = [];
            stream.on("data", (c) => chunks.push(c));
            stream.on("error", reject);
            stream.on("end", async () => {
              try {
                const png = Buffer.concat(chunks),
                  meta = await sharp(png).metadata();
                if (!meta.hasAlpha)
                  throw new Error("素材缺少透明通道 " + entry.fileName);
                const { data, info } = await sharp(png)
                  .ensureAlpha()
                  .raw()
                  .toBuffer({ resolveWithObject: true });
                let edgeMax = 0;
                for (let x = 0; x < info.width; x++)
                  edgeMax = Math.max(
                    edgeMax,
                    data[x * 4 + 3],
                    data[((info.height - 1) * info.width + x) * 4 + 3],
                  );
                for (let y = 0; y < info.height; y++)
                  edgeMax = Math.max(
                    edgeMax,
                    data[y * info.width * 4 + 3],
                    data[(y * info.width + info.width - 1) * 4 + 3],
                  );
                if (
                  entry.fileName.startsWith("exports/") &&
                  !entry.fileName.includes("/resources/") &&
                  edgeMax > 2
                )
                  throw new Error(
                    "视觉素材触及导出边缘 " +
                      entry.fileName +
                      " alpha=" +
                      edgeMax,
                  );
                if (
                  entry.fileName.startsWith("preview/") &&
                  !data.some((v, i) => i % 4 === 3 && v > 0)
                )
                  throw new Error("预览图为空 " + entry.fileName);
                if (entry.fileName.startsWith("preview/"))
                  await fs.writeFile(
                    path.join(
                      output,
                      skin.manifest.basePreset + "-preview.png",
                    ),
                    png,
                  );
                else if (entry.fileName.startsWith("exports/"))
                  images.push({ name: entry.fileName, png });
                zip.readEntry();
              } catch (e) {
                reject(e);
              }
            });
          });
        });
        zip.on("end", resolve);
        zip.readEntry();
      }),
    );
    const cellWidth = 220,
      cellHeight = 160,
      columns = 8,
      rows = Math.ceil(images.length / columns);
    const composites = [];
    for (const [i, image] of images.entries()) {
      const picture = await sharp(image.png)
        .resize(190, 100, { fit: "inside" })
        .extend({
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
      const m = await sharp(picture).metadata();
      composites.push({
        input: picture,
        left: (i % columns) * cellWidth + Math.floor((cellWidth - m.width) / 2),
        top: Math.floor(i / columns) * cellHeight + 10,
      });
      const safe = image.name
        .replace(/^exports\//, "")
        .replace("@1x.png", "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;");
      composites.push({
        input: Buffer.from(
          `<svg width="220" height="45"><text x="10" y="17" font-size="10" fill="#334155" font-family="Segoe UI">${safe.slice(0, 33)}</text><text x="10" y="32" font-size="10" fill="#64748B">${safe.slice(33)}</text></svg>`,
        ),
        left: (i % columns) * cellWidth,
        top: Math.floor(i / columns) * cellHeight + 110,
      });
    }
    await sharp({
      create: {
        width: columns * cellWidth,
        height: rows * cellHeight,
        channels: 4,
        background: "#EEF1F4",
      },
    })
      .composite(composites)
      .png()
      .toFile(path.join(output, skin.manifest.basePreset + "-atlas.png"));
    await fs.writeFile(
      path.join(output, skin.manifest.basePreset + "-export.json"),
      JSON.stringify(
        { files, visuals: images.length, scale: [1, 2], transparent: true },
        null,
        2,
      ),
    );
    console.log("ATLAS", skin.manifest.basePreset, images.length);
  }
} finally {
  await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
