import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import sharp from "sharp";
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "aw-skins-qa-")),
  output = path.resolve("docs/skins");
await fs.mkdir(output, { recursive: true });
const sourceDirectory = path.join(temp, "source"),
  source = path.join(sourceDirectory, "plate.png");
await fs.mkdir(sourceDirectory);
await fs.writeFile(
  path.join(sourceDirectory, "atlas.json"),
  JSON.stringify({
    frames: { "plate-region": { frame: { x: 10, y: 5, w: 80, h: 20 } } },
    meta: { image: "plate.png" },
  }),
);
await sharp({
  create: {
    width: 180,
    height: 36,
    channels: 4,
    background: { r: 23, g: 145, b: 172, alpha: 0.85 },
  },
})
  .png()
  .toFile(source);
const launch = () =>
  electron.launch({
    ...(process.env.WORKSHOP_EXE
      ? {
          executablePath: process.env.WORKSHOP_EXE,
          args: [`--user-data-dir=${path.join(temp, "profile")}`],
        }
      : {
          args: [
            "out/main/index.cjs",
            `--user-data-dir=${path.join(temp, "profile")}`,
          ],
        }),
    env: { ...process.env, WORKSHOP_LIBRARY: path.join(temp, "library") },
  });
let app = await launch(),
  page = await app.firstWindow();
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const call = (method, input = {}) =>
  page.evaluate(([m, i]) => window.workshop.call(m, i), [method, input]);
const check = async (name, fn) => {
  await fn();
  checks.push(name);
  console.log("PASS", name);
};
try {
  await page.waitForSelector(".asset-browser");
  const list = await call("skins.list");
  assert.equal(list.length, 3);
  const protocol = await call("skins.protocol");
  await fs.writeFile(
    path.join(output, "slots-v1.json"),
    JSON.stringify(protocol.slots, null, 2),
  );
  await fs.writeFile(
    path.join(output, "skin.schema.json"),
    JSON.stringify(protocol.manifestSchema, null, 2),
  );
  await check("all themes update chrome and preserve input", async () => {
    await page
      .getByRole("textbox", { name: "搜索素材", exact: true })
      .fill("长中文文件名称不会在换肤时丢失");
    for (const skin of list) {
      await call("appearance.update", {
        skinKey: skin.key,
        density: "regular",
        motion: "none",
      });
      await page.waitForSelector(
        `.app-shell[data-skin="${skin.manifest.basePreset}"]`,
      );
      assert.equal(
        await page
          .getByRole("textbox", { name: "搜索素材", exact: true })
          .inputValue(),
        "长中文文件名称不会在换肤时丢失",
      );
    }
    await page.getByRole("textbox", { name: "搜索素材", exact: true }).fill("");
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.locator(".skin-card")).toHaveCount(3);
  await check(
    "settings previews, native dialogs, density and motion",
    async () => {
      const fresh = page
        .locator(".skin-card")
        .filter({ has: page.locator("h3", { hasText: "清爽" }) });
      await fresh.getByRole("button", { name: "应用", exact: true }).click();
      await page.waitForSelector('.app-shell[data-skin="fresh"]');
      await page
        .getByLabel("界面密度", { exact: true })
        .selectOption("compact");
      await page.waitForSelector('.app-shell[data-density="compact"]');
      await page.getByLabel("动效", { exact: true }).selectOption("reduced");
      await page.waitForSelector('.app-shell[data-motion="reduced"]');
      await fresh.getByRole("button", { name: "预览", exact: true }).click();
      await expect(
        page.locator('dialog[open][data-skin="fresh"]'),
      ).toBeVisible();
      const preview = page.locator("dialog[open]");
      await preview
        .getByRole("button", { name: "预览菜单", exact: true })
        .click();
      await expect(
        page.locator('[role=menu][data-skin="fresh"]'),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(
        fresh.getByRole("button", { name: "预览", exact: true }),
      ).toBeFocused();
    },
  );
  await check("theme screenshots at both supported sizes", async () => {
    const w = await app.browserWindow(page);
    for (const skin of list) {
      await call("appearance.update", {
        skinKey: skin.key,
        density: "regular",
        motion: "none",
      });
      await page.waitForSelector(
        `.app-shell[data-skin="${skin.manifest.basePreset}"]`,
      );
      for (const [width, height] of [
        [1050, 700],
        [1510, 950],
      ]) {
        await w.evaluate(
          (win, size) => {
            win.unmaximize();
            win.setContentSize(...size);
          },
          [width, height],
        );
        await page.waitForFunction(
          ([w, h]) =>
            Math.abs(innerWidth - w) < 3 && Math.abs(innerHeight - h) < 3,
          [width, height],
        );
        await page.screenshot({
          path: path.join(output, `${skin.manifest.basePreset}-${width}.png`),
          scale: "css",
        });
      }
    }
  });
  await check(
    "slot wizard creates a reusable skin asset and applies it",
    async () => {
      await app.evaluate(({ dialog }, p) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [p],
        });
      }, sourceDirectory);
      await page.evaluate(() => window.workshop.choose({ kind: "files" }));
      const plan = await call("imports.inspect", { paths: [sourceDirectory] });
      const job = await call("imports.start", { planId: plan.id });
      await expect
        .poll(
          async () =>
            (await call("jobs.list")).find((j) => j.id === job)?.status,
          { timeout: 30000 },
        )
        .toBe("completed");
      await page.getByRole("button", { name: "素材组包", exact: true }).click();
      const dialog = page.locator("dialog[open]");
      await dialog
        .getByLabel("皮肤名称", { exact: true })
        .fill("自定义清爽 · 槽位测试");
      await dialog
        .getByRole("button", { name: "添加视觉槽位", exact: true })
        .click();
      const images = await call("assets.query", { imageOnly: true, limit: 10 });
      await dialog
        .getByLabel("来源素材", { exact: true })
        .selectOption(images.items[0].id);
      await dialog
        .getByLabel("图集区域", { exact: true })
        .selectOption("plate-region");
      await expect
        .poll(() =>
          dialog
            .locator(".skin-slot-preview .aw-button--primary")
            .first()
            .evaluate(
              (el) => getComputedStyle(el, "::before").borderImageSource,
            ),
        )
        .toContain("data:image/png");
      await dialog
        .getByRole("button", { name: "校验并生成皮肤包", exact: true })
        .click();
      await expect(page.locator("dialog[open]")).toHaveCount(0, {
        timeout: 120000,
      });
      await expect(page.locator(".skin-card")).toHaveCount(4);
      await expect
        .poll(
          async () =>
            (await call("assets.query", { category: "skin" })).items.length,
          { timeout: 60000 },
        )
        .toBe(1);
      const custom = (await call("skins.list")).find((s) => !s.builtin);
      assert.ok(custom);
      assert.deepEqual(custom.manifest.resources[0].atlasRegion, {
        name: "plate-region",
        x: 10,
        y: 5,
        width: 80,
        height: 20,
        sourceWidth: 180,
        sourceHeight: 36,
      });
      const customCard = page
        .locator(".skin-card")
        .filter({ has: page.locator("h3", { hasText: "自定义清爽" }) });
      await customCard
        .getByRole("button", { name: "应用", exact: true })
        .click();
      await page.waitForSelector(`.app-shell[data-skin-key="${custom.key}"]`);
      const image = await page
        .locator(".top-actions .aw-button--primary")
        .first()
        .evaluate((el) => getComputedStyle(el, "::before").borderImageSource);
      assert.ok(image.includes("workshop://skins/"), image);
      await page.screenshot({
        path: path.join(output, "custom-slots.png"),
        scale: "css",
      });
      await fs.rm(source);
      assert.equal(
        (await call("appearance.get")).preferences.skinKey,
        custom.key,
      );
      if (process.env.SKIN_EXPORT === "1") {
        const target = path.join(output, "example-fresh.awskin");
        await app.evaluate(({ dialog }, p) => {
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: p,
          });
        }, target);
        await page.evaluate(() => window.workshop.choose({ kind: "save" }));
        await call("skins.export", {
          key: custom.key,
          target,
          mode: "package",
        });
        assert.ok((await fs.stat(target)).size > 0);
        console.log("PASS native package export", target);
        await app.evaluate(({ dialog }, p) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [p],
          });
        }, target);
        await page.evaluate(() => window.workshop.choose({ kind: "files" }));
        const imported = await call("skins.inspect", { path: target });
        assert.equal(imported.key, custom.key);
        checks.push("native package export and reimport");
      }
      await app.close();
      app = await launch();
      page = await app.firstWindow();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.waitForSelector(`.app-shell[data-skin-key="${custom.key}"]`);
      const nextLibrary = path.join(temp, "next-library");
      await fs.mkdir(nextLibrary);
      await app.evaluate(({ dialog }, p) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [p],
        });
      }, nextLibrary);
      await page.evaluate(() => window.workshop.choose({ kind: "directory" }));
      await call("library.open", { root: nextLibrary }).catch((e) => {
        if (!e.message.includes("destroyed")) throw e;
      });
      await page.waitForSelector(
        `.app-shell[data-skin-key="${custom.key}"] .asset-browser`,
      );
      assert.equal(
        (await call("appearance.get")).preferences.skinKey,
        custom.key,
      );
      checks.push(
        "restart, source removal and switching libraries preserve installed appearance",
      );
      await call("skins.remove", { key: custom.key });
      await page.waitForSelector('.app-shell[data-skin="comic"]');
    },
  );
  await check(
    "all navigation pages and image editor inherit appearance",
    async () => {
      for (const skin of list) {
        await call("appearance.update", {
          skinKey: skin.key,
          density: "regular",
          motion: "system",
        });
        for (const [name, id] of [
          ["工作台", "dashboard"],
          ["AI 生成", "generation"],
          ["同类素材", "families"],
          ["全部素材", "library"],
          ["免费素材", "sources"],
          ["任务中心", "tasks"],
          ["设置", "settings"],
        ]) {
          const button = page.getByRole("button", { name, exact: true });
          await button.click();
          await expect(page.locator(".app-shell")).toHaveAttribute(
            "data-page",
            id,
          );
          await expect(page.locator(".app-shell")).toHaveAttribute(
            "data-skin",
            skin.manifest.basePreset,
          );
        }
        await page
          .getByRole("button", { name: "图像加工", exact: true })
          .click();
        await expect(
          page.getByRole("dialog", { name: "图像加工", exact: true }),
        ).toHaveAttribute("data-skin", skin.manifest.basePreset);
        await page.keyboard.press("Escape");
        await expect(page.locator("dialog[open]")).toHaveCount(0);
      }
    },
  );
  await check(
    "rapid preferences keep the latest intent and reduced motion keeps hit visuals stable",
    async () => {
      const densityId = await page
        .getByLabel("界面密度", { exact: true })
        .getAttribute("id");
      const motionId = await page
        .getByLabel("动效", { exact: true })
        .getAttribute("id");
      await page.evaluate(
        ([densityId, motionId]) => {
          const set = (id, value) => {
            const el = document.getElementById(id);
            if (!el) throw new Error(id);
            el.value = value;
            el.dispatchEvent(new Event("change", { bubbles: true }));
          };
          set(densityId, "compact");
          set(motionId, "none");
          set(densityId, "regular");
        },
        [densityId, motionId],
      );
      await expect
        .poll(async () => (await call("appearance.get")).preferences)
        .toEqual({
          skinKey: "builtin:paper",
          density: "regular",
          motion: "none",
        });
      for (const skin of list) {
        await call("appearance.update", {
          skinKey: skin.key,
          density: "regular",
          motion: "reduced",
        });
        await page.waitForSelector(
          `.app-shell[data-skin="${skin.manifest.basePreset}"][data-motion="reduced"]`,
        );
        const button = page.locator(".top-actions .aw-button--primary").first();
        await page.mouse.move(0, 0);
        const before = await button.evaluate((el) => [
          getComputedStyle(el, "::before").transform,
          getComputedStyle(el, "::after").transform,
        ]);
        await button.hover();
        const after = await button.evaluate((el) => [
          getComputedStyle(el, "::before").transform,
          getComputedStyle(el, "::after").transform,
        ]);
        assert.deepEqual(after, before, skin.manifest.name);
        const animations = await button.evaluate((el) =>
          el
            .getAnimations({ subtree: true })
            .map((a) => Number(a.effect.getTiming().duration)),
        );
        assert.ok(animations.every((d) => d <= 80));
      }
    },
  );
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "qa.json"),
    JSON.stringify({ checks, errors, date: new Date().toISOString() }, null, 2),
  );
  console.log("Skin QA completed", checks.length);
} finally {
  await app.close();
  await fs.rm(temp, { recursive: true, force: true });
}
