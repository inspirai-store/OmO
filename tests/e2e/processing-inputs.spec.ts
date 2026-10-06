import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

test("size fields stay open while clicking, clearing, typing 64 and tabbing between fields", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-size-input-"));
  const filename = path.join(temp, "image.png");
  await sharp({
    create: { width: 256, height: 256, channels: 4, background: "#79aaff" },
  })
    .png()
    .toFile(filename);
  const app = await electron.launch({
    ...(process.env.WORKSHOP_EXE
      ? {
          executablePath: process.env.WORKSHOP_EXE,
          args: [`--user-data-dir=${path.join(temp, "state")}`],
        }
      : {
          args: [
            "out/main/index.cjs",
            `--user-data-dir=${path.join(temp, "state")}`,
          ],
        }),
    env: { ...process.env, WORKSHOP_LIBRARY: path.join(temp, "library") },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.waitForSelector(".asset-browser");
    await app.evaluate(({ dialog }, filename) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filename],
      });
    }, filename);
    await page.getByRole("button", { name: "图像加工", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "图像加工", exact: true });
    await editor.getByRole("button", { name: "添加图片", exact: true }).click();
    await expect(editor.locator(".processing-inputs > button")).toHaveCount(1);
    const width = editor.getByLabel("宽度", { exact: true }),
      height = editor.getByLabel("高度", { exact: true });
    for (const field of [width, height]) {
      await field.click();
      await field.press("Control+A");
      await field.press("Backspace");
      await expect(editor).toBeVisible();
      await expect(field).toHaveValue("");
      await field.pressSequentially("64", { delay: 150 });
      await expect(editor).toBeVisible();
      await expect(field).toHaveValue("64");
      await field.press("Tab");
      await expect(editor).toBeVisible();
    }
    await width.click();
    await width.press("ArrowUp");
    await width.press("ArrowDown");
    await width.press("Enter");
    await expect(editor).toBeVisible();
    const sizeBox = (await width.boundingBox())!;
    await page.mouse.move(
      sizeBox.x + sizeBox.width / 2,
      sizeBox.y + sizeBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 12 });
    await page.mouse.up();
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute("data-presence", "enter");
    await page.mouse.click(5, 5);
    await expect(editor).toHaveAttribute("data-presence", "enter");
    await editor.getByRole("button", { name: "添加步骤", exact: true }).click();
    await editor
      .getByRole("button", { name: "检查整套方案", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "启动整套方案", exact: true })
      .click();
    await expect(editor.locator(".processing-artifacts article")).toContainText(
      "64×64",
    );
    await fs.mkdir(path.resolve("docs/screenshots"), { recursive: true });
    await page.screenshot({
      path: path.resolve("docs/screenshots/processing-size-input-64.png"),
    });
    await editor.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page.getByRole("button", { name: "创建项目", exact: true }).click();
    const project = page.getByRole("dialog", {
        name: "创建游戏项目",
        exact: true,
      }),
      name = project.getByLabel("项目名称", { exact: true });
    const fieldBox = (await name.boundingBox())!;
    await page.mouse.move(
      fieldBox.x + fieldBox.width / 2,
      fieldBox.y + fieldBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(5, 5, { steps: 12 });
    await page.mouse.up();
    await expect(project).toHaveAttribute("data-presence", "enter");
    await page.mouse.click(5, 5);
    await expect(project).not.toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    await fs.rm(temp, { recursive: true, force: true });
  }
});
