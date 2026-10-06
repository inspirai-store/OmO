import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { build } from "vite";
import { createHash } from "node:crypto";
import { writeArtwork, workspace } from "./ui-art.mjs";
import { openKit } from "./ui-kit-runtime.mjs";
import { packageUIKit } from "./package-ui-kit.mjs";

const output = path.join(workspace, "docs/ui-kit"),
  artDirectory = path.join(output, "artwork"),
  controlDirectory = path.join(output, "controls");
await fs.mkdir(artDirectory, { recursive: true });
await fs.mkdir(controlDirectory, { recursive: true });
const artManifest = await writeArtwork(),
  kit = await openKit({
    viewport: { width: 1024, height: 800 },
    deviceScaleFactor: 2,
  });
const index = {
  version: 2,
  motion: "none",
  license: "MIT",
  source: "Original OmO (素材工坊) graphics and React components",
  controls: [],
  artwork: [],
  overview: [],
};
const errors = [];
kit.page.on("pageerror", (e) => errors.push(e.message));
try {
  await kit.page.emulateMedia({ reducedMotion: "reduce" });
  await kit.page.goto(`${kit.url}?motion=none`);
  await kit.page.locator("[data-ui-kit-ready]").waitFor();
  const catalog = JSON.parse(
    await kit.page.locator("#kit-catalog").textContent(),
  );
  const queue = catalog.samples.map((s) => ({
    ...s,
    accent: "red",
    density: "regular",
  }));
  for (const component of catalog.components)
    for (const [accent, density] of [
      ["cyan", "regular"],
      ["violet", "regular"],
      ["red", "compact"],
    ]) {
      queue.push({
        ...component,
        id: `${component.kind}--default`,
        state: "default",
        accent,
        density,
      });
    }
  for (let i = 0; i < queue.length; i++) {
    const sample = queue[i],
      key = `${sample.kind}--${sample.state}--${sample.accent}--${sample.density}`;
    const file = `controls/${key}@2x.png`;
    if (
      process.argv.includes("--resume") &&
      !process.argv
        .find((arg) => arg.startsWith("--refresh="))
        ?.slice(10)
        .split(",")
        .includes(sample.kind) &&
      (await fs.stat(path.join(output, file)).catch(() => false))
    ) {
      const metadata = await sharp(path.join(output, file)).metadata();
      index.controls.push({
        id: key,
        component: sample.kind,
        label: sample.label,
        state: sample.state,
        accent: sample.accent,
        density: sample.density,
        scale: 2,
        width: metadata.width,
        height: metadata.height,
        logicalWidth: metadata.width / 2,
        logicalHeight: metadata.height / 2,
        file,
      });
      continue;
    }
    await kit.page.goto(
      `${kit.url}?export=${sample.id}&accent=${sample.accent}&density=${sample.density}`,
    );
    await kit.page.locator("[data-export-root]").waitFor();
    await kit.page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map((img) => {
          img.loading = "eager";
          return img.decode().catch(() => {});
        }),
      );
    });
    if (sample.kind === "menu" && sample.state === "open")
      await kit.page.getByRole("menu").waitFor();
    if (sample.kind === "tooltip" && sample.state === "open")
      await kit.page.getByRole("tooltip").waitFor();
    if (sample.kind === "dialog" && sample.state === "open")
      await kit.page.getByRole("dialog").waitFor();
    const clip = await kit.page.evaluate(() => {
      const dialog = document.querySelector(".aw-dialog[open]");
      const elements = dialog
        ? [dialog]
        : Array.from(
            document.querySelectorAll(
              "[data-export-root],.aw-menu,.aw-tooltip",
            ),
          );
      const boxes = elements.map((el) => el.getBoundingClientRect());
      const left = Math.max(
          0,
          Math.floor(Math.min(...boxes.map((b) => b.left)) - 8),
        ),
        top = Math.max(0, Math.floor(Math.min(...boxes.map((b) => b.top)) - 8));
      const right = Math.min(
          innerWidth,
          Math.ceil(Math.max(...boxes.map((b) => b.right)) + 10),
        ),
        bottom = Math.min(
          innerHeight,
          Math.ceil(Math.max(...boxes.map((b) => b.bottom)) + 10),
        );
      return { x: left, y: top, width: right - left, height: bottom - top };
    });
    await kit.page.screenshot({
      path: path.join(output, file),
      clip,
      omitBackground: true,
      animations: "disabled",
    });
    const metadata = await sharp(path.join(output, file)).metadata();
    index.controls.push({
      id: key,
      component: sample.kind,
      label: sample.label,
      state: sample.state,
      accent: sample.accent,
      density: sample.density,
      scale: 2,
      width: metadata.width,
      height: metadata.height,
      logicalWidth: clip.width,
      logicalHeight: clip.height,
      file,
    });
    if ((i + 1) % 30 === 0 || i === queue.length - 1)
      console.log(`Controls ${i + 1}/${queue.length}`);
  }
  for (const art of artManifest) {
    const source = path.join(
        workspace,
        "src/renderer/public/ui-art",
        art.filename,
      ),
      file = `artwork/${art.filename}`;
    await fs.copyFile(source, path.join(output, file));
    const png = [];
    for (const scale of [1, 2]) {
      const filename = `artwork/${art.id}@${scale}x.png`;
      await sharp(source, { density: 72 * scale })
        .resize(art.width * scale, art.height * scale)
        .png()
        .toFile(path.join(output, filename));
      png.push({
        scale,
        width: art.width * scale,
        height: art.height * scale,
        file: filename,
      });
    }
    index.artwork.push({ ...art, svg: file, png });
  }
  console.log(
    `Artwork: ${index.artwork.length} SVG + ${index.artwork.length * 2} transparent PNG`,
  );
  await kit.page.setViewportSize({ width: 1510, height: 950 });
  await kit.page.goto(kit.url);
  await kit.page.locator("[data-ui-kit-ready]").waitFor();
  await kit.page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) => {
        img.loading = "eager";
        return img.decode().catch(() => {});
      }),
    );
  });
  await kit.page.screenshot({
    path: path.join(output, "gallery-overview.png"),
    fullPage: true,
    animations: "disabled",
  });
  await kit.page.screenshot({
    path: path.join(output, "gallery-hero.png"),
    animations: "disabled",
  });
  index.overview.push("gallery-overview.png", "gallery-hero.png");
  for (const [view, file] of [
    ["组合示例", "scene-compositions.png"],
    ["原创素材", "artwork-gallery.png"],
    ["动效实验室", "motion-lab.png"],
  ]) {
    await kit.page.getByRole("button", { name: view, exact: true }).click();
    if (view === "动效实验室")
      await kit.page
        .getByRole("button", { name: "弹出通知", exact: true })
        .click();
    await kit.page.screenshot({
      path: path.join(output, file),
      fullPage: true,
      animations: "disabled",
    });
    index.overview.push(file);
  }
  // The atlas uses the same exported default controls, with concise bilingual labels.
  const cells = catalog.components.map((component) =>
    index.controls.find(
      (c) =>
        c.component === component.kind &&
        c.accent === "red" &&
        c.density === "regular" &&
        c.state ===
          (["dialog", "menu", "tooltip"].includes(component.kind)
            ? "open"
            : "default"),
    ),
  );
  const columns = 4,
    cellWidth = 350,
    cellHeight = 280,
    headerHeight = 160,
    atlasWidth = columns * cellWidth,
    atlasHeight =
      headerHeight + Math.ceil(cells.length / columns) * cellHeight + 30;
  const esc = (s) =>
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${atlasWidth}" height="${atlasHeight}"><rect width="100%" height="100%" fill="#111112"/><path d="M0 0h1400v130H0Z" fill="#EF1024"/><text x="30" y="60" fill="#090909" font-family="Arial Black,Microsoft YaHei" font-size="33" font-weight="900">素材工坊 / UI COMPONENT ATLAS</text><text x="32" y="95" fill="#090909" font-family="Microsoft YaHei" font-size="16">${cells.length} 类可复用组件 · 红黑白主线 · 原创图形 · React + CSS + SVG</text>`;
  const composites = [];
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i],
      x = (i % columns) * cellWidth,
      y = headerHeight + Math.floor(i / columns) * cellHeight;
    svg += `<rect x="${x + 12}" y="${y + 8}" width="${cellWidth - 24}" height="${cellHeight - 16}" fill="#191919" stroke="#56524c"/><text x="${x + 26}" y="${y + 33}" fill="#F5F2EB" font-family="Microsoft YaHei" font-size="14" font-weight="bold">${String(i + 1).padStart(2, "0")} / ${esc(cell.label)}</text><text x="${x + 26}" y="${y + cellHeight - 26}" fill="#9d968b" font-family="Consolas" font-size="11">${cell.component}</text>`;
    const resized = await sharp(path.join(output, cell.file))
      .resize({ width: cellWidth - 50, height: cellHeight - 85, fit: "inside" })
      .png()
      .toBuffer();
    const meta = await sharp(resized).metadata();
    composites.push({
      input: resized,
      left: x + Math.floor((cellWidth - meta.width) / 2),
      top: y + 48 + Math.floor((cellHeight - 100 - meta.height) / 2),
    });
  }
  svg += "</svg>";
  await sharp(Buffer.from(svg))
    .composite(composites)
    .png()
    .toFile(path.join(output, "component-atlas.png"));
  index.overview.push("component-atlas.png");
  // Package a fully built static preview; it can also be opened through file:// offline.
  await build({ configFile: path.join(workspace, "ui-kit.vite.config.ts") });
  const standalone = path.join(workspace, "out/ui-kit");
  const previewDir = path.join(output, "preview");
  await fs.mkdir(previewDir, { recursive: true });
  await fs.copyFile(
    path.join(standalone, "ui-kit.html"),
    path.join(previewDir, "ui-kit.html"),
  );
  await fs.cp(
    path.join(standalone, "assets"),
    path.join(previewDir, "assets"),
    { recursive: true },
  );
  await fs.cp(
    path.join(standalone, "ui-art"),
    path.join(previewDir, "ui-art"),
    { recursive: true },
  );
  // Inline the built module and stylesheet to allow direct offline opening without module CORS.
  let html = await fs.readFile(path.join(previewDir, "ui-kit.html"), "utf8");
  const scriptMatch = html.match(
    /<script[^>]*type="module"[^>]*src="([^"]+)"[^>]*><\/script>/,
  );
  if (scriptMatch) {
    const code = await fs.readFile(
      path.resolve(previewDir, scriptMatch[1]),
      "utf8",
    );
    const inline = code.replaceAll("</script", "<\\/script"),
      hash = createHash("sha256").update(inline).digest("base64");
    html = html.replace(
      scriptMatch[0],
      () => `<script type="module">${inline}</script>`,
    );
    html = html.replace(
      "script-src 'self'",
      `script-src 'self' 'sha256-${hash}'`,
    );
  }
  for (const match of [
    ...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g),
  ]) {
    const css = await fs.readFile(path.resolve(previewDir, match[1]), "utf8");
    html = html.replace(match[0], () => `<style>${css}</style>`);
  }
  html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, "");
  await fs.writeFile(path.join(previewDir, "ui-kit.html"), html);
  if (errors.length) throw new Error(`UI errors: ${errors.join("; ")}`);
  await fs.writeFile(
    path.join(output, "index.json"),
    JSON.stringify(index, null, 2) + "\n",
  );
  console.log(
    `Exported ${index.controls.length} control states, ${index.artwork.length} artwork families/accents, ${index.overview.length} overview images.\n${output}`,
  );
  await packageUIKit();
} finally {
  await kit.close();
}
