import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";

test("generate, crop, masked AI edit, compare, accept a derived copy, project and export", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-processing-e2e-"));
  const original = await sharp({
    create: { width: 256, height: 256, channels: 4, background: "#dc793480" },
  })
    .png()
    .toBuffer();
  const edited = await sharp({
    create: { width: 128, height: 128, channels: 4, background: "#2277ff" },
  })
    .png()
    .toBuffer();
  let edits = 0;
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) {
    }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/v1/images/edits") edits++;
    res.end(
      JSON.stringify({
        data: [
          {
            b64_json: (req.url === "/v1/images/edits"
              ? edited
              : original
            ).toString("base64"),
          },
        ],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const endpoint = `http://127.0.0.1:${(server.address() as any).port}/v1`;
  const app = await electron.launch({
    ...(process.env.WORKSHOP_EXE
      ? {
          executablePath: process.env.WORKSHOP_EXE,
          args: [`--user-data-dir=${path.join(temp, "app-state")}`],
        }
      : {
          args: [
            "out/main/index.cjs",
            `--user-data-dir=${path.join(temp, "app-state")}`,
          ],
        }),
    env: { ...process.env, WORKSHOP_LIBRARY: path.join(temp, "库") },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.waitForSelector(".asset-browser");
    const generated = await page.evaluate(async (endpoint) => {
      await window.workshop.call("generation.providers.delete", {
        id: "codex-default",
      });
      const providers = await window.workshop.call<any[]>(
        "generation.providers.save",
        {
          config: {
            id: "processing-qa",
            name: "加工验收模型",
            kind: "openai",
            endpoint,
            models: ["qa-image"],
            enabled: true,
            bindings: [],
          },
          key: "fake-processing-qa-key",
        },
      );
      const plan = await window.workshop.call<any>("generation.preview", {
        items: [
          {
            providerId: providers.find((p) => p.id === "processing-qa")!.id,
            model: "qa-image",
            prompt: "制作游戏图标",
            referenceIds: [],
            width: 256,
            height: 256,
            count: 1,
            tags: [],
            category: "ui",
          },
        ],
      });
      return window.workshop.call<any>("generation.start", { planId: plan.id });
    }, endpoint);
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.workshop.call<any[]>("jobs.list")).find(
              (j) => j.id === id,
            )?.status,
          generated.jobId,
        ),
      )
      .toBe("completed");
    const candidate = await page.evaluate(
      async (id) =>
        (await window.workshop.call<any>("generation.detail", { id }))
          .candidates[0],
      generated.runId,
    );
    await page.getByRole("button", { name: "AI 生成", exact: true }).click();
    await page.locator(".gen-history-row > button").first().click();
    await expect(page.locator(".gen-candidate")).toHaveCount(1);
    await page.getByRole("button", { name: "加工", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "图像加工", exact: true });
    await expect(editor).toBeVisible();
    await expect(editor.locator(".processing-inputs button")).toHaveCount(1);
    await editor.getByLabel("加工工具", { exact: true }).selectOption("crop");
    await editor.getByLabel("左坐标", { exact: true }).fill("32");
    await editor.getByLabel("上坐标", { exact: true }).fill("32");
    await editor.getByLabel("宽度", { exact: true }).fill("128");
    await editor.getByLabel("高度", { exact: true }).fill("128");
    await editor.getByRole("button", { name: "添加步骤", exact: true }).click();
    await editor.getByLabel("加工工具", { exact: true }).selectOption("ai");
    await editor
      .getByLabel("加工连接", { exact: true })
      .selectOption("processing-qa");
    await editor.getByLabel("宽度", { exact: true }).fill("128");
    await editor.getByLabel("高度", { exact: true }).fill("128");
    await editor
      .getByLabel("加工要求", { exact: true })
      .fill("将选区改成蓝色，保留外部所有内容");
    await editor
      .getByRole("button", { name: "绘制局部蒙版", exact: true })
      .click();
    const mask = page.getByRole("dialog", {
      name: "局部修改蒙版",
      exact: true,
    });
    const canvas = mask.locator("canvas");
    await expect(canvas).toBeVisible();
    await expect
      .poll(() => canvas.evaluate((c) => (c as HTMLCanvasElement).width))
      .toBe(128);
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 5,
      box.y + box.height / 2 + 5,
    );
    await page.mouse.up();
    await mask.getByRole("button", { name: "保存蒙版", exact: true }).click();
    await expect(mask).not.toBeVisible();
    await editor.getByRole("button", { name: "添加步骤", exact: true }).click();
    await editor
      .getByRole("button", { name: "检查整套方案", exact: true })
      .click();
    await expect(editor.locator(".processing-plan")).toContainText(
      "图像调用 1 次",
    );
    expect(edits).toBe(0);
    await editor
      .getByRole("button", { name: "启动整套方案", exact: true })
      .click();
    await expect(editor.locator(".processing-artifacts article")).toHaveCount(
      2,
    );
    const results = await page.evaluate(async () => {
      const runs = await window.workshop.call<any[]>("processing.list");
      return window.workshop.call<any>("processing.detail", { id: runs[0].id });
    });
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.workshop.call<any>("processing.detail", { id })).run
              .status,
          results.run.id,
        ),
      )
      .toBe("completed");
    expect(edits).toBe(1);
    const project = await page.evaluate(() =>
      window.workshop.call<any>("projects.save", { name: "加工验收项目" }),
    );
    await editor
      .getByLabel("加工结果加入项目", { exact: true })
      .selectOption(project.id);
    await editor
      .locator(".processing-artifacts article")
      .last()
      .locator("input[type=checkbox]")
      .check();
    await editor.getByLabel("对比方式", { exact: true }).selectOption("slider");
    await editor.getByLabel("对比位置", { exact: true }).fill("65");
    await fs.mkdir(path.resolve("docs/screenshots"), { recursive: true });
    await page.screenshot({
      path: path.resolve("docs/screenshots/image-processing-workbench.png"),
      fullPage: true,
    });
    await editor
      .getByRole("button", { name: "保存与整理", exact: true })
      .click();
    const savePanel = page.getByRole("dialog", {
      name: "保存与整理",
      exact: true,
    });
    await savePanel
      .getByRole("button", { name: "确认保存并加入", exact: true })
      .click();
    await expect(savePanel.locator(".processing-save-complete")).toContainText(
      "1 个素材已保存",
    );
    await savePanel
      .getByRole("button", { name: "返回加工", exact: true })
      .click();
    await expect(
      editor.locator(".processing-artifacts article").last(),
    ).toContainText("已入库");
    const assets = await page.evaluate(() =>
      window.workshop.call<any>("assets.query", {}),
    );
    expect(assets.total).toBe(1);
    expect(assets.items[0].metadata.processing.steps).toHaveLength(2);
    expect(assets.items[0].metadata.generation.candidateId).toBe(candidate.id);
    const output = path.join(temp, "export");
    await fs.mkdir(output);
    await app.evaluate(({ dialog }, output) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [output],
      });
    }, output);
    await page.evaluate(() => window.workshop.choose({ kind: "folder" }));
    const exportId = await page.evaluate(
      async ({ id, output }) => {
        const plan = await window.workshop.call<any>("exports.inspect", {
          assetIds: [id],
          target: output,
          mode: "generic",
        });
        return window.workshop.call<string>("exports.start", {
          planId: plan.id,
        });
      },
      { id: assets.items[0].id, output },
    );
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.workshop.call<any[]>("jobs.list")).find(
              (j) => j.id === id,
            )?.status,
          exportId,
        ),
      )
      .toBe("completed");
    await expect(
      page.evaluate(async () => {
        try {
          await window.workshop.call("processing.files.resolve", {
            kind: "input",
            id: "x",
          });
          return false;
        } catch {
          return true;
        }
      }),
    ).resolves.toBe(true);
    await expect(
      page.evaluate(async () => {
        try {
          await window.workshop.call("processing.inputs.add", {
            path: "C:/Windows/win.ini",
          });
          return false;
        } catch {
          return true;
        }
      }),
    ).resolves.toBe(true);
    expect(errors).toEqual([]);
    await editor.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(editor).not.toBeVisible();
    await page.getByRole("button", { name: "图像加工", exact: true }).click();
    await page.locator(".processing-history").first().click();
    await expect(editor.locator(".processing-inputs > button")).toHaveCount(1);
    await expect(editor.locator(".processing-steps ol li")).toHaveCount(2);
    await editor
      .locator(".processing-artifacts article")
      .last()
      .locator("input[type=checkbox]")
      .check();
    await editor.getByRole("button", { name: "恢复原图", exact: true }).click();
    await expect(editor.locator(".processing-steps ol li")).toHaveCount(0);
    await expect(
      editor.locator(".processing-artifacts input:checked"),
    ).toHaveCount(0);
    await page.locator(".processing-history").first().click();
    await editor
      .locator(".processing-artifacts article")
      .last()
      .getByRole("button", { name: "从此结果继续", exact: true })
      .click();
    await expect(editor.locator(".processing-inputs > button")).toHaveCount(1);
    await expect(editor.locator(".processing-steps ol li")).toHaveCount(0);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
