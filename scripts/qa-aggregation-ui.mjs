import { _electron as electron } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

const app = await electron.launch({
  executablePath: path.resolve("release/win-unpacked/素材工坊.exe"),
  args: [],
  env: { ...process.env, WORKSHOP_LIBRARY: path.resolve(".data/library") },
});
try {
  const page = await app.firstWindow(),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.waitForSelector(".asset-browser");
  await page
    .locator(".entity-nav")
    .getByRole("button", { name: "武器与装备", exact: true })
    .click();
  await page.getByRole("button", { name: "智能聚合", exact: true }).click();
  await page.waitForSelector(".group-card");
  await page.waitForFunction(
    () => document.querySelectorAll(".group-thumb img").length >= 3,
    undefined,
    { timeout: 30000 },
  );
  const screenshot = path.resolve("docs/screenshots/smart-aggregation.png");
  await fs.mkdir(path.dirname(screenshot), { recursive: true });
  await page.screenshot({ path: screenshot });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    JSON.stringify({
      screenshot,
      summary: await page
        .locator(".aggregation-browser .browser-toolbar")
        .innerText(),
      errors,
    }),
  );
} finally {
  await app.close();
}
