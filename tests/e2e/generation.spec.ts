import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";

test("configure, generate, compare, mask edit, accept into project and export", async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-generation-e2e-")),
    root = path.join(temp, "库"),
    requests: { url: string; body: Buffer }[] = [];
  const png = await sharp(
    await fs
      .readFile(path.resolve(".data/generation-smoke/smoke.png"))
      .catch(() => Buffer.alloc(0)),
  )
    .resize(256, 256)
    .png()
    .toBuffer()
    .catch(() =>
      sharp({
        create: { width: 256, height: 256, channels: 4, background: "#a6773c" },
      })
        .png()
        .toBuffer(),
    );
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    requests.push({ url: req.url!, body });
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/v1/models"
          ? { data: [{ id: "qa-image" }] }
          : { data: [{ b64_json: png.toString("base64") }] },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
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
      env: { ...process.env, WORKSHOP_LIBRARY: root },
    }),
    page = await app.firstWindow(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.waitForSelector(".asset-browser");
    await page.getByRole("button", { name: "AI 生成", exact: true }).click();
    await page
      .getByRole("button", { name: "模型与工作流连接", exact: true })
      .click();
    const settings = page.getByRole("dialog", { name: "模型与工作流连接" });
    await settings
      .getByRole("button", { name: "添加连接", exact: true })
      .click();
    await settings.getByLabel("连接名称", { exact: true }).fill("QA 云端图像");
    await settings.getByLabel("服务地址", { exact: true }).fill(endpoint);
    await settings
      .getByLabel("API 密钥", { exact: true })
      .fill("fake-qa-secret");
    await settings
      .getByLabel("图像模型 ID（每行一个）", { exact: true })
      .fill("qa-image");
    await settings
      .getByRole("button", { name: "检查连接", exact: true })
      .click();
    await expect(settings.getByRole("status")).toContainText(
      "认证与模型列表可用",
    );
    expect(requests.map((r) => r.url)).toEqual(["/v1/models"]);
    const userData = await app.evaluate(({ app }) => app.getPath("userData"));
    expect(
      await fs.readFile(
        path.join(userData, "generation-providers.json"),
        "utf8",
      ),
    ).not.toContain("fake-qa-secret");
    await settings.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(settings).not.toBeVisible();
    const providers = await page.evaluate(() =>
      window.workshop.call<any[]>("generation.providers.list"),
    );
    await page
      .getByLabel("生成连接", { exact: true })
      .selectOption(providers.find((p) => p.name === "QA 云端图像").id);
    await page
      .getByLabel("提示词", { exact: true })
      .fill("奇幻游戏宝箱图标，清晰轮廓，柔和光照");
    await page.getByLabel("生成数量", { exact: true }).fill("2");
    await page
      .getByRole("button", { name: "预览生成方案", exact: true })
      .click();
    const plan = page.getByRole("dialog", { name: "检查生成方案" });
    await expect(plan).toContainText("2 次生成调用");
    await plan.getByRole("button", { name: "开始生成", exact: true }).click();
    await expect(page.locator(".gen-candidate")).toHaveCount(2);
    await page.getByRole("button", { name: "全选", exact: true }).click();
    await page.getByRole("button", { name: "并排比较", exact: true }).click();
    const comparison = page.getByRole("dialog", { name: "候选图对照" });
    await expect(comparison.locator("figure")).toHaveCount(2);
    await comparison.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(comparison).not.toBeVisible();
    const initial = await page.evaluate(() =>
      window.workshop.call<any[]>("generation.list"),
    );
    const original = initial[0].items[0].candidateIds[0];
    await page
      .locator(".gen-candidate")
      .first()
      .getByRole("button", { name: "继续修改", exact: true })
      .click();
    await expect(page.getByLabel("提示词", { exact: true })).toHaveValue(
      /修改要求/,
    );
    await expect(page.getByLabel("提示词", { exact: true })).toBeEnabled();
    await page
      .getByLabel("提示词", { exact: true })
      .fill("保持宝箱轮廓，仅将锁扣改为银色");
    await page
      .getByRole("button", { name: "绘制局部修改区域", exact: true })
      .click();
    const mask = page.getByRole("dialog", { name: "局部修改蒙版" }),
      canvas = mask.locator("canvas");
    await expect(
      mask.getByRole("button", { name: "保存蒙版", exact: true }),
    ).toBeEnabled();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.55);
    await page.mouse.up();
    await mask.getByRole("button", { name: "撤销", exact: true }).click();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await mask.getByRole("button", { name: "保存蒙版", exact: true }).click();
    await expect(mask).not.toBeVisible();
    await page
      .getByRole("button", { name: "预览生成方案", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "检查生成方案" })
      .getByRole("button", { name: "开始生成", exact: true })
      .click();
    await expect(page.locator(".gen-candidate")).toHaveCount(1);
    await expect(page.locator(".gen-candidate")).toContainText("修改版本");
    const runs = await page.evaluate(() =>
        window.workshop.call<any[]>("generation.list"),
      ),
      edited = runs[0];
    expect(edited.items[0].request.parentCandidateId).toBe(original);
    expect(edited.items[0].request.maskId).toBeTruthy();
    expect(edited.items[0].request.prompt).toBe(
      "保持宝箱轮廓，仅将锁扣改为银色",
    );
    const upload = requests.find((r) => r.url === "/v1/images/edits")!;
    expect(upload.body.toString()).toContain('name="mask"');
    const start = upload.body.indexOf(Buffer.from('filename="mask.png"'));
    const payloadStart =
      upload.body.indexOf(Buffer.from("\r\n\r\n"), start) + 4;
    const boundary = upload.body.indexOf(Buffer.from("\r\n--"), payloadStart);
    const maskBytes = upload.body.subarray(payloadStart, boundary);
    const { data, info } = await sharp(maskBytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(256);
    expect(info.height).toBe(256);
    expect(data[(128 * 256 + 128) * 4 + 3]).toBe(0);
    expect(data[3]).toBe(255);
    const project = await page.evaluate(() =>
      window.workshop.call<any>("projects.save", { name: "AI 验收项目" }),
    );
    await page.getByRole("button", { name: "全选", exact: true }).click();
    await page.getByLabel("加入项目", { exact: true }).selectOption(project.id);
    await page
      .getByRole("button", { name: "将选中候选入库", exact: true })
      .click();
    await expect(page.locator(".gen-imported")).toContainText("已入库");
    const assets = await page.evaluate(() =>
      window.workshop.call<any>("assets.query", {}),
    );
    expect(assets.total).toBe(1);
    expect(assets.items[0].metadata.generation.parentCandidateId).toBe(
      original,
    );
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
      async ({ assetId, output }) => {
        const plan = await window.workshop.call<any>("exports.inspect", {
          assetIds: [assetId],
          target: output,
          mode: "generic",
        });
        return window.workshop.call<string>("exports.start", {
          planId: plan.id,
        });
      },
      { assetId: assets.items[0].id, output },
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
    await fs.mkdir(path.resolve(".data/qa"), { recursive: true });
    await page.screenshot({
      path: path.resolve(".data/qa/generation-page.png"),
      fullPage: true,
    });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
