import fs from "node:fs/promises";
import path from "node:path";
const inventory = JSON.parse(
  (await fs.readFile("resources/THIRD-PARTY-LICENSES.json", "utf8")).replace(
    /^\uFEFF/,
    "",
  ),
);
for (const items of Object.values(inventory))
  for (const item of items) {
    const directory = item.paths?.[0];
    delete item.paths;
    const target = path.join(
      "resources",
      "licenses",
      item.name.replace(/[@/]/g, "-"),
    );
    await fs.mkdir(target, { recursive: true });
    for (const file of await fs.readdir(directory).catch(() => []))
      if (/^(licen[sc]e|copying|notice)(\.|$)/i.test(file)) {
        const source = path.join(directory, file);
        if ((await fs.stat(source)).isFile())
          await fs.copyFile(source, path.join(target, file));
      }
  }
await fs.writeFile(
  "resources/THIRD-PARTY-LICENSES.json",
  JSON.stringify(inventory, null, 2),
);
await fs.copyFile("LICENSE", "resources/LICENSE.txt");
