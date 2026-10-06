import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
test("OBJ context conversion preserves source material and forced 3D thumbnails update only the cache", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-convert-")),
    source = path.join(temp, "交付"),
    root = path.join(temp, "库");
  await fs.mkdir(source);
  await fs.writeFile(
    path.join(source, "原始模型.obj"),
    "mtllib material.mtl\no triangle\nv -1 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0.5 1\nusemtl original_wood\nf 1/1 2/2 3/3\n",
  );
  await fs.writeFile(
    path.join(source, "material.mtl"),
    "newmtl original_wood\nKd 0.65 0.3 0.1\n",
  );
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
    const card = page
      .locator("button.asset-card")
      .filter({ hasText: "原始模型" });
    await card.dblclick();
    await expect(page.locator(".model-canvas canvas").last()).toBeVisible();
    await expect(page.locator(".viewer-message")).toHaveCount(0);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "模型更多操作", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "显示模式", exact: true }).click();
    await page
      .getByRole("menuitemcheckbox", { name: "纯色", exact: true })
      .click();
    await page
      .getByRole("dialog")
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
    expect(glb.metadata.materials[0].name).toBe("original_wood");
    const before = await page.evaluate(() =>
      window.workshop.call<any>("library.stats"),
    );
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    const job = await page.evaluate(
      (id) => window.workshop.call<string>("previews.rebuild", { ids: [id] }),
      glb.id,
    );
    await expect
      .poll(
        () =>
          page.evaluate(
            (id) =>
              window.workshop
                .call<any[]>("jobs.list")
                .then((j) => j.find((j) => j.id === id)?.status),
            job,
          ),
        { timeout: 70000 },
      )
      .toBe("completed");
    const rebuilt = await page.evaluate(
      (id) =>
        window.workshop.call<any>("assets.detail", { id }).then((d) => d.asset),
      glb.id,
    );
    expect(rebuilt.thumbnailUrl).toMatch(/model-v\d{10,}\.png/);
    const after = await page.evaluate(() =>
      window.workshop.call<any>("library.stats"),
    );
    expect(after.assets).toBe(before.assets);
    expect(after.files).toBe(before.files);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
