import { _electron as electron, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
const app = await electron.launch({
    args: ["out/main/index.cjs"],
    env: { ...process.env, WORKSHOP_LIBRARY: path.resolve(".data/library") },
  }),
  page = await app.firstWindow();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
try {
  await page.waitForSelector(".asset-browser");
  const call = (method, input) =>
    page.evaluate(({ method, input }) => window.workshop.call(method, input), {
      method,
      input,
    });
  for (const search of ["wooden_crate_02_2k", "character-male-a"]) {
    const result = await call("assets.query", {
      search,
      extension: search.includes("crate") ? "gltf" : "fbx",
      limit: 1,
    });
    let asset = result.items[0];
    if (!asset && search.includes("character"))
      asset = (
        await call("assets.query", {
          hasAnimation: true,
          extension: "fbx",
          limit: 1,
        })
      ).items[0];
    if (!asset) throw new Error("找不到模型 " + search);
    await page.getByLabel("搜索素材", { exact: true }).fill(asset.title);
    await page
      .locator(".asset-card")
      .filter({ hasText: asset.title })
      .first()
      .dblclick();
    await expect(page.locator(".modal .model-canvas canvas")).toBeVisible();
    await expect(page.locator(".modal .viewer-message")).toHaveCount(0, {
      timeout: 60000,
    });
    if (search.includes("character"))
      await expect(
        page.getByRole("dialog").getByLabel("动画", { exact: true }),
      ).toBeVisible();
    await page.screenshot({ path: `docs/screenshots/${search}.png` });
    if (
      search.includes("character") &&
      !(
        await call("assets.query", {
          hasAnimation: true,
          extension: "glb",
          limit: 1,
        })
      ).items.length
    ) {
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "播放动画", exact: true })
        .click();
      await page.waitForTimeout(300);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "保存 GLB 副本", exact: true })
        .click();
      await expect
        .poll(
          async () => {
            const jobs = await call("jobs.list");
            return jobs.find((j) => j.title === "导入 GLB 转换副本")?.status;
          },
          { timeout: 30000 },
        )
        .toBe("completed");
    }
    if (search.includes("crate")) {
      await page
        .getByRole("button", { name: "材质工作台", exact: true })
        .last()
        .click();
      await expect(
        page.getByRole("button", { name: "保存变体", exact: true }),
      ).toBeEnabled();
      const variant = page
        .locator(".variant-strip button")
        .filter({ hasText: "秋季" })
        .first();
      await expect(variant).toBeVisible();
      await variant.click();
      await expect(page.locator(".viewer-message")).toHaveCount(0);
      await page.waitForTimeout(300);
      await page.screenshot({
        path: "docs/screenshots/material-workbench-real.png",
      });
      await page
        .getByRole("button", { name: "返回素材库", exact: true })
        .click();
    } else {
      await page.getByRole("button", { name: "关闭", exact: true }).click();
    }
  }
  console.log("MODEL QA", JSON.stringify(errors));
  await fs.writeFile(
    "docs/model-qa.json",
    JSON.stringify({ date: new Date().toISOString(), errors }, null, 2),
  );
  if (errors.length) process.exitCode = 1;
} finally {
  await app.close();
}
