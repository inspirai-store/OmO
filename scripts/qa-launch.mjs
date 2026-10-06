import { _electron as electron } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
const app = await electron.launch({
  args: ["out/main/index.cjs"],
  env: {
    ...process.env,
    WORKSHOP_LIBRARY: path.resolve(
      process.env.WORKSHOP_LIBRARY ?? ".data/qa-library",
    ),
  },
});
const page = await app.firstWindow();
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE", m.text());
});
page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await page.waitForSelector(".asset-browser", { timeout: 60000 });
console.log("TITLE", await page.title());
console.log(
  "STATS",
  await page.evaluate(() => window.workshop.call("library.stats")),
);
await fs.mkdir("docs/screenshots", { recursive: true });
await page.waitForTimeout(700);
await page.screenshot({ path: "docs/screenshots/library.png" });
await page.getByRole("button", { name: "免费素材", exact: true }).click();
await page.screenshot({ path: "docs/screenshots/sources.png" });
await app.close();
