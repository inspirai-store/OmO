import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";
test("14-row family workflow splits, selects, enlarges, processes, organizes and exports real paths", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "workshop-family-e2e-")),
    target = path.join(temp, "godot"),
    requests: string[] = [];
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "project.godot"), "config_version=5");
  const png = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><path d="M50 20L110 90L70 140L40 110Z" fill="#528575" stroke="#af814a" stroke-width="8"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const server = http.createServer(async (req, res) => {
    for await (const _ of req) {
    }
    requests.push(req.url!);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
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
    }),
    page = await app.firstWindow(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.waitForSelector(".asset-browser");
    await page.evaluate(
      async (endpoint) => {
        await window.workshop.call("generation.providers.save", {
          config: {
            id: "family-qa",
            name: "Family QA",
            kind: "openai",
            enabled: true,
            endpoint,
            models: ["qa"],
            bindings: [],
            capabilities: {
              references: true,
              maxReferences: 5,
              mask: true,
              seed: false,
              negativePrompt: false,
              transparent: true,
              quality: true,
              cancelRemote: false,
            },
            unitPrice: 0.01,
            currency: "USD",
          },
          key: "fake-test-key",
        });
      },
      `http://127.0.0.1:${(server.address() as any).port}/v1`,
    );
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, target);
    await page.evaluate(async (folder) => {
      await window.workshop.choose({ kind: "folder" });
      await window.workshop.call("projects.save", {
        name: "字阵山河验收",
        godotPath: folder,
      });
    }, target);
    await page.getByRole("button", { name: "同类素材", exact: true }).click();
    await page
      .getByLabel("生成连接", { exact: true })
      .selectOption("family-qa");
    await page
      .getByLabel("目标项目", { exact: true })
      .selectOption({ label: "字阵山河验收" });
    await expect(page.locator(".family-table tbody tr")).toHaveCount(14);
    await page
      .getByRole("button", { name: "建立制作批次", exact: true })
      .click();
    await page
      .getByRole("button", { name: "检查生成未选条目", exact: true })
      .click();
    const plan = page.getByRole("dialog", { name: "检查同类生成方案" });
    await expect(plan).toContainText("28 次调用 · 2 批");
    await expect(plan).toContainText("USD 0.280");
    await plan.getByRole("button", { name: "开始生成", exact: true }).click();
    await expect(page.locator(".family-candidates article")).toHaveCount(28, {
      timeout: 45000,
    });
    await expect(
      page.getByRole("button", { name: "加工选定结果", exact: true }),
    ).toBeDisabled();
    const cards = page.locator("[data-family-key]");
    for (let n = 0; n < 14; n++)
      await cards
        .nth(n)
        .getByRole("button", { name: "选用此图", exact: true })
        .first()
        .click();
    await cards
      .first()
      .getByRole("button", { name: "放大 破阵刀", exact: true })
      .first()
      .click();
    const expanded = page.getByRole("dialog", { name: "查看候选" });
    await expect(expanded.locator("img")).toBeVisible();
    await expanded.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(expanded).not.toBeVisible();
    await page
      .getByRole("button", { name: "加工选定结果", exact: true })
      .click();
    await expect(cards.last()).toContainText("64×64 待保存", {
      timeout: 45000,
    });
    await expect(
      page.getByRole("button", { name: "整理并保存", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "整理并保存", exact: true }).click();
    const review = page.getByRole("dialog", { name: "整理并保存选定素材" });
    await expect(review.locator(".family-review-row")).toHaveCount(14);
    await review.getByRole("button", { name: "保存入库", exact: true }).click();
    await expect(cards.last()).toContainText("64×64 已入库", {
      timeout: 45000,
    });
    await page
      .getByRole("button", { name: "交付游戏项目", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "交付同类素材" })
      .getByRole("button", { name: "确认交付", exact: true })
      .click();
    const filename = path.join(
      target,
      "assets",
      "workshop",
      "workshop-family-index.json",
    );
    await expect
      .poll(() =>
        fs
          .stat(filename)
          .then(() => true)
          .catch(() => false),
      )
      .toBe(true);
    const index = JSON.parse(await fs.readFile(filename, "utf8"));
    expect(Object.keys(index.items)).toHaveLength(14);
    expect(Object.keys(index.items["gear.blade"].sizes)).toEqual([
      "64",
      "128",
      "512",
    ]);
    expect(requests).toHaveLength(28);
    expect(errors).toEqual([]);
    await fs.mkdir("docs/qa", { recursive: true });
    await page.screenshot({ path: "docs/qa/families-desktop.png" });
    await page.getByRole("button", { name: "AI 生成", exact: true }).click();
    await page.locator(".gen-history-row > button").first().click();
    await page
      .locator(".gen-candidate")
      .first()
      .getByRole("button", { name: "制作同类素材", exact: true })
      .click();
    await expect(page.locator(".family-references img")).toHaveCount(1);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
