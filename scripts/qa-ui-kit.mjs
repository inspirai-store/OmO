import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import sharp from "sharp";
import { expect, _electron as electron } from "@playwright/test";
import { openKit } from "./ui-kit-runtime.mjs";
import { workspace } from "./ui-art.mjs";

const output = path.join(workspace, "docs/ui-kit");
await fs.mkdir(output, { recursive: true });
const kit = await openKit(),
  page = kit.page,
  errors = [],
  checks = [];
const check = async (name, fn) => {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
};
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const external = [];
await page.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.hostname !== "127.0.0.1") {
    external.push(url.href);
    return route.abort();
  }
  return route.continue();
});
const tile = (id) => page.locator(`[data-sample-id="${id}"]`);
try {
  await page.goto(kit.url);
  await page.locator("[data-ui-kit-ready]").waitFor();
  await check("32 component families; no Electron IPC required", async () => {
    await expect(page.locator(".kit-sample-tile")).toHaveCount(32);
    assert.equal(
      await page.evaluate(() => typeof window.workshop),
      "undefined",
    );
  });
  await check(
    "Controlled fields, clear search, select and range keyboard input",
    async () => {
      await tile("text-field--default")
        .getByLabel("素材名称")
        .fill("长中文文件名_完整依赖_2026.glb");
      await expect(
        tile("text-field--default").getByLabel("素材名称"),
      ).toHaveValue("长中文文件名_完整依赖_2026.glb");
      await tile("search-field--default")
        .getByRole("button", { name: "清除搜索" })
        .click();
      await expect(
        tile("search-field--default").getByLabel("搜索素材"),
      ).toHaveValue("");
      await tile("select-field--default")
        .getByLabel("素材格式")
        .selectOption("fbx");
      await expect(
        tile("select-field--default").getByLabel("素材格式"),
      ).toHaveValue("fbx");
      await tile("range--default").getByLabel("缩略图尺寸").focus();
      await page.keyboard.press("End");
      await expect(tile("range--default").locator("output")).toHaveText("100");
    },
  );
  await check("Tabs activate with arrows and Home/End", async () => {
    const tabs = tile("tabs--default");
    await tabs.getByRole("tab", { name: "属性" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "依赖" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("End");
    await expect(tabs.getByRole("tab", { name: "来源" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(tabs.getByRole("tab", { name: "属性" })).toBeFocused();
  });
  await check(
    "Menu keyboard navigation skips disabled items and restores focus",
    async () => {
      const trigger = tile("menu--default").getByRole("button", {
        name: "素材操作",
      });
      await trigger.focus();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("menuitem", { name: "展开预览" }),
      ).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("menuitemcheckbox", { name: "加入收藏" }),
      ).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(
        page.getByRole("menuitem", { name: "移入回收站" }),
      ).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0);
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.getByRole("menuitemcheckbox", { name: "加入收藏" }).click();
      await trigger.click();
      await expect(
        page.getByRole("menuitemcheckbox", { name: "加入收藏" }),
      ).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
    },
  );
  await check("Tooltip describes its interactive trigger", async () => {
    const trigger = tile("tooltip--default").getByRole("button");
    await trigger.focus();
    const id = await trigger.getAttribute("aria-describedby");
    assert.ok(id);
    await expect(page.locator(`[id="${id}"]`)).toHaveAttribute(
      "role",
      "tooltip",
    );
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await trigger.blur();
  });
  await check(
    "Native dialog traps focus, closes with Escape and restores trigger",
    async () => {
      const trigger = tile("dialog--default").getByRole("button", {
        name: "创建游戏项目",
      });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "创建游戏项目" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("项目名称").fill("测试项目");
      for (let i = 0; i < 7; i++) {
        await page.keyboard.press("Tab");
        assert.equal(
          await dialog.evaluate((el) => el.contains(document.activeElement)),
          true,
        );
      }
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    },
  );
  await check(
    "32 families / 101 states; disabled/loading actions do not dispatch",
    async () => {
      await page.getByRole("button", { name: "状态矩阵", exact: true }).click();
      const catalog = JSON.parse(
        await page.locator("#kit-catalog").textContent(),
      );
      await expect(page.locator(".kit-sample-tile")).toHaveCount(
        catalog.samples.length,
      );
      await tile("primary-button--default").getByRole("button").click();
      await page
        .locator(".kit-notice")
        .getByRole("button", { name: "关闭通知" })
        .click();
      for (const id of [
        "primary-button--disabled",
        "primary-button--loading",
      ]) {
        const button = tile(id).getByRole("button");
        await expect(button).toBeDisabled();
        await button.evaluate((el) => el.click());
      }
      await expect(page.locator(".kit-notice")).toHaveCount(0);
      const mixed = tile("checkbox--partial").getByRole("checkbox");
      await expect(mixed).toHaveJSProperty("indeterminate", true);
      await mixed.check();
      await expect(mixed).toHaveJSProperty("indeterminate", false);
      const tabs = tile("tabs--disabled");
      await tabs.getByRole("tab", { name: "属性" }).focus();
      await page.keyboard.press("End");
      await expect(tabs.getByRole("tab", { name: "依赖" })).toBeFocused();
      await expect(
        tile("text-field--error").getByLabel("素材名称"),
      ).toHaveAttribute("aria-invalid", "true");
    },
  );
  await check(
    "Palette and compact density apply across all components",
    async () => {
      await page.getByRole("button", { name: "组件总览", exact: true }).click();
      await page
        .getByRole("group", { name: "组件配色", exact: true })
        .getByRole("button", { name: "紫", exact: true })
        .click();
      await page
        .getByRole("group", { name: "组件密度", exact: true })
        .getByRole("button", { name: "紧凑", exact: true })
        .click();
      const values = await tile("primary-button--default")
        .getByRole("button")
        .evaluate((el) => ({
          height: el.getBoundingClientRect().height,
          color: getComputedStyle(el).getPropertyValue("--aw-accent").trim(),
        }));
      assert.equal(values.height, 28);
      assert.equal(values.color, "#b643ff");
      await page
        .getByRole("group", { name: "组件配色", exact: true })
        .getByRole("button", { name: "红", exact: true })
        .click();
      await page
        .getByRole("group", { name: "组件密度", exact: true })
        .getByRole("button", { name: "标准", exact: true })
        .click();
    },
  );
  await check(
    "Composition demos search, select, download and bind textures",
    async () => {
      await page.getByRole("button", { name: "组合示例", exact: true }).click();
      const library = page.locator(".kit-library-scene");
      await library.getByLabel("搜索演示素材").fill("wooden");
      await expect(library.locator(".aw-asset-card")).toHaveCount(1);
      await library.getByRole("button", { name: "清除搜索" }).click();
      await expect(library.locator(".aw-asset-card")).toHaveCount(3);
      await library
        .getByRole("group", { name: "示例浏览方式" })
        .getByRole("button", { name: "列表", exact: true })
        .click();
      await expect(library.locator(".kit-scene-assets")).toHaveClass(/is-list/);
      await library.locator(".aw-asset-card").nth(1).click();
      await expect(library.locator(".kit-scene-inspector")).toContainText(
        "角色_游侠",
      );
      await page
        .getByRole("button", { name: "下载资源包", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "下载资源包", exact: true }),
      ).toBeDisabled();
      await page.getByRole("button", { name: "完成演示", exact: true }).click();
      await expect(
        page.getByRole("progressbar", { name: "地牢资源包下载演示" }),
      ).toHaveAttribute("aria-valuenow", "100");
      const material = page.locator(".kit-material-body");
      await material
        .getByRole("button", { name: "移除Base Color · 基础色贴图" })
        .click();
      await expect(material).toContainText("尚未绑定贴图");
      await material
        .getByRole("button", { name: "选择Base Color · 基础色贴图" })
        .click();
      await expect(material).toContainText("WoodFloor051_2K_Color.png");
    },
  );

  await check("Palette changes preserve controlled field values", async () => {
    await page.getByRole("button", { name: "组件总览", exact: true }).click();
    const input = tile("text-field--default").getByLabel("素材名称");
    await input.fill("保持输入_长中文文件名_动画期间.glb");
    await page
      .getByRole("group", { name: "组件配色", exact: true })
      .getByRole("button", { name: "紫", exact: true })
      .click();
    await expect(input).toHaveValue("保持输入_长中文文件名_动画期间.glb");
    await page.getByRole("button", { name: "动效实验室", exact: true }).click();
  });
  const lab = page.locator("[data-motion-lab]");
  const modeButton = (name) =>
    lab
      .getByRole("group", { name: "动效模式", exact: true })
      .getByRole("button", { name, exact: true });
  await check(
    "Button motion preserves hit bounds and dispatches immediately by mouse and keyboard",
    async () => {
      const demo = lab.locator('[data-motion-demo="button"]');
      const button = demo.getByRole("button", { name: "收集灵感" });
      await page.mouse.move(0, 0);
      const before = await button.boundingBox();
      await button.hover();
      await expect
        .poll(async () =>
          button.evaluate((el) => getComputedStyle(el, "::before").transform),
        )
        .not.toBe("none");
      assert.deepEqual(await button.boundingBox(), before);
      await button.click();
      await expect(demo).toContainText("已触发 1 次");
      await button.press("Space");
      await expect(demo).toContainText("已触发 2 次");
      assert.deepEqual(await button.boundingBox(), before);
      assert.equal(
        await button.evaluate(
          (el) =>
            getComputedStyle(el.querySelector(".aw-button-label")).transform,
        ),
        "none",
      );
    },
  );
  await check(
    "Rapid selection and replay retain the latest state without moving layout",
    async () => {
      const group = lab.getByRole("group", {
        name: "动效选中演示",
        exact: true,
      });
      for (let i = 0; i < 12; i++)
        await group
          .getByRole("button", { name: i % 2 ? "材质" : "下载", exact: true })
          .evaluate((el) => el.click());
      const active = group.getByRole("button", { name: "材质", exact: true });
      await expect(active).toHaveAttribute("aria-pressed", "true");
      await expect
        .poll(async () =>
          group.evaluate((el) =>
            Math.abs(
              parseFloat(
                getComputedStyle(el.querySelector(".aw-selection-plate")).left,
              ) - el.querySelector('[aria-pressed="true"]').offsetLeft,
            ),
          ),
        )
        .toBeLessThan(0.5);
      const cards = lab.locator('[data-motion-demo="cards"]');
      const before = await cards.boundingBox();
      for (let i = 0; i < 6; i++)
        await lab
          .getByRole("button", { name: "重播动效", exact: true })
          .evaluate((el) => el.click());
      await expect(
        group.getByRole("button", { name: "下载", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      assert.deepEqual(await cards.boundingBox(), before);
      await expect
        .poll(() =>
          cards.evaluate(
            (el) =>
              el
                .getAnimations({ subtree: true })
                .filter((a) => a.playState === "running").length,
          ),
        )
        .toBe(0);
    },
  );
  await check(
    "Portaled menu inherits all palettes and densities; closing then reopening cancels its exit",
    async () => {
      const trigger = lab.getByRole("button", {
        name: "打开动效菜单",
        exact: true,
      });
      for (const [label, accent] of [
        ["红", "red"],
        ["青", "cyan"],
        ["紫", "violet"],
      ]) {
        await page
          .getByRole("group", { name: "组件配色", exact: true })
          .getByRole("button", { name: label, exact: true })
          .click();
        for (const [label, density] of [
          ["标准", "regular"],
          ["紧凑", "compact"],
        ]) {
          await page
            .getByRole("group", { name: "组件密度", exact: true })
            .getByRole("button", { name: label, exact: true })
            .click();
          await trigger.click();
          await expect(page.getByRole("menu")).toHaveAttribute(
            "data-accent",
            accent,
          );
          await expect(page.getByRole("menu")).toHaveAttribute(
            "data-density",
            density,
          );
          await page.keyboard.press("Escape");
          await expect(trigger).toBeFocused();
        }
      }
      await trigger.click();
      await page.keyboard.press("Escape");
      await expect(page.locator(".aw-menu")).toHaveAttribute(
        "data-presence",
        "exit",
      );
      await trigger.evaluate((el) => el.click());
      await page.waitForTimeout(170);
      await expect(page.getByRole("menu")).toHaveAttribute(
        "data-presence",
        "enter",
      );
      await page.keyboard.press("Escape");
      await expect(page.locator(".aw-menu")).toHaveCount(0);
    },
  );
  await check(
    "Native dialog can reopen during exit and restores focus after its final close",
    async () => {
      const trigger = lab.getByRole("button", {
        name: "打开动效弹窗",
        exact: true,
      });
      await trigger.click();
      const dialog = page.locator(".aw-dialog");
      await dialog
        .getByLabel("项目名称")
        .fill("长中文标题_材质工作台_完整依赖_演示项目");
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveAttribute("data-presence", "exit");
      await trigger.evaluate((el) => el.click());
      await page.waitForTimeout(170);
      await expect(dialog).toBeVisible();
      await expect(dialog).toHaveAttribute("data-presence", "enter");
      assert.equal(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
        true,
      );
      await expect(dialog.getByLabel("项目名称")).toHaveValue(
        "长中文标题_材质工作台_完整依赖_演示项目",
      );
      await page.keyboard.press("Escape");
      await expect(dialog).not.toBeVisible();
      await expect(trigger).toBeFocused();
    },
  );
  await check(
    "Reduced motion uses only opacity <=80ms; static mode has no active animations",
    async () => {
      await modeButton("减少动画").click();
      await lab
        .getByRole("button", { name: "打开动效菜单", exact: true })
        .click();
      await expect(page.getByRole("menu")).toHaveAttribute(
        "data-motion",
        "reduced",
      );
      const assertOpacityOnly = async () => {
        const animations = await page.evaluate(() =>
          [
            ...document
              .querySelector("[data-motion-lab]")
              .getAnimations({ subtree: true }),
            ...document
              .querySelector(".aw-menu")
              .getAnimations({ subtree: true }),
          ].map((a) => ({
            timing: a.effect.getTiming(),
            frames: a.effect.getKeyframes(),
          })),
        );
        for (const animation of animations) {
          assert.ok(animation.timing.duration <= 80);
          assert.equal(animation.timing.delay, 0);
          assert.ok(animation.frames.every((frame) => !frame.transform));
        }
      };
      await assertOpacityOnly();
      await page.keyboard.press("Escape");
      await modeButton("跟随系统").click();
      await lab
        .getByRole("button", { name: "打开动效菜单", exact: true })
        .click();
      await page
        .getByRole("menuitem", { name: "展开预览", exact: true })
        .hover();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(
        () =>
          getComputedStyle(document.querySelector(".aw-menu"))
            .getPropertyValue("--aw-opacity")
            .trim() === "80ms",
      );
      await assertOpacityOnly();
      await page.keyboard.press("Escape");
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await modeButton("静态状态").click();
      await lab.getByRole("button", { name: "重播动效", exact: true }).click();
      await lab
        .getByRole("button", { name: "打开动效菜单", exact: true })
        .click();
      assert.equal(
        await page.evaluate(
          () =>
            [
              ...document
                .querySelector("[data-motion-lab]")
                .getAnimations({ subtree: true }),
              ...document
                .querySelector(".aw-menu")
                .getAnimations({ subtree: true }),
            ].length,
        ),
        0,
      );
      await page.keyboard.press("Escape");
      await expect(page.locator(".aw-menu")).toHaveCount(0);
      await modeButton("跟随系统").click();
    },
  );
  await check(
    "Motion laboratory has six demos and fits both requested viewports",
    async () => {
      for (const size of [
        { width: 1050, height: 700 },
        { width: 1510, height: 950 },
      ]) {
        await page.setViewportSize(size);
        await expect(lab.locator("[data-motion-demo]")).toHaveCount(6);
        await lab
          .getByRole("button", { name: "重播动效", exact: true })
          .click();
        assert.equal(
          await lab.locator("[data-motion-demo]").evaluateAll(
            (els) =>
              els.filter((el) => {
                const r = el.getBoundingClientRect();
                return r.left < 0 || r.right > innerWidth + 0.5;
              }).length,
          ),
          0,
        );
        await expect
          .poll(() =>
            lab.evaluate(
              (el) =>
                el
                  .getAnimations({ subtree: true })
                  .filter((a) => a.playState === "running").length,
            ),
          )
          .toBe(0);
        await page.screenshot({
          path: path.join(
            output,
            "motion-qa-" + size.width + "x" + size.height + ".png",
          ),
          fullPage: true,
        });
      }
      await page
        .getByRole("group", { name: "组件配色", exact: true })
        .getByRole("button", { name: "红", exact: true })
        .click();
      await page
        .getByRole("group", { name: "组件密度", exact: true })
        .getByRole("button", { name: "标准", exact: true })
        .click();
    },
  );
  await check(
    "1050×700 / 1510×950 layouts and floating menus stay inside viewport",
    async () => {
      for (const size of [
        { width: 1050, height: 700 },
        { width: 1510, height: 950 },
      ]) {
        await page.setViewportSize(size);
        await page.goto(kit.url);
        await page.locator("[data-ui-kit-ready]").waitFor();
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        const out = await page.locator(".kit-sample-tile").evaluateAll(
          (els) =>
            els.filter((el) => {
              const r = el.getBoundingClientRect();
              return r.left < 0 || r.right > innerWidth + 0.5;
            }).length,
        );
        assert.equal(out, 0);
        const trigger = tile("menu--default").getByRole("button");
        await trigger.scrollIntoViewIfNeeded();
        await trigger.click();
        await expect
          .poll(
            async () => {
              const r = await page.getByRole("menu").boundingBox();
              return (
                !!r &&
                r.x >= 0 &&
                r.y >= 0 &&
                r.x + r.width <= size.width &&
                r.y + r.height <= size.height
              );
            },
            { message: `Menu bounds at ${size.width}×${size.height}` },
          )
          .toBe(true);
        await page.keyboard.press("Escape");
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({
          path: path.join(output, `qa-${size.width}x${size.height}.png`),
        });
      }
    },
  );
  await check(
    "Reduced motion disables continuous animation; no remote dependencies",
    async () => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      assert.equal(
        await page
          .locator(".aw-spin")
          .first()
          .evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
      assert.deepEqual(external, []);
      assert.deepEqual(errors, []);
    },
  );
  const exported = path.join(output, "index.json");
  if (await fs.stat(exported).catch(() => false)) {
    await check(
      "PNG export alpha, exact dimensions and source index coverage",
      async () => {
        const index = JSON.parse(await fs.readFile(exported, "utf8"));
        const catalog = JSON.parse(
          await page.locator("#kit-catalog").textContent(),
        );
        for (const sample of catalog.samples)
          assert.ok(
            index.controls.some(
              (c) => c.component === sample.kind && c.state === sample.state,
            ),
          );
        for (const art of index.artwork)
          for (const png of art.png) {
            const img = sharp(path.join(output, png.file)),
              meta = await img.metadata(),
              stats = await img.stats();
            assert.equal(meta.width, png.width);
            assert.equal(meta.height, png.height);
            assert.equal(meta.hasAlpha, true);
            assert.equal(stats.channels[3].min, 0);
          }
        for (const item of index.controls) {
          const meta = await sharp(path.join(output, item.file)).metadata();
          assert.equal(meta.width, item.width);
          assert.equal(meta.height, item.height);
          assert.equal(meta.hasAlpha, true);
          const stats = await sharp(path.join(output, item.file)).stats();
          assert.equal(stats.channels[3].min, 0);
        }
      },
    );
    await check(
      "Delivered preview opens directly offline without Electron",
      async () => {
        const offline = await kit.browser.newPage();
        const failures = [];
        offline.on("pageerror", (e) => failures.push(e.message));
        offline.on("console", (m) => {
          if (m.type() === "error") failures.push(m.text());
        });
        await offline.goto(
          pathToFileURL(path.join(output, "preview/ui-kit.html")).href,
        );
        await offline.locator("[data-ui-kit-ready]").waitFor();
        await expect(offline.locator(".kit-sample-tile")).toHaveCount(32);
        await offline
          .getByRole("button", { name: "动效实验室", exact: true })
          .click();
        await expect(offline.locator("[data-motion-demo]")).toHaveCount(6);
        await offline
          .getByRole("button", { name: "重播动效", exact: true })
          .click();
        assert.deepEqual(failures, []);
        await offline.close();
      },
    );
  }
  await check("Original Electron app and #thumbnail entry smoke", async () => {
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), "workshop-ui-kit-"));
    const app = await electron.launch({
      args: [
        path.join(workspace, "out/main/index.cjs"),
        `--user-data-dir=${path.join(temp, "app")}`,
      ],
      env: { ...process.env, WORKSHOP_LIBRARY: path.join(temp, "library") },
    });
    try {
      const original = await app.firstWindow();
      const appErrors = [];
      original.on("pageerror", (e) => appErrors.push(e.message));
      await original.waitForSelector(".asset-browser", { timeout: 60000 });
      await expect(
        original.getByRole("button", { name: "全部素材", exact: true }),
      ).toBeVisible();
      await original.goto(
        pathToFileURL(path.join(workspace, "out/renderer/index.html")).href +
          "#thumbnail",
      );
      await original.reload();
      await original.waitForFunction(() => window.thumbnailReady === true);
      await expect(original.locator(".app-shell")).toHaveCount(0);
      assert.deepEqual(appErrors, []);
    } finally {
      await app.close();
    }
  });
  await fs.writeFile(
    path.join(output, "validation.json"),
    JSON.stringify(
      { passed: true, checks, externalRequests: external, errors },
      null,
      2,
    ) + "\n",
  );
  console.log(`All ${checks.length} UI-kit checks passed.`);
} finally {
  await kit.close();
}
