import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import sharp from "sharp";
import { pathToFileURL } from "node:url";

const output = path.resolve("docs/client-style");
await fs.mkdir(output, { recursive: true });
const temp = await fs.mkdtemp(path.join(os.tmpdir(), "workshop-client-style-"));
const source = path.join(temp, "素材"),
  root = path.join(temp, "library");
await fs.mkdir(source);
const pictures = [
  "sample-character",
  "sample-crate",
  "sample-dungeon",
  "sample-normal",
  "sample-albedo",
];
const available = await fs.readdir("src/renderer/public/ui-art");
for (let i = 0; i < 20; i++) {
  const name = pictures.filter((name) => available.includes(name + ".svg"))[
    i % 3
  ];
  await sharp(path.resolve(`src/renderer/public/ui-art/${name}.svg`))
    .resize(320, 240, { fit: "contain" })
    .png()
    .toFile(
      path.join(
        source,
        `${i === 0 ? "很长的中文素材名称_角色动作与多行属性验证_" : "冒险素材_"}${String(i).padStart(2, "0")}.png`,
      ),
    );
}
await fs.copyFile(
  "tests/fixtures/kenney-nature/bridge_center_wood.fbx",
  path.join(source, "木桥_模型.fbx"),
);
const app = await electron.launch({
  ...(process.env.WORKSHOP_EXE
    ? {
        executablePath: process.env.WORKSHOP_EXE,
        args: [`--user-data-dir=${path.join(temp, "app")}`],
      }
    : {
        args: [
          path.resolve("out/main/index.cjs"),
          `--user-data-dir=${path.join(temp, "app")}`,
        ],
      }),
  env: { ...process.env, WORKSHOP_LIBRARY: root },
});
const errors = [],
  checks = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  let requestedSize = [1510, 950];
  const nativeWindow = await app.browserWindow(page);
  const setSize = async (width, height) => {
    requestedSize = [width, height];
    await nativeWindow.evaluate(
      (window, size) => {
        window.unmaximize();
        window.setContentSize(...size);
      },
      [width, height],
    );
    await page.waitForFunction(
      ([width, height]) =>
        Math.abs(innerWidth - width) <= 2 &&
        Math.abs(innerHeight - height) <= 2,
      [width, height],
    );
  };
  const capture = async (name) => {
    await page.waitForFunction(
      () =>
        !document
          .querySelector(".client-route-reveal")
          ?.getAnimations({ subtree: true })
          .some((a) => a.playState === "running"),
    );
    const bounds = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    }));
    assert.ok(
      Math.abs(bounds.width - requestedSize[0]) <= 2 &&
        Math.abs(bounds.height - requestedSize[1]) <= 2,
      name + JSON.stringify(bounds),
    );
    await page.screenshot({
      scale: "css",
      path: path.join(output, name + ".png"),
    });
  };
  await page.waitForSelector(".asset-browser");
  await setSize(1510, 950);
  await app.evaluate(({ dialog }, source) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [source],
    });
  }, source);
  await page.getByRole("button", { name: "导入素材", exact: true }).click();
  await page.getByRole("button", { name: "开始导入", exact: true }).click();
  await expect(page.locator(".browser-toolbar b")).toHaveText("21");
  checks.push("Native import and real IPC catalog");
  await page
    .locator(".asset-card")
    .filter({ hasText: "很长的中文" })
    .locator(".asset-caption")
    .click();
  await expect(page.locator(".inspector-heading")).toContainText("很长的中文");
  await page.getByRole("tab", { name: "属性", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "依赖", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Home");
  checks.push("Selection, long Chinese name, inspector keyboard tabs");
  await capture("library-detail-1510x950");
  const trigger = page.getByRole("button", {
    name: "素材视图更多操作",
    exact: true,
  });
  await trigger.click();
  await expect(
    page.getByRole("menu", { name: "操作菜单", exact: true }),
  ).toBeVisible();
  await capture("menu-1510x950");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  const modal = page.getByRole("dialog");
  await modal.getByLabel("项目名称").fill("漫画冒险 · 角色与场景");
  await modal
    .getByLabel("项目说明")
    .fill("本地素材管理与材质制作\n多行说明、中文输入和焦点恢复验证");
  await capture("dialog-1510x950");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "创建项目", exact: true }),
  ).toBeFocused();
  checks.push("Menu focus restoration, native dialog Escape/exit/focus");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("项目名称")
    .fill("漫画冒险 · 角色与场景");
  await page
    .getByRole("dialog")
    .getByLabel("项目说明")
    .fill("原创角色、地牢与木桥素材。离线制作自己的游戏世界。");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "创建项目", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  for (const [width, height] of [
    [1510, 950],
    [1050, 700],
  ]) {
    await setSize(width, height);
    await page.getByRole("button", { name: "全部素材", exact: true }).click();
    await capture(`library-${width}x${height}`);
    for (const [label, selector, name] of [
      ["工作台", ".dashboard", "dashboard"],
      ["免费素材", ".sources-page", "sources"],
      ["设置", ".settings-page", "settings"],
    ]) {
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.locator(selector).waitFor();
      await capture(`${name}-${width}x${height}`);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${name}: window overflow`,
      );
    }
    // The task icon has a stable accessible name in the client.
    await page.getByRole("button", { name: "任务中心", exact: true }).click();
    await page.locator(".tasks-page").waitFor();
    await capture(`tasks-${width}x${height}`);
    await page.getByRole("button", { name: "全部素材", exact: true }).click();
    await page.locator(".asset-scroll").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await page
      .locator(".asset-card")
      .filter({ hasText: "木桥_模型" })
      .locator(".asset-caption")
      .click();
    await page
      .locator(".inspector-actions")
      .getByRole("button", { name: "材质工作台", exact: true })
      .click();
    await page.locator(".material-workbench").waitFor();
    await expect(page.locator(".app-shell")).toHaveAttribute(
      "data-accent",
      "violet",
    );
    await setSize(width, height);
    await capture(`material-${width}x${height}`);
  }
  checks.push("Six client pages at 1050×700 and 1510×950");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "全部素材", exact: true }).click();
  await trigger.click();
  const invalid = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .some((a) => {
        const effect = a.effect;
        return (
          effect instanceof KeyframeEffect &&
          (Number(effect.getTiming().duration) > 80 ||
            effect.getKeyframes().some((f) => "transform" in f))
        );
      }),
  );
  assert.equal(invalid, false);
  await page.keyboard.press("Escape");
  checks.push("System reduced motion, no transform or long-running animations");
  await page.goto(
    pathToFileURL(path.resolve("out/renderer/index.html")).href + "#thumbnail",
  );
  await page.reload();
  await page.waitForFunction(() => window.thumbnailReady === true);
  await expect(page.locator(".client-theme")).toHaveCount(0);
  checks.push("Thumbnail renderer remains isolated");
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(output, "validation.json"),
    JSON.stringify(
      { passed: true, date: new Date().toISOString(), checks, errors },
      null,
      2,
    ),
  );
  console.log(`Client style: ${checks.length} checks passed.`);
} finally {
  await app.close();
}
