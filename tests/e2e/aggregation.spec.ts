import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

test("entity filtering, smart grouping, manual correction and grouped game export", async ({}, testInfo) => {
  const temp = await fs.mkdtemp(
      path.join(os.tmpdir(), "workshop-aggregation-ui-"),
    ),
    source = path.join(temp, "实体素材"),
    root = path.join(temp, "库"),
    target = path.join(temp, "游戏工程");
  await fs.mkdir(source);
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "project.godot"), "config_version=5\n");
  const png = await sharp({
    create: { width: 32, height: 32, channels: 4, background: "#b99557" },
  })
    .png()
    .toBuffer();
  for (const file of [
    "door_closed.png",
    "door_open.png",
    "sword_icon.png",
    "coin.png",
  ])
    await fs.writeFile(path.join(source, file), png);
  const app = await electron.launch({
      ...(process.env.WORKSHOP_EXE
        ? {
            executablePath: process.env.WORKSHOP_EXE,
            args: [`--user-data-dir=${path.join(root, "electron-state")}`],
          }
        : {
            args: [
              "out/main/index.cjs",
              `--user-data-dir=${path.join(root, "electron-state")}`,
            ],
          }),
      env: { ...process.env, WORKSHOP_LIBRARY: root },
    }),
    page = await app.firstWindow(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.waitForSelector(".asset-browser");
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [source],
      });
    }, source);
    await page.getByRole("button", { name: "导入素材", exact: true }).click();
    await page.getByRole("button", { name: "开始导入", exact: true }).click();
    await expect(page.locator(".browser-toolbar b")).toHaveText("4");
    const assets = page.locator("button.asset-card");
    await assets.first().locator(".asset-caption").click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await assets
      .nth(1)
      .locator(".asset-thumb")
      .click({ modifiers: ["Control"] });
    await expect(page.locator(".selection-bar")).toContainText("2 个已选择");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await assets.first().locator(".asset-caption").click();
    await assets
      .nth(2)
      .locator(".asset-thumb")
      .click({ modifiers: ["Shift"] });
    await expect(page.locator(".selection-bar")).toContainText("3 个已选择");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const door = assets.filter({ hasText: "door_closed" });
    await door.locator(".asset-thumb").click();
    await expect(
      page
        .getByRole("dialog", { name: "door_closed", exact: true })
        .locator(".image-stage img"),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    // The native modal remains active until its exit animation completes.
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await door.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "door_closed", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    const project = await page.evaluate(() =>
      window.workshop.call<any>("projects.save", {
        name: "聚合验收项目",
        description: "整组交付验证",
        color: "#b99557",
      }),
    );
    await page
      .locator(".entity-nav")
      .getByRole("button", { name: "交互物与机关", exact: true })
      .click();
    await expect(page.locator(".browser-toolbar b")).toHaveText("2");
    await page.getByRole("button", { name: "智能聚合", exact: true }).click();
    await expect(
      page.locator(".aggregation-browser .browser-toolbar b"),
    ).toHaveText("1");
    const card = page.locator(".group-card").first();
    await card.locator(".group-preview strong").click();
    await expect(page.locator(".selection-bar")).toContainText("2 个已选择");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await card.locator(".group-thumb").click({ modifiers: ["Control"] });
    await expect(page.locator(".selection-bar")).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await card.locator(".group-thumb").click();
    await expect(
      page.getByRole("dialog").locator(".image-stage img"),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await card.locator(".group-preview").focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog").locator(".image-stage img"),
    ).toBeVisible();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "关闭", exact: true })
      .click();
    await page
      .getByRole("button", { name: "素材更多操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "批量整理…", exact: true })
      .click();
    const organize = page.getByRole("dialog", { name: "批量整理素材" });
    await organize.getByLabel("聚合组", { exact: true }).selectOption("new");
    await organize.getByLabel("聚合组名称").fill("地牢门 · 开关状态");
    await organize
      .getByRole("button", { name: "应用到 2 个素材", exact: true })
      .click();
    await expect(card).toContainText("地牢门 · 开关状态");
    await card.getByRole("button", { name: "查看成员", exact: true }).click();
    const detail = page.getByRole("dialog", {
      name: "聚合组 · 地牢门 · 开关状态",
    });
    await expect(detail.locator(".group-members button")).toHaveCount(2);
    await detail.getByLabel("整组加入项目").selectOption(project.id);
    await detail.getByRole("button", { name: "加入项目", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.workshop
              .call<any>("assets.query", { projectId: id, showRelated: true })
              .then((p) => p.total),
          project.id,
        ),
      )
      .toBe(2);
    await page.screenshot({
      path: testInfo.outputPath("smart-aggregation.png"),
    });
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [target],
      });
    }, target);
    await card.getByRole("button", { name: "整组导入", exact: true }).click();
    const flow = page.getByRole("dialog", { name: "导出游戏素材" });
    await expect(
      flow.getByRole("checkbox", { name: /聚合交付/ }),
    ).toBeChecked();
    await flow.getByRole("button", { name: "选择", exact: true }).click();
    await flow.getByRole("button", { name: "检查导出", exact: true }).click();
    await expect(flow).toContainText("依赖和格式检查通过");
    await flow.getByRole("button", { name: "开始导出", exact: true }).click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          window.workshop
            .call<any[]>("jobs.list")
            .then((jobs) => jobs.find((j) => j.type === "export")?.status),
        ),
      )
      .toBe("completed");
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(target, "assets", "workshop", "workshop-manifest.json"),
        "utf8",
      ),
    );
    expect(manifest.assets).toHaveLength(2);
    expect(
      new Set(manifest.entries.map((e: any) => e.entry.split("/")[0])).size,
    ).toBe(1);
    expect(
      manifest.assets.every(
        (a: any) =>
          a.metadata.entityCategory === "interactive" &&
          a.metadata.assetGroup.name === "地牢门 · 开关状态",
      ),
    ).toBe(true);
    await page.getByLabel("聚合方式").selectOption("package");
    await expect(
      page.locator(".aggregation-browser .browser-toolbar"),
    ).toContainText("4 个关联素材");
    await page.getByRole("button", { name: "普通浏览", exact: true }).click();
    await expect(page.locator(".browser-toolbar b")).toHaveText("2");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    if (
      !path
        .resolve(temp)
        .startsWith(path.join(os.tmpdir(), "workshop-aggregation-ui-"))
    )
      throw new Error("Unexpected test directory");
    await fs.rm(temp, { recursive: true, force: true });
  }
});
