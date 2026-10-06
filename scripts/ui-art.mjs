import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const accents = { red: "#EF1024", cyan: "#05D5DA", violet: "#B643FF" };
const paper = "#F5F2EB",
  black = "#090909";
export const artDefinitions = [
  {
    name: "cube-burst",
    label: "立方体星芒标识",
    width: 160,
    height: 160,
    shape: (c) =>
      `<path d="M78 4 92 38 125 14 115 52 154 48 126 77 157 99 117 108 132 145 96 126 80 157 65 124 26 147 40 111 4 105 35 81 5 55 46 54 34 14 67 37Z" fill="${c}" stroke="${black}" stroke-width="6"/><path d="m78 39 39 23v43l-39 23-38-23V62Z" fill="${black}" stroke="${paper}" stroke-width="5"/><path d="m40 62 38 23 39-23M78 85v43M59 52l38 22" fill="none" stroke="${paper}" stroke-width="5"/>`,
  },
  {
    name: "starburst",
    label: "爆裂星芒",
    width: 160,
    height: 160,
    shape: (c) =>
      `<path d="m80 6 13 44 43-29-21 43 39 13-43 13 26 45-42-23-16 43-13-43-44 25 25-40L6 78l43-14-26-41 43 25Z" fill="${black}" stroke="${paper}" stroke-width="5"/><path d="m80 27 10 39 31-20-20 29 32 9-34 9 18 28-29-20-10 30-8-34-30 18 19-28-31-9 35-8-19-29 28 20Z" fill="${c}"/>`,
  },
  {
    name: "lightning",
    label: "折线闪电",
    width: 96,
    height: 160,
    shape: (c) =>
      `<path d="M44 7 88 8 65 58 92 57 17 154 39 93 7 94Z" fill="${c}" stroke="${black}" stroke-width="7"/><path d="m49 17 22 1-24 56 28-2-36 44 13-40-25 1Z" fill="${paper}"/>`,
  },
  {
    name: "arrow",
    label: "推进箭头",
    width: 160,
    height: 80,
    shape: (c) =>
      `<path d="M8 21 101 17 101 6 151 36 104 73 102 58 8 62 21 42Z" fill="${black}" stroke="${paper}" stroke-width="4"/><path d="m25 31 88-4-1-9 26 20-23 21-1-11-89 4 9-10Z" fill="${c}"/>`,
  },
  {
    name: "torn-frame",
    label: "撕纸边框",
    width: 360,
    height: 220,
    shape: (c) =>
      `<path d="m9 17 88-9 13 7 150-8 17 9 74-6-5 51 10 10-7 58 6 12-9 60-62 10-14-8-130 10-18-7-111 3 8-57-10-9 7-43-9-11Z" fill="${black}" stroke="${c}" stroke-width="6"/><path d="m21 28 70-8 20 7 150-8 17 9 60-6-3 40 9 12-7 55 4 10-7 49-48 9-18-8-128 10-17-8-88 3 6-43-8-10 7-39-7-11Z" fill="none" stroke="${paper}" stroke-width="3"/>`,
  },
  {
    name: "title-plate",
    label: "斜切标题底板",
    width: 360,
    height: 100,
    shape: (c) =>
      `<path d="m12 21 293-16-4 12 47-5-14 68-78 8-11-8-221 14 7-19H6Z" fill="${black}"/><path d="m18 14 284-9-9 12 49-6-14 59-80 7-10-7L17 86l7-20H10Z" fill="${c}"/><path d="m24 20 231-7M43 76l206-14" fill="none" stroke="${paper}" stroke-width="3"/>`,
  },
  {
    name: "sticker-plate",
    label: "错位贴纸底板",
    width: 200,
    height: 90,
    shape: (c) =>
      `<path d="m12 14 166-9 13 59-158 20Z" fill="${black}"/><path d="m7 8 168-5 13 56L26 77Z" fill="${paper}" stroke="${black}" stroke-width="4"/><path d="m17 16 150-6 7 42-141 15Z" fill="${c}"/>`,
  },
  {
    name: "halftone",
    label: "可平铺网点纹理",
    width: 256,
    height: 256,
    shape: (c) =>
      `<defs><pattern id="dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="4" cy="4" r="1.7" fill="${c}" opacity=".3"/><circle cx="12" cy="12" r="1.7" fill="${c}" opacity=".3"/></pattern></defs><path fill="url(#dots)" d="M0 0h256v256H0Z"/>`,
  },
  {
    name: "scratches",
    label: "可平铺划痕纹理",
    width: 256,
    height: 256,
    shape: (c) =>
      `<g fill="${c}" opacity=".23"><path d="m12 44 155-21-93 24ZM97 121l154-36-107 34ZM-18 234l182-33-131 37ZM173 18l11 89-17-51ZM32 103l24 81-29-50ZM190 176l13 70-21-30ZM58 10l71 4-30 5Z"/></g>`,
  },
];
const svg = (w, h, shape) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${shape}</svg>\n`;
export async function writeArtwork() {
  const output = path.join(workspace, "src/renderer/public/ui-art");
  await fs.mkdir(output, { recursive: true });
  const manifest = [];
  for (const art of artDefinitions)
    for (const [accent, color] of Object.entries(accents)) {
      const filename = `${art.name}-${accent}.svg`;
      await fs.writeFile(
        path.join(output, filename),
        svg(art.width, art.height, art.shape(color)),
      );
      manifest.push({
        id: `${art.name}-${accent}`,
        family: art.name,
        label: art.label,
        accent,
        width: art.width,
        height: art.height,
        filename,
      });
    }
  const samples = {
    crate: svg(
      220,
      160,
      `<path d="m110 12 72 32v70l-72 35-72-35V44Z" fill="#ba7040" stroke="${black}" stroke-width="4"/><path d="m38 44 72 32 72-32-72-32Z" fill="#e3b077"/><path d="m110 76 72-32v70l-72 35Z" fill="#8b4a2b"/><g fill="none" stroke="#573421" stroke-width="3"><path d="m54 51 72-32M73 60l72-32M92 69l72-32M38 62l72 32 72-32M38 83l72 32 72-32M38 105l72 32 72-32M110 76v73"/></g>`,
    ),
    character: svg(
      220,
      160,
      `<ellipse cx="111" cy="146" rx="48" ry="7" fill="#090909" opacity=".25"/><g stroke="${black}" stroke-width="3"><path d="m92 75-9 39 12 3 5-25 2 31-7 22h16l8-23 8 23h16l-10-27-4-44Z" fill="#eee9dd"/><path d="m129 74 14 25 10-6-9-30Z" fill="#eee9dd"/><path d="m90 37 18-16 24 5 10 24-14 25-24-3-17-18Z" fill="#f5f2eb"/><path d="m86 48 4-18 21-13 25 8 6 18-25-7-17 17Z" fill="#090909"/></g><path d="m96 82 32-1-5 26-23-1Z" fill="#ef1024"/>`,
    ),
    dungeon: svg(
      220,
      160,
      `<rect x="17" y="9" width="186" height="142" fill="#28282f"/><g fill="#565161" stroke="#17151c" stroke-width="3">${Array.from({ length: 30 }, (_, i) => `<rect x="${19 + (i % 6) * 30}" y="${11 + Math.floor(i / 6) * 28}" width="30" height="27"/>`).join("")}</g><path d="M39 28h67v25h57v53h-34v27H70v-25H39Z" fill="#18171e"/><path d="M55 42h34v30h56v18h-33v28H87V93H56Z" fill="#b3a07a"/><path d="M53 37h36v9H53ZM139 69h9v25h-9ZM83 108h32v8H83Z" fill="#05d5da"/>`,
    ),
    wood: svg(
      128,
      128,
      `<rect width="128" height="128" fill="#bd8754"/><g fill="none" stroke="#644225" stroke-width="2" opacity=".65">${Array.from({ length: 10 }, (_, i) => `<path d="M0 ${i * 13}q35 -9 64 0t64 0M${(i * 17) % 128} ${i * 13}v13"/>`).join("")}</g>`,
    ),
    normal: svg(
      128,
      128,
      `<rect width="128" height="128" fill="#8f7dff"/><g fill="none" stroke="#6cc7ff" stroke-width="3">${Array.from({ length: 10 }, (_, i) => `<path d="M0 ${i * 13}q35 -9 64 0t64 0"/>`).join("")}</g>`,
    ),
  };
  for (const [name, content] of Object.entries(samples))
    await fs.writeFile(path.join(output, `sample-${name}.svg`), content);
  await fs.writeFile(
    path.join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const manifest = await writeArtwork();
  console.log(
    `Generated ${manifest.length} original SVG decorations and 5 demo thumbnails.`,
  );
}
