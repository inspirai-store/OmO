import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import {
  atomicJSON,
  inside,
  hashFile,
  now,
  uid,
  walk,
  WorkshopError,
} from "./files";
import {
  generationId,
  generationRequestSchema,
  assertNoSecrets,
} from "./generation-schemas";
import {
  defaultGenerationAdapters,
  codexAssistant,
  downloadGenerationImage,
  fetchRunningHubWorkflow,
  redactGenerationError,
  type GenerationAdapter,
} from "./generation-adapters";
import type { GenerationAccess } from "./generation-provider-store";
import { inspectImport, runImport, type JobContext } from "./importer";
import { sourcePath } from "./exporter";
import type { Runtime } from "./runtime";
import type { Job } from "../shared/types";
import type {
  GenerationCandidate,
  GenerationItem,
  GenerationPlan,
  GenerationProvenance,
  GenerationProviderConfig,
  GenerationReference,
  GenerationRequest,
  GenerationRun,
  GenerationTemplate,
} from "../shared/generation";

interface StoredInput extends GenerationReference {
  relativePath: string;
}
interface StoredCandidate extends GenerationCandidate {
  relativePath: string;
}
const sha = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
export class GenerationService {
  private access: GenerationAccess;
  private controllers = new Map<string, AbortController>();
  private imports = new Set<string>();
  constructor(
    private runtime: Runtime,
    access: GenerationAccess = { providers: [], keys: {} },
    public adapters: Record<
      string,
      GenerationAdapter
    > = defaultGenerationAdapters,
  ) {
    this.access = access;
  }
  candidateProvenance(id: string): GenerationProvenance {
    const c = this.candidate(id),
      run = this.catalog.generationGet<GenerationRun>(
        "generation_runs",
        c.runId,
      )!,
      item = run.items[c.itemIndex],
      request = item.request;
    return {
      schemaVersion: 1,
      runId: run.id,
      candidateId: c.id,
      provider: item.provider.kind,
      model: request.model,
      workflowId: item.provider.workflowId,
      workflowHash: item.provider.workflowJSON
        ? sha(JSON.stringify(item.provider.workflowJSON))
        : undefined,
      prompt: request.prompt,
      negativePrompt: request.negativePrompt,
      parameters: {
        width: request.width,
        height: request.height,
        seed: request.seed,
        quality: request.quality,
        transparent: request.transparent,
        steps: request.steps,
        cfg: request.cfg,
        workflowValues: request.workflowValues,
      },
      references: [
        ...request.referenceIds,
        ...(request.maskId ? [request.maskId] : []),
      ].map((id) => ({
        sha256: this.input(id).sha256,
        role: this.input(id).role,
      })),
      parentCandidateId: c.parentCandidateId,
      createdAt: c.createdAt,
    };
  }
  configure(access: GenerationAccess) {
    this.access = access;
  }
  shutdown() {
    this.controllers.forEach((c) => c.abort());
  }
  private get catalog() {
    return this.runtime.catalog;
  }
  private get root() {
    return this.runtime.root;
  }
  private provider(id: string) {
    const p = this.access.providers.find((p) => p.id === id && p.enabled);
    if (!p) throw new Error("生成连接不存在或已停用");
    return structuredClone(p);
  }
  private key(p: GenerationProviderConfig) {
    const current = this.access.providers.find((config) => config.id === p.id);
    if (
      p.kind !== "codex" &&
      (!current || current.kind !== p.kind || current.endpoint !== p.endpoint)
    )
      throw new Error(
        "历史连接的服务地址已变更或移除，请恢复原连接后继续查询或重试",
      );
    return this.access.keys[p.id] ?? "";
  }
  private input(id: string) {
    const ref = this.catalog.generationGet<StoredInput>(
      "generation_inputs",
      generationId.parse(id),
    );
    if (!ref) throw new Error("参考图或蒙版已不存在");
    return ref;
  }
  private candidate(id: string) {
    const c = this.catalog.generationGet<StoredCandidate>(
      "generation_candidates",
      generationId.parse(id),
    );
    if (!c) throw new Error("候选图已不存在");
    return c;
  }
  private publicCandidate(c: StoredCandidate): GenerationCandidate {
    const { relativePath: _, ...result } = c;
    return result;
  }
  private publicInput(ref: StoredInput): GenerationReference {
    const { relativePath: _, ...result } = ref;
    return result;
  }
  private async persist(run: GenerationRun) {
    run.updatedAt = now();
    this.catalog.generationSave("generation_runs", run);
    await atomicJSON(inside(this.root, `generations/${run.id}/run.json`), run);
    this.runtime.emit("generation.updated", { runId: run.id });
  }
  validate(raw: unknown) {
    const request = generationRequestSchema.parse(raw) as GenerationRequest;
    const p = this.provider(request.providerId),
      cap = p.capabilities;
    if (p.kind === "openai" && !request.model)
      throw new Error("请选择或填写图像模型 ID");
    if (p.models.length && !p.models.includes(request.model))
      throw new Error("所选模型不在连接配置中");
    if (
      request.referenceIds.length &&
      (!cap.references || request.referenceIds.length > cap.maxReferences)
    )
      throw new Error("当前模型不支持这些参考图");
    if (request.maskId && (!cap.mask || !request.referenceIds.length))
      throw new Error("蒙版需要支持局部编辑的模型和一张目标图片");
    if (request.seed !== undefined && !cap.seed)
      throw new Error("当前模型不支持种子参数");
    if (request.transparent && !cap.transparent)
      throw new Error("当前模型不支持透明背景");
    if (request.negativePrompt && !cap.negativePrompt)
      throw new Error("当前模型不支持独立反向提示词，请写入主提示词的约束");
    if (
      p.kind === "runninghub" &&
      (!p.workflowId ||
        (!p.bindings.some((b) => b.role === "prompt") && !p.purposes?.length))
    )
      throw new Error("请先配置工作流 ID，并映射提示词字段");
    for (const refId of request.referenceIds)
      if (this.input(refId).role !== "reference")
        throw new Error("参考图不能使用蒙版文件");
    if (request.maskId) {
      const mask = this.input(request.maskId),
        original = this.input(request.referenceIds[0]);
      if (
        mask.role !== "mask" ||
        mask.width !== original.width ||
        mask.height !== original.height
      )
        throw new Error("蒙版必须与第一张参考图尺寸一致");
    }
    if (
      request.projectId &&
      !this.catalog.db
        .prepare("SELECT 1 FROM projects WHERE id=?")
        .get(request.projectId)
    )
      throw new Error("目标项目不存在");
    assertNoSecrets(request.workflowValues);
    for (const key of Object.keys(request.workflowValues ?? {})) {
      if (
        !p.bindings.some(
          (b) => b.role === "custom" && `${b.nodeId}.${b.fieldName}` === key,
        )
      )
        throw new Error("自定义参数没有对应的工作流映射");
    }
    return request;
  }
  async preview(items: unknown[]) {
    const requests = z
      .array(z.unknown())
      .min(1)
      .max(20)
      .parse(items)
      .map((raw) => this.validate(raw));
    const totalCalls = requests.reduce((n, r) => n + r.count, 0);
    if (totalCalls > 20) throw new Error("单批最多生成 20 张，请拆分任务");
    const providers = requests.map((r) => this.provider(r.providerId));
    const currency = providers[0].currency;
    const known = providers.every(
      (p) => p.unitPrice !== undefined && p.currency && p.currency === currency,
    );
    const warnings = ["重复生成会再次消耗额度；相同参数不保证完全相同的图片。"];
    if (!known) warnings.push("部分服务费用未知，请检查平台计费规则。");
    if (providers.some((p) => p.kind !== "codex" && !this.key(p)))
      warnings.push("部分连接未配置 API 密钥，启动前需要保存密钥。");
    if (providers.some((p) => p.kind === "codex"))
      warnings.push("Codex 使用当前登录额度；停止本机进程不保证云端请求撤销。");
    const plan: GenerationPlan = {
      id: uid(),
      items: requests,
      totalCalls,
      estimatedCost: known
        ? requests.reduce((n, r, i) => n + r.count * providers[i].unitPrice!, 0)
        : undefined,
      currency: known ? currency : undefined,
      warnings,
      createdAt: now(),
    };
    this.runtime.plans.set(plan.id, plan);
    return plan;
  }
  recover(job: Job) {
    if (job.type !== "generation") return;
    const run = this.catalog.generationGet<GenerationRun>(
      "generation_runs",
      job.request.runId,
    );
    if (!run) {
      job.status = "failed";
      job.error = "生成记录缺失，未重新提交";
      return;
    }
    // A candidate may have been committed just before the run's candidate IDs were saved.
    const saved = this.catalog
      .generationList<StoredCandidate>("generation_candidates", 100000)
      .filter((c) => c.runId === run.id);
    for (const candidate of saved) {
      const item = run.items[candidate.itemIndex];
      if (item && !item.candidateIds.includes(candidate.id))
        item.candidateIds.push(candidate.id);
    }
    for (const item of run.items)
      if (item.state === "submitting") {
        item.state = item.remoteTaskId ? "submitted" : "uncertain";
        item.error = item.remoteTaskId
          ? undefined
          : "提交时程序中断，请检查提供方任务记录";
      }
    for (const item of run.items)
      if (item.outputCount && item.candidateIds.length >= item.outputCount) {
        item.state = "completed";
        item.error = undefined;
      }
    if (run.items.some((i) => i.state === "uncertain")) {
      job.status = "interrupted";
      job.stage = "需检查远端记录，未重复提交";
    } else job.status = "queued";
    run.status = job.status;
    this.catalog.generationSave("generation_runs", run);
  }
  checkRetry(job: Job, confirmed = false) {
    const run = this.catalog.generationGet<GenerationRun>(
      "generation_runs",
      job.request.runId,
    );
    if (!run) throw new Error("生成记录不存在");
    for (const item of run.items.filter((i) => i.state !== "completed")) {
      this.provider(item.provider.id);
      if (item.provider.kind !== "codex" && !this.key(item.provider))
        throw new Error("请先保存原服务的 API 密钥");
    }
    if (run.items.some((i) => i.state === "uncertain") && !confirmed)
      throw new Error("请先检查平台任务记录，确认未成功后再重新提交");
    return run;
  }
  prepareRetry(job: Job, confirmed = false) {
    const run = this.checkRetry(job, confirmed);
    for (const item of run.items)
      if (["failed", "uncertain", "cancelled"].includes(item.state)) {
        if (
          item.error?.startsWith("REMOTE_FAILED:") ||
          item.remoteCancellation === "cancelled"
        ) {
          item.remoteTaskId = undefined;
          item.outputUrls = undefined;
        }
        item.state = item.outputUrls?.length
          ? "retrieved"
          : item.remoteTaskId
            ? "submitted"
            : "prepared";
        item.error = undefined;
        item.remoteCancellation = undefined;
      }
    run.status = "queued";
    this.catalog.generationSave("generation_runs", run);
  }
  async cancel(job: Job) {
    this.controllers.get(job.id)?.abort();
    if (job.type !== "generation") return;
    while (this.controllers.has(job.id))
      await new Promise((resolve) => setTimeout(resolve, 20));
    const run = this.catalog.generationGet<GenerationRun>(
      "generation_runs",
      job.request.runId,
    );
    if (!run) return;
    const messages: string[] = [];
    for (const [index, item] of run.items.entries())
      if (!["completed", "failed"].includes(item.state)) {
        let result: GenerationItem["remoteCancellation"] = "unsupported";
        const adapter = this.adapters[item.provider.kind];
        if (item.remoteTaskId && adapter.cancel) {
          try {
            await adapter.cancel(
              item.provider,
              this.key(item.provider),
              item.remoteTaskId,
            );
            result = "cancelled";
          } catch (e) {
            result = "unconfirmed";
            messages.push(
              `远端取消未确认：${redactGenerationError(e, this.key(item.provider))}`,
            );
          }
        } else if (item.state === "prepared") result = "cancelled";
        else
          messages.push(
            "本机已停止；提供方不支持撤销或尚未返回任务 ID，云端调用可能继续",
          );
        const latest = this.catalog.generationGet<GenerationRun>(
          "generation_runs",
          run.id,
        )!;
        latest.items[index].remoteCancellation = result;
        if (result === "cancelled") latest.items[index].state = "cancelled";
        latest.status = "cancelled";
        await this.persist(latest);
      }
    job.cancellation = {
      remoteSupported: run.items.every(
        (i) => i.provider.capabilities.cancelRemote,
      ),
      message: messages.join("；") || "已停止未完成项目，远端取消已确认",
    };
    await this.catalog.snapshot();
  }
  async handle(method: string, input: any): Promise<any> {
    switch (method) {
      case "generation.providers.test": {
        const p = this.provider(generationId.parse(input.id));
        return this.adapters[p.kind].check(p, this.key(p));
      }
      case "generation.providers.workflow": {
        const p = this.provider(generationId.parse(input.id));
        return fetchRunningHubWorkflow(p, this.key(p));
      }
      case "generation.providers.busy": {
        const providerId = generationId.parse(input.id);
        if (
          this.catalog
            .generationList<any>("processing_save_proposals", 100000)
            .some(
              (p) =>
                p.providerId === providerId &&
                ["queued", "analyzing"].includes(p.state),
            )
        )
          return true;
        if (
          this.catalog
            .generationList<any>("processing_runs", 100000)
            .some(
              (r) =>
                ["queued", "running", "paused"].includes(r.status) &&
                (r.plan.providers.some((p: any) => p.id === providerId) ||
                  (r.plan.sessionId &&
                    this.catalog.generationGet<any>(
                      "agent_sessions",
                      r.plan.sessionId,
                    )?.providerId === providerId)),
            )
        )
          return true;
        const agentJobs = this.catalog.db
          .prepare(
            "SELECT data FROM jobs WHERE json_extract(data,'$.type') IN ('processing-assistant','processing-review') AND json_extract(data,'$.status') IN ('queued','running','paused')",
          )
          .all();
        if (
          agentJobs.some(
            (row: any) =>
              this.catalog.generationGet<any>(
                "agent_sessions",
                JSON.parse(row.data).request.sessionId,
              )?.providerId === providerId,
          )
        )
          return true;
        const id = generationId.parse(input.id);
        const runs = this.catalog.db
          .prepare(
            "SELECT data FROM generation_runs WHERE json_extract(data,'$.status') IN ('queued','running','paused')",
          )
          .all();
        if (
          runs.some((row: any) =>
            JSON.parse(row.data).items.some(
              (i: GenerationItem) => i.provider.id === id,
            ),
          )
        )
          return true;
        return (
          this.access.providers.some(
            (p) => p.id === id && p.kind === "codex",
          ) &&
          this.catalog.db
            .prepare(
              "SELECT 1 FROM jobs WHERE json_extract(data,'$.type')='generation-assistant' AND json_extract(data,'$.status') IN ('queued','running','paused') LIMIT 1",
            )
            .get() !== undefined
        );
      }
      case "generation.inputs.add": {
        let bytes: Buffer,
          name: string,
          sourceAssetId: string | undefined,
          sourceCandidateId: string | undefined;
        if (input.assetId) {
          const a = this.catalog.get(generationId.parse(input.assetId));
          bytes = await fs.readFile(sourcePath(this.catalog, a));
          name = a.title;
          sourceAssetId = a.id;
        } else if (input.candidateId) {
          const c = this.candidate(input.candidateId);
          bytes = await fs.readFile(inside(this.root, c.relativePath));
          name = c.title;
          sourceCandidateId = c.id;
        } else {
          const filename = z.string().min(1).max(3000).parse(input.filePath);
          const stat = await fs.lstat(filename);
          if (
            !stat.isFile() ||
            stat.isSymbolicLink() ||
            stat.size > 64 * 1024 * 1024
          )
            throw new Error("请选择不超过 64 MiB 的真实图片");
          bytes = await fs.readFile(filename);
          name = path.basename(filename);
        }
        const png = await sharp(bytes, { limitInputPixels: 32 * 1024 * 1024 })
          .rotate()
          .png()
          .toBuffer();
        return this.saveInput(png, name, "reference", {
          sourceAssetId,
          sourceCandidateId,
        });
      }
      case "generation.inputs.list":
        return this.catalog
          .generationList<StoredInput>("generation_inputs", 200)
          .filter((r) => r.role === "reference")
          .map((r) => this.publicInput(r));
      case "generation.inputs.get":
        return z
          .array(generationId)
          .max(17)
          .parse(input.ids)
          .map((id) => this.publicInput(this.input(id)));
      case "generation.mask.save": {
        const original = this.input(input.referenceId);
        if (original.role !== "reference") throw new Error("蒙版必须绑定原图");
        const base64 = z
          .string()
          .min(1)
          .max(90 * 1024 * 1024)
          .parse(input.base64)
          .replace(/^data:image\/png;base64,/, "");
        const bytes = Buffer.from(base64, "base64");
        const info = await sharp(bytes, {
          limitInputPixels: 32 * 1024 * 1024,
        }).metadata();
        if (
          info.format !== "png" ||
          !info.hasAlpha ||
          info.width !== original.width ||
          info.height !== original.height
        )
          throw new Error("蒙版须为与原图同尺寸的 RGBA PNG");
        await sharp(bytes, { limitInputPixels: 32 * 1024 * 1024 }).stats();
        return this.saveInput(bytes, "局部修改蒙版", "mask", {});
      }
      case "generation.files.resolve": {
        const id = generationId.parse(input.id);
        const row =
          input.kind === "input" ? this.input(id) : this.candidate(id);
        return inside(this.root, row.relativePath);
      }
      case "generation.preview":
        return this.preview(input.items);
      case "generation.start": {
        const saved = this.runtime.plans.get(
          generationId.parse(input.planId),
        ) as GenerationPlan;
        if (
          !saved?.items ||
          Date.now() - Date.parse(saved.createdAt) > 30 * 60000
        )
          throw new Error("方案已过期，请重新预览");
        const plan = await this.preview(saved.items);
        for (const req of plan.items)
          if (
            this.provider(req.providerId).kind !== "codex" &&
            !this.key(this.provider(req.providerId))
          )
            throw new Error("请先在连接设置保存 API 密钥");
        const runId = uid();
        const items: GenerationItem[] = plan.items.flatMap((req) =>
          Array.from({ length: req.count }, (_, i) => ({
            request: {
              ...req,
              count: 1,
              ...(this.provider(req.providerId).capabilities.seed
                ? {
                    seed:
                      req.seed === undefined
                        ? Math.floor(Math.random() * 2147483647)
                        : req.seed + i,
                  }
                : {}),
            },
            provider: this.provider(req.providerId),
            state: "prepared" as const,
            candidateIds: [],
          })),
        );
        const job = this.runtime.start(
          "generation",
          { runId },
          `生成 ${items.length} 张候选图`,
          (j) => {
            j.cancellation = {
              remoteSupported: items.every(
                (i) => i.provider.capabilities.cancelRemote,
              ),
            };
            if (input.processingLink) {
              const linked = this.catalog.generationGet<any>(
                "processing_runs",
                input.processingLink.runId,
              );
              if (!linked?.items[input.processingLink.index])
                throw new Error("加工关联不存在");
              linked.items[input.processingLink.index].generationRunId = runId;
              linked.items[input.processingLink.index].childJobId = j.id;
              this.catalog.generationSave("processing_runs", linked);
            }
            if (input.familyLink) {
              const b = this.catalog.generationGet<any>(
                "family_batches",
                input.familyLink.batchId,
              );
              const s = b?.segments.find(
                (s: any) => s.id === input.familyLink.segmentId,
              );
              if (!s || s.runId) throw new Error("同类生成关联不存在或已提交");
              s.runId = runId;
              s.jobId = j.id;
              this.catalog.generationSave("family_batches", b);
            }
            this.catalog.generationSave("generation_runs", {
              id: runId,
              jobId: j.id,
              items,
              status: "queued",
              createdAt: now(),
              updatedAt: now(),
            });
          },
        );
        this.runtime.plans.delete(saved.id);
        this.runtime.plans.delete(plan.id);
        return { jobId: job.id, runId };
      }
      case "generation.list":
        return this.catalog.generationList<GenerationRun>(
          "generation_runs",
          100,
        );
      case "generation.detail": {
        const run = this.catalog.generationGet<GenerationRun>(
          "generation_runs",
          generationId.parse(input.id),
        );
        if (!run) throw new Error("生成记录不存在");
        return {
          run,
          candidates: run.items
            .flatMap((i) =>
              i.candidateIds.map((id) =>
                this.catalog.generationGet<StoredCandidate>(
                  "generation_candidates",
                  id,
                ),
              ),
            )
            .filter((c): c is StoredCandidate => !!c)
            .map((c) => this.publicCandidate(c)),
          references: [
            ...new Set(
              run.items.flatMap((i) => [
                ...i.request.referenceIds,
                ...(i.request.maskId ? [i.request.maskId] : []),
              ]),
            ),
          ].map((id) => this.publicInput(this.input(id))),
        };
      }
      case "generation.accept": {
        const ids = [
          ...new Set(
            z.array(generationId).min(1).max(100).parse(input.candidateIds),
          ),
        ];
        const records = ids.map((id) => this.candidate(id));
        const projectId = input.projectId
          ? generationId.parse(input.projectId)
          : undefined;
        if (
          projectId &&
          !this.catalog.db
            .prepare("SELECT 1 FROM projects WHERE id=?")
            .get(projectId)
        )
          throw new Error("目标项目不存在");
        const existing = records.flatMap((c) => c.importedAssetIds ?? []);
        if (projectId && existing.length)
          this.catalog.attach(projectId, existing);
        const pending = records.filter((c) => !c.importedAssetIds?.length);
        if (!pending.length) {
          if (projectId) await this.runtime.changed();
          return { assets: existing };
        }
        const activeImports: { id: string }[] = this.catalog.db
          .prepare(
            "SELECT id FROM jobs WHERE json_extract(data,'$.status') IN ('queued','running','paused')",
          )
          .all();
        const claimed = pending.filter((c) =>
          activeImports.some((j) => j.id === c.importJobId),
        );
        const unclaimed = pending.filter((c) => !claimed.includes(c));
        if (!unclaimed.length) return { jobId: claimed[0].importJobId };
        const job = this.runtime.start(
          "generation-import",
          { candidateIds: unclaimed.map((c) => c.id), projectId },
          `入库 ${unclaimed.length} 张生成图片`,
          (j) =>
            unclaimed.forEach((c) =>
              this.catalog.generationSave("generation_candidates", {
                ...c,
                importJobId: j.id,
              }),
            ),
        );
        return { jobId: job.id };
      }
      case "generation.delete": {
        for (const id of z
          .array(generationId)
          .min(1)
          .max(100)
          .parse(input.candidateIds)) {
          const c = this.candidate(id);
          if (
            this.catalog
              .generationList<any>("family_batches", 10000)
              .some((b) =>
                b.items.some((i: any) => i.selectedCandidateId === id),
              )
          )
            throw new Error("候选已被同类批次选定，保留原始生成来源");
          if (
            this.imports.has(id) ||
            (c.importJobId &&
              this.catalog
                .jobs()
                .some(
                  (j) =>
                    j.id === c.importJobId &&
                    ["queued", "running", "paused"].includes(j.status),
                ))
          )
            throw new Error("候选图正在入库，请等待任务完成");
          await fs.unlink(inside(this.root, c.relativePath)).catch((e: any) => {
            if (e.code !== "ENOENT") throw e;
          });
          this.catalog.db
            .prepare("DELETE FROM generation_candidates WHERE id=?")
            .run(id);
        }
        await this.catalog.snapshot();
        this.runtime.emit("generation.updated", {});
        return true;
      }
      case "generation.templates.list":
        return this.catalog.generationList<GenerationTemplate>(
          "generation_templates",
          200,
        );
      case "generation.templates.save": {
        const template: GenerationTemplate = {
          id: input.id ? generationId.parse(input.id) : uid(),
          name: z.string().trim().min(1).max(100).parse(input.name),
          request: this.validate(input.request),
        };
        this.catalog.generationSave("generation_templates", template);
        await this.catalog.snapshot();
        return template;
      }
      case "generation.templates.delete":
        this.catalog.db
          .prepare("DELETE FROM generation_templates WHERE id=?")
          .run(generationId.parse(input.id));
        await this.catalog.snapshot();
        return true;
      case "generation.assistant.plan": {
        const base = this.validate(input.base);
        const brief = z.string().trim().min(1).max(16000).parse(input.brief);
        if (!this.access.providers.some((p) => p.kind === "codex" && p.enabled))
          throw new Error("制作助手需要启用 Codex 连接");
        return {
          jobId: this.runtime.start(
            "generation-assistant",
            { base, brief },
            "Codex 制作助手正在编写方案",
          ).id,
        };
      }
      default:
        throw new Error(`未知生成操作：${method}`);
    }
  }
  private async saveInput(
    bytes: Buffer,
    name: string,
    role: StoredInput["role"],
    source: Partial<StoredInput>,
  ) {
    const id = uid(),
      relativePath = `generations/inputs/${id}.png`,
      info = await sharp(bytes).metadata();
    await fs.mkdir(path.dirname(inside(this.root, relativePath)), {
      recursive: true,
    });
    await fs.writeFile(inside(this.root, relativePath), bytes);
    const ref: StoredInput = {
      id,
      name: name.slice(0, 100),
      sha256: sha(bytes),
      width: info.width!,
      height: info.height!,
      previewUrl: `workshop://generations/input/${id}`,
      role,
      relativePath,
      ...source,
    };
    this.catalog.generationSave("generation_inputs", ref);
    await this.catalog.snapshot();
    return this.publicInput(ref);
  }
  async execute(ctx: JobContext) {
    if (ctx.job.type === "generation-import") return this.importCandidates(ctx);
    const controller = new AbortController();
    this.controllers.set(ctx.job.id, controller);
    if (ctx.job.type === "generation-assistant") {
      try {
        const p = this.access.providers.find(
          (p) => p.kind === "codex" && p.enabled,
        )!;
        const request = ctx.job.request.base as GenerationRequest;
        const prompts = await codexAssistant(
          p,
          inside(this.root, `generations/assistant-${ctx.job.id}`),
          `需求：${ctx.job.request.brief}\n基础提示词：${request.prompt}\n模型能力：${JSON.stringify(this.provider(request.providerId).capabilities)}\n最多 ${request.count} 条。`,
          controller.signal,
          request.referenceIds.map((id) =>
            inside(this.root, this.input(id).relativePath),
          ),
        );
        await ctx.check();
        return {
          plan: await this.preview(
            prompts
              .slice(0, request.count)
              .map((prompt) => ({ ...request, prompt, count: 1 })),
          ),
        };
      } finally {
        this.controllers.delete(ctx.job.id);
      }
    }
    const run = this.catalog.generationGet<GenerationRun>(
      "generation_runs",
      ctx.job.request.runId,
    )!;
    run.status = "running";
    await this.persist(run);
    try {
      for (let index = 0; index < run.items.length; index++) {
        await ctx.check();
        const item = run.items[index];
        if (["completed", "failed", "cancelled"].includes(item.state)) continue;
        if (item.state === "uncertain") continue;
        const key = this.key(item.provider);
        try {
          const directory = inside(
            this.root,
            `generations/${run.id}/work-${index}-${uid()}`,
          );
          await fs.mkdir(directory, { recursive: true });
          let buffers: Buffer[];
          if (item.outputUrls?.length)
            buffers = await Promise.all(
              item.outputUrls.map((url) =>
                downloadGenerationImage(url, controller.signal),
              ),
            );
          else {
            // Persist the submission boundary before any request can reach the provider.
            item.state = item.remoteTaskId ? "submitted" : "submitting";
            await this.persist(run);
            buffers = await this.adapters[item.provider.kind].generate({
              provider: item.provider,
              request: item.request,
              key,
              outputDirectory: directory,
              inputFiles: item.request.referenceIds.map((id) =>
                inside(this.root, this.input(id).relativePath),
              ),
              maskFile: item.request.maskId
                ? inside(
                    this.root,
                    this.input(item.request.maskId).relativePath,
                  )
                : undefined,
              signal: controller.signal,
              remoteTaskId: item.remoteTaskId,
              outputUrls: item.outputUrls,
              submitted: async (taskId) => {
                item.remoteTaskId = taskId;
                item.state = "submitted";
                await this.persist(run);
              },
              outputs: async (urls) => {
                item.outputUrls = urls;
                item.state = "retrieved";
                await this.persist(run);
              },
              progress: (stage) =>
                ctx.progress(
                  stage,
                  run.items.filter((i) => i.state === "completed").length,
                  run.items.length,
                ),
            });
          }
          await ctx.check();
          if (controller.signal.aborted)
            throw new WorkshopError("CANCELLED", "任务已停止");
          if (!buffers.length) throw new Error("服务没有返回图片");
          item.outputCount = buffers.length;
          await this.persist(run);
          for (
            let outputIndex = 0;
            outputIndex < buffers.length;
            outputIndex++
          ) {
            await ctx.check();
            const id = `${run.id}-${index}-${outputIndex}`;
            if (!this.catalog.generationGet("generation_candidates", id)) {
              const raw = buffers[outputIndex];
              if (raw.length > 64 * 1024 * 1024)
                throw new Error("图片超过 64 MiB");
              const info = await sharp(raw, {
                limitInputPixels: 32 * 1024 * 1024,
              }).metadata();
              if (!["png", "jpeg", "webp"].includes(info.format ?? ""))
                throw new Error("服务输出不是 PNG、JPEG 或 WebP 图片");
              await sharp(raw, { limitInputPixels: 32 * 1024 * 1024 }).stats();
              const relativePath = `generations/${run.id}/outputs/${id}.${info.format === "jpeg" ? "jpg" : info.format}`;
              await fs.mkdir(path.dirname(inside(this.root, relativePath)), {
                recursive: true,
              });
              await fs.writeFile(inside(this.root, relativePath), raw);
              this.catalog.generationSave("generation_candidates", {
                id,
                runId: run.id,
                itemIndex: index,
                title: item.request.prompt.slice(0, 48),
                width: info.width!,
                height: info.height!,
                sha256: sha(raw),
                bytes: raw.length,
                previewUrl: `workshop://generations/candidate/${id}`,
                createdAt: now(),
                parentCandidateId: item.request.parentCandidateId,
                relativePath,
              });
            }
            if (!item.candidateIds.includes(id)) item.candidateIds.push(id);
            await this.persist(run);
          }
          item.state = "completed";
          item.error = undefined;
          await this.persist(run);
        } catch (error: any) {
          if (controller.signal.aborted)
            throw new WorkshopError("CANCELLED", "任务已停止");
          const definitive =
            error.code === "RH_REJECTED" ||
            error.code === "REMOTE_FAILED" ||
            /^HTTP_4/.test(error.code ?? "");
          item.state =
            item.remoteTaskId ||
            item.outputUrls?.length ||
            definitive ||
            item.state === "prepared"
              ? "failed"
              : "uncertain";
          item.error = `${error.code ?? "GENERATION"}: ${redactGenerationError(error, key)}`;
          await this.persist(run);
        }
      }
      await ctx.check();
      if (controller.signal.aborted)
        throw new WorkshopError("CANCELLED", "任务已停止");
      run.status = run.items.some((i) => i.state === "uncertain")
        ? "interrupted"
        : run.items.some((i) => i.state === "failed")
          ? "failed"
          : "completed";
      ctx.job.status = run.status;
      if (run.status !== "completed")
        ctx.job.error = run.items
          .filter((i) => i.error)
          .map((i) => i.error)
          .join("\n")
          .slice(0, 4000);
      return {
        runId: run.id,
        candidates: run.items.flatMap((i) => i.candidateIds),
        target: inside(this.root, `generations/${run.id}`),
      };
    } catch (error: any) {
      if (this.runtime.shuttingDown)
        error = new WorkshopError("SHUTDOWN", "生成任务将在下次启动时检查恢复");
      for (const item of run.items)
        if (item.state === "submitting" && !item.remoteTaskId)
          item.state = "uncertain";
      run.status =
        error.code === "SHUTDOWN"
          ? run.items.some((i) => i.state === "uncertain")
            ? "interrupted"
            : "queued"
          : "cancelled";
      throw error;
    } finally {
      try {
        await this.persist(run);
        await this.catalog.snapshot();
      } finally {
        this.controllers.delete(ctx.job.id);
      }
    }
  }
  private async importCandidates(ctx: JobContext) {
    const assetIds: string[] = [];
    for (const [index, id] of (
      ctx.job.request.candidateIds as string[]
    ).entries()) {
      await ctx.check();
      const c = this.candidate(id);
      if (c.importedAssetIds?.length) {
        assetIds.push(...c.importedAssetIds);
        continue;
      }
      if (this.imports.has(id)) throw new Error("候选图已由另一任务入库");
      this.imports.add(id);
      try {
        const run = this.catalog.generationGet<GenerationRun>(
            "generation_runs",
            c.runId,
          )!,
          item = run.items[c.itemIndex];
        const request = item.request;
        const provenance = this.candidateProvenance(c.id);
        const plan = await inspectImport([inside(this.root, c.relativePath)]);
        Object.assign(plan, {
          generation: provenance,
          category: request.category,
          tags: request.tags,
          projectId: ctx.job.request.projectId ?? request.projectId,
          source: {
            provider: item.provider.kind,
            pageUrl:
              item.provider.kind === "runninghub"
                ? `${item.provider.endpoint}/workflow/${item.provider.workflowId}`
                : "https://learn.chatgpt.com/docs/image-generation",
            author: "用户生成",
            license: "使用权以模型及平台条款为准",
            evidence: "AI 生成素材；保留生成参数与输入哈希。",
          },
        });
        const childCtx: JobContext = {
          ...ctx,
          job: { ...ctx.job, id: `${ctx.job.id}-${index}` },
        };
        const result = await runImport(this.catalog, plan, childCtx);
        c.importedAssetIds = result.assets;
        c.importJobId = undefined;
        this.catalog.generationSave("generation_candidates", c);
        assetIds.push(...result.assets);
        await this.catalog.snapshot();
        ctx.progress(
          "将选中候选加入素材库",
          index + 1,
          ctx.job.request.candidateIds.length,
        );
      } finally {
        this.imports.delete(id);
      }
    }
    await this.runtime.changed();
    this.runtime.emit("generation.updated", {});
    return { assets: assetIds };
  }
}
