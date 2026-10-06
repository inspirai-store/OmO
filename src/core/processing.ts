import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { atomicJSON, inside, now, uid, WorkshopError } from "./files";
import { sourcePath } from "./exporter";
import type { JobContext } from "./importer";
import { rasterInput } from "./media";
import { generationId } from "./generation-schemas";
import { CodexProcessingHarness } from "./processing-agent";
import { ProcessingOrganizeService } from "./processing-organize";
import {
  applyImageOperation,
  compositeMaskedEdit,
  imageRefSchema,
  MAX_PROCESSING_PIXELS,
  parseOperations,
  operationSchema,
  processingTools,
  executeProcessingTool,
} from "./processing-tools";
import type { Runtime } from "./runtime";
import type { Job } from "../shared/types";
import type {
  GenerationCandidate,
  GenerationProviderConfig,
  GenerationRun,
} from "../shared/generation";
import type {
  AgentSession,
  ImageOperation,
  ImageRef,
  ProcessingArtifact,
  ProcessingInput,
  ProcessingPlan,
  ProcessingRecipe,
  ProcessingRun,
} from "../shared/processing";

type Stored<T> = T & { relativePath: string };
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const terminal = ["completed", "failed", "cancelled", "interrupted"];
export class ProcessingService {
  harness = new CodexProcessingHarness();
  organize: ProcessingOrganizeService;
  private controllers = new Map<string, AbortController>();
  private previews = new Map<string, Promise<ProcessingInput>>();
  constructor(private runtime: Runtime) {
    this.organize = new ProcessingOrganizeService(runtime);
  }
  private get catalog() {
    return this.runtime.catalog;
  }
  private get root() {
    return this.runtime.root;
  }
  private get providers() {
    return this.runtime.generationAccess.providers.filter((p) => p.enabled);
  }
  private row<T>(
    table:
      | "processing_inputs"
      | "processing_artifacts"
      | "processing_runs"
      | "agent_sessions",
    id: string,
  ): T {
    const value = this.catalog.generationGet<T>(table, generationId.parse(id));
    if (!value) throw new Error("加工记录已不存在");
    return value;
  }
  private public<T extends { relativePath?: string }>(value: T) {
    const { relativePath: _, ...result } = value;
    return result;
  }
  private resolve(ref: ImageRef): Stored<ProcessingInput> {
    return ref.kind === "artifact"
      ? this.row("processing_artifacts", ref.id)
      : this.row("processing_inputs", ref.id);
  }
  private async bytes(ref: ImageRef) {
    return fs.readFile(inside(this.root, this.resolve(ref).relativePath));
  }
  private async saveRun(run: ProcessingRun) {
    run.updatedAt = now();
    this.catalog.generationSave("processing_runs", run);
    await atomicJSON(inside(this.root, `processing/${run.id}/run.json`), run);
    this.runtime.emit("processing.updated", { runId: run.id });
  }
  private async writeInput(
    bytes: Buffer,
    title: string,
    extra: Partial<ProcessingInput> = {},
    id = uid(),
  ): Promise<Stored<ProcessingInput>> {
    if (bytes.length > 64 * 1024 * 1024) throw new Error("加工图片超过 64 MiB");
    const info = await sharp(bytes, {
      limitInputPixels: MAX_PROCESSING_PIXELS,
    }).metadata();
    await sharp(bytes, { limitInputPixels: MAX_PROCESSING_PIXELS }).stats();
    const relativePath = `processing/inputs/${id}.png`;
    await fs.mkdir(path.dirname(inside(this.root, relativePath)), {
      recursive: true,
    });
    await fs.writeFile(inside(this.root, relativePath), bytes);
    const record = {
      ...extra,
      id,
      title,
      width: info.width!,
      height: info.height!,
      sha256: hash(bytes),
      bytes: bytes.length,
      previewUrl: `workshop://processing/input/${id}`,
      relativePath,
    };
    this.catalog.generationSave("processing_inputs", record);
    await this.catalog.snapshot();
    return record;
  }
  async addInput(raw: any) {
    if (raw.base64) throw new Error("请通过文件选择器或素材 ID 添加图片");
    const ref = raw.source ? imageRefSchema.parse(raw.source) : undefined;
    const extra: Partial<ProcessingInput> = { source: ref, role: "image" };
    let filename: string,
      title = "加工图片";
    if (ref?.kind === "asset") {
      const asset = this.catalog.get(ref.id);
      filename = sourcePath(this.catalog, asset);
      title = asset.title;
      Object.assign(extra, {
        sourceInfo: asset.source,
        generation: asset.metadata.generation,
        processing: asset.metadata.processing,
        category: asset.category,
        entityCategory: asset.metadata.entityCategory,
        gameplayTags: asset.metadata.gameplayTags,
        tags: asset.tags,
      });
    } else if (ref?.kind === "candidate") {
      const candidate = this.catalog.generationGet<Stored<GenerationCandidate>>(
        "generation_candidates",
        ref.id,
      );
      if (!candidate) throw new Error("生成候选已不存在");
      filename = inside(this.root, candidate.relativePath);
      title = candidate.title;
      extra.generation = this.runtime.generation.candidateProvenance(
        candidate.id,
      );
      extra.sourceInfo = {
        provider: extra.generation.provider,
        author: "用户生成",
        pageUrl: "https://learn.chatgpt.com/docs/image-generation",
        license: "使用权以模型及平台条款为准",
      };
    } else if (ref) {
      const record = this.resolve(ref);
      filename = inside(this.root, record.relativePath);
      title = record.title;
      Object.assign(extra, {
        generation: record.generation,
        processing: record.processing,
        sourceInfo: record.sourceInfo,
        category: record.category,
        entityCategory: record.entityCategory,
        gameplayTags: record.gameplayTags,
        tags: record.tags,
      });
    } else filename = z.string().min(1).max(2000).parse(raw.path);
    const stat = await fs.stat(filename);
    if (stat.size > 64 * 1024 * 1024) throw new Error("图片超过 64 MiB");
    const page = z.number().int().min(0).max(10000).optional().parse(raw.page);
    const decoded = await rasterInput(
      filename,
      page ?? 0,
      MAX_PROCESSING_PIXELS,
    );
    const metadata = await sharp(decoded.input, decoded.options).metadata();
    if ((metadata.pages ?? 1) > 1 && page === undefined)
      throw new WorkshopError(
        "PAGE_REQUIRED",
        `图片有 ${metadata.pages} 页或帧，请选择页码后加工`,
      );
    if (page !== undefined && page >= (metadata.pages ?? 1))
      throw new Error("页码超出图片范围");
    const bytes = await sharp(decoded.input, decoded.options)
      .autoOrient()
      .toColourspace("srgb")
      .ensureAlpha()
      .png()
      .toBuffer();
    return this.public(
      await this.writeInput(
        bytes,
        ref ? title : path.basename(filename),
        extra,
      ),
    );
  }
  async preview(raw: any): Promise<ProcessingPlan> {
    const inputIds = [
      ...new Set(z.array(generationId).min(1).max(100).parse(raw.inputIds)),
    ];
    const operations = parseOperations(raw.operations);
    const extraCalls = z
      .number()
      .int()
      .min(0)
      .max(1)
      .default(1)
      .parse(raw.extraCalls);
    const inputs = inputIds.map((id) =>
      this.row<Stored<ProcessingInput>>("processing_inputs", id),
    );
    const providers: GenerationProviderConfig[] = [];
    const warnings: string[] = [];
    for (const op of operations)
      if (op.type === "ai") {
        const p = this.providers.find((p) => p.id === op.providerId);
        if (!p) throw new Error("所选加工连接已停用");
        if (!p.capabilities.references)
          throw new Error("加工模型需要参考图能力");
        if (p.models.length && !p.models.includes(op.model))
          throw new Error("请选择连接内的模型");
        if (p.kind === "openai" && !op.model)
          throw new Error("请填写图像模型 ID");
        if (
          p.kind === "runninghub" &&
          (!p.workflowId || !p.bindings.some((b) => b.role === "reference"))
        )
          throw new Error("工作流需要 ID 和输入图片映射");
        if (p.kind === "runninghub" && !p.purposes?.includes(op.purpose))
          throw new Error("请在连接设置中标记该工作流的加工用途");
        if (op.purpose === "upscale" && p.kind !== "runninghub")
          throw new Error("超分需要已标记用途的 RunningHub 专用工作流");
        if (op.maskId) {
          if (!p.capabilities.mask) throw new Error("该模型不支持蒙版修改");
          if (inputIds.length !== 1)
            throw new Error("蒙版只绑定单张图片，批量加工请分别绘制");
          const mask = this.row<Stored<ProcessingInput>>(
            "processing_inputs",
            op.maskId,
          );
          if (mask.role !== "mask" || mask.maskInputHash !== op.maskInputHash)
            throw new Error("蒙版绑定已失效，请重画");
        }
        if (!providers.some((c) => c.id === p.id))
          providers.push(structuredClone(p));
      }
    // Validate coordinates and output bounds against complete inputs; never spend cloud quota during preview.
    for (const input of inputs) {
      let bytes = await fs.readFile(inside(this.root, input.relativePath));
      for (const op of operations) {
        if (op.type === "ai") {
          if (op.maskId && hash(bytes) !== op.maskInputHash)
            throw new Error("前置操作改变了蒙版原图，请重画蒙版");
          break;
        }
        bytes = await applyImageOperation(bytes, op);
      }
    }
    const totalCalls =
      operations.filter((op) => op.type === "ai").length * inputIds.length;
    if (totalCalls > 20) throw new Error("一批最多二十次图像模型调用");
    const maxCalls = totalCalls + (raw.sessionId ? extraCalls : 0);
    const sessionId = raw.sessionId
      ? generationId.parse(raw.sessionId)
      : undefined;
    if (sessionId) this.row<AgentSession>("agent_sessions", sessionId);
    if (totalCalls)
      warnings.push(
        "费用未知的连接按平台规则计费；调用上限包含修正，不自动切换服务。",
      );
    const currency = providers[0]?.currency;
    const known =
      providers.length &&
      providers.every(
        (p) => p.unitPrice !== undefined && p.currency === currency,
      );
    const plan: ProcessingPlan = {
      id: uid(),
      inputIds,
      operations,
      totalCalls,
      maxCalls,
      extraCalls,
      providers,
      sessionId,
      warnings,
      createdAt: now(),
      ...(known
        ? {
            estimatedCost:
              operations.reduce(
                (n, op) =>
                  op.type === "ai"
                    ? n +
                      inputIds.length *
                        providers.find((p) => p.id === op.providerId)!
                          .unitPrice!
                    : n,
                0,
              ) +
              (maxCalls - totalCalls) *
                Math.max(...providers.map((p) => p.unitPrice!)),
            currency,
          }
        : {}),
    };
    this.runtime.plans.set(plan.id, plan);
    return plan;
  }
  async handle(method: string, raw: any): Promise<any> {
    if (
      method.startsWith("processing.organize.") ||
      method === "processing.accept"
    )
      return this.organize.handle(method, raw);
    switch (method) {
      case "processing.capabilities":
        return {
          tools: processingTools,
          providers: this.providers,
          maxPixels: MAX_PROCESSING_PIXELS,
          maxRounds: 8,
        };
      case "processing.inputs":
      case "processing.inputs.add":
        return this.addInput(raw);
      case "processing.inputs.list":
        return this.catalog
          .generationList<Stored<ProcessingInput>>("processing_inputs", 200)
          .filter((x) => x.role !== "mask")
          .map((x) => this.public(x));
      case "processing.files.resolve":
        return inside(
          this.root,
          raw.kind === "artifact"
            ? this.row<Stored<ProcessingArtifact>>(
                "processing_artifacts",
                raw.id,
              ).relativePath
            : this.row<Stored<ProcessingInput>>("processing_inputs", raw.id)
                .relativePath,
        );
      case "processing.mask.save": {
        const source = imageRefSchema.parse(raw.source);
        const original = this.resolve(source);
        const bytes = Buffer.from(
          z
            .string()
            .max(90 * 1024 * 1024)
            .parse(raw.base64)
            .replace(/^data:image\/png;base64,/, ""),
          "base64",
        );
        const info = await sharp(bytes, {
          limitInputPixels: MAX_PROCESSING_PIXELS,
        }).metadata();
        if (
          info.format !== "png" ||
          !info.hasAlpha ||
          info.width !== original.width ||
          info.height !== original.height
        )
          throw new Error("蒙版必须与工作图尺寸相同");
        return this.public(
          await this.writeInput(bytes, "加工蒙版", {
            role: "mask",
            maskInputHash: original.sha256,
          }),
        );
      }
      case "processing.preview":
        return this.preview(raw);
      case "processing.previewImage": {
        const source = imageRefSchema.parse(raw.source);
        const operations = raw.operations?.length
          ? parseOperations(raw.operations)
          : [];
        if (operations.some((op) => op.type === "ai"))
          throw new Error("云端处理需要确认方案后启动");
        const key = this.resolve(source).sha256 + JSON.stringify(operations);
        let pending = this.previews.get(key);
        if (!pending) {
          pending = (async () => {
            const bytes = await executeProcessingTool("image.preview", {
              bytes: await this.bytes(source),
              operations,
            });
            return this.public(
              await this.writeInput(bytes, "完整加工预览", {
                source,
                role: "image",
              }),
            );
          })();
          this.previews.set(key, pending);
          if (this.previews.size > 20)
            this.previews.delete(this.previews.keys().next().value!);
          pending.catch(() => this.previews.delete(key));
        }
        return pending;
      }
      case "processing.start": {
        const saved = this.runtime.plans.get(
          generationId.parse(raw.planId),
        ) as ProcessingPlan;
        if (
          !saved?.inputIds ||
          Date.now() - Date.parse(saved.createdAt) > 30 * 60000
        )
          throw new Error("方案已过期，请重新检查");
        if (
          saved.providers.some(
            (p) =>
              JSON.stringify(p) !==
              JSON.stringify(
                this.providers.find((current) => current.id === p.id),
              ),
          )
        )
          throw new Error("方案中的连接已改变，请重新检查后启动");
        this.runtime.plans.delete(saved.id);
        const plan = await this.preview(saved);
        this.runtime.plans.delete(plan.id);
        const id = uid();
        const createdAt = now();
        const job = this.runtime.start(
          "processing",
          { runId: id },
          `加工 ${plan.inputIds.length} 张图片`,
          (job) => {
            if (raw.familyLink) {
              const b = this.catalog.generationGet<any>(
                "family_batches",
                raw.familyLink.batchId,
              );
              const item = b?.items.find(
                (i: any) => i.key === raw.familyLink.key,
              );
              if (!item || item.processingRunId)
                throw new Error("同类加工关联不存在或已提交");
              item.processingRunId = id;
              this.catalog.generationSave("family_batches", b);
            }
            this.catalog.generationSave("processing_runs", {
              id,
              jobId: job.id,
              plan,
              calls: 0,
              createdAt,
              updatedAt: createdAt,
              status: "queued",
              items: plan.inputIds.map((inputId) => ({
                inputId,
                cursor: 0,
                artifactIds: [],
                state: "pending",
                corrections: 0,
              })),
            } satisfies ProcessingRun);
          },
        );
        return { runId: id, jobId: job.id };
      }
      case "processing.list":
        return this.catalog.generationList<ProcessingRun>(
          "processing_runs",
          100,
        );
      case "processing.detail": {
        const run = this.row<ProcessingRun>("processing_runs", raw.id);
        return {
          run,
          inputs: run.items.map((i) =>
            this.public(
              this.row<Stored<ProcessingInput>>("processing_inputs", i.inputId),
            ),
          ),
          artifacts: run.items
            .flatMap((i) => i.artifactIds)
            .map((id) =>
              this.catalog.generationGet<Stored<ProcessingArtifact>>(
                "processing_artifacts",
                id,
              ),
            )
            .filter((a): a is Stored<ProcessingArtifact> => !!a)
            .map((a) => this.public(a)),
          session: run.plan.sessionId
            ? this.row<AgentSession>("agent_sessions", run.plan.sessionId)
            : undefined,
        };
      }
      case "processing.recipes.list":
        return this.catalog.generationList<ProcessingRecipe>(
          "processing_recipes",
          100,
        );
      case "processing.recipes.save": {
        const record = {
          id: raw.id ? generationId.parse(raw.id) : uid(),
          name: z.string().trim().min(1).max(100).parse(raw.name),
          operations: parseOperations(raw.operations),
          createdAt: now(),
        };
        this.catalog.generationSave("processing_recipes", record);
        await this.catalog.snapshot();
        return record;
      }
      case "processing.recipes.delete":
        this.catalog.db
          .prepare("DELETE FROM processing_recipes WHERE id=?")
          .run(generationId.parse(raw.id));
        await this.catalog.snapshot();
        return true;
      case "processing.delete": {
        const a = this.row<Stored<ProcessingArtifact>>(
          "processing_artifacts",
          raw.id,
        );
        if (
          this.catalog
            .generationList<any>("family_batches", 10000)
            .some((b) =>
              b.items.some((i: any) =>
                i.outputs?.some((o: any) => o.artifactId === a.id),
              ),
            )
        )
          throw new Error("结果被同类批次引用，保留加工与尺寸来源");
        if (
          this.catalog
            .generationList<ProcessingInput>("processing_inputs", 100000)
            .some(
              (i) => i.source?.kind === "artifact" && i.source.id === a.id,
            ) ||
          this.catalog
            .generationList<ProcessingArtifact>("processing_artifacts", 100000)
            .some((i) => i.parent.kind === "artifact" && i.parent.id === a.id)
        )
          throw new Error("结果仍被后续加工引用，请先删除后续结果");
        const run = this.row<ProcessingRun>("processing_runs", a.runId);
        if (!terminal.includes(run.status)) throw new Error("请先停止加工任务");
        if (this.organize.isAnalyzingArtifact(a.id))
          throw new Error("正在识别此结果，请先停止整理识别任务");
        if (
          a.importJobId &&
          !terminal.includes(this.job(a.importJobId)?.status ?? "failed")
        )
          throw new Error("正在入库");
        this.catalog.db
          .prepare("DELETE FROM processing_artifacts WHERE id=?")
          .run(a.id);
        run.items.forEach(
          (i) => (i.artifactIds = i.artifactIds.filter((id) => id !== a.id)),
        );
        await this.saveRun(run);
        await fs.rm(inside(this.root, a.relativePath), { force: true });
        await this.catalog.snapshot();
        return true;
      }
      case "processing.assistant.plan":
      case "processing.assistant.continue": {
        const p = this.providers.find(
          (p) =>
            p.kind === "codex" &&
            (!raw.assistantProviderId || p.id === raw.assistantProviderId),
        );
        if (!p) throw new Error("请启用 Codex 制作助手连接");
        const inputIds = z
          .array(generationId)
          .min(1)
          .max(100)
          .parse(raw.inputIds);
        inputIds.forEach((id) => this.row("processing_inputs", id));
        const brief = z.string().trim().min(1).max(16000).parse(raw.brief);
        const session: AgentSession = raw.sessionId
          ? this.row("agent_sessions", raw.sessionId)
          : {
              id: uid(),
              brief,
              providerId: p.id,
              model: raw.assistantModel ?? "",
              rounds: 0,
              state: "planning",
              history: [],
              createdAt: now(),
            };
        if (session.providerId !== p.id)
          throw new Error("继续会话不能自动更换助手连接");
        session.brief = brief;
        session.rounds = 0;
        session.state = "planning";
        session.history.push({ role: "user", text: brief, createdAt: now() });
        this.catalog.generationSave("agent_sessions", session);
        const job = this.runtime.start(
          "processing-assistant",
          {
            sessionId: session.id,
            inputIds,
            operations: raw.operations ?? [],
            selectedProviderId: raw.selectedProviderId,
            selectedModel: raw.selectedModel ?? "",
          },
          "助手正在制定加工方案",
        );
        return { sessionId: session.id, jobId: job.id };
      }
      default:
        throw new Error(`未知加工接口：${method}`);
    }
  }
  private job(id: string): Job | undefined {
    const row = this.catalog.db
      .prepare("SELECT data FROM jobs WHERE id=?")
      .get(id);
    return row ? JSON.parse(row.data) : undefined;
  }
  private async waitJob(id: string, ctx: JobContext): Promise<Job> {
    for (;;) {
      await ctx.check();
      const job = this.job(id);
      if (!job) throw new Error("加工子任务缺失，未重复提交");
      if (terminal.includes(job.status)) return job;
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  recover(job: Job) {
    this.organize.recover(job);
    if (
      job.type === "processing-assistant" ||
      job.type === "processing-review"
    ) {
      job.status = "interrupted";
      job.stage = "助手回合中断，请检查后继续";
      const session = this.catalog.generationGet<AgentSession>(
        "agent_sessions",
        job.request.sessionId,
      );
      if (session) {
        session.state = "needsInput";
        this.catalog.generationSave("agent_sessions", session);
      }
      return;
    }
    if (job.type !== "processing") return;
    const run = this.row<ProcessingRun>("processing_runs", job.request.runId);
    if (run.status === "interrupted") {
      job.status = "interrupted";
      return;
    }
    for (const item of run.items)
      if (item.state === "failed") item.state = "pending";
    run.status = "queued";
    this.catalog.generationSave("processing_runs", run);
  }
  async retry(job: Job, confirmed = false) {
    this.organize.retry(job);
    if (job.type !== "processing") return;
    const run = this.row<ProcessingRun>("processing_runs", job.request.runId);
    let additionalCalls = 0;
    if (!confirmed && run.status === "interrupted")
      throw new Error("请先检查中断记录，确认后重试");
    // Validate every item before restarting any child; an ambiguous batch must
    // not partially restart while another item still needs confirmation.
    for (const item of run.items.filter((i) => i.state !== "completed")) {
      const child = item.childJobId ? this.job(item.childJobId) : undefined;
      const review = item.reviewJobId ? this.job(item.reviewJobId) : undefined;
      if (
        !confirmed &&
        (child?.status === "interrupted" || review?.status === "interrupted")
      )
        throw new Error("请先检查远端记录或助手回合，确认后重试");
      if (
        child?.type === "generation" &&
        ["failed", "cancelled", "interrupted"].includes(child.status)
      ) {
        const generated = this.catalog.generationGet<GenerationRun>(
          "generation_runs",
          child.request.runId,
        )!;
        additionalCalls += generated.items.filter(
          (i) =>
            i.state !== "completed" &&
            ((!i.remoteTaskId && !i.outputUrls?.length) ||
              i.error?.startsWith("REMOTE_FAILED:") ||
              i.remoteCancellation === "cancelled"),
        ).length;
      }
    }
    // Explicit retry is a new user-authorized attempt, not an automatic repair.
    // Downloads and polling an existing task consume no additional calls.
    run.calls += additionalCalls;
    run.plan.maxCalls += additionalCalls;
    await this.saveRun(run);
    for (const item of run.items)
      if (item.state !== "completed") {
        if (item.childJobId) {
          const child = this.job(item.childJobId);
          if (
            child &&
            ["failed", "cancelled", "interrupted"].includes(child.status)
          )
            await this.runtime.handle("jobs.control", {
              id: child.id,
              action: "retry",
              confirmUnknown: confirmed,
            });
        }
        if (item.reviewJobId) {
          const review = this.job(item.reviewJobId);
          if (
            review &&
            ["failed", "cancelled", "interrupted"].includes(review.status)
          ) {
            if (!confirmed && review.status === "interrupted")
              throw new Error("请检查助手回合后确认重试");
            await this.runtime.handle("jobs.control", {
              id: review.id,
              action: "retry",
            });
          }
        }
        item.state = "pending";
        item.error = undefined;
      }
    run.status = "queued";
    await this.saveRun(run);
  }
  shutdown() {
    this.organize.shutdown();
    this.controllers.forEach((c) => c.abort());
  }
  async cancel(job: Job) {
    await this.organize.cancel(job);
    this.controllers.get(job.id)?.abort();
    if (job.type !== "processing") return;
    const run = this.row<ProcessingRun>("processing_runs", job.request.runId);
    const messages: string[] = [];
    for (const item of run.items) {
      for (const id of [item.childJobId, item.reviewJobId]) {
        const child = id ? this.job(id) : undefined;
        if (child && ["queued", "running", "paused"].includes(child.status)) {
          const result = await this.runtime.handle("jobs.control", {
            id: child.id,
            action: "cancel",
          });
          if (result.cancellation?.message)
            messages.push(result.cancellation.message);
        }
      }
      if (item.state !== "completed") item.state = "cancelled";
    }
    run.status = "cancelled";
    await this.saveRun(run);
    job.cancellation = {
      remoteSupported: run.plan.providers.every(
        (p) => p.capabilities.cancelRemote,
      ),
      message: messages.join("；") || "已停止加工，保留已完成结果",
    };
  }
  async execute(ctx: JobContext): Promise<any> {
    if (ctx.job.type === "processing-organize")
      return this.organize.execute(ctx);
    if (ctx.job.type === "processing") return this.coordinate(ctx);
    if (ctx.job.type === "processing-import")
      return this.organize.importArtifacts(ctx);
    if (ctx.job.type === "processing-step") return this.step(ctx);
    const controller = new AbortController();
    this.controllers.set(ctx.job.id, controller);
    try {
      const session = this.row<AgentSession>(
        "agent_sessions",
        ctx.job.request.sessionId,
      );
      const provider = this.providers.find(
        (p) => p.id === session.providerId && p.kind === "codex",
      );
      if (!provider) throw new Error("原 Codex 助手连接已停用");
      const review = ctx.job.type === "processing-review";
      const records: Stored<ProcessingInput>[] = review
        ? [
            this.row("processing_inputs", ctx.job.request.inputId),
            this.row("processing_artifacts", ctx.job.request.artifactId),
          ]
        : ctx.job.request.inputIds.map((id: string) =>
            this.row("processing_inputs", id),
          );
      const measured = review
        ? await executeProcessingTool("image.compare", {
            bytes: await fs.readFile(
              inside(this.root, records[0].relativePath),
            ),
            result: await fs.readFile(
              inside(this.root, records[1].relativePath),
            ),
          })
        : await Promise.all(
            records.slice(0, 5).map(async (r) =>
              executeProcessingTool("image.inspect", {
                bytes: await fs.readFile(inside(this.root, r.relativePath)),
              }),
            ),
          );
      const prompt = review
        ? `检查结果是否满足需求 ${session.brief}。已确认配方 ${JSON.stringify(session.plan?.operations)}。工具实际比较 ${JSON.stringify(measured)}。若合格 decision=accept；只可修改最后一步原参数而不能添加步骤或更换模型，使用 operationJson；不能在既定能力内满足则 needsInput。`
        : `需求 ${session.brief}。输入实际检查 ${JSON.stringify(measured)}。全部输入尺寸 ${JSON.stringify(records.map((r) => ({ width: r.width, height: r.height })))}。当前配方 ${JSON.stringify(ctx.job.request.operations)}。指定图像连接 ${ctx.job.request.selectedProviderId ?? "没有，使用本地工具"} 和模型 ${ctx.job.request.selectedModel}。实际连接能力 ${JSON.stringify(this.providers)}。返回 operationsJson 为 ImageOperation 数组。操作结构：${JSON.stringify(z.toJSONSchema(z.array(operationSchema), { unrepresentable: "any" }))}。不可编造蒙版，缺少选区时在 note 说明需要用户绘制。工具 ${JSON.stringify(processingTools)}。`;
      session.state = review ? "reviewing" : "planning";
      this.catalog.generationSave("agent_sessions", session);
      const result = await this.harness.round(
        provider,
        session,
        inside(this.root, `processing/agents/${session.id}`),
        prompt,
        records.slice(0, 5).map((r) => inside(this.root, r.relativePath)),
        controller.signal,
        review,
        (text) => ctx.progress(text.slice(0, 160), session.rounds, 8),
        async () => {
          this.catalog.generationSave("agent_sessions", session);
          await this.catalog.snapshot();
        },
      );
      if (review) {
        this.catalog.generationSave("agent_sessions", session);
        await this.catalog.snapshot();
        return result;
      }
      const ops = parseOperations(JSON.parse(result.operationsJson));
      if (
        ops.some(
          (op) =>
            op.type === "ai" &&
            (op.providerId !== ctx.job.request.selectedProviderId ||
              op.model !== ctx.job.request.selectedModel),
        )
      )
        throw new Error("助手提出了未选择的模型或服务，请调整需求");
      const plan = await this.preview({
        inputIds: ctx.job.request.inputIds,
        operations: ops,
        sessionId: session.id,
      });
      if (result.note) plan.warnings.push(String(result.note).slice(0, 2000));
      session.plan = plan;
      session.state = "awaitingApproval";
      this.catalog.generationSave("agent_sessions", session);
      await this.catalog.snapshot();
      return { plan, sessionId: session.id };
    } catch (error) {
      const session = this.row<AgentSession>(
        "agent_sessions",
        ctx.job.request.sessionId,
      );
      session.state = "needsInput";
      this.catalog.generationSave("agent_sessions", session);
      await this.catalog.snapshot();
      throw error;
    } finally {
      this.controllers.delete(ctx.job.id);
    }
  }
  private async step(ctx: JobContext) {
    const { source, operation, artifactId, runId } = ctx.job.request as {
      source: ImageRef;
      operation: ImageOperation;
      artifactId: string;
      runId: string;
    };
    const existing = this.catalog.generationGet<Stored<ProcessingArtifact>>(
      "processing_artifacts",
      artifactId,
    );
    if (existing) return { artifactId };
    await ctx.check();
    const original = this.resolve(source);
    let bytes = await this.bytes(source);
    let generation;
    if (operation.type === "ai")
      bytes = await executeProcessingTool("image.ai_edit", {
        bytes,
        approvedAI: async () => {
          const candidate = this.catalog.generationGet<
            Stored<GenerationCandidate>
          >("generation_candidates", ctx.job.request.candidateId);
          if (!candidate) throw new Error("AI 候选未保存");
          const edited = await fs.readFile(
            inside(this.root, candidate.relativePath),
          );
          generation = this.runtime.generation.candidateProvenance(
            candidate.id,
          );
          if (operation.maskId) {
            const mask = this.row<Stored<ProcessingInput>>(
              "processing_inputs",
              operation.maskId,
            );
            if (
              mask.maskInputHash !== original.sha256 ||
              original.sha256 !== operation.maskInputHash
            )
              throw new Error("蒙版原图已改变，请重画");
            bytes = await compositeMaskedEdit(
              bytes,
              edited,
              await fs.readFile(inside(this.root, mask.relativePath)),
            );
          } else
            bytes = await sharp(edited, {
              limitInputPixels: MAX_PROCESSING_PIXELS,
            })
              .autoOrient()
              .ensureAlpha()
              .png()
              .toBuffer();
          if (operation.purpose === "removeBackground") {
            const { channels } = await sharp(bytes).stats();
            if (channels[3]?.min === 255)
              throw new Error("结果没有透明背景；原始 AI 候选已保留");
          }
          return bytes;
        },
      });
    else
      bytes = await executeProcessingTool("image.apply", { bytes, operation });
    await ctx.check();
    const info = await sharp(bytes).metadata();
    const sha256 = hash(bytes);
    const relativePath = `processing/${runId}/artifacts/${artifactId}.png`;
    await fs.mkdir(path.dirname(inside(this.root, relativePath)), {
      recursive: true,
    });
    await fs.writeFile(inside(this.root, relativePath), bytes);
    const artifact: Stored<ProcessingArtifact> = {
      ...original,
      id: artifactId,
      title: `${original.title.replace(/(?:\s*·\s*加工)+$/g, "")} · 加工`,
      runId,
      parent: source,
      operation,
      toolVersion:
        operation.type === "ai"
          ? `cloud-edit-v1${operation.maskId ? `/compose-sharp-${sharp.versions.sharp}` : ""}`
          : `sharp-${sharp.versions.sharp}`,
      width: info.width!,
      height: info.height!,
      sha256,
      bytes: bytes.length,
      relativePath,
      previewUrl: `workshop://processing/artifact/${artifactId}`,
      createdAt: now(),
      importedAssetIds: undefined,
      importJobId: undefined,
      rawCandidateId: ctx.job.request.candidateId,
      processing: {
        schemaVersion: 1,
        source: original.processing?.source ?? original.source ?? source,
        sourceHash: original.processing?.sourceHash ?? original.sha256,
        runId,
        artifactId,
        steps: [
          ...(original.processing?.steps ?? []),
          {
            operation,
            inputHash: original.sha256,
            outputHash: sha256,
            toolVersion:
              operation.type === "ai"
                ? "cloud-edit-v1"
                : `sharp-${sharp.versions.sharp}`,
            generation,
          },
        ],
      },
    };
    this.catalog.generationSave("processing_artifacts", artifact);
    await this.catalog.snapshot();
    this.runtime.emit("processing.updated", { runId });
    return { artifactId };
  }
  private async coordinate(ctx: JobContext): Promise<any> {
    const run = this.row<ProcessingRun>(
      "processing_runs",
      ctx.job.request.runId,
    );
    run.status = "running";
    await this.saveRun(run);
    if (run.plan.sessionId) {
      const session = this.row<AgentSession>(
        "agent_sessions",
        run.plan.sessionId,
      );
      session.plan = run.plan;
      session.state = "executing";
      this.catalog.generationSave("agent_sessions", session);
    }
    for (const [index, item] of run.items.entries()) {
      if (item.state === "completed") continue;
      item.state = "running";
      try {
        while (
          item.cursor < run.plan.operations.length ||
          item.repairOperation
        ) {
          await ctx.check();
          const repairing = !!item.repairOperation;
          const operation =
            item.repairOperation ?? run.plan.operations[item.cursor];
          const previous = item.artifactIds.at(-1);
          const source: ImageRef =
            repairing && previous
              ? this.row<ProcessingArtifact>("processing_artifacts", previous)
                  .parent
              : previous
                ? { kind: "artifact", id: previous }
                : { kind: "input", id: item.inputId };
          const artifactId = `${run.id}-${index}-${item.cursor}-${item.corrections}`;
          if (operation.type === "ai" && !item.generationRunId) {
            if (run.calls >= run.plan.maxCalls)
              throw new WorkshopError(
                "AGENT_LIMIT",
                "已达到图像调用上限，请调整方案",
              );
            const snapshot = run.plan.providers.find(
              (p) => p.id === operation.providerId,
            )!;
            const current = this.providers.find(
              (p) => p.id === operation.providerId,
            );
            if (
              !current ||
              JSON.stringify(current) !== JSON.stringify(snapshot)
            )
              throw new Error("加工连接已改变，请重新检查方案");
            const ref = await this.runtime.generation.handle(
              "generation.inputs.add",
              {
                filePath: inside(this.root, this.resolve(source).relativePath),
              },
            );
            const mask = operation.maskId
              ? await this.runtime.generation.handle("generation.mask.save", {
                  referenceId: ref.id,
                  base64: (
                    await this.bytes({ kind: "input", id: operation.maskId })
                  ).toString("base64"),
                })
              : undefined;
            const plan = await this.runtime.generation.preview([
              {
                providerId: operation.providerId,
                model: operation.model,
                prompt: operation.prompt,
                referenceIds: [ref.id],
                maskId: mask?.id,
                width: operation.width,
                height: operation.height,
                count: 1,
                transparent:
                  operation.purpose === "removeBackground" &&
                  current.capabilities.transparent,
                category: this.resolve(source).category ?? "ui",
                tags: [],
                workflowValues: operation.workflowValues,
              },
            ]);
            // The child linkage and quota reservation are committed before its task can execute.
            run.calls++;
            await this.saveRun(run);
            const started = await this.runtime.generation.handle(
              "generation.start",
              { planId: plan.id, processingLink: { runId: run.id, index } },
            );
            item.generationRunId = started.runId;
            item.childJobId = started.jobId;
            await this.saveRun(run);
          }
          if (
            item.generationRunId &&
            this.job(item.childJobId!)?.type === "generation"
          ) {
            const generated = await this.waitJob(item.childJobId!, ctx);
            if (generated.status !== "completed")
              throw new WorkshopError(
                generated.status === "interrupted"
                  ? "UNCERTAIN"
                  : "CHILD_FAILED",
                generated.error ?? "AI 加工未完成，已保留候选",
              );
            const gen = this.catalog.generationGet<GenerationRun>(
              "generation_runs",
              item.generationRunId,
            )!;
            const candidateId = gen.items[0].candidateIds[0];
            if (!candidateId) throw new Error("AI 未返回候选");
            item.childJobId = this.runtime.start(
              "processing-step",
              { source, operation, artifactId, runId: run.id, candidateId },
              "合成 AI 加工结果",
              (job) => {
                item.childJobId = job.id;
                this.catalog.generationSave("processing_runs", run);
              },
            ).id;
          } else if (!item.childJobId)
            item.childJobId = this.runtime.start(
              "processing-step",
              { source, operation, artifactId, runId: run.id },
              "本地图像加工",
              (job) => {
                item.childJobId = job.id;
                this.catalog.generationSave("processing_runs", run);
              },
            ).id;
          const child = await this.waitJob(item.childJobId!, ctx);
          if (child.status !== "completed")
            throw new Error(child.error ?? "图像加工未完成");
          if (!item.artifactIds.includes(child.result.artifactId))
            item.artifactIds.push(child.result.artifactId);
          item.childJobId = undefined;
          item.generationRunId = undefined;
          if (repairing) item.repairOperation = undefined;
          else item.cursor++;
          await this.saveRun(run);
          ctx.progress(
            "逐项加工并保存",
            index * run.plan.operations.length + item.cursor,
            run.items.length * run.plan.operations.length,
          );
        }
        if (run.plan.sessionId && !item.reviewDone) {
          if (!item.reviewJobId)
            item.reviewJobId = this.runtime.start(
              "processing-review",
              {
                sessionId: run.plan.sessionId,
                artifactId: item.artifactIds.at(-1),
                inputId: item.inputId,
              },
              "助手检查加工结果",
              (job) => {
                item.reviewJobId = job.id;
                this.catalog.generationSave("processing_runs", run);
              },
            ).id;
          const review = await this.waitJob(item.reviewJobId, ctx);
          if (review.status !== "completed")
            throw new WorkshopError(
              "AGENT_LIMIT",
              review.error ?? "助手检查中断，请调整方案",
            );
          const result = review.result;
          item.reviewJobId = undefined;
          if (result.decision === "accept") item.reviewDone = true;
          else if (result.decision === "adjust" && item.corrections < 1) {
            const operation = parseOperations([
              JSON.parse(result.operationJson),
            ])[0];
            const last = run.plan.operations.at(-1)!;
            if (
              operation.type !== last.type ||
              (operation.type === "ai" &&
                last.type === "ai" &&
                (operation.providerId !== last.providerId ||
                  operation.model !== last.model ||
                  operation.purpose !== last.purpose ||
                  operation.maskId !== last.maskId ||
                  operation.width !== last.width ||
                  operation.height !== last.height ||
                  run.calls >= run.plan.maxCalls))
            )
              throw new WorkshopError(
                "AGENT_LIMIT",
                "修正超出已确认方案，请调整后启动",
              );
            item.corrections++;
            item.repairOperation = operation;
            await this.saveRun(run);
            // Re-enter the current item without occupying a worker slot.
            return this.coordinate(ctx);
          } else
            throw new WorkshopError(
              "AGENT_LIMIT",
              String(result.note ?? "助手建议调整方案"),
            );
        }
        item.state = "completed";
      } catch (error: any) {
        if (["CANCELLED", "SHUTDOWN"].includes(error.code)) throw error;
        item.state = ["UNCERTAIN", "AGENT_LIMIT"].includes(error.code)
          ? "uncertain"
          : "failed";
        item.error = error.message;
      }
      await this.saveRun(run);
    }
    run.status = run.items.some((i) => i.state === "uncertain")
      ? "interrupted"
      : run.items.some((i) => i.state === "failed")
        ? "failed"
        : "completed";
    ctx.job.status = run.status;
    ctx.job.error = run.items
      .filter((i) => i.error)
      .map((i) => i.error)
      .join("\n");
    if (run.plan.sessionId) {
      const session = this.row<AgentSession>(
        "agent_sessions",
        run.plan.sessionId,
      );
      session.state = run.status === "completed" ? "completed" : "needsInput";
      this.catalog.generationSave("agent_sessions", session);
    }
    await this.saveRun(run);
    await this.catalog.snapshot();
    return {
      runId: run.id,
      artifactIds: run.items.flatMap((i) => i.artifactIds),
    };
  }
}
