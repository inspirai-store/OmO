import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
const launch = (root: string) =>
  electron.launch({
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
  });
test("context menus organize all pages, preserve live thumbnails, and restore auxiliary images", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-context-")),
    source = path.join(temp, "素材"),
    root = path.join(temp, "库");
  await fs.mkdir(source);
  const png = await sharp({
    create: { width: 16, height: 16, channels: 4, background: "#95734d" },
  })
    .png()
    .toBuffer();
  await Promise.all(
    Array.from({ length: 260 }, (_, i) =>
      fs.writeFile(
        path.join(source, `素材-${String(i).padStart(3, "0")}.png`),
        png,
      ),
    ),
  );
  const app = await launch(root),
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
    await expect(page.locator(".browser-toolbar b")).toHaveText("260");
    const cards = page.locator("button.asset-card");
    await cards.nth(0).locator(".asset-caption").click();
    await cards.nth(1).click({ modifiers: ["Control"] });
    await cards.nth(0).click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "批量整理…", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".selection-bar")).toContainText("2 个已选择");
    await page.keyboard.press("Escape");
    await cards.nth(2).click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "整理…", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".selection-bar")).toContainText("1 个已选择");
    await page.keyboard.press("Escape");
    await cards.nth(2).focus();
    await page.keyboard.press("Shift+F10");
    await expect(
      page.getByRole("menuitem", { name: "整理…", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(cards.nth(2)).toBeFocused();
    await page
      .getByRole("button", { name: "素材视图更多操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "全选当前筛选结果", exact: true })
      .click();
    await expect(page.locator(".selection-bar")).toContainText("260 个已选择");
    await page
      .getByRole("button", { name: "素材更多操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "批量整理…", exact: true })
      .click();
    const organize = page.getByRole("dialog", { name: "批量整理素材" });
    await organize.getByLabel("分类", { exact: true }).selectOption("ui");
    await organize.getByLabel("标题规则").selectOption("rule");
    await organize.getByLabel("前缀", { exact: true }).fill("界面-");
    await organize
      .getByRole("button", { name: "应用到 260 个素材", exact: true })
      .click();
    await expect(cards.first()).toContainText("界面-");
    const rows = await page.evaluate(() =>
      window.workshop.call<any>("assets.query", {
        limit: 300,
        showRelated: true,
      }),
    );
    expect(
      rows.items.every(
        (a: any) => a.category === "ui" && a.title.startsWith("界面-"),
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "清除选择", exact: true }).click();
    await cards.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "整理…", exact: true }).click();
    await page
      .getByRole("dialog", { name: "整理素材" })
      .getByLabel("图片用途")
      .selectOption("preview");
    await page
      .getByRole("button", { name: "应用到 1 个素材", exact: true })
      .click();
    await expect(page.locator(".browser-toolbar b")).toHaveText("259");
    await page
      .getByRole("button", { name: "素材视图更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "视图", exact: true }).click();
    await page
      .getByRole("menuitemcheckbox", { name: "显示辅助预览图", exact: true })
      .click();
    await expect(page.locator(".browser-toolbar b")).toHaveText("260");
    const aux = await page.evaluate(() =>
      window.workshop
        .call<any>("assets.query", { showRelated: true, limit: 300 })
        .then((p) =>
          p.items.find((a: any) => a.metadata.auxiliaryRole === "preview"),
        ),
    );
    const auxCard = cards.filter({ hasText: aux.title });
    await auxCard.click({ button: "right" });
    await page.getByRole("menuitem", { name: "整理…", exact: true }).click();
    await page
      .getByRole("dialog", { name: "整理素材" })
      .getByLabel("图片用途")
      .selectOption("ordinary");
    await page
      .getByRole("button", { name: "应用到 1 个素材", exact: true })
      .click();
    // Open at the lower window edge, then update its underlying card without changing the captured command target.
    await cards.first().locator(".asset-caption").click();
    const selected = await page.evaluate(() =>
      window.workshop
        .call<any>("assets.selection", {
          query: { showRelated: true, sort: "newest" },
        })
        .then((s) => s.sample[0]),
    );
    await page.locator(".asset-scroll").evaluate((el) =>
      el.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          clientX: innerWidth - 2,
          clientY: innerHeight - 2,
        }),
      ),
    );
    await expect(
      page.getByRole("menuitem", { name: "全选当前筛选结果", exact: true }),
    ).toBeVisible();
    const rect = (await page.locator(".context-menu").boundingBox())!;
    const viewport = await page.evaluate(() => ({
      w: innerWidth,
      h: innerHeight,
    }));
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.w);
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.h);
    await page.keyboard.press("Escape");
    await cards.first().click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "整理…", exact: true }),
    ).toBeVisible();
    const before = await page
      .locator(".asset-scroll")
      .evaluate((el) => el.scrollTop);
    await page.evaluate(
      async ({ id, base64 }) => {
        for (let i = 0; i < 12; i++)
          await window.workshop.call("previews.thumbnail", {
            assetId: id,
            base64,
          });
      },
      { id: selected.id, base64: png.toString("base64") },
    );
    await expect(
      page.getByRole("menuitem", { name: "整理…", exact: true }),
    ).toBeVisible();
    expect(
      await page.locator(".asset-scroll").evaluate((el) => el.scrollTop),
    ).toBe(before);
    await page
      .getByRole("menuitem", { name: "收藏所选素材", exact: true })
      .click();
    expect(
      await page.evaluate(
        (id) =>
          window.workshop
            .call<any>("assets.detail", { id })
            .then((d) => d.asset.favorite),
        selected.id,
      ),
    ).toBe(true);
    await app.evaluate(({ Menu }) => {
      (globalThis as any).__textMenu = [];
      Menu.prototype.popup = function () {
        (globalThis as any).__textMenu = this.items.map((i) => i.role);
      };
    });
    await page
      .getByLabel("搜索素材", { exact: true })
      .click({ button: "right" });
    await expect(page.locator(".context-menu")).toHaveCount(0);
    expect(await app.evaluate(() => (globalThis as any).__textMenu)).toEqual(
      expect.arrayContaining(["cut", "copy", "paste"]),
    );
    await page
      .getByRole("button", { name: "素材更多操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "文件与来源", exact: true })
      .focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("menuitem", { name: "复制标题", exact: true }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "复制标题", exact: true }).click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      selected.title,
    );
    const collectionIds = await page.evaluate(async (id) => {
      const manual = await window.workshop.call<string>("collections.save", {
        name: "菜单测试收藏",
      });
      await window.workshop.call("collections.attach", {
        collectionId: manual,
        assetIds: [id],
      });
      const smart = await window.workshop.call<string>("collections.save", {
        name: "菜单智能收藏",
        query: { category: "ui" },
      });
      return { manual, smart };
    }, selected.id);
    const manual = page
      .locator(".sidebar nav button")
      .filter({ hasText: "菜单测试收藏" });
    await manual.click({ button: "right" });
    await page.getByRole("menuitem", { name: "重命名…", exact: true }).click();
    await page.getByLabel("收藏集名称", { exact: true }).fill("菜单收藏已改名");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "保存", exact: true })
      .click();
    await page
      .locator(".sidebar nav button")
      .filter({ hasText: "菜单收藏已改名" })
      .click();
    await cards.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "关联", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "移出当前收藏集", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .locator(".sidebar nav button")
      .filter({ hasText: "菜单智能收藏" })
      .click();
    await expect(page.locator(".browser-toolbar b")).toHaveText("260");
    await cards.first().click({ button: "right" });
    await page.getByRole("menuitem", { name: "关联", exact: true }).click();
    await expect(
      page.getByRole("menuitem", { name: "移出当前收藏集", exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByPlaceholder("你的下一个游戏").fill("菜单项目");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "创建项目", exact: true })
      .click();
    const projectButton = page
      .locator(".sidebar nav button")
      .filter({ hasText: "菜单项目" });
    await projectButton.click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "导出整个项目", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("menuitem", { name: "编辑名称与工程绑定…", exact: true })
      .click();
    await page.getByLabel("项目名称", { exact: true }).fill("菜单项目已改名");
    await page.getByRole("button", { name: "保存项目", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "菜单项目已改名", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "免费素材", exact: true }).click();
    await page.locator(".source-card").first().click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "查看规格与依赖…", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "复制来源链接", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator(".top-actions button").last().click();
    await page.locator(".job-card").first().click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "查看任务详情", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "暂停", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("menuitem", { name: "查看任务详情", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "任务详情" })).toBeVisible();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("button", { name: "缓存更多操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "查看缓存占用", exact: true })
      .click();
    await expect(page.getByRole("dialog", { name: "缓存占用" })).toContainText(
      "未计入素材",
    );
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .getByRole("button", { name: "素材库更多操作", exact: true })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "恢复到新目录…", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await page
      .locator(".sidebar nav button")
      .filter({ hasText: "菜单智能收藏" })
      .click();
    await cards.first().click({ button: "right" });
    await page.screenshot({ path: "docs/screenshots/context-menu.png" });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
test("desktop import → project → image/model → variant → export → restart", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-e2e-")),
    source = path.join(temp, "美术交付"),
    root = path.join(temp, "库"),
    target = path.join(temp, "Godot");
  await fs.mkdir(source);
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "project.godot"), "config_version=5\n");
  await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 173, g: 90, b: 40, alpha: 1 },
    },
  })
    .png()
    .toFile(path.join(source, "木板_Color.png"));
  const floats = new Float32Array([
    -1, 0, 0, 1, 0, 0, 0, 1.7, 0, 0, 0, 1, 0, 0.5, 1, 0, 1, 0, 0, 0, 1, 0, 0,
    0.7071068, 0.7071068,
  ]);
  await fs.writeFile(
    path.join(source, "model.bin"),
    Buffer.from(floats.buffer),
  );
  const doc = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "测试模型" }],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 },
        ],
      },
    ],
    materials: [
      {
        name: "木材",
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      },
    ],
    buffers: [{ uri: "model.bin", byteLength: floats.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 24 },
      { buffer: 0, byteOffset: 60, byteLength: 8 },
      { buffer: 0, byteOffset: 68, byteLength: 32 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-1, 0, 0],
        max: [1, 1.7, 0],
      },
      { bufferView: 1, componentType: 5126, count: 3, type: "VEC2" },
      {
        bufferView: 2,
        componentType: 5126,
        count: 2,
        type: "SCALAR",
        min: [0],
        max: [1],
      },
      { bufferView: 3, componentType: 5126, count: 2, type: "VEC4" },
    ],
    animations: [
      {
        name: "旋转",
        samplers: [{ input: 2, output: 3 }],
        channels: [{ sampler: 0, target: { node: 0, path: "rotation" } }],
      },
    ],
  };
  await fs.writeFile(path.join(source, "测试模型.gltf"), JSON.stringify(doc));
  const errors: string[] = [];
  let app = await launch(root);
  let page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await expect(
      page.getByRole("heading", { name: "全部素材", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    await page.getByPlaceholder("你的下一个游戏").fill("冒险项目");
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [target],
      });
    }, target);
    await page
      .getByRole("button", { name: "选择 Godot 工程", exact: true })
      .click();
    await page
      .getByRole("button", { name: "创建项目", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("heading", { name: "冒险项目", exact: true }),
    ).toBeVisible();
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [source],
      });
    }, source);
    await page.getByRole("button", { name: "导入素材", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "导入素材到本地库" }),
    ).toBeVisible();
    await page.getByLabel("目标项目").selectOption({ label: "冒险项目" });
    await page.getByRole("button", { name: "开始导入", exact: true }).click();
    await expect(page.locator(".asset-card")).toHaveCount(2, {
      timeout: 30000,
    });
    await fs.rm(source, { recursive: true, force: true });
    await page
      .locator(".asset-card")
      .filter({ hasText: "木板" })
      .locator(".asset-caption")
      .click();
    await expect(page.locator(".inspector-preview img")).toBeVisible();
    const loaded = await page
      .locator(".inspector-preview img")
      .evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0);
    expect(loaded).toBe(true);
    await page
      .locator(".asset-card")
      .filter({ hasText: "测试模型" })
      .dblclick();
    await expect(
      page.getByRole("dialog").getByLabel("动画", { exact: true }),
    ).toBeVisible({ timeout: 30000 });
    await expect(page.locator(".viewer-message.error")).toHaveCount(0);
    const canvas = page.getByRole("dialog").locator(".model-canvas canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(
      box.x + box.width / 2 + 40,
      box.y + box.height / 2 + 12,
      { steps: 8 },
    );
    await page.mouse.up({ button: "right" });
    await expect(page.locator(".context-menu")).toHaveCount(0);
    await canvas.click({ button: "right" });
    await expect(
      page.getByRole("menuitem", { name: "重置相机", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    await page
      .getByRole("dialog")
      .getByRole("button", { name: "播放动画", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "暂停动画", exact: true })
      .click();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .locator(".asset-card")
      .filter({ hasText: "木板" })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "素材工具", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "匹配贴图到模型…", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "匹配贴图到模型" })
      .getByLabel("模型", { exact: true })
      .selectOption({ label: "测试模型" });
    await page
      .getByRole("button", { name: "确认匹配并进入工作台", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "保存变体", exact: true }),
    ).toBeEnabled();
    await page.getByLabel("变体名称").fill("秋季木材");
    await page
      .locator(".texture-slot")
      .first()
      .getByRole("button")
      .first()
      .click();
    await page
      .locator(".texture-picker-grid button")
      .filter({ hasText: "木板" })
      .click();
    await page.getByRole("button", { name: "保存变体", exact: true }).click();
    await expect(page.locator(".variant-strip")).toContainText("秋季木材");
    await page
      .getByRole("button", { name: "材质更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "复制变体", exact: true }).click();
    await expect(page.locator(".variant-strip")).toContainText("秋季木材 副本");
    await page
      .getByRole("button", { name: "材质更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "重命名…", exact: true }).click();
    await page
      .getByRole("dialog", { name: "重命名材质变体" })
      .getByLabel("变体名称", { exact: true })
      .fill("试验副本");
    await page.getByRole("button", { name: "保存名称", exact: true }).click();
    await page
      .locator(".variant-strip button")
      .filter({ hasText: "试验副本" })
      .click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "删除未引用变体…", exact: true })
      .click();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await page
      .locator(".variant-strip button")
      .filter({ hasText: "秋季木材" })
      .click();
    await page
      .getByRole("button", { name: "材质更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "并排对照", exact: true }).click();
    await expect(
      page.getByRole("dialog").locator(".model-canvas canvas"),
    ).toHaveCount(2);
    await expect(
      page.getByRole("dialog").locator(".viewer-message"),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [target],
      });
    }, target);
    await page
      .getByRole("button", { name: "保存并导出…", exact: true })
      .click();
    await page.getByRole("button", { name: "选择", exact: true }).click();
    await page.getByRole("button", { name: "检查导出", exact: true }).click();
    await page.getByRole("button", { name: "开始导出", exact: true }).click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          window.workshop
            .call<any[]>("jobs.list")
            .then((j) => j.find((j) => j.type === "export")?.status),
        ),
      )
      .toBe("completed");
    await fs.access(path.join(target, "assets/workshop/workshop-export.json"));
    await fs.mkdir("docs/screenshots", { recursive: true });
    await page.screenshot({ path: "docs/screenshots/material-workbench.png" });
    await page
      .getByRole("button", { name: "材质更多操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "应用到项目…", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "为项目选择材质变体" })
      .getByRole("button", { name: "冒险项目", exact: true })
      .click();
    await page
      .getByRole("button", { name: "材质更多操作", exact: true })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "删除未引用变体…", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]);
    await app.close();
    app = await launch(root);
    page = await app.firstWindow();
    await page.waitForSelector(".asset-browser");
    const variants = await page.evaluate(() =>
      window.workshop.call("materials.list"),
    );
    expect(variants).toHaveLength(1);
    expect((variants as any)[0].name).toBe("秋季木材");
    const stats = await page.evaluate(() =>
      window.workshop.call("library.stats"),
    );
    expect(stats.assets).toBe(2);
    const quick = await page.evaluate(async () => {
      const projects = await window.workshop.call<any[]>("projects.list");
      return window.workshop.call<any>("exports.quick", {
        projectId: projects[0].id,
      });
    });
    expect(quick.jobId).toBeTruthy();
    expect(quick.plan.variants).toHaveLength(1);
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.workshop
              .call<any[]>("jobs.list")
              .then((rows) => rows.find((j) => j.id === id)?.status),
          quick.jobId,
        ),
      )
      .toBe("completed");
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("scrolling keeps cards and position stable during pagination and thumbnail updates", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-scroll-"));
  const source = path.join(temp, "素材"),
    root = path.join(temp, "库");
  await fs.mkdir(source);
  const png = await sharp({
    create: { width: 16, height: 16, channels: 4, background: "#937346" },
  })
    .png()
    .toBuffer();
  await Promise.all(
    Array.from({ length: 460 }, (_, i) =>
      fs.writeFile(
        path.join(source, `素材-${String(i).padStart(3, "0")}.png`),
        png,
      ),
    ),
  );
  const app = await launch(root),
    page = await app.firstWindow();
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
    await expect(page.locator(".browser-toolbar b")).toHaveText("460");
    await page.evaluate(() => {
      const scroll = document.querySelector<HTMLDivElement>(".asset-scroll")!;
      const row = scroll.querySelector<HTMLDivElement>(".asset-row")!;
      const columns =
        getComputedStyle(row).gridTemplateColumns.split(" ").length;
      scroll.scrollTop =
        Math.floor(245 / columns) * parseFloat(row.style.height);
    });
    await expect
      .poll(() => page.locator("button.asset-card").count())
      .toBeGreaterThan(0);
    await expect(page.locator(".asset-scroll > .loading")).toHaveCount(0);
    await page
      .locator("button.asset-card")
      .first()
      .locator(".asset-caption")
      .click();
    const thumbnailAssets = await page.evaluate(async () => {
      const scroll = document.querySelector<HTMLDivElement>(".asset-scroll")!;
      const card = scroll.querySelector<HTMLButtonElement>(
        "button.asset-card.selected",
      )!;
      const title = card.title.split("\n")[0];
      const result = await window.workshop.call<any>("assets.query", {
        offset: 200,
        limit: 200,
        sort: "newest",
      });
      const asset = result.items.find((a: any) => a.title === title);
      if (!asset) throw new Error("滚动后没有加载到第二页");
      const observation = {
        loaders: 0,
        reset: false,
        removed: false,
        top: scroll.scrollTop,
      };
      const check = () => {
        if (scroll.querySelector(".loading")) observation.loaders++;
        if (scroll.scrollTop < observation.top - 1) observation.reset = true;
        if (!card.isConnected) observation.removed = true;
      };
      const observer = new MutationObserver(check);
      observer.observe(scroll, { childList: true, subtree: true });
      scroll.addEventListener("scroll", check);
      (window as any).__scrollQA = { observation, card, observer, check };
      return {
        selectedId: asset.id,
        ids: [
          asset.id,
          ...result.items
            .filter((a: any) => a.id !== asset.id)
            .slice(0, 19)
            .map((a: any) => a.id),
        ],
      };
    });
    for (const assetId of thumbnailAssets.ids) {
      await page.evaluate(
        ({ assetId, base64 }) =>
          window.workshop.call("previews.thumbnail", { assetId, base64 }),
        {
          assetId,
          base64: png.toString("base64"),
        },
      );
    }
    await page.waitForTimeout(250);
    const observation = await page.evaluate(() => {
      const qa = (window as any).__scrollQA;
      qa.check();
      return qa.observation;
    });
    expect(observation.top).toBeGreaterThan(0);
    expect(observation.reset).toBe(false);
    expect(observation.loaders).toBe(0);
    expect(observation.removed).toBe(false);
    await page.evaluate(
      (id) =>
        window.workshop.call("assets.update", {
          ids: [id],
          change: { favorite: true },
        }),
      thumbnailAssets.selectedId,
    );
    await expect(
      page.locator("button.asset-card.selected .favorite-star"),
    ).toBeVisible();
    expect(
      await page.evaluate(() => {
        const qa = (window as any).__scrollQA;
        qa.check();
        return qa.observation;
      }),
    ).toEqual(observation);
    await page.evaluate(() => {
      const qa = (window as any).__scrollQA;
      qa.observer.disconnect();
      document
        .querySelector(".asset-scroll")!
        .removeEventListener("scroll", qa.check);
    });
    for (const index of [310, 410]) {
      await page.evaluate((index) => {
        const scroll = document.querySelector<HTMLDivElement>(".asset-scroll")!;
        const row = scroll.querySelector<HTMLDivElement>(".asset-row")!;
        const columns =
          getComputedStyle(row).gridTemplateColumns.split(" ").length;
        scroll.scrollTop =
          Math.floor(index / columns) * parseFloat(row.style.height);
      }, index);
      await expect
        .poll(() => page.locator("button.asset-card").count())
        .toBeGreaterThan(0);
      await expect(page.locator(".asset-scroll > .loading")).toHaveCount(0);
      await expect(page.locator(".asset-placeholder")).toHaveCount(0);
    }
    await page.getByLabel("搜索素材", { exact: true }).fill("不存在的素材");
    await expect(
      page.getByRole("heading", { name: "没有匹配的素材", exact: true }),
    ).toBeVisible();
    await fs.writeFile(
      "docs/scroll-validation.json",
      JSON.stringify(
        {
          date: new Date().toISOString(),
          passed: true,
          assets: 460,
          thumbnailCompletions: 20,
          distinctThumbnailAssets: thumbnailAssets.ids.length,
          observation,
          catalogRefreshPreservedCards: true,
          favoriteUpdated: true,
          paginationCheckedAt: [245, 310, 410],
          queryChangeChecked: true,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await app.close();
    if (path.dirname(path.resolve(temp)) !== path.resolve(os.tmpdir()))
      throw new Error("测试清理路径超出临时目录");
    await fs.rm(temp, { recursive: true, force: true });
  }
});
