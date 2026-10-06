import fs from "node:fs/promises";
import sharp from "sharp";
import { z } from "zod";
import type { Runtime } from "./runtime";
import type { JobContext } from "./importer";
import { now, uid, WorkshopError } from "./files";
import { parseOperations } from "./processing-tools";
import type {
  GenerationRun,
  GenerationCandidate,
  GenerationRequest,
} from "../shared/generation";
import type {
  AssetFamilyTemplate,
  AssetFamilyBatch,
  AssetFamilyRow,
  FamilySegment,
  FamilyPlan,
  FamilyDetail,
} from "../shared/families";
import { familyIconOperations } from "../shared/families";
const id = z.string().min(1).max(100);
const rowSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/)
    .max(80),
  name: z.string().trim().min(1).max(100),
  subject: z.string().trim().min(1).max(2000),
  accent: z.string().max(500).default(""),
  motif: z.string().max(1000).default(""),
  count: z.number().int().min(1).max(4).default(2),
  category: z
    .enum([
      "concept",
      "ui",
      "controls",
      "sprite",
      "texture",
      "model",
      "animation",
      "environment",
      "other",
    ])
    .default("ui"),
});
const terminal = ["completed", "failed", "cancelled", "interrupted"];
const rowUpdateSchema = rowSchema
  .omit({ count: true, category: true, accent: true, motif: true })
  .extend({
    count: z.number().int().min(1).max(4),
    accent: z.string().max(500),
    motif: z.string().max(1000),
    category: z.enum([
      "concept",
      "ui",
      "controls",
      "sprite",
      "texture",
      "model",
      "animation",
      "environment",
      "other",
    ]),
  })
  .partial()
  .required({ key: true });
export class FamilyService {
  constructor(private runtime: Runtime) {}
  private get catalog() {
    return this.runtime.catalog;
  }
  private getBatch(value: unknown) {
    const b = this.catalog.generationGet<AssetFamilyBatch>(
      "family_batches",
      id.parse(value),
    );
    if (!b) throw new Error("同类批次不存在");
    return b;
  }
  private busy(b: AssetFamilyBatch) {
    return (
      !!b.jobId &&
      this.catalog
        .jobs()
        .some((j) => j.id === b.jobId && !terminal.includes(j.status))
    );
  }
  private imported(item: AssetFamilyBatch["items"][number]) {
    return item.outputs?.some(
      (o) =>
        o.assetIds.length ||
        this.catalog.generationGet<any>("processing_artifacts", o.artifactId)
          ?.importedAssetIds?.length,
    );
  }
  private async save(b: AssetFamilyBatch) {
    b.updatedAt = now();
    this.catalog.generationSave("family_batches", b);
    await this.catalog.snapshot();
    this.runtime.emit("family.updated", { batchId: b.id });
  }
  private candidates(b: AssetFamilyBatch) {
    const records: FamilyDetail["candidates"] = Object.fromEntries(
      b.items.map((i) => [i.key, []]),
    );
    for (const segment of b.segments) {
      const run = segment.runId
        ? this.catalog.generationGet<GenerationRun>(
            "generation_runs",
            segment.runId,
          )
        : undefined;
      run?.items.forEach((item, index) => {
        const key = segment.keys[index];
        if (!records[key]) return;
        for (const cId of item.candidateIds) {
          const c = this.catalog.generationGet<GenerationCandidate>(
            "generation_candidates",
            cId,
          );
          if (c && !records[key].some((existing) => existing.id === c.id)) {
            const {
              id,
              runId,
              itemIndex,
              title,
              width,
              height,
              sha256,
              bytes,
              previewUrl,
              createdAt,
              parentCandidateId,
            } = c;
            records[key].push({
              id,
              runId,
              itemIndex,
              title,
              width,
              height,
              sha256,
              bytes,
              previewUrl,
              createdAt,
              parentCandidateId,
            });
          }
        }
      });
    }
    return records;
  }
  private progress(b: AssetFamilyBatch) {
    const result: FamilyDetail["progress"] = Object.fromEntries(
      b.items.map((i) => [
        i.key,
        { completed: 0, pending: 0, running: 0, failed: 0, errors: [] },
      ]),
    );
    for (const segment of b.segments) {
      const run = segment.runId
        ? this.catalog.generationGet<GenerationRun>(
            "generation_runs",
            segment.runId,
          )
        : undefined;
      segment.keys.forEach((key, index) => {
        const row = result[key];
        if (!row) return;
        const item = run?.items[index];
        if (!item || item.state === "prepared") row.pending++;
        else if (item.state === "completed") row.completed++;
        else if (["failed", "uncertain", "cancelled"].includes(item.state)) {
          row.failed++;
          if (item.error && !row.errors.includes(item.error))
            row.errors.push(item.error);
        } else row.running++;
      });
    }
    return result;
  }
  async handle(method: string, raw: any): Promise<any> {
    if (method === "families.templates.list") {
      const all = this.catalog.generationList<AssetFamilyTemplate>(
        "family_templates",
        10000,
      );
      return all.filter(
        (t) =>
          !all.some((n) => n.familyId === t.familyId && n.version > t.version),
      );
    }
    if (method === "families.templates.save") {
      const old = raw.id
        ? this.catalog.generationGet<AssetFamilyTemplate>(
            "family_templates",
            id.parse(raw.id),
          )
        : undefined;
      if (raw.id && !old) throw new Error("模板不存在");
      const base = this.runtime.generation.validate({
        ...raw.base,
        prompt: raw.base?.prompt || "制作清单中指定的单个物件",
      });
      const operations = parseOperations(
        raw.operations ?? familyIconOperations,
      );
      if (operations.some((op) => op.type === "ai"))
        throw new Error("同类模板的加工配方只使用本地工具；AI修改请从候选继续");
      const version = old
        ? Math.max(
            ...this.catalog
              .generationList<AssetFamilyTemplate>("family_templates", 10000)
              .filter((t) => t.familyId === old.familyId)
              .map((t) => t.version),
          ) + 1
        : 1;
      const template: AssetFamilyTemplate = {
        id: uid(),
        familyId: old?.familyId ?? uid(),
        version,
        name: z.string().trim().min(1).max(100).parse(raw.name),
        style: z.string().trim().min(1).max(8000).parse(raw.style),
        base,
        operations,
        createdAt: now(),
      };
      this.catalog.generationSave("family_templates", template);
      await this.catalog.snapshot();
      return template;
    }
    if (method === "families.batches.list")
      return this.catalog.generationList<AssetFamilyBatch>(
        "family_batches",
        200,
      );
    if (method === "families.batches.create") {
      const template = this.catalog.generationGet<AssetFamilyTemplate>(
        "family_templates",
        id.parse(raw.templateId),
      );
      if (!template) throw new Error("模板不存在");
      const items = z.array(rowSchema).min(1).max(100).parse(raw.items);
      if (new Set(items.map((i) => i.key)).size !== items.length)
        throw new Error("条目ID不能重复");
      const projectId = raw.projectId
        ? id.parse(raw.projectId)
        : template.base.projectId;
      if (projectId && !this.catalog.projects().some((p) => p.id === projectId))
        throw new Error("目标项目不存在");
      const batch: AssetFamilyBatch = {
        id: uid(),
        template,
        items,
        projectId,
        segments: [],
        createdAt: now(),
        updatedAt: now(),
      };
      if (raw.sourceBatchId) {
        const source = this.getBatch(raw.sourceBatchId);
        batch.segments = source.segments;
        for (const item of batch.items) {
          const old = source.items.find(
            (i) => i.key === item.key && i.subject === item.subject,
          );
          if (old?.selectedCandidateId)
            item.selectedCandidateId = old.selectedCandidateId;
        }
      }
      await this.save(batch);
      return batch;
    }
    if (method === "families.batches.detail") {
      const batch = this.getBatch(raw.id);
      return {
        batch,
        candidates: this.candidates(batch),
        progress: this.progress(batch),
      } satisfies FamilyDetail;
    }
    const b = this.getBatch(raw.batchId);
    if (method === "families.batches.select") {
      if (
        this.busy(b) &&
        this.catalog.jobs().find((j) => j.id === b.jobId)?.type !==
          "family-generate"
      )
        throw new Error("请等待当前加工或保存完成再选择候选");
      const item = b.items.find((i) => i.key === raw.key);
      if (!item) throw new Error("条目不存在");
      if (this.imported(item))
        throw new Error("条目已保存；制作新版本请复制清单创建新批次");
      if (!this.candidates(b)[item.key].some((c) => c.id === raw.candidateId))
        throw new Error("候选不属于此条目");
      if (item.selectedCandidateId !== raw.candidateId) {
        item.selectedCandidateId = raw.candidateId;
        item.processingRunId = undefined;
        item.inputId = undefined;
        item.outputs = undefined;
        item.proposalId = undefined;
        item.importJobId = undefined;
        item.error = undefined;
      }
      await this.save(b);
      return b;
    }
    if (method === "families.batches.update") {
      if (this.busy(b)) throw new Error("请等待当前任务完成");
      if (raw.projectId !== undefined) {
        if (b.items.some((i) => this.imported(i)))
          throw new Error("已保存批次的项目归属请在素材库修改");
        const projectId = z.string().max(100).parse(raw.projectId);
        if (
          projectId &&
          !this.catalog.projects().some((p) => p.id === projectId)
        )
          throw new Error("目标项目不存在");
        b.projectId = projectId || undefined;
      }
      const patches = z.array(rowUpdateSchema).max(100).parse(raw.items);
      for (const patch of patches) {
        const item = b.items.find((i) => i.key === patch.key);
        if (!item) throw new Error("条目不存在");
        if (this.imported(item))
          throw new Error("已保存条目的名称与规格不能在批次内改写");
        Object.assign(item, patch);
      }
      await this.save(b);
      return b;
    }
    if (method === "families.generate.preview") {
      if (this.busy(b)) throw new Error("当前批次仍有任务在执行");
      const keys = z
        .array(id)
        .max(100)
        .parse(
          raw.keys ??
            b.items.filter((i) => !i.selectedCandidateId).map((i) => i.key),
        );
      const instruction = z
        .string()
        .max(2000)
        .parse(raw.instruction ?? "");
      if (!keys.length || new Set(keys).size !== keys.length)
        throw new Error("请选择未完成的条目");
      let referenceIds = b.template.base.referenceIds;
      let parentCandidateId: string | undefined;
      if (raw.continueKey) {
        const item = b.items.find((i) => i.key === raw.continueKey);
        if (
          !item?.selectedCandidateId ||
          keys.length !== 1 ||
          keys[0] !== item.key
        )
          throw new Error("继续修改需要选择一个条目的候选");
        parentCandidateId = item.selectedCandidateId;
        const ref = await this.runtime.generation.handle(
          "generation.inputs.add",
          { candidateId: parentCandidateId },
        );
        referenceIds = [ref.id];
      }
      const segments: FamilySegment[] = [];
      let segment: FamilySegment = { id: uid(), keys: [], requests: [] };
      for (const key of keys) {
        const item = b.items.find((i) => i.key === key);
        if (!item) throw new Error("清单中不存在该条目");
        if (this.imported(item))
          throw new Error("已保存条目请创建新批次后重做");
        if (segment.keys.length + item.count > 20) {
          segments.push(segment);
          segment = { id: uid(), keys: [], requests: [] };
        }
        const request: GenerationRequest = {
          ...b.template.base,
          referenceIds,
          parentCandidateId,
          projectId: b.projectId,
          count: item.count,
          category: item.category,
          prompt: [
            b.template.style,
            b.template.base.prompt,
            `条目名称：${item.name}。主体：${item.subject}。点缀：${item.accent}。装饰与意象：${item.motif}。`,
            instruction,
          ]
            .filter(Boolean)
            .join("\n"),
          tags: [
            ...new Set([...b.template.base.tags, "同类素材", item.key]),
          ].slice(0, 40),
        };
        segment.requests.push(request);
        segment.keys.push(...Array(item.count).fill(item.key));
      }
      if (segment.requests.length) segments.push(segment);
      const plans = await Promise.all(
        segments.map((s) => this.runtime.generation.preview(s.requests)),
      );
      const sameCurrency = plans.every(
        (p) =>
          p.estimatedCost !== undefined && p.currency === plans[0].currency,
      );
      const plan: FamilyPlan = {
        id: uid(),
        batchId: b.id,
        segments,
        totalCalls: plans.reduce((n, p) => n + p.totalCalls, 0),
        ...(sameCurrency
          ? {
              estimatedCost: plans.reduce((n, p) => n + p.estimatedCost!, 0),
              currency: plans[0].currency,
            }
          : {}),
        warnings: [...new Set(plans.flatMap((p) => p.warnings))],
        createdAt: now(),
      };
      plans.forEach((p) => this.runtime.plans.delete(p.id));
      this.runtime.plans.set(plan.id, {
        ...plan,
        batchSnapshot: JSON.stringify(b),
        providerSnapshot: structuredClone(
          this.runtime.generationAccess.providers,
        ),
      });
      return plan;
    }
    if (method === "families.generate.start") {
      if (this.busy(b)) return { jobId: b.jobId, batchId: b.id };
      const plan = this.runtime.plans.get(id.parse(raw.planId));
      if (
        !plan?.segments ||
        plan.batchId !== b.id ||
        Date.now() - Date.parse(plan.createdAt) > 30 * 60000
      )
        throw new Error("方案过期，请重新检查");
      if (plan.batchSnapshot !== JSON.stringify(b))
        throw new Error("清单已改变，请重新检查方案");
      if (
        JSON.stringify(plan.providerSnapshot) !==
        JSON.stringify(this.runtime.generationAccess.providers)
      )
        throw new Error("连接已改变，请重新检查方案");
      const job = this.runtime.start(
        "family-generate",
        {
          batchId: b.id,
          segments: plan.segments,
          providers: plan.providerSnapshot,
        },
        `${b.template.name} · 生成 ${plan.totalCalls} 个候选`,
        (j) => {
          b.jobId = j.id;
          b.segments.push(...plan.segments);
          this.catalog.generationSave("family_batches", b);
        },
      );
      this.runtime.plans.delete(plan.id);
      return { jobId: job.id, batchId: b.id };
    }
    if (method === "families.analyze.preview") {
      const artifactIds = b.items.flatMap(
        (i) =>
          i.outputs?.filter((o) => o.size === 512).map((o) => o.artifactId) ??
          [],
      );
      if (!artifactIds.length) throw new Error("请先加工选定结果");
      return this.runtime.processing.handle("processing.organize.preview", {
        artifactIds,
        context: { projectId: b.projectId },
        brief: `${b.template.name}：核对条目主体与风格，名称与分类由模板确定`,
        fresh: true,
      });
    }
    if (
      method === "families.save.start" ||
      method === "families.prepare.start"
    ) {
      if (this.busy(b)) return { jobId: b.jobId };
      if (!b.items.some((i) => i.selectedCandidateId))
        throw new Error("请逐项选择满意候选");
      const prepare = method === "families.prepare.start";
      const job = this.runtime.start(
        prepare ? "family-prepare" : "family-save",
        { batchId: b.id },
        `${b.template.name} · ${prepare ? "加工选定结果" : "整理入库"}`,
        (j) => {
          b.jobId = j.id;
          this.catalog.generationSave("family_batches", b);
        },
      );
      return { jobId: job.id };
    }
    if (method === "families.export.inspect") {
      const assetIds = b.items.flatMap(
        (i) => i.outputs?.flatMap((o) => o.assetIds) ?? [],
      );
      if (!assetIds.length) throw new Error("请先保存选定素材");
      return this.runtime.handle("exports.inspect", {
        assetIds,
        target: raw.target,
        mode: raw.mode ?? "godot",
        aggregate: true,
        familyBatchId: b.id,
      });
    }
    throw new Error(`未知同类素材操作：${method}`);
  }
  private async waitChild(ctx: JobContext, jobId: string) {
    while (true) {
      await ctx.check();
      const job = this.catalog.jobs().find((j) => j.id === jobId);
      if (!job) throw new Error("关联任务不存在");
      if (terminal.includes(job.status)) {
        if (job.status !== "completed")
          throw new Error(job.error ?? "关联任务未完成，请查看任务列表后重试");
        return job.result;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  recover(job: import("../shared/types").Job) {
    if (job.type === "family-generate") {
      job.status = "interrupted";
      job.stage = "请核对已提交候选后重试未完成项";
    }
  }
  async retry(job: import("../shared/types").Job, confirmUnknown?: boolean) {
    const b = this.getBatch(job.request.batchId);
    if (this.busy(b) && b.jobId !== job.id)
      throw new Error("批次仍有任务在执行");
    const children = (
      job.type === "family-generate" ? job.request.segments : []
    )
      .map((s: FamilySegment) => b.segments.find((x) => x.id === s.id)?.jobId)
      .filter(Boolean);
    // Check uncertain submissions before restarting any child, so a rejected retry has no side effects.
    for (const childId of children) {
      const child = this.catalog.jobs().find((j) => j.id === childId)!;
      if (["failed", "cancelled", "interrupted"].includes(child.status))
        this.runtime.generation.checkRetry(child, confirmUnknown);
    }
    for (const childId of children) {
      const child = this.catalog.jobs().find((j) => j.id === childId)!;
      if (["failed", "cancelled", "interrupted"].includes(child.status))
        await this.runtime.handle("jobs.control", {
          id: childId,
          action: "retry",
          confirmUnknown,
        });
    }
    b.jobId = job.id;
    await this.save(b);
  }
  async cancel(job: import("../shared/types").Job) {
    const b = this.getBatch(job.request.batchId);
    const children =
      job.type === "family-generate"
        ? (job.request.segments as FamilySegment[]).map(
            (s) => b.segments.find((x) => x.id === s.id)?.jobId,
          )
        : b.items.flatMap((i) => [
            i.importJobId,
            i.processingRunId
              ? this.catalog.generationGet<any>(
                  "processing_runs",
                  i.processingRunId,
                )?.jobId
              : undefined,
          ]);
    for (const childId of children.filter(Boolean)) {
      const child = this.catalog.jobs().find((j) => j.id === childId);
      if (child && !terminal.includes(child.status))
        await this.runtime.handle("jobs.control", {
          id: childId,
          action: "cancel",
        });
    }
  }
  async execute(ctx: JobContext) {
    const batchId: string = ctx.job.request.batchId;
    if (ctx.job.type === "family-generate") {
      for (const [index, original] of (
        ctx.job.request.segments as FamilySegment[]
      ).entries()) {
        await ctx.check();
        const b = this.getBatch(batchId),
          segment = b.segments.find((s) => s.id === original.id)!;
        if (!segment.runId) {
          if (
            JSON.stringify(ctx.job.request.providers) !==
            JSON.stringify(this.runtime.generationAccess.providers)
          )
            throw new Error("生成连接已改变，未提交后续条目");
          const plan = await this.runtime.generation.preview(segment.requests);
          await this.runtime.generation.handle("generation.start", {
            planId: plan.id,
            familyLink: { batchId, segmentId: segment.id },
          });
        }
        const linked = this.getBatch(batchId).segments.find(
          (s) => s.id === original.id,
        )!;
        ctx.progress(
          `正在生成同类候选 · 第 ${index + 1}/${ctx.job.request.segments.length} 批`,
          index,
          ctx.job.request.segments.length,
        );
        await this.waitChild(ctx, linked.jobId!);
        ctx.progress(
          "已保存同类候选",
          index + 1,
          ctx.job.request.segments.length,
        );
      }
      return { batchId };
    }
    const errors: string[] = [];
    const initial = this.getBatch(batchId);
    for (const [index, current] of initial.items.entries()) {
      if (!current.selectedCandidateId) continue;
      await ctx.check();
      try {
        let b = this.getBatch(batchId),
          item = b.items[index];
        if (item.outputs?.every((o) => o.assetIds.length)) continue;
        if (!item.processingRunId) {
          const file = await this.runtime.generation.handle(
            "generation.files.resolve",
            { id: item.selectedCandidateId, kind: "candidate" },
          );
          const info = await sharp(await fs.readFile(file))
            .ensureAlpha()
            .stats();
          if (info.channels[3].min !== 0 || info.channels[3].max === 0)
            throw new Error(
              "候选需要真实透明背景和可见主体，请加工或选择其他候选",
            );
          const input = await this.runtime.processing.addInput({
            source: { kind: "candidate", id: item.selectedCandidateId },
          });
          item.inputId = input.id;
          await this.save(b);
          const plan = await this.runtime.processing.preview({
            inputIds: [input.id],
            operations: b.template.operations,
          });
          const run = await this.runtime.processing.handle("processing.start", {
            planId: plan.id,
            familyLink: { batchId, key: item.key },
          });
          await this.waitChild(ctx, run.jobId);
        } else {
          const run = this.catalog.generationGet<any>(
            "processing_runs",
            item.processingRunId,
          )!;
          if (run.status !== "completed") {
            const job = this.catalog.jobs().find((j) => j.id === run.jobId)!;
            if (terminal.includes(job.status))
              await this.runtime.handle("jobs.control", {
                id: job.id,
                action: "retry",
              });
            await this.waitChild(ctx, run.jobId);
          }
        }
        b = this.getBatch(batchId);
        item = b.items[index];
        if (!item.outputs) {
          const result = await this.runtime.processing.handle(
            "processing.detail",
            { id: item.processingRunId },
          );
          const artifacts = result.artifacts;
          item.outputs = [512, 128, 64].map((size) => {
            const a = [...artifacts]
              .reverse()
              .find((a: any) => a.width === size && a.height === size);
            if (!a) throw new Error(`加工配方没有输出 ${size}×${size}`);
            return { size, artifactId: a.id, assetIds: [] };
          });
          await this.save(b);
        }
        if (!item.proposalId) {
          const p = await this.runtime.processing.handle(
            "processing.organize.preview",
            {
              artifactIds: item.outputs!.map((o) => o.artifactId),
              context: { projectId: b.projectId },
              brief: `${b.template.name} · ${item.name}`,
              analyze: false,
            },
          );
          item.proposalId = p.id;
          await this.save(b);
        }
        const patches = item
          .outputs!.filter(
            (o) =>
              !this.catalog.generationGet<any>(
                "processing_save_items",
                o.artifactId,
              ),
          )
          .map((o) => ({
            artifactId: o.artifactId,
            title: `${item.name} · ${o.size}`,
            filename: item.key.replace(/\./g, "_"),
            category: item.category,
            entityCategory: item.key.startsWith("gear.") ? "equipment" : null,
            gameplayTags: item.key.startsWith("gear.") ? ["equipment"] : [],
            tags: [
              ...b.template.base.tags,
              "同类素材",
              item.key,
              `${o.size}×${o.size}`,
            ],
            projectIds: b.projectId ? [b.projectId] : [],
            collectionIds: [],
          }));
        const proposal = patches.length
          ? await this.runtime.processing.handle("processing.organize.update", {
              id: item.proposalId,
              items: patches,
            })
          : await this.runtime.processing.handle("processing.organize.detail", {
              id: item.proposalId,
            });
        if (ctx.job.type === "family-prepare") {
          item.error = undefined;
          await this.save(b);
          ctx.progress("已加工选定图标", index + 1, initial.items.length);
          continue;
        }
        const accepted = await this.runtime.processing.handle(
          "processing.accept",
          { proposalId: proposal.id, items: proposal.items },
        );
        if (accepted.jobId) {
          item.importJobId = accepted.jobId;
          await this.save(b);
          await this.waitChild(ctx, accepted.jobId);
        }
        b = this.getBatch(batchId);
        item = b.items[index];
        for (const output of item.outputs!) {
          const artifact = this.catalog.generationGet<any>(
            "processing_artifacts",
            output.artifactId,
          )!;
          output.assetIds = artifact.importedAssetIds ?? [];
          if (!output.assetIds.length) throw new Error("入库结果尚未保存");
          this.catalog.update(output.assetIds, {
            metadata: {
              family: {
                schemaVersion: 1,
                familyId: b.template.familyId,
                templateId: b.template.id,
                templateVersion: b.template.version,
                batchId: b.id,
                key: item.key,
                size: output.size,
                candidateId: item.selectedCandidateId,
              },
              assetGroup: { id: `family-${b.id}-${item.key}`, name: item.name },
            },
          });
        }
        item.error = undefined;
        await this.save(b);
        await this.runtime.changed();
        ctx.progress("已整理同类图标", index + 1, initial.items.length);
      } catch (error: any) {
        if (
          error instanceof WorkshopError &&
          ["CANCELLED", "SHUTDOWN"].includes(error.code)
        )
          throw error;
        const b = this.getBatch(batchId);
        b.items[index].error = error.message;
        await this.save(b);
        errors.push(`${current.name}：${error.message}`);
      }
    }
    if (errors.length) throw new Error(errors.join("\n"));
    return {
      batchId,
      assets: this.getBatch(batchId).items.flatMap(
        (i) => i.outputs?.flatMap((o) => o.assetIds) ?? [],
      ),
    };
  }
}
