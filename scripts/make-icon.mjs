import fs from "node:fs/promises";
import sharp from "sharp";
await sharp("resources/icon.svg").png().toFile("resources/icon.png");
const png = await sharp("resources/icon.svg").resize(256).png().toBuffer(),
  header = Buffer.alloc(22);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header[8] = 0;
header[9] = 0;
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18);
await fs.writeFile("resources/icon.ico", Buffer.concat([header, png]));
