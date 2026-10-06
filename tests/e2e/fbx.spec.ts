import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

test("real Kenney FBX displays all material groups, generates a thumbnail and converts intact to GLB", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-FBX-")),
    source = path.join(temp, "中文 空格交付"),
    root = path.join(temp, "素材库"),
    fixture = path.resolve(
      "tests/fixtures/kenney-nature/bridge_center_wood.fbx",
    );
  await fs.mkdir(source);
  await fs.copyFile(fixture, path.join(source, "bridge_center_wood.fbx"));
  const original = await fs.readFile(fixture);
  const launch = () =>
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
  let app = await launch(),
    page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
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
    const card = page
      .locator("button.asset-card")
      .filter({ hasText: "bridge_center_wood" });
    await card.locator(".asset-caption").click();
    // Both the compact inspector reported by the user and the expanded viewer
    // share the adapter. Wait for parsed statistics as well as a canvas.
    await expect(page.locator(".inspector .model-canvas canvas")).toBeVisible();
    await expect(page.locator(".inspector .viewer-message")).toHaveCount(0);
    await card.locator(".asset-thumb").click();
    const viewer = page.getByRole("dialog");
    await expect(viewer.locator(".viewport-bottom")).toHaveText(
      /52 三角形156 顶点UV 0/,
    );
    await expect(viewer.locator(".viewer-message")).toHaveCount(0);
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            window.workshop
              .call<any>("assets.query", { extension: "fbx" })
              .then((p) => p.items[0].thumbnailUrl),
          ),
        { timeout: 30000 },
      )
      .toBeTruthy();
    const fbx = await page.evaluate(() =>
      window.workshop
        .call<any>("assets.query", { extension: "fbx" })
        .then((p) => p.items[0]),
    );
    expect(fbx.metadata.materials.map((m: any) => m.name)).toEqual([
      "woodBark",
      "wood",
      "stone",
    ]);
    const hosted = path.join(
      root,
      "packages",
      fbx.packageId,
      fbx.revisionId,
      "source",
      fbx.path,
    );
    expect(
      createHash("sha256")
        .update(await fs.readFile(hosted))
        .digest("hex"),
    ).toBe(createHash("sha256").update(original).digest("hex"));
    await fs.mkdir("docs/screenshots", { recursive: true });
    await page.screenshot({ path: "docs/screenshots/fbx-bridge-fixed.png" });
    await viewer
      .getByRole("button", { name: "模型更多操作", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "生成 GLB 副本", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.workshop
            .call<any[]>("jobs.list")
            .then(
              (j) => j.find((j) => j.title === "导入 GLB 转换副本")?.status,
            ),
        ),
      )
      .toBe("completed");
    const glb = await page.evaluate(() =>
      window.workshop
        .call<any>("assets.query", { extension: "glb" })
        .then((p) => p.items[0]),
    );
    const glbBytes = await fs.readFile(
      path.join(
        root,
        "packages",
        glb.packageId,
        glb.revisionId,
        "source",
        glb.path,
      ),
    );
    const json = JSON.parse(
      glbBytes.subarray(20, 20 + glbBytes.readUInt32LE(12)).toString("utf8"),
    );
    const primitives = json.meshes.flatMap((m: any) => m.primitives);
    expect(primitives).toHaveLength(3);
    expect(primitives.map((p: any) => json.accessors[p.indices].count)).toEqual(
      [138, 12, 6],
    );
    expect(json.materials.map((m: any) => m.name)).toEqual([
      "woodBark",
      "wood",
      "stone",
    ]);
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .locator("button.asset-card")
      .filter({ hasText: glb.title })
      .dblclick();
    await expect(
      page.getByRole("dialog").locator(".viewport-bottom"),
    ).toHaveText(/52 三角形\d+ 顶点UV 0/);
    await expect(
      page.getByRole("dialog").locator(".viewer-message"),
    ).toHaveCount(0);
    expect(errors).toEqual([]);

    // Simulate the persisted state from the user's older client, then reopen.
    // No direct preview request: the grid must retry the old FBX failure itself.
    await app.close();
    const db = new DatabaseSync(path.join(root, "catalog.sqlite"));
    try {
      const row = db
        .prepare("SELECT metadata FROM assets WHERE id=?")
        .get(fbx.id)!;
      db.prepare("UPDATE assets SET thumbnail=NULL,metadata=? WHERE id=?").run(
        JSON.stringify({
          ...JSON.parse(row.metadata as string),
          thumbnailError: true,
          thumbnailErrorVersion: 1,
        }),
        fbx.id,
      );
    } finally {
      db.close();
    }
    app = await launch();
    page = await app.firstWindow();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.waitForSelector(".asset-browser");
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              window.workshop
                .call<any>("assets.detail", { id })
                .then(
                  (d) =>
                    !!d.asset.thumbnailUrl && !d.asset.metadata.thumbnailError,
                ),
            fbx.id,
          ),
        { timeout: 30000 },
      )
      .toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});

test("binary FBX character with separate animation still loads and plays", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-FBX动画-")),
    source = path.join(temp, "交付"),
    root = path.join(temp, "库");
  await fs.cp("tests/fixtures/kenney-animated", source, { recursive: true });
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
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
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
    await page
      .locator("button.asset-card")
      .filter({ hasText: "characterMedium" })
      .dblclick();
    const viewer = page.getByRole("dialog");
    await expect(viewer.locator(".viewer-message")).toHaveCount(0, {
      timeout: 30000,
    });
    await expect(viewer.getByLabel("动画", { exact: true })).toBeVisible();
    await viewer.getByRole("button", { name: "播放动画", exact: true }).click();
    await expect
      .poll(async () =>
        Number(
          await viewer.getByLabel("动画时间", { exact: true }).inputValue(),
        ),
      )
      .toBeGreaterThan(0);
    await viewer.getByRole("button", { name: "暂停动画", exact: true }).click();
    await expect(viewer.locator(".viewer-message")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
