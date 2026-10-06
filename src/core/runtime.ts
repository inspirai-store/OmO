import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { z } from "zod";
import { Catalog, processingTables } from "./catalog";
import { ProcessingService } from "./processing";
import { FamilyService } from "./families";
import {
  atomicJSON,
  copyVerified,
  folderBytes,
  hashFile,
  inside,
  now,
  readJSON,
  uid,
  walk,
  WorkshopError,
} from "./files";
import { inspectImport, runImport, type JobContext } from "./importer";
import { inspectExport, runExport, sourcePath } from "./exporter";
import { runDownload, samples, searchSource, resolveSample } from "./sources";
import { openDatabase } from "./sqlite";
import { rebuildLibrary } from "./recovery";
import { inspectMedia } from "./media";
import {
  variantSchema,
  querySchema,
  entityCategorySchema,
  gameplayTagSchema,
} from "./schemas";
import { aggregateAssets } from "./aggregation";
import { handleCommand } from "./commands";
import { GenerationService } from "./generation";
import type { GenerationAccess } from "./generation-provider-store";
import { FBX_PREVIEW_VERSION, canRequestThumbnail } from "../shared/fbx";
import type { MediaPool } from "./media-pool";
import type {
  Asset,
  AssetQuery,
  AssetGroup,
  AggregationMode,
  ExportPlan,
  ImportPlan,
  Job,
  MaterialVariant,
  Settings,
  TextureSlot,
} from "../shared/types";

const id = z.string().min(1).max(100),
  ids = z.array(id).min(1).max(100000);
const category = z.enum([
  "concept",
  "ui",
  "controls",
  "skin",
  "sprite",
  "texture",
  "model",
  "animation",
  "environment",
  "other",
]);
export class Runtime {
  generation!: GenerationService;
  processing!: ProcessingService;
  families!: FamilyService;
  coordinating = new Map<string, Job>();
  catalog!: Catalog;
  settings!: Settings;
  plans = new Map<string, ImportPlan | ExportPlan | any>();
  active = new Map<string, Job>();
  queue: Job[] = [];
  locks = new Set<string>();
  shuttingDown = false;
  thumbnailPending = new Set<string>();
  aggregationCache = new Map<AggregationMode, AssetGroup[]>();
  thumbnailWaiters = new Map<
    string,
    { token: string; resolve: (ok: boolean) => void }
  >();
  constructor(
    public root: string,
    public emit: (type: string, data: any) => void = () => {},
    public media?: MediaPool,
    public generationAccess: GenerationAccess = { providers: [], keys: {} },
  ) {}
  async init() {
    await fs.mkdir(this.root, { recursive: true });
    const lock = path.join(this.root, ".write.lock");
    try {
      const old = await readJSON<any>(lock, null);
      if (old) {
        let alive = false;
        try {
          process.kill(old.pid, 0);
          alive = true;
        } catch (e: any) {
          alive = e.code === "EPERM";
        }
        if (alive)
          throw new WorkshopError(
            "LIBRARY_LOCKED",
            "素材库已由另一个工坊实例打开",
          );
        await fs.rm(lock, { force: true });
      }
      const handle = await fs.open(lock, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, createdAt: now() }),
      );
      await handle.close();
      this.locks.add(lock);
    } catch (error) {
      throw error;
    }
    this.catalog = new Catalog(this.root);
    this.generation = new GenerationService(this, this.generationAccess);
    this.processing = new ProcessingService(this);
    this.families = new FamilyService(this);
    for (const dir of [
      "packages",
      "cache",
      "staging",
      "variants",
      "metadata",
      "trash",
      "exports",
      "generations",
      "processing",
    ])
      await fs.mkdir(path.join(this.root, dir), { recursive: true });
    const library = await readJSON<any>(path.join(this.root, "library.json"), {
      id: uid(),
      schemaVersion: 1,
      createdAt: now(),
      cacheGB: 20,
      godotPath: "",
      blenderPath: "",
    });
    await atomicJSON(path.join(this.root, "library.json"), library);
    this.settings = {
      root: this.root,
      cacheGB: library.cacheGB,
      godotPath: library.godotPath,
      blenderPath: library.blenderPath,
    };
    if (library.integrationVersion !== 2) {
      for (const row of this.catalog.db
        .prepare("SELECT id FROM revisions")
        .all()) {
        const manifest = this.catalog.revision(row.id),
          fbx = manifest.assets.find(
            (a) =>
              a.path.endsWith(".fbx") &&
              /model|character/i.test(a.path) &&
              !/animations?\//i.test(a.path),
          ),
          clips = manifest.files
            .filter(
              (f) => f.extension === ".fbx" && /animations?\//i.test(f.path),
            )
            .map((f) => f.path),
          resourceMap = Object.fromEntries(
            manifest.files
              .filter((f) =>
                [".png", ".jpg", ".jpeg", ".tga", ".bmp"].includes(f.extension),
              )
              .map((f) => [path.basename(f.path).toLowerCase(), f.path]),
          );
        for (const record of manifest.assets) {
          let a: Asset;
          try {
            a = this.catalog.get(record.id);
          } catch {
            continue;
          }
          if (
            ["model", "animation"].includes(a.category) &&
            ![".glb", ".gltf", ".fbx", ".obj", ".blend"].includes(a.extension)
          )
            this.catalog.update([a.id], { category: "texture" });
          if (a.extension === ".fbx" && fbx && clips.length)
            this.catalog.update([a.id], {
              metadata: {
                resourceMap,
                animationModel: fbx.path,
                animationFiles: clips,
                animations: clips.map((p) => ({
                  name: path.basename(p, ".fbx"),
                })),
                dependent: a.path !== fbx.path,
              },
            });
        }
      }
      await atomicJSON(path.join(this.root, "library.json"), {
        ...library,
        integrationVersion: 2,
      });
    }
    for (const job of this.catalog.db
      .prepare(
        "SELECT data FROM jobs WHERE json_extract(data,'$.status') IN ('running','queued') ORDER BY rowid",
      )
      .all()
      .map((r: any) => JSON.parse(r.data) as Job))
      if (["running", "queued"].includes(job.status)) {
        job.status = "queued";
        job.stage = "恢复未完成任务";
        this.generation.recover(job);
        this.processing.recover(job);
        this.families.recover(job);
        if (job.status === "queued") this.queue.push(job);
        this.catalog.saveJob(job);
      }
    const recordedJobs = new Set(
      this.catalog.db
        .prepare("SELECT id FROM jobs")
        .all()
        .map((j: any) => j.id),
    );
    for (const run of this.catalog.generationList<any>(
      "generation_runs",
      100000,
    ))
      if (
        !recordedJobs.has(run.jobId) &&
        ["queued", "running"].includes(run.status)
      ) {
        run.status = "interrupted";
        this.catalog.generationSave("generation_runs", run);
      }
    for (const run of this.catalog.generationList<any>(
      "processing_runs",
      100000,
    ))
      if (
        !recordedJobs.has(run.jobId) &&
        ["queued", "running", "paused"].includes(run.status)
      ) {
        run.status = "interrupted";
        for (const item of run.items)
          if (item.state !== "completed") item.state = "uncertain";
        this.catalog.generationSave("processing_runs", run);
      }
    for (const proposal of this.catalog.generationList<any>(
      "processing_save_proposals",
      100000,
    )) {
      if (["queued", "analyzing"].includes(proposal.state)) {
        const job = this.catalog.jobs().find((j) => j.id === proposal.jobId);
        if (
          !job ||
          ["completed", "failed", "cancelled", "interrupted"].includes(
            job.status,
          )
        ) {
          proposal.state = "interrupted";
          proposal.warnings.push("识图记录中断，未重复调用；可使用已保存建议");
          this.catalog.generationSave("processing_save_proposals", proposal);
        }
      }
    }
    this.pump();
    return this;
  }
  asset(a: Asset) {
    const preview = a.metadata.previewCache
      ? `workshop://cache/${a.metadata.previewCache}`
      : `workshop://assets/${a.packageId}/${a.revisionId}/source/${a.path.split("/").map(encodeURIComponent).join("/")}`;
    return { ...a, previewUrl: preview };
  }
  async handle(method: string, input: any = {}) {
    if (method.startsWith("families."))
      return this.families.handle(method, input);
    if (method.startsWith("processing."))
      return this.processing.handle(method, input);
    if (method.startsWith("generation."))
      return this.generation.handle(method, input);
    const command = await handleCommand(this, method, input);
    if (command) return command.value;
    switch (method) {
      case "library.stats": {
        const stats = this.catalog.stats();
        stats.recent = stats.recent.map((a) => this.asset(a));
        stats.cacheBytes = await folderBytes(path.join(this.root, "cache"));
        return stats;
      }
      case "assets.query": {
        const q = querySchema.parse(input) as AssetQuery;
        const p = this.catalog.query(q);
        return {
          ...p,
          auxiliaryTotal: this.catalog.query(
            {
              ...q,
              includeAuxiliary: true,
              showRelated: true,
              limit: 1,
              offset: 0,
            },
            false,
            true,
          ).total,
          items: p.items.map((a) => this.asset(a)),
        };
      }
      case "assets.groups":
      case "assets.groupSelection": {
        const request = z
          .object({
            query: querySchema.default({}),
            mode: z.enum(["entity", "package"]).default("entity"),
          })
          .parse(input);
        if (request.query.trash) throw new Error("回收站请使用普通浏览");
        let groups = this.aggregationCache.get(request.mode);
        if (!groups) {
          const rows = this.catalog.db
            .prepare("SELECT * FROM assets WHERE trashed=0")
            .all();
          const all = rows.map((r: any) => this.catalog.hydrate(r));
          const manifests = new Map<string, any>();
          for (const row of this.catalog.db
            .prepare("SELECT id,manifest FROM revisions")
            .all())
            manifests.set(row.id, JSON.parse(row.manifest));
          groups = aggregateAssets(all, request.mode, manifests);
          this.aggregationCache.set(request.mode, groups);
        }
        const matched = this.catalog.query(
          {
            ...request.query,
            showRelated: true,
            includeAuxiliary: false,
            offset: 0,
            limit: 100000,
          },
          true,
        );
        if (matched.total > 100000)
          throw new Error("聚合筛选一次最多十万个素材，请缩小筛选范围");
        const ids = new Set(matched.items.map((a) => a.id));
        const filtered = groups.filter((g) =>
          g.assetIds.some((id) => ids.has(id)),
        );
        const order = new Map(matched.items.map((a, i) => [a.id, i]));
        const ranks = new Map(
          filtered.map((g) => [
            g.id,
            g.assetIds.reduce(
              (n, id) => Math.min(n, order.get(id) ?? Infinity),
              Infinity,
            ),
          ]),
        );
        filtered.sort(
          (a, b) =>
            ranks.get(a.id)! - ranks.get(b.id)! || a.id.localeCompare(b.id),
        );
        if (method === "assets.groupSelection") {
          const selected = [...new Set(filtered.flatMap((g) => g.assetIds))];
          if (selected.length > 100000)
            throw new Error("一次最多选择十万个素材，请缩小聚合范围");
          return { ids: selected, count: selected.length };
        }
        const offset = request.query.offset ?? 0,
          limit = request.query.limit ?? 100;
        return {
          total: filtered.length,
          assetTotal: new Set(filtered.flatMap((g) => g.assetIds)).size,
          offset,
          limit,
          items: filtered.slice(offset, offset + limit).map((g) => ({
            ...g,
            primary: this.asset(this.catalog.get(g.primary.id)),
          })),
        };
      }
      case "assets.detail": {
        let a = this.catalog.get(id.parse(input.id));
        if (
          (a.metadata.previewCache &&
            !(await fs
              .stat(
                inside(path.join(this.root, "cache"), a.metadata.previewCache),
              )
              .catch(() => null))) ||
          (!a.thumbnailUrl &&
            [".svg", ".tif", ".tiff", ".psd", ".kra", ".tga"].includes(
              a.extension,
            ) &&
            !a.metadata.previewError)
        ) {
          const f = this.catalog
            .revision(a.revisionId)
            .files.find((f) => f.path === a.path)!;
          const media = await (
            this.media?.inspect.bind(this.media) ?? inspectMedia
          )(sourcePath(this.catalog, a), f, path.join(this.root, "cache"));
          this.catalog.update([a.id], { metadata: media.metadata });
          if (media.thumbnail) this.catalog.setThumbnail(a.id, media.thumbnail);
          a = this.catalog.get(a.id);
        }
        this.catalog.viewed(a.id);
        return {
          asset: this.asset(a),
          manifest: this.catalog.revision(a.revisionId),
          variants: this.catalog.variants(a.id),
          projects: this.catalog
            .projects()
            .filter((p) =>
              this.catalog.db
                .prepare(
                  "SELECT 1 FROM project_assets WHERE project_id=? AND asset_id=?",
                )
                .get(p.id, a.id),
            ),
        };
      }
      case "assets.update": {
        const update = z
          .object({
            ids,
            change: z.object({
              title: z.string().min(1).max(200).optional(),
              category: category.optional(),
              tags: z.array(z.string().max(100)).max(200).optional(),
              notes: z.string().max(20000).optional(),
              favorite: z.boolean().optional(),
              trashed: z.boolean().optional(),
              metadata: z.record(z.string(), z.unknown()).optional(),
            }),
          })
          .parse(input);
        this.catalog.update(update.ids, update.change as any);
        await this.changed();
        return true;
      }
      case "assets.purge": {
        const values = ids.parse(input.ids);
        if (this.active.size || this.coordinating.size)
          throw new Error("请等待后台任务完成再永久清理");
        for (const value of values) {
          const a = this.catalog.get(value);
          if (!a.trashed) throw new Error("只能清理回收站素材");
          if (
            this.catalog.db
              .prepare("SELECT 1 FROM project_assets WHERE asset_id=?")
              .get(value) ||
            this.catalog
              .variants()
              .some(
                (v) =>
                  v.assetId === value ||
                  Object.values(v.bindings).some((b) => b?.assetId === value),
              )
          )
            throw new Error(`${a.title} 仍被项目或材质变体引用`);
        }
        const revisions = [
          ...new Set(values.map((value) => this.catalog.get(value).revisionId)),
        ];
        this.catalog.db.transaction(() => {
          for (const value of values) {
            this.catalog.db
              .prepare("DELETE FROM collection_assets WHERE asset_id=?")
              .run(value);
            this.catalog.db.prepare("DELETE FROM assets WHERE id=?").run(value);
          }
        })();
        for (const revision of revisions) {
          if (
            this.catalog.db
              .prepare("SELECT 1 FROM assets WHERE revision_id=?")
              .get(revision)
          )
            continue;
          const manifest = this.catalog.revision(revision);
          this.catalog.db
            .prepare("DELETE FROM provenance WHERE revision_id=?")
            .run(revision);
          this.catalog.db
            .prepare("DELETE FROM revisions WHERE id=?")
            .run(revision);
          await fs.rm(
            inside(this.root, `packages/${manifest.packageId}/${revision}`),
            { recursive: true, force: true },
          );
        }
        await this.changed();
        return true;
      }
      case "projects.list":
        return this.catalog.projects();
      case "assets.versions": {
        const a = this.catalog.get(id.parse(input.id)),
          logical = a.metadata.logicalId ?? a.id;
        return this.catalog.db
          .prepare(
            "SELECT id FROM assets WHERE id=? OR json_extract(metadata,'$.logicalId')=? ORDER BY created_at DESC",
          )
          .all(logical, logical)
          .map((row: any) => this.asset(this.catalog.get(row.id)));
      }
      case "projects.upgrade": {
        const from = this.catalog.get(id.parse(input.fromAssetId)),
          to = this.catalog.get(id.parse(input.toAssetId));
        if (
          (from.metadata.logicalId ?? from.id) !==
          (to.metadata.logicalId ?? to.id)
        )
          throw new Error("请选择同一素材的其他版本");
        const projectId = id.parse(input.projectId);
        this.catalog.db.transaction(() => {
          this.catalog.db
            .prepare(
              "DELETE FROM project_assets WHERE project_id=? AND asset_id=?",
            )
            .run(projectId, from.id);
          this.catalog.db
            .prepare("INSERT OR REPLACE INTO project_assets VALUES(?,?,?,NULL)")
            .run(projectId, to.id, to.revisionId);
        })();
        await this.changed();
        return true;
      }
      case "projects.save": {
        const p = z
          .object({
            id: z.string().optional(),
            name: z.string().min(1).max(100),
            description: z.string().max(5000).optional(),
            color: z.string().optional(),
            godotPath: z.string().optional(),
          })
          .parse(input);
        const result = this.catalog.saveProject(p);
        await this.changed();
        return result;
      }
      case "projects.attach": {
        const p = z
          .object({
            projectId: id,
            assetIds: ids,
            variantId: z.string().optional(),
          })
          .parse(input);
        this.catalog.attach(p.projectId, p.assetIds, p.variantId);
        await this.changed();
        return true;
      }
      case "projects.detach":
        this.catalog.detach(
          id.parse(input.projectId),
          ids.parse(input.assetIds),
        );
        await this.changed();
        return true;
      case "projects.delete":
        this.catalog.db
          .prepare("DELETE FROM projects WHERE id=?")
          .run(id.parse(input.id));
        await this.changed();
        return true;
      case "collections.list":
        return this.catalog.collections();
      case "collections.save": {
        const c = z
          .object({
            name: z.string().min(1).max(100),
            query: querySchema.optional(),
          })
          .parse(input);
        const result = this.catalog.saveCollection(c.name, c.query);
        await this.changed();
        return result;
      }
      case "collections.attach":
        this.catalog.collect(
          id.parse(input.collectionId),
          ids.parse(input.assetIds),
        );
        await this.changed();
        return true;
      case "imports.inspect": {
        const p = await inspectImport(
          z.array(z.string()).min(1).max(1000).parse(input.paths),
        );
        try {
          const disk = await fs.statfs(this.root);
          p.availableBytes = disk.bavail * disk.bsize;
          if (p.bytes > p.availableBytes)
            p.issues.push("素材库磁盘可用空间不足，请清理磁盘或迁移素材库");
        } catch {
          /* The OS may not expose free space for this volume. */
        }
        this.plans.set(p.id, p);
        return p;
      }
      case "imports.start": {
        const stored = this.plans.get(id.parse(input.planId)) as ImportPlan;
        if (!stored) throw new Error("导入计划已过期");
        const p = {
          ...stored,
          parentAssetId: input.parentAssetId
            ? id.parse(input.parentAssetId)
            : undefined,
          source: input.parentAssetId
            ? this.catalog.get(input.parentAssetId).source
            : stored.source,
          projectId: input.projectId || undefined,
          category: input.category ? category.parse(input.category) : undefined,
          entityCategory:
            input.entityCategory === null
              ? null
              : input.entityCategory
                ? entityCategorySchema.parse(input.entityCategory)
                : undefined,
          gameplayTags: input.gameplayTags
            ? z.array(gameplayTagSchema).max(20).parse(input.gameplayTags)
            : undefined,
          tags: input.tags ? z.array(z.string()).parse(input.tags) : undefined,
        };
        return this.start(
          "import",
          p,
          `导入 ${p.roots.map((r) => r.label).join("、")}`,
        ).id;
      }
      case "assets.tags": {
        const request = z
          .object({
            ids,
            tags: z.array(z.string().min(1).max(100)).max(200),
            replace: z.boolean().default(false),
          })
          .parse(input);
        for (const value of request.ids) {
          const a = this.catalog.get(value);
          this.catalog.update([value], {
            tags: request.replace
              ? request.tags
              : [...new Set([...a.tags, ...request.tags])],
          });
        }
        await this.changed();
        return true;
      }
      case "materials.list":
        return this.catalog.variants(input.assetId);
      case "materials.save": {
        const v = variantSchema.parse(input) as MaterialVariant;
        const a = this.catalog.get(v.assetId);
        if (!a.metadata.materialSet && ![".glb", ".gltf"].includes(a.extension))
          throw new Error(
            "材质变体支持 GLB/glTF 或 PBR 套组；其他模型请先生成 GLB 副本",
          );
        if (v.id) {
          const existing = this.catalog
            .variants()
            .find((item) => item.id === v.id);
          if (existing && existing.assetId !== a.id)
            throw new Error("材质变体 ID 属于另一份素材");
        }
        if (
          !a.metadata.materialSet &&
          a.metadata.materials?.length &&
          v.materialIndex >= a.metadata.materials.length
        )
          throw new Error("材质槽不存在");
        if (a.metadata.materials?.[v.materialIndex]?.extensions?.length)
          throw new Error("此材质扩展为只读，请使用标准 PBR 材质");
        if (a.metadata.materialSet) {
          const set = a.metadata.materialSet;
          for (const slot of [
            "baseColor",
            "normal",
            "roughness",
            "metallic",
            "ao",
          ] as TextureSlot[]) {
            if (v.bindings[slot]) continue;
            const file =
              set[slot] ??
              (["roughness", "metallic", "ao"].includes(slot)
                ? set.orm
                : undefined);
            if (!file) continue;
            const row = this.catalog.db
              .prepare("SELECT id FROM assets WHERE revision_id=? AND path=?")
              .get(a.revisionId, file);
            if (row)
              v.bindings[slot] = {
                assetId: row.id,
                revisionId: a.revisionId,
                channel: set[slot]
                  ? ["baseColor", "normal"].includes(slot)
                    ? "rgb"
                    : "r"
                  : slot === "ao"
                    ? "r"
                    : slot === "roughness"
                      ? "g"
                      : "b",
                uv: 0,
              };
          }
        }
        for (const [slot, b] of Object.entries(v.bindings)) {
          if (
            !a.metadata.materialSet &&
            !a.metadata.uvChannels?.includes(b!.uv)
          )
            throw new Error(`模型缺少 UV${b!.uv}`);
          const tex = this.catalog.get(b!.assetId);
          if (tex.metadata.previewError)
            throw new Error("该贴图无法解析，不能绑定材质");
          if (tex.revisionId !== b!.revisionId || tex.trashed)
            throw new Error("贴图版本不可用");
          if (
            ![
              ".png",
              ".jpg",
              ".jpeg",
              ".webp",
              ".tif",
              ".tiff",
              ".svg",
            ].includes(tex.extension)
          )
            throw new Error("材质绑定支持 PNG、JPEG、WebP、TIFF、SVG");
        }
        const saved = this.catalog.saveVariant(v);
        await atomicJSON(
          path.join(this.root, "variants", `${saved.id}.json`),
          saved,
        );
        await this.changed();
        return saved;
      }
      case "sources.samples": {
        const installed = new Set(
          (
            this.catalog.db
              .prepare("SELECT source FROM assets WHERE source IS NOT NULL")
              .all() as any[]
          ).map((r) => JSON.parse(r.source).assetId),
        );
        return samples.map((s) => ({
          ...s,
          installed: installed.has(s.upstreamId),
        }));
      }
      case "sources.search":
        return searchSource(
          z.enum(["ambientcg", "polyhaven"]).parse(input.provider),
          z
            .string()
            .max(100)
            .parse(input.search ?? ""),
          z
            .number()
            .int()
            .min(0)
            .parse(input.offset ?? 0),
        );
      case "sources.resolve": {
        const sample =
          samples.find((s) => s.id === input.id) ??
          z
            .object({
              id: z.string(),
              title: z.string(),
              provider: z.enum(["ambientcg", "polyhaven"]),
              upstreamId: z.string().regex(/^[a-z0-9_-]+$/i),
              pageUrl: z.string(),
              author: z.string(),
              category,
              tags: z.array(z.string()),
              description: z.string(),
              project: z.enum(["2d", "3d", "concept"]),
            })
            .parse(input.sample);
        const plan = await resolveSample(sample);
        const key = uid();
        this.plans.set(key, plan);
        return { id: key, ...plan };
      }
      case "downloads.start": {
        const plan = this.plans.get(id.parse(input.planId));
        if (!plan?.files) throw new Error("下载计划已过期");
        return this.start("download", plan, `下载 ${plan.sample.title}`).id;
      }
      case "samples.installAll": {
        const jobs = [];
        for (const sample of samples) {
          const already = this.catalog.db
            .prepare(
              "SELECT 1 FROM assets WHERE json_extract(source,'$.assetId')=?",
            )
            .get(sample.upstreamId);
          if (!already)
            jobs.push(
              this.start("sample", { sample }, `安装 ${sample.title}`).id,
            );
        }
        return jobs;
      }
      case "exports.inspect": {
        const request = z
          .object({
            assetIds: ids,
            target: z.string().min(1),
            mode: z.enum(["godot", "generic"]),
            variantIds: z.array(z.string()).optional(),
            zip: z.boolean().optional(),
            aggregate: z.boolean().optional(),
            preferGLTF: z.boolean().optional(),
            familyBatchId: id.optional(),
          })
          .parse(input);
        const plan = inspectExport(this.catalog, request);
        this.plans.set(plan.id, plan);
        return plan;
      }
      case "exports.start": {
        const plan = this.plans.get(id.parse(input.planId)) as ExportPlan;
        if (!plan?.request) throw new Error("导出计划已过期");
        return this.start("export", plan, `导出 ${plan.assets.length} 个素材`)
          .id;
      }
      case "exports.list":
        return this.catalog.db
          .prepare("SELECT data FROM exports ORDER BY rowid DESC LIMIT 50")
          .all()
          .map((r: any) => JSON.parse(r.data));
      case "jobs.list":
        return this.catalog.jobs();
      case "jobs.control": {
        const command = z
          .object({
            id,
            action: z.enum(["pause", "resume", "cancel", "retry"]),
            confirmUnknown: z.boolean().optional(),
          })
          .parse(input);
        const job =
          this.active.get(command.id) ??
          this.coordinating.get(command.id) ??
          this.queue.find((j) => j.id === command.id) ??
          this.catalog.jobs().find((j) => j.id === command.id);
        if (!job) throw new Error("任务不存在");
        if (command.action === "pause" && job.type.startsWith("generation"))
          throw new Error("云端生成不支持暂停，可以停止任务");
        if (command.action === "pause" && job.type === "processing-organize")
          throw new Error("自动识图不支持暂停，可以停止识别");
        if (command.action === "pause" && job.type === "convert")
          throw new Error("Blender 转换不支持暂停，可以取消任务");
        if (command.action === "pause" && job.type.startsWith("family-"))
          throw new Error("同类批次请使用停止和续接");
        if (
          command.action === "cancel" &&
          !["running", "queued", "paused"].includes(job.status)
        )
          throw new Error("该任务已结束");
        if (
          command.action === "retry" &&
          (this.active.has(job.id) || this.coordinating.has(job.id))
        )
          throw new Error("任务正在结束，请稍后重试");
        if (
          command.action === "retry" &&
          job.type === "generation" &&
          ["failed", "cancelled", "interrupted"].includes(job.status)
        )
          this.generation.prepareRetry(job, command.confirmUnknown);
        if (
          command.action === "retry" &&
          job.type.startsWith("processing") &&
          ["failed", "cancelled", "interrupted"].includes(job.status)
        )
          await this.processing.retry(job, command.confirmUnknown);
        if (command.action === "cancel" && job.type.startsWith("processing")) {
          job.status = "cancelled";
          this.persistJob(job);
          await this.processing.cancel(job);
        }
        if (command.action === "cancel" && job.type.startsWith("generation")) {
          job.status = "cancelled";
          this.persistJob(job);
          await this.generation.cancel(job);
        }
        if (
          command.action === "retry" &&
          job.type.startsWith("family-") &&
          ["failed", "cancelled", "interrupted"].includes(job.status)
        )
          await this.families.retry(job, command.confirmUnknown);
        if (command.action === "cancel" && job.type.startsWith("family-")) {
          job.status = "cancelled";
          this.persistJob(job);
          await this.families.cancel(job);
        }
        if (
          command.action === "pause" &&
          ["running", "queued"].includes(job.status)
        )
          job.status = "paused";
        else if (command.action === "cancel") job.status = "cancelled";
        else if (command.action === "resume" && job.status === "paused") {
          job.status =
            this.active.has(job.id) || this.coordinating.has(job.id)
              ? "running"
              : "queued";
          if (
            !this.active.has(job.id) &&
            !this.coordinating.has(job.id) &&
            !this.queue.includes(job)
          )
            this.queue.push(job);
        } else if (
          command.action === "retry" &&
          ["failed", "cancelled", "interrupted"].includes(job.status)
        ) {
          job.status = "queued";
          job.error = undefined;
          if (!this.queue.some((j) => j.id === job.id)) this.queue.push(job);
        }
        this.persistJob(job);
        this.pump();
        return job;
      }
      case "settings.get":
        return this.settings;
      case "settings.save": {
        const settings = z
          .object({
            cacheGB: z.number().min(0.1).max(1000),
            godotPath: z.string(),
            blenderPath: z.string(),
          })
          .parse(input);
        this.settings = { ...this.settings, ...settings };
        const lib = await readJSON<any>(path.join(this.root, "library.json"));
        await atomicJSON(path.join(this.root, "library.json"), {
          ...lib,
          ...settings,
        });
        await this.trimCache();
        return this.settings;
      }
      case "cache.clear": {
        if (this.active.size) throw new Error("请等待任务完成再清理缓存");
        await fs.rm(path.join(this.root, "cache"), {
          recursive: true,
          force: true,
        });
        await fs.mkdir(path.join(this.root, "cache"), { recursive: true });
        this.catalog.db.prepare("UPDATE assets SET thumbnail=NULL").run();
        this.catalog.db
          .prepare(
            "UPDATE assets SET metadata=json_remove(metadata,'$.previewCache')",
          )
          .run();
        this.emit("catalog.changed", {});
        return true;
      }
      case "cache.rebuild":
        return this.start("cache", {}, "重建图片与模型预览").id;
      case "backups.create":
        return this.start(
          "backup",
          { target: z.string().min(1).parse(input.target) },
          "备份本地素材库",
        ).id;
      case "backups.restore":
        return this.start(
          "restore",
          {
            backup: z.string().parse(input.backup),
            target: z.string().parse(input.target),
          },
          "验证并恢复素材库",
        ).id;
      case "backups.rebuild":
        await this.catalog.snapshot();
        return this.start(
          "rebuild",
          { target: z.string().min(1).parse(input.target) },
          "从清单重建素材库",
        ).id;
      case "previews.imagePage": {
        const a = this.catalog.get(id.parse(input.assetId));
        if (![".tif", ".tiff"].includes(a.extension))
          throw new Error("多页预览支持 TIFF");
        const page = z
            .number()
            .int()
            .min(0)
            .max((a.metadata.pages ?? 1) - 1)
            .parse(input.page),
          f = this.catalog
            .revision(a.revisionId)
            .files.find((f) => f.path === a.path)!;
        const result = await (
          this.media?.inspect.bind(this.media) ?? inspectMedia
        )(
          sourcePath(this.catalog, a),
          { ...f, metadata: { ...f.metadata, requestPage: page } },
          path.join(this.root, "cache"),
        );
        if (result.metadata.previewError)
          throw new Error(result.metadata.previewError);
        return `workshop://cache/${result.metadata.previewCache}`;
      }
      case "models.convert": {
        if (!this.settings.blenderPath)
          throw new Error("请先在设置中配置 Blender");
        return this.start(
          "convert",
          {
            assetId: id.parse(input.assetId),
            projectId: input.projectId ? id.parse(input.projectId) : undefined,
          },
          "Blender 转换预览副本",
        ).id;
      }
      case "files.resolve":
        return sourcePath(
          this.catalog,
          this.catalog.get(id.parse(input.assetId)),
        );
      case "models.fromPreview": {
        const a = this.catalog.get(id.parse(input.assetId));
        if (![".fbx", ".obj"].includes(a.extension))
          throw new Error("仅转换已经解析的 FBX / OBJ 预览");
        const data = Buffer.from(
          z.string().max(140000000).parse(input.base64),
          "base64",
        );
        if (data.length < 20 || data.toString("ascii", 0, 4) !== "glTF")
          throw new Error("转换结果不是 GLB");
        const temp = path.join(this.root, "staging", "conversion-" + uid());
        await fs.mkdir(temp, { recursive: true });
        const file = inside(
          temp,
          a.title.replace(/[<>:\"/\\|?*]/g, "-").slice(0, 60) + "-preview.glb",
        );
        await fs.writeFile(file, data);
        const plan = await inspectImport([file]);
        plan.tags = [...a.tags, "转换副本"];
        plan.source = a.source;
        plan.projectId = input.projectId
          ? id.parse(input.projectId)
          : undefined;
        return this.start("import", plan, "导入 GLB 转换副本").id;
      }
      case "previews.thumbnail": {
        const a = this.catalog.get(id.parse(input.assetId));
        if (input.base64) {
          const data = Buffer.from(
            z.string().max(4000000).parse(input.base64),
            "base64",
          );
          const waiter = this.thumbnailWaiters.get(a.id);
          if (waiter && input.token !== waiter.token) return false;
          const file = `${a.sha256}-model-v${input.token ? Number(input.token) : 1}.png`;
          await fs.writeFile(path.join(this.root, "cache", file), data);
          this.catalog.setThumbnail(a.id, file);
          if (a.metadata.thumbnailError)
            this.catalog.update([a.id], {
              metadata: { thumbnailError: false },
            });
          this.thumbnailPending.delete(a.id);
          waiter?.resolve(true);
          this.emit("thumbnail.ready", {
            id: a.id,
            thumbnailUrl: this.asset(this.catalog.get(a.id)).thumbnailUrl,
          });
          return true;
        }
        return false;
      }
      case "previews.thumbnailFailed": {
        const a = this.catalog.get(id.parse(input.assetId));
        const waiter = this.thumbnailWaiters.get(input.assetId);
        if (waiter && input.token !== waiter.token) return false;
        this.thumbnailPending.delete(input.assetId);
        if (!waiter)
          this.catalog.update([input.assetId], {
            metadata: {
              thumbnailError: true,
              thumbnailErrorVersion:
                a.extension === ".fbx" ? FBX_PREVIEW_VERSION : 1,
            },
          });
        waiter?.resolve(false);
        return true;
      }
      case "previews.metadata": {
        const a = this.catalog.get(id.parse(input.assetId));
        const metadata = z
          .object({
            triangles: z.number().nonnegative(),
            vertices: z.number().nonnegative(),
            uvChannels: z.array(z.number().int().min(0).max(8)),
            materials: z.array(z.any()).max(1000),
            animations: z.array(z.any()).max(1000),
          })
          .parse(input.metadata);
        this.catalog.update([a.id], { metadata });
        return true;
      }
      case "previews.request": {
        const a = this.catalog.get(id.parse(input.assetId));
        if (
          ["model", "environment", "material"].includes(
            a.capabilities.preview,
          ) &&
          !a.thumbnailUrl &&
          canRequestThumbnail(a.extension, a.metadata) &&
          !this.thumbnailPending.has(a.id)
        ) {
          this.thumbnailPending.add(a.id);
          this.emit("thumbnail.request", this.asset(a));
        }
        return true;
      }
      default:
        throw new WorkshopError("UNKNOWN_METHOD", `未知操作：${method}`);
    }
  }
  async changed() {
    this.aggregationCache.clear();
    await this.catalog.snapshot();
    this.emit("catalog.changed", {});
  }
  start(
    type: string,
    request: any,
    title: string,
    prepare?: (job: Job) => void,
  ) {
    const job: Job = {
      id: uid(),
      type,
      title,
      status: "queued",
      stage: "等待开始",
      progress: 0,
      done: 0,
      total: 1,
      request,
      createdAt: now(),
      updatedAt: now(),
    };
    prepare?.(job);
    this.queue.push(job);
    this.persistJob(job);
    this.pump();
    return job;
  }
  persistJob(job: Job) {
    job.updatedAt = now();
    this.catalog.saveJob(job);
    this.emit("job.updated", job);
  }
  pump() {
    if (this.shuttingDown) return;
    for (let index = this.queue.length - 1; index >= 0; index--) {
      const job = this.queue[index];
      if (
        (job.type === "processing" || job.type.startsWith("family-")) &&
        job.status === "queued"
      ) {
        this.queue.splice(index, 1);
        this.coordinating.set(job.id, job);
        void this.execute(job);
      }
    }
    while (this.active.size < 2) {
      const usesCodex = (j: Job) =>
        j.type === "generation-assistant" ||
        j.type === "processing-assistant" ||
        j.type === "processing-review" ||
        j.type === "processing-organize" ||
        (j.type === "generation" &&
          this.catalog
            .generationGet("generation_runs", j.request.runId)
            ?.items.some((i: any) => i.provider.kind === "codex"));
      const index = this.queue.findIndex(
        (j) =>
          j.status === "queued" &&
          !(usesCodex(j) && [...this.active.values()].some(usesCodex)),
      );
      if (index < 0) break;
      const job = this.queue.splice(index, 1)[0];
      this.active.set(job.id, job);
      void this.execute(job);
    }
  }
  async execute(job: Job) {
    job.status = "running";
    this.persistJob(job);
    let last = 0;
    const ctx: JobContext = {
      parse: this.media ? this.media.inspect.bind(this.media) : undefined,
      job,
      event: (t, d) => this.emit(t, d),
      check: async () => {
        while (job.status === "paused" && !this.shuttingDown)
          await new Promise((r) => setTimeout(r, 100));
        if (job.status === "cancelled")
          throw new WorkshopError("CANCELLED", "任务已取消");
        if (this.shuttingDown)
          throw new WorkshopError("SHUTDOWN", "任务将在下次启动时恢复");
        await new Promise<void>((r) => setImmediate(r));
      },
      progress: (stage, done, total) => {
        job.stage = stage;
        job.done = done;
        job.total = total;
        job.progress = total ? Math.max(0, Math.min(1, done / total)) : 0;
        if (Date.now() - last > 150) {
          last = Date.now();
          this.persistJob(job);
        }
      },
    };
    try {
      if (job.type.startsWith("family-"))
        job.result = await this.families.execute(ctx);
      else if (job.type.startsWith("processing"))
        job.result = await this.processing.execute(ctx);
      else if (job.type.startsWith("generation"))
        job.result = await this.generation.execute(ctx);
      else if (job.type === "import")
        job.result = await runImport(this.catalog, job.request, ctx);
      else if (job.type === "sample" || job.type === "download") {
        const plan =
          job.type === "sample"
            ? await resolveSample(job.request.sample)
            : job.request;
        job.result = await runDownload(this.catalog, plan, ctx);
      } else if (job.type === "export")
        job.result = await runExport(this.catalog, job.request, ctx);
      else if (job.type === "backup")
        job.result = await this.backup(job.request.target, ctx);
      else if (job.type === "restore")
        job.result = await this.restore(
          job.request.backup,
          job.request.target,
          ctx,
        );
      else if (job.type === "rebuild")
        job.result = await rebuildLibrary(
          this.root,
          job.request.target,
          () => ctx.check(),
          (done, total) => ctx.progress("重建素材目录", done, total),
        );
      else if (job.type === "cache") {
        const { inspectMedia } = await import("./media");
        const rows = this.catalog.db
          .prepare("SELECT id FROM assets")
          .all() as any[];
        for (const [i, r] of rows.entries()) {
          await ctx.check();
          const a = this.catalog.get(r.id),
            file = this.catalog
              .revision(a.revisionId)
              .files.find((f) => f.path === a.path)!;
          const result = await (
            this.media?.inspect.bind(this.media) ?? inspectMedia
          )(sourcePath(this.catalog, a), file, path.join(this.root, "cache"));
          if (result.thumbnail)
            this.catalog.setThumbnail(a.id, result.thumbnail);
          if (result.metadata.previewCache)
            this.catalog.update([a.id], { metadata: result.metadata });
          ctx.progress("重建预览", i + 1, rows.length);
        }
        job.result = { count: rows.length };
        this.emit("catalog.changed", {});
      } else if (job.type === "thumbnails") {
        const failures: string[] = [];
        for (const [index, value] of job.request.ids.entries()) {
          await ctx.check();
          const a = this.catalog.get(value),
            token = String(Date.now());
          if (
            ["model", "environment", "material"].includes(
              a.capabilities.preview,
            )
          ) {
            const ok = await new Promise<boolean>((resolve) => {
              const timer = setTimeout(() => resolve(false), 65000);
              this.thumbnailWaiters.set(a.id, {
                token,
                resolve: (ok) => {
                  clearTimeout(timer);
                  resolve(ok);
                },
              });
              this.emit("thumbnail.request", {
                ...this.asset(a),
                metadata: { ...a.metadata, thumbnailToken: token },
              });
            });
            this.thumbnailWaiters.delete(a.id);
            if (!ok) failures.push(a.title);
          } else {
            const temp = inside(this.root, `staging/${job.id}/cache`);
            const f = this.catalog
              .revision(a.revisionId)
              .files.find((f) => f.path === a.path)!;
            const result = await (
              this.media?.inspect.bind(this.media) ?? inspectMedia
            )(sourcePath(this.catalog, a), f, temp);
            await ctx.check();
            if (result.thumbnail) {
              const filename = `${a.sha256}-image-v${token}.webp`;
              await fs.copyFile(
                inside(temp, result.thumbnail),
                inside(this.root, `cache/${filename}`),
              );
              this.catalog.setThumbnail(a.id, filename);
              this.emit("thumbnail.ready", {
                id: a.id,
                thumbnailUrl: this.asset(this.catalog.get(a.id)).thumbnailUrl,
              });
            } else failures.push(a.title);
          }
          ctx.progress("重建缩略图", index + 1, job.request.ids.length);
        }
        await fs.rm(inside(this.root, `staging/${job.id}`), {
          recursive: true,
          force: true,
        });
        job.result = { count: job.request.ids.length, failures };
        if (failures.length)
          throw new Error(
            `以下素材重建失败，保留旧缩略图：${failures.slice(0, 10).join("、")}`,
          );
      } else if (job.type === "convert")
        job.result = await this.convert(
          job.request.assetId,
          ctx,
          job.request.projectId,
        );
      await ctx.check();
      if (!this.shuttingDown && job.status === "running") {
        job.status = "completed";
        job.stage = "完成";
        job.progress = 1;
      }
      if (String(job.status) === "interrupted")
        job.stage = "需检查提供方记录，未重复提交";
      if (String(job.status) === "failed" && job.type === "generation")
        job.stage = "部分生成未完成，已保留候选";
    } catch (error: any) {
      if (
        error.code === "SHUTDOWN" ||
        (this.shuttingDown && String(job.status) !== "cancelled")
      ) {
        job.status = "queued";
        job.stage = "等待下次启动恢复";
      } else if (error.code === "CANCELLED") {
        job.status = "cancelled";
        job.stage = "已取消";
      } else {
        job.status = "failed";
        job.error = error.message;
        job.stage = "操作未完成";
      }
    } finally {
      if (job.status === "cancelled")
        for (const suffix of ["", "-download", "-export"])
          await fs
            .rm(inside(this.root, "staging/" + job.id + suffix), {
              recursive: true,
              force: true,
            })
            .catch(() => {});
      if (job.status === "completed" && !this.shuttingDown)
        await this.trimCache().catch(() => {});
      this.persistJob(job);
      this.active.delete(job.id);
      this.coordinating.delete(job.id);
      if (!this.shuttingDown) {
        if (job.type !== "thumbnails") this.emit("catalog.changed", {});
        this.pump();
      }
    }
  }
  async backup(target: string, ctx: JobContext) {
    const rel = path.relative(this.root, path.resolve(target));
    if (!rel || (!rel.startsWith("..") && !path.isAbsolute(rel)))
      throw new Error("备份位置必须在素材库目录之外");
    const destination = path.join(
      target,
      `素材工坊备份-${now().replace(/[:.]/g, "-")}-${ctx.job.id.slice(0, 8)}`,
    );
    await fs.mkdir(destination, { recursive: true });
    await this.catalog.db.backup(path.join(destination, "catalog.sqlite"));
    const snapshot = openDatabase(path.join(destination, "catalog.sqlite"));
    const revisions = snapshot
      .prepare("SELECT manifest FROM revisions")
      .all()
      .map((r: any) => JSON.parse(r.manifest));
    const variants = snapshot
      .prepare("SELECT data FROM variants")
      .all()
      .map((r: any) => JSON.parse(r.data));
    const metadata = {
      schemaVersion: 1,
      createdAt: now(),
      tables: Object.fromEntries(
        [
          "projects",
          "project_assets",
          "collections",
          "collection_assets",
          "variants",
          "provenance",
          "generation_runs",
          "generation_candidates",
          "generation_inputs",
          "generation_templates",
          ...processingTables,
        ].map((t) => [t, snapshot.prepare(`SELECT * FROM ${t}`).all()]),
      ),
      assetMetadata: snapshot
        .prepare(
          "SELECT id,title,category,tags,notes,favorite,trashed,metadata FROM assets",
        )
        .all(),
    };
    snapshot.close();
    const files: { path: string; sha256: string; bytes: number }[] = [];
    const generationFiles = [
      ...new Set(
        [
          "generation_inputs",
          "generation_candidates",
          "processing_inputs",
          "processing_artifacts",
        ].flatMap((t) =>
          (metadata.tables as any)[t].map(
            (r: any) => JSON.parse(r.data).relativePath,
          ),
        ),
      ),
    ];
    for (const relative of generationFiles) {
      await ctx.check();
      const record = [
        ...(metadata.tables as any).generation_inputs,
        ...(metadata.tables as any).generation_candidates,
        ...(metadata.tables as any).processing_inputs,
        ...(metadata.tables as any).processing_artifacts,
      ]
        .map((r: any) => JSON.parse(r.data))
        .find((r: any) => r.relativePath === relative);
      const fileHash = await copyVerified(
        inside(this.root, relative as string),
        inside(destination, relative as string),
        () => ctx.check(),
      );
      if (record?.sha256 && record.sha256 !== fileHash)
        throw new Error("生成原图校验失败，备份未完成");
      files.push({
        path: relative as string,
        sha256: fileHash,
        bytes: (await fs.stat(inside(destination, relative as string))).size,
      });
    }
    let done = 0;
    for (const m of revisions) {
      const prefix = `packages/${m.packageId}/${m.revisionId}`,
        from = inside(this.root, prefix);
      for (const f of await walk(from, { exclude: [] })) {
        await ctx.check();
        const relative = `${prefix}/${f.path}`,
          sha256 = await copyVerified(
            inside(this.root, relative),
            inside(destination, relative),
            () => ctx.check(),
          );
        const expected = f.path.startsWith("source/")
          ? m.files.find((item: any) => item.path === f.path.slice(7))?.sha256
          : undefined;
        if (expected && sha256 !== expected)
          throw new Error(`原件校验失败，备份未完成：${f.path}`);
        files.push({ path: relative, sha256, bytes: f.bytes });
      }
      ctx.progress("备份原件与许可证", ++done, revisions.length);
    }
    for (const v of variants) {
      const relative = `variants/${v.id}.json`;
      await atomicJSON(inside(destination, relative), v);
      files.push({
        path: relative,
        sha256: await hashFile(inside(destination, relative)),
        bytes: (await fs.stat(inside(destination, relative))).size,
      });
    }
    await atomicJSON(
      path.join(destination, "metadata", "catalog.json"),
      metadata,
    );
    files.push({
      path: "metadata/catalog.json",
      sha256: await hashFile(
        path.join(destination, "metadata", "catalog.json"),
      ),
      bytes: (await fs.stat(path.join(destination, "metadata", "catalog.json")))
        .size,
    });
    await fs.copyFile(
      path.join(this.root, "library.json"),
      path.join(destination, "library.json"),
    );
    files.push({
      path: "catalog.sqlite",
      sha256: await hashFile(path.join(destination, "catalog.sqlite")),
      bytes: (await fs.stat(path.join(destination, "catalog.sqlite"))).size,
    });
    files.push({
      path: "library.json",
      sha256: await hashFile(path.join(destination, "library.json")),
      bytes: (await fs.stat(path.join(destination, "library.json"))).size,
    });
    await atomicJSON(path.join(destination, "backup-manifest.json"), {
      schemaVersion: 1,
      createdAt: now(),
      files,
      assets: this.catalog.stats().assets,
    });
    return { target: destination, files: files.length };
  }
  async trimCache() {
    const folder = path.join(this.root, "cache"),
      entries = await walk(folder, { exclude: [] });
    let total = entries.reduce((n, f) => n + f.bytes, 0),
      budget = this.settings.cacheGB * 1024 ** 3;
    if (total <= budget) return;
    const ages = await Promise.all(
      entries.map(async (f) => ({
        ...f,
        mtime: (await fs.stat(inside(folder, f.path))).mtimeMs,
      })),
    );
    ages.sort((a, b) => a.mtime - b.mtime);
    for (const f of ages) {
      if (total <= budget) break;
      await fs.rm(inside(folder, f.path), { force: true });
      this.catalog.db
        .prepare("UPDATE assets SET thumbnail=NULL WHERE thumbnail=?")
        .run(f.path);
      total -= f.bytes;
    }
  }
  async restore(backup: string, target: string, ctx: JobContext) {
    const relative = path.relative(this.root, path.resolve(target));
    if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative)))
      throw new Error("请恢复到新的素材库目录");
    const list = await fs.readdir(target).catch(() => []);
    if (list.length) throw new Error("恢复目标目录必须为空");
    const manifest = await readJSON<any>(
      path.join(backup, "backup-manifest.json"),
    );
    if (manifest.schemaVersion !== 1) throw new Error("备份版本不支持");
    for (const [i, f] of manifest.files.entries()) {
      await ctx.check();
      if (
        (await hashFile(inside(backup, f.path), () => ctx.check())) !== f.sha256
      )
        throw new Error(`备份文件校验失败：${f.path}`);
      ctx.progress("校验备份", i + 1, manifest.files.length);
    }
    await fs.mkdir(target, { recursive: true });
    for (const f of manifest.files) {
      await ctx.check();
      const source = inside(backup, f.path);
      const stat = await fs.lstat(source);
      if (!stat.isFile() || stat.isSymbolicLink())
        throw new Error("备份包含非法文件");
      await copyVerified(source, inside(target, f.path), () => ctx.check());
    }
    const db = openDatabase(path.join(target, "catalog.sqlite"));
    for (const row of db.prepare("SELECT id,data FROM jobs").all()) {
      const job = JSON.parse(row.data);
      if (["queued", "running", "paused"].includes(job.status)) {
        job.status = "cancelled";
        job.stage = "恢复备份后未重放旧机器任务";
        db.prepare("UPDATE jobs SET data=? WHERE id=?").run(
          JSON.stringify(job),
          row.id,
        );
      }
    }
    db.prepare("UPDATE projects SET godot_path=NULL").run();
    for (const row of db.prepare("SELECT id,data FROM generation_runs").all()) {
      const run = JSON.parse(row.data);
      if (["queued", "running", "paused"].includes(run.status)) {
        run.status = "interrupted";
        for (const item of run.items)
          if (item.state === "submitting" && !item.remoteTaskId)
            item.state = "uncertain";
        db.prepare("UPDATE generation_runs SET data=? WHERE id=?").run(
          JSON.stringify(run),
          row.id,
        );
      }
    }
    for (const table of [
      "processing_runs",
      "agent_sessions",
      "processing_save_proposals",
    ] as const) {
      if (
        !db
          .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
          .get(table)
      )
        continue;
      for (const row of db.prepare(`SELECT id,data FROM ${table}`).all()) {
        const record = JSON.parse(row.data);
        if (
          table === "processing_runs" &&
          ["queued", "running", "paused"].includes(record.status)
        ) {
          record.status = "interrupted";
          for (const item of record.items)
            if (item.state !== "completed") item.state = "uncertain";
        }
        if (
          table === "agent_sessions" &&
          ["planning", "executing", "reviewing"].includes(record.state)
        )
          record.state = "needsInput";
        if (
          table === "processing_save_proposals" &&
          ["queued", "analyzing"].includes(record.state)
        ) {
          record.state = "interrupted";
          record.warnings.push("恢复备份后未重放识图调用，可使用已保存建议");
        }
        db.prepare(`UPDATE ${table} SET data=? WHERE id=?`).run(
          JSON.stringify(record),
          row.id,
        );
      }
    }
    db.close();
    const config = await readJSON<any>(path.join(target, "library.json"));
    await atomicJSON(path.join(target, "library.json"), {
      ...config,
      godotPath: "",
      blenderPath: "",
    });
    return { target, verified: manifest.files.length };
  }
  async convert(assetId: string, ctx: JobContext, projectId?: string) {
    const a = this.catalog.get(assetId);
    if (![".blend", ".fbx", ".obj"].includes(a.extension))
      throw new Error("转换入口支持 BLEND、FBX、OBJ");
    const output = path.join(this.root, "variants", "converted", a.id);
    await fs.mkdir(output, { recursive: true });
    const script = path.join(output, "convert.py");
    await fs.writeFile(
      script,
      `import bpy, sys\nargs=sys.argv[sys.argv.index('--')+1:]\nsource,dest=args\nif source.lower().endswith('.blend'):\n bpy.ops.wm.open_mainfile(filepath=source)\nelif source.lower().endswith('.fbx'):\n bpy.ops.import_scene.fbx(filepath=source)\nelse:\n bpy.ops.wm.obj_import(filepath=source)\nbpy.ops.export_scene.gltf(filepath=dest,export_format='GLB')\n`,
    );
    const dest = path.join(output, "preview.glb");
    await ctx.check();
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        this.settings.blenderPath,
        [
          "--background",
          "--factory-startup",
          "--disable-autoexec",
          "--python",
          script,
          "--",
          sourcePath(this.catalog, a),
          dest,
        ],
        { windowsHide: true, shell: false },
      );
      let logs = "";
      child.stderr.on("data", (d) => (logs += d.toString().slice(-2000)));
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Blender 转换超时"));
      }, 120000);
      const cancelled = setInterval(() => {
        if (ctx.job.status === "cancelled" || this.shuttingDown) {
          child.kill();
          clearInterval(cancelled);
        }
      }, 100);
      child.on("error", (e) => {
        clearTimeout(timeout);
        clearInterval(cancelled);
        reject(e);
      });
      child.on("exit", (code) => {
        clearTimeout(timeout);
        clearInterval(cancelled);
        if (ctx.job.status === "cancelled")
          return reject(new WorkshopError("CANCELLED", "任务已取消"));
        code === 0
          ? resolve()
          : reject(new Error(`Blender 转换失败：${logs.slice(-2000)}`));
      });
    });
    await ctx.check();
    const plan = await inspectImport([dest]);
    plan.tags = [...a.tags, "转换副本"];
    plan.source = a.source;
    plan.projectId = projectId;
    return runImport(this.catalog, plan, ctx);
  }
  async shutdown() {
    this.generation?.shutdown();
    this.processing?.shutdown();
    this.shuttingDown = true;
    while (this.active.size || this.coordinating.size)
      await new Promise((r) => setTimeout(r, 50));
    this.media?.close();
    await this.catalog.snapshot();
    this.catalog.close();
    for (const lock of this.locks) await fs.rm(lock, { force: true });
    this.locks.clear();
  }
}
