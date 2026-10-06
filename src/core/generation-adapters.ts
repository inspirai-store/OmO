import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { atomicJSON, inside, WorkshopError } from "./files";
import { assertNoSecrets, validateEndpoint } from "./generation-schemas";
import type {
  GenerationProviderConfig,
  GenerationRequest,
} from "../shared/generation";

const MAX_BYTES = 64 * 1024 * 1024;
export function redactGenerationError(error: unknown, key = "") {
  let text = error instanceof Error ? error.message : String(error);
  if (key) text = text.split(key).join("[已隐藏密钥]");
  return text
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [已隐藏]")
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}/g, "[已隐藏密钥]")
    .slice(0, 1200);
}
async function limitedBytes(response: Response) {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES)
    throw new Error("返回文件超过 64 MiB 限制");
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_BYTES) throw new Error("返回文件超过 64 MiB 限制");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
async function http(
  url: string,
  key: string,
  body?: unknown,
  signal?: AbortSignal,
  method = "POST",
) {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        ...(body instanceof FormData || body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body:
        body instanceof FormData
          ? body
          : body === undefined
            ? undefined
            : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.any([
        ...(signal ? [signal] : []),
        AbortSignal.timeout(180000),
      ]),
    });
    const data = JSON.parse((await limitedBytes(response)).toString("utf8"));
    if (!response.ok)
      throw new WorkshopError(
        `HTTP_${response.status}`,
        `服务返回 ${response.status}：${redactGenerationError(data.error?.message ?? data.msg ?? "请求失败", key)}`,
      );
    return data;
  } catch (error) {
    if (signal?.aborted) throw new WorkshopError("CANCELLED", "任务已停止");
    if (error instanceof WorkshopError) throw error;
    throw new WorkshopError(
      "NETWORK_UNCERTAIN",
      `连接中断或返回内容不可读取：${redactGenerationError(error, key)}`,
    );
  }
}
export async function downloadGenerationImage(
  url: string,
  signal: AbortSignal,
) {
  validateEndpoint(new URL(url).origin);
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
    redirect: "error",
  });
  if (!response.ok) throw new Error(`结果下载失败 (${response.status})`);
  return limitedBytes(response);
}
export interface AdapterContext {
  provider: GenerationProviderConfig;
  request: GenerationRequest;
  key: string;
  inputFiles: string[];
  maskFile?: string;
  outputDirectory: string;
  signal: AbortSignal;
  remoteTaskId?: string;
  outputUrls?: string[];
  submitted(taskId: string): Promise<void>;
  outputs(urls: string[]): Promise<void>;
  progress(stage: string): void;
}
export interface GenerationAdapter {
  check(
    provider: GenerationProviderConfig,
    key: string,
  ): Promise<{ message: string; models?: string[] }>;
  generate(context: AdapterContext): Promise<Buffer[]>;
  cancel?(
    provider: GenerationProviderConfig,
    key: string,
    taskId: string,
  ): Promise<void>;
}
export async function runCodex(
  executable: string | undefined,
  directory: string,
  prompt: string,
  images: string[],
  signal: AbortSignal,
  model?: string,
  assistant = false,
) {
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--disable",
    "apps",
    "--disable",
    "plugins",
    "--disable",
    "browser_use",
    "--disable",
    "computer_use",
    "--disable",
    "multi_agent",
    "--disable",
    "hooks",
    "--sandbox",
    assistant ? "read-only" : "workspace-write",
    "-C",
    directory,
  ];
  if (assistant)
    args.push(
      "--disable",
      "image_generation",
      "--disable",
      "shell_tool",
      "--output-schema",
      path.join(directory, "schema.json"),
    );
  if (model) args.push("-m", model);
  for (const file of images) args.push("-i", file);
  args.push("-");
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable || "codex", args, {
      windowsHide: true,
      shell: false,
      cwd: directory,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let buffer = "",
      lastMessage = "",
      errors = "",
      failed = "";
    const abort = () => child.kill();
    const timer = setTimeout(() => {
      failed = "Codex 超过 10 分钟，请检查已有输出后再重试";
      child.kill();
    }, 600000);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > MAX_BYTES) {
        failed = "Codex 返回内容过大";
        child.kill();
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const event = JSON.parse(line);
          if (event.item?.type === "agent_message" && event.item.text)
            lastMessage = event.item.text;
          if (event.type === "turn.failed" || event.type === "error")
            failed = redactGenerationError(
              event.error?.message ?? event.message ?? "Codex 执行失败",
            );
        } catch {
          /* Ignore non-event startup lines. */
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      errors = (errors + chunk.toString()).slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(new Error(`无法启动 Codex：${redactGenerationError(error)}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (signal.aborted)
        reject(
          new WorkshopError(
            "CANCELLED",
            "Codex 已停止；已发出的云端生成可能仍消耗额度",
          ),
        );
      else if (code !== 0 || failed)
        reject(
          new Error(
            failed ||
              `Codex 执行失败 (${code})：${redactGenerationError(errors)}`,
          ),
        );
      else resolve(lastMessage);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}
async function inspectCodex(executable?: string) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable || "codex", ["login", "status"], {
      shell: false,
      windowsHide: true,
    });
    let output = "";
    const timer = setTimeout(() => child.kill(), 15000);
    child.stdout.on("data", (b) => {
      output += b;
    });
    child.stderr.on("data", (b) => {
      output += b;
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("未找到 Codex，请在连接设置中选择 codex.exe"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      code === 0
        ? resolve(
            /ChatGPT/i.test(output)
              ? "已使用 ChatGPT 登录；生成使用 Codex 额度"
              : "Codex 已登录；额度按当前登录方式计算",
          )
        : reject(new Error("Codex 未登录，请先使用 Codex 登录"));
    });
  });
}
export class CodexImageAdapter implements GenerationAdapter {
  async check(provider: GenerationProviderConfig) {
    return { message: await inspectCodex(provider.executable) };
  }
  async generate(ctx: AdapterContext) {
    await fs.mkdir(ctx.outputDirectory, { recursive: true });
    const prompt = `$imagegen\n使用内置 image_gen 工具生成一张图片，不使用 API 密钥、不切换其他服务。\n需求：${ctx.request.prompt}\n目标尺寸：${ctx.request.width} × ${ctx.request.height}。${ctx.request.transparent ? "背景真正透明，保留 alpha。" : ""}\n${ctx.inputFiles.length ? "所附图片按顺序作为参考；若是修改任务，保留用户未要求修改的部分。" : ""}\n生成后，将真实生成的图片从默认生成目录复制到当前工作区，命名 result.png；不得以绘图代码、SVG 或占位图替代。只复制本次生成结果，不改其他文件。最后返回包含已保存相对路径的 JSON。`;
    ctx.progress("Codex 正在生成图片");
    await runCodex(
      ctx.provider.executable,
      ctx.outputDirectory,
      prompt,
      ctx.inputFiles,
      ctx.signal,
      ctx.request.model,
    );
    const filename = inside(ctx.outputDirectory, "result.png");
    const stat = await fs.lstat(filename).catch(() => null);
    if (
      !stat?.isFile() ||
      stat.isSymbolicLink() ||
      !stat.size ||
      stat.size > MAX_BYTES
    )
      throw new Error("Codex 没有保存可验证的图片文件，请检查登录和生图能力");
    return [await fs.readFile(filename)];
  }
}
export class OpenAIImageAdapter implements GenerationAdapter {
  async check(provider: GenerationProviderConfig, key: string) {
    if (!key) throw new Error("请在连接设置中保存 API 密钥");
    const result = await http(
      `${provider.endpoint}/models`,
      key,
      undefined,
      undefined,
      "GET",
    );
    return {
      message: "认证与模型列表可用；图像参数兼容性以实际生成结果为准",
      models: Array.isArray(result.data)
        ? result.data.map((m: any) => String(m.id))
        : [],
    };
  }
  async generate(ctx: AdapterContext) {
    if (!ctx.key) throw new Error("请在连接设置中保存 API 密钥");
    const fields: Record<string, string | number> = {
      model: ctx.request.model,
      prompt: ctx.request.prompt,
      n: 1,
      size: `${ctx.request.width}x${ctx.request.height}`,
      output_format: "png",
    };
    if (ctx.provider.capabilities.quality)
      fields.quality = ctx.request.quality ?? "auto";
    if (ctx.request.transparent) fields.background = "transparent";
    if (ctx.request.seed !== undefined) fields.seed = ctx.request.seed;
    if (ctx.request.negativePrompt)
      fields.negative_prompt = ctx.request.negativePrompt;
    let body: unknown = fields;
    if (ctx.inputFiles.length) {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.set(k, String(v));
      for (const filename of ctx.inputFiles)
        form.append(
          ctx.inputFiles.length === 1 ? "image" : "image[]",
          new Blob([new Uint8Array(await fs.readFile(filename))], {
            type: "image/png",
          }),
          path.basename(filename),
        );
      if (ctx.maskFile)
        form.set(
          "mask",
          new Blob([new Uint8Array(await fs.readFile(ctx.maskFile))], {
            type: "image/png",
          }),
          "mask.png",
        );
      body = form;
    }
    ctx.progress(
      ctx.inputFiles.length ? "云端正在编辑图片" : "云端正在生成图片",
    );
    const result = await http(
      `${ctx.provider.endpoint}/images/${ctx.inputFiles.length ? "edits" : "generations"}`,
      ctx.key,
      body,
      ctx.signal,
    );
    if (!Array.isArray(result.data) || !result.data.length)
      throw new WorkshopError(
        "NETWORK_UNCERTAIN",
        "服务没有返回图片数据，请检查服务端任务记录",
      );
    const urls = result.data
      .filter((d: any) => d.url)
      .map((d: any) => String(d.url));
    if (urls.length === result.data.length) await ctx.outputs(urls);
    return Promise.all(
      result.data
        .slice(0, 20)
        .map((d: any) =>
          d.b64_json
            ? Buffer.from(d.b64_json, "base64")
            : downloadGenerationImage(d.url, ctx.signal),
        ),
    );
  }
}
async function rh(
  provider: GenerationProviderConfig,
  key: string,
  route: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return http(
    `${provider.endpoint}${route}`,
    key,
    { ...body, apiKey: key },
    signal,
  );
}
function rhSuccess(result: any, key: string) {
  if (Number(result.code) !== 0)
    throw new WorkshopError(
      "RH_REJECTED",
      `RunningHub (${result.code})：${redactGenerationError(result.msg ?? "调用失败", key)}`,
    );
  return result.data;
}
export async function fetchRunningHubWorkflow(
  provider: GenerationProviderConfig,
  key: string,
) {
  if (!key || !provider.workflowId) throw new Error("请先保存密钥和工作流 ID");
  const data = rhSuccess(
    await rh(provider, key, "/api/openapi/getJsonApiFormat", {
      workflowId: provider.workflowId,
    }),
    key,
  );
  const graph =
    typeof data?.prompt === "string"
      ? JSON.parse(data.prompt)
      : (data?.prompt ?? data);
  assertNoSecrets(graph);
  return graph;
}
export class RunningHubImageAdapter implements GenerationAdapter {
  async check(provider: GenerationProviderConfig, key: string) {
    await fetchRunningHubWorkflow(provider, key);
    return { message: "密钥与工作流访问检查通过，未提交生成任务" };
  }
  async cancel(
    provider: GenerationProviderConfig,
    key: string,
    taskId: string,
  ) {
    rhSuccess(await rh(provider, key, "/task/openapi/cancel", { taskId }), key);
  }
  async generate(ctx: AdapterContext) {
    if (!ctx.key) throw new Error("请先保存 RunningHub API 密钥");
    let taskId = ctx.remoteTaskId;
    if (!taskId) {
      const uploaded: string[] = [];
      for (const file of [
        ...ctx.inputFiles,
        ...(ctx.maskFile ? [ctx.maskFile] : []),
      ]) {
        const form = new FormData();
        form.set("apiKey", ctx.key);
        form.set("fileType", "input");
        form.set(
          "file",
          new Blob([new Uint8Array(await fs.readFile(file))], {
            type: "image/png",
          }),
          path.basename(file),
        );
        const data = rhSuccess(
          await http(
            `${ctx.provider.endpoint}/task/openapi/upload`,
            ctx.key,
            form,
            ctx.signal,
          ),
          ctx.key,
        );
        if (!data?.fileName)
          throw new Error("RunningHub 上传没有返回 fileName");
        uploaded.push(data.fileName);
      }
      let refIndex = 0;
      const values: Record<string, unknown> = {
        prompt: ctx.request.prompt,
        negativePrompt: ctx.request.negativePrompt ?? "",
        width: ctx.request.width,
        height: ctx.request.height,
        seed: ctx.request.seed ?? Math.floor(Math.random() * 2147483647),
        steps: ctx.request.steps,
        cfg: ctx.request.cfg,
      };
      const nodeInfoList = ctx.provider.bindings.flatMap((b) => {
        const value =
          b.role === "reference"
            ? uploaded[refIndex++]
            : b.role === "mask"
              ? ctx.maskFile
                ? uploaded.at(-1)
                : undefined
              : b.role === "custom"
                ? ctx.request.workflowValues?.[`${b.nodeId}.${b.fieldName}`]
                : values[b.role];
        return value === undefined
          ? []
          : [{ nodeId: b.nodeId, fieldName: b.fieldName, fieldValue: value }];
      });
      const data = rhSuccess(
        await rh(
          ctx.provider,
          ctx.key,
          "/task/openapi/create",
          {
            workflowId: ctx.provider.workflowId,
            nodeInfoList,
            ...(ctx.provider.workflowJSON
              ? { workflow: JSON.stringify(ctx.provider.workflowJSON) }
              : {}),
          },
          ctx.signal,
        ),
        ctx.key,
      );
      if (!data?.taskId)
        throw new WorkshopError(
          "NETWORK_UNCERTAIN",
          "RunningHub 未返回任务 ID，请检查平台任务列表",
        );
      taskId = String(data.taskId);
      await ctx.submitted(taskId);
    }
    let urls = ctx.outputUrls;
    const deadline = Date.now() + 20 * 60000;
    while (!urls?.length) {
      if (Date.now() > deadline)
        throw new WorkshopError(
          "REMOTE_PENDING",
          "云端仍在运行，可稍后重试查询；不会重复提交",
        );
      const result = await rh(
        ctx.provider,
        ctx.key,
        "/task/openapi/outputs",
        { taskId },
        ctx.signal,
      );
      if ([804, 813].includes(Number(result.code))) {
        ctx.progress(
          Number(result.code) === 804
            ? "RunningHub 正在运行"
            : "RunningHub 正在排队",
        );
        await delay(3000, undefined, { signal: ctx.signal });
        continue;
      }
      if (Number(result.code) === 805)
        throw new WorkshopError(
          "REMOTE_FAILED",
          "RunningHub 执行失败，请查看平台任务详情",
        );
      const data = rhSuccess(result, ctx.key);
      urls = (Array.isArray(data) ? data : [])
        .filter(
          (d: any) =>
            /^(png|jpe?g|webp|image)$/i.test(d.fileType ?? "") ||
            /\.(png|jpe?g|webp)(?:\?|$)/i.test(d.fileUrl ?? ""),
        )
        .map((d: any) => String(d.fileUrl));
      if (!urls?.length)
        throw new WorkshopError(
          "REMOTE_FAILED",
          "工作流已结束，但没有图片输出；第一版只接收图片",
        );
      await ctx.outputs(urls!);
    }
    ctx.progress("下载 RunningHub 图片");
    return Promise.all(
      urls.slice(0, 20).map((url) => downloadGenerationImage(url, ctx.signal)),
    );
  }
}
export const defaultGenerationAdapters = {
  codex: new CodexImageAdapter(),
  openai: new OpenAIImageAdapter(),
  runninghub: new RunningHubImageAdapter(),
};
export async function codexAssistant(
  provider: GenerationProviderConfig,
  directory: string,
  prompt: string,
  signal: AbortSignal,
  images: string[] = [],
) {
  await fs.mkdir(directory, { recursive: true });
  const schema = {
    type: "object",
    properties: {
      prompts: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: { type: "string" },
      },
    },
    required: ["prompts"],
    additionalProperties: false,
  };
  await atomicJSON(path.join(directory, "schema.json"), schema);
  const answer = await runCodex(
    provider.executable,
    directory,
    `你是游戏素材制作助手。只编写生成提示词，不调用工具或生成图片。按照需求和附带参考图给出 1 到 20 条可独立执行的提示词，每条包含主体、风格、构图和保留条件。必须只返回 JSON：{"prompts":["..."]}。\n${prompt}`,
    images,
    signal,
    undefined,
    true,
  );
  const text = answer.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const result = JSON.parse(text);
  if (
    !Array.isArray(result.prompts) ||
    !result.prompts.length ||
    result.prompts.length > 20 ||
    result.prompts.some((p: unknown) => typeof p !== "string" || !p.trim())
  )
    throw new Error("助手没有返回有效的生成方案");
  return result.prompts as string[];
}
