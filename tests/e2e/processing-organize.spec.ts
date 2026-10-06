import { test, expect, _electron as electron } from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("processing save panel keeps manual edits during AI analysis, classifies, associates and navigates", async () => {
  test.skip(
    process.platform !== "win32",
    "The native Windows mock launcher uses the bundled .NET compiler",
  );
  const temp = await fs.mkdtemp(
    path.join(os.tmpdir(), "workshop-organize-e2e-"),
  );
  const filename = path.join(temp, "health_potion.png"),
    fake = path.join(temp, "fake-codex.cjs"),
    executable = path.join(temp, "mock-codex.exe");
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: "#ef335599" },
  })
    .png()
    .toFile(filename);
  await fs.writeFile(
    fake,
    `
{
  const readline = require('node:readline'), path = require('node:path');
  const send = message => process.stdout.write(JSON.stringify(message)+'\\n');
  readline.createInterface({ input: process.stdin }).on('line', line => {
    const m = JSON.parse(line.trim());
    if (m.method === 'initialize') send({ id:m.id, result:{} });
    if (m.method === 'thread/start' || m.method === 'thread/resume') send({ id:m.id, result:{ thread:{ id:'organize-mock-session' } } });
    if (m.method === 'turn/start') {
      send({ id:m.id, result:{turn:{id:'mock-turn',status:'inProgress'}} });
      setTimeout(() => {
        const images=m.params.input.filter(i=>i.type==='localImage');
        const result={ items:images.map((i,n)=>({ artifactId:path.basename(i.path,'.png'),title:'红色生命药水图标 '+(n+1),englishName:'health_potion_red',category:'ui',entityCategory:'pickup',gameplayTags:['pickup'],tags:['药水','红色'],confidence:'high',reason:'识别到红色药水图标' })) };
        send({method:'item/completed',params:{item:{type:'agentMessage',text:JSON.stringify(result)}}});
        send({method:'turn/completed',params:{turn:{status:'completed'}}});
        setTimeout(() => process.exit(0), 50);
      }, 4500);
    }
  });
}
`,
  );
  const launcher = path.join(temp, "Launcher.cs");
  const literal = (value: string) => '@"' + value.replace(/"/g, '""') + '"';
  await fs.writeFile(
    launcher,
    `using System; using System.Diagnostics; using System.Threading.Tasks; using System.Text;
class Launcher { static int Main() {
  Console.InputEncoding=Encoding.UTF8; Console.OutputEncoding=new UTF8Encoding(false);
  var info = new ProcessStartInfo(${literal(process.execPath)}, ${literal('"' + fake + '"')});
  info.UseShellExecute=false; info.CreateNoWindow=true;
  info.RedirectStandardInput=true; info.RedirectStandardOutput=true; info.RedirectStandardError=true;
  var child=Process.Start(info);
  var input=new System.IO.StreamWriter(child.StandardInput.BaseStream,new UTF8Encoding(false)); input.AutoFlush=true;
  Task.Run(()=>{string line; while((line=Console.ReadLine())!=null){input.WriteLine(line);}});
  var output=Task.Run(()=>{string line; while((line=child.StandardOutput.ReadLine())!=null){Console.WriteLine(line);Console.Out.Flush();}});
  var error=Task.Run(()=>{string line; while((line=child.StandardError.ReadLine())!=null){Console.Error.WriteLine(line);Console.Error.Flush();}});
  child.WaitForExit(); Task.WaitAll(output,error); return child.ExitCode;
} }`,
  );
  await promisify(execFile)(
    path.join(
      process.env.WINDIR!,
      "Microsoft.NET",
      "Framework64",
      "v4.0.30319",
      "csc.exe",
    ),
    ["/nologo", `/out:${executable}`, launcher],
  );
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
    env: {
      ...process.env,
      WORKSHOP_LIBRARY: path.join(temp, "library"),
    },
  });
  const page = await app.firstWindow(),
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.waitForSelector(".asset-browser");
    await app.evaluate(({ dialog }, exe) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [exe],
      });
    }, executable);
    await page.evaluate(async (executable) => {
      await window.workshop.call("generation.providers.delete", {
        id: "codex-default",
      });
      await window.workshop.choose({ kind: "executable" });
      await window.workshop.call("generation.providers.save", {
        config: {
          id: "organize-qa",
          name: "识图验收 Codex",
          kind: "codex",
          executable,
          enabled: true,
          models: [],
          bindings: [],
        },
      });
    }, executable);
    const places = await page.evaluate(async () => ({
      project: await window.workshop.call<any>("projects.save", {
        name: "药水项目",
      }),
      collectionId: await window.workshop.call<string>("collections.save", {
        name: "药水收藏",
      }),
      smartId: await window.workshop.call<string>("collections.save", {
        name: "UI 图标自动收录",
        query: { category: "ui", minWidth: 64 },
      }),
    }));
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
    await editor.getByLabel("宽度", { exact: true }).fill("64");
    await editor.getByLabel("高度", { exact: true }).fill("64");
    await editor.getByRole("button", { name: "添加步骤", exact: true }).click();
    await editor
      .getByLabel("加工工具", { exact: true })
      .selectOption("sharpen");
    await editor.getByRole("button", { name: "添加步骤", exact: true }).click();
    await editor
      .getByRole("button", { name: "检查整套方案", exact: true })
      .click();
    await editor
      .getByRole("button", { name: "启动整套方案", exact: true })
      .click();
    await expect(editor.locator(".processing-artifacts article")).toHaveCount(
      2,
    );
    await expect(
      editor.locator(".processing-artifacts input:checked"),
    ).toHaveCount(1);
    await editor
      .getByLabel("加工结果加入项目", { exact: true })
      .selectOption(places.project.id);
    await editor
      .getByRole("button", { name: "保存与整理", exact: true })
      .click();
    const panel = page.getByRole("dialog", { name: "保存与整理", exact: true });
    await expect(panel.getByLabel("标题 1", { exact: true })).toBeVisible();
    await panel.getByLabel("标题 1", { exact: true }).fill("我的红色药水图标");
    await panel
      .getByLabel("英文文件名 1", { exact: true })
      .fill("my_health_potion.png");
    await panel.getByLabel("素材分类 1", { exact: true }).selectOption("ui");
    await panel.getByRole("button", { name: "返回加工", exact: true }).click();
    await expect(panel).not.toBeVisible();
    await editor
      .getByRole("button", { name: "保存与整理", exact: true })
      .click();
    await expect(panel.getByLabel("标题 1", { exact: true })).toHaveValue(
      "我的红色药水图标",
    );
    await expect(panel.getByLabel("素材分类 1", { exact: true })).toHaveValue(
      "ui",
    );
    await expect(panel.locator(".processing-save-summary")).toContainText(
      "已调用 1 次",
    );
    await expect(panel.locator(".processing-save-thumb"))
      .toContainText("AI 建议", { timeout: 15000 })
      .catch(async (error) => {
        console.log(
          await page.evaluate(async () => {
            const job = (await window.workshop.call<any[]>("jobs.list")).find(
              (j) => j.type === "processing-organize",
            );
            const p = await window.workshop.call<any>(
              "processing.organize.detail",
              { id: job.request.proposalId },
            );
            return {
              status: job.status,
              stage: job.stage,
              warnings: p.warnings,
            };
          }),
        );
        throw error;
      });
    await expect(panel.getByLabel("标题 1", { exact: true })).toHaveValue(
      "我的红色药水图标",
    );
    await expect(panel.locator(".processing-save-summary")).toContainText(
      "已调用 1 次",
    );
    await expect(panel.getByLabel("英文文件名 1", { exact: true })).toHaveValue(
      "my_health_potion.png",
    );
    await panel
      .getByLabel("标签 1", { exact: true })
      .fill("药水, 红色, 测试自定义");
    await panel.getByLabel("标签 1", { exact: true }).press("Tab");
    await expect(
      panel.getByLabel("加入项目 1 药水项目", { exact: true }),
    ).toBeChecked();
    await expect(panel.locator(".processing-save-smart")).toContainText(
      "UI 图标自动收录",
    );
    await panel.getByLabel("加入收藏集 1 药水收藏", { exact: true }).check();
    await fs.mkdir(path.resolve("docs/screenshots"), { recursive: true });
    await page.screenshot({
      path: path.resolve("docs/screenshots/processing-save-organize.png"),
    });
    await panel
      .getByRole("button", { name: "确认保存并加入", exact: true })
      .click();
    await expect(panel.locator(".processing-save-complete")).toContainText(
      "1 个素材已保存",
    );
    const asset = await page.evaluate(
      async () =>
        (await window.workshop.call<any>("assets.query", {})).items[0],
    );
    expect(asset.title).toBe("我的红色药水图标");
    expect(asset.path).toBe("my_health_potion_64x64_v01.png");
    expect(asset.tags).toContain("测试自定义");
    expect(asset.metadata.processing.steps).toHaveLength(2);
    const memberships = await page.evaluate(
      async (places) => ({
        project: (
          await window.workshop.call<any>("assets.query", {
            projectId: places.project.id,
          })
        ).total,
        collection: (
          await window.workshop.call<any>("assets.query", {
            collectionId: places.collectionId,
          })
        ).total,
        smart: (
          await window.workshop.call<any>("assets.query", {
            collectionId: places.smartId,
          })
        ).total,
      }),
      places,
    );
    expect(memberships).toEqual({ project: 1, collection: 1, smart: 1 });
    await panel
      .getByRole("button", { name: "补充所选归属", exact: true })
      .click();
    expect(
      await page.evaluate(
        async () => (await window.workshop.call<any>("assets.query", {})).total,
      ),
    ).toBe(1);
    await panel
      .getByRole("button", { name: "打开收藏集：药水收藏", exact: true })
      .click();
    await expect(panel).not.toBeVisible();
    await expect(editor).not.toBeVisible();
    await expect(page.locator(".asset-browser")).toContainText(
      "我的红色药水图标",
    );
    expect(errors).toEqual([]);
  } catch (error: any) {
    console.log({ failure: error.message.slice(0, 1500) });
    throw error;
  } finally {
    await app.close();
    await fs.rm(temp, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 200,
    });
  }
});
