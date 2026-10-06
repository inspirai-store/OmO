import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import type { Runtime } from "./runtime";
import { querySchema, organizeSchema } from "./schemas";
import { organizedTitle } from "../shared/organize";
import { atomicJSON, inside, uid } from "./files";
import { inspectExport, runExport } from "./exporter";
import type { JobContext } from "./importer";
import type { Asset, AssetSelection } from "../shared/types";
const id = z.string().min(1).max(100);
const idsSchema = z.array(id).min(1).max(100000);
export async function handleCommand(
  rt: Runtime,
  method: string,
  input: any,
): Promise<{ value: any } | undefined> {
  const c = rt.catalog;
  switch (method) {
    case "materials.usage": {
      const assetId = id.parse(input.assetId);
      return {
        value: Object.fromEntries(
          c.variants(assetId).map((v) => [
            v.id,
            c.db
              .prepare(
                "SELECT p.name FROM projects p JOIN project_assets pa ON p.id=pa.project_id WHERE pa.variant_id=?",
              )
              .all(v.id)
              .map((p: any) => p.name),
          ]),
        ),
      };
    }
    case "materials.textures": {
      const assetId = id.parse(input.assetId),
        ids = new Set<string>();
      for (const v of c.variants(assetId))
        for (const b of Object.values(v.bindings)) if (b) ids.add(b.assetId);
      return { value: [...ids].map((id) => rt.asset(c.get(id))) };
    }
    case "assets.copyValues": {
      const v = z
        .object({
          assetIds: idsSchema,
          field: z.enum(["title", "id", "path", "original", "source"]),
        })
        .parse(input);
      return {
        value: v.assetIds
          .map((id) => {
            const a = c.get(id);
            return v.field === "original"
              ? inside(
                  rt.root,
                  `packages/${a.packageId}/${a.revisionId}/source/${a.path}`,
                )
              : v.field === "path"
                ? `packages/${a.packageId}/${a.revisionId}/source/${a.path}`
                : v.field === "source"
                  ? (a.source?.pageUrl ?? "")
                  : a[v.field];
          })
          .join("\n"),
      };
    }
    case "assets.selectedPage": {
      const v = z
        .object({
          ids: idsSchema,
          offset: z.number().int().nonnegative().default(0),
        })
        .parse(input);
      return {
        value: v.ids
          .slice(v.offset, v.offset + 100)
          .map((id) => rt.asset(c.get(id))),
      };
    }
    case "assets.dependencies": {
      const ids = idsSchema.parse(input.ids),
        issues: string[] = [];
      for (const id of ids) {
        const a = c.get(id);
        for (const d of c
          .revision(a.revisionId)
          .dependencies.filter(
            (d) => d.from === a.path && d.status !== "resolved",
          ))
          issues.push(
            `${a.title}：${d.status === "remote" ? "远程依赖未加载" : "缺少依赖"} ${d.target}`,
          );
      }
      return { value: { count: ids.length, issues } };
    }
    case "materials.forAssets": {
      const ids = new Set(idsSchema.parse(input.ids));
      return { value: c.variants().filter((v) => ids.has(v.assetId)) };
    }
    case "materials.matchCandidates": {
      const ids = idsSchema.parse(input.ids),
        textures = new Map<string, any>();
      for (const id of ids) {
        const a = c.get(id);
        if (a.metadata.materialSet) {
          for (const file of Object.values(a.metadata.materialSet)) {
            if (typeof file !== "string") continue;
            const row = c.db
              .prepare("SELECT id FROM assets WHERE revision_id=? AND path=?")
              .get(a.revisionId, file);
            if (row) {
              const t = c.get(row.id);
              textures.set(t.id, rt.asset(t));
            }
          }
        } else if (a.capabilities.preview === "image")
          textures.set(a.id, rt.asset(a));
      }
      return { value: [...textures.values()] };
    }
    case "assets.selection": {
      const request = z
        .object({ ids: idsSchema.optional(), query: querySchema.optional() })
        .parse(input);
      const page = request.ids
        ? undefined
        : c.query({ ...request.query, offset: 0, limit: 100000 }, true);
      if (page && page.total > 100000)
        throw new Error("一次最多选择十万个素材，请先缩小筛选范围");
      const ids = request.ids
        ? [...new Set(request.ids)]
        : page!.items.map((a) => a.id);
      const rows = c.db
        .prepare(
          "SELECT * FROM assets WHERE id IN(SELECT value FROM json_each(?))",
        )
        .all(JSON.stringify(ids));
      if (rows.length !== ids.length)
        throw new Error("部分素材已不存在，请重新选择");
      const all: Asset[] = rows.map((r: any) => c.hydrate(r));
      const sampleIds = new Set(ids.slice(0, 12)),
        sampleMap = new Map<string, (typeof all)[number]>();
      for (const a of all) if (sampleIds.has(a.id)) sampleMap.set(a.id, a);
      const value: AssetSelection = {
        ids,
        count: ids.length,
        sample: ids.slice(0, 12).map((i) => rt.asset(sampleMap.get(i)!)),
        allImages:
          !!all.length && all.every((a) => a.capabilities.preview === "image"),
        allPreviewable:
          !!all.length &&
          all.every((a) => a.capabilities.preview !== "archive"),
        allFavorite: !!all.length && all.every((a) => a.favorite),
        allTrashed: !!all.length && all.every((a) => a.trashed),
        allAuxiliary:
          !!all.length &&
          all.every((a) => a.metadata.auxiliaryRole === "preview"),
      };
      return { value };
    }
    case "assets.organize": {
      const plan = organizeSchema.parse(input),
        ids = [...new Set(plan.ids)];
      const assetGroup = plan.group
        ? { id: uid(), name: plan.group.name }
        : null;
      // Validate the entire plan before the first write; title rules operate on display names only.
      const changes = ids.map((id, i) => {
        const a = c.get(id),
          title = organizedTitle(a.title, i, plan.title);
        if (!title || title.length > 200)
          throw new Error(`标题长度无效：${a.title}`);
        if (
          plan.auxiliaryRole !== undefined &&
          a.capabilities.preview !== "image"
        )
          throw new Error("辅助预览标记只支持图片");
        const tags = plan.tags
          ? plan.replaceTags
            ? plan.tags
            : [...new Set([...a.tags, ...plan.tags])]
          : a.tags;
        if (tags.length > 200) throw new Error(`${a.title} 的标签超过 200 个`);
        return {
          id,
          change: {
            title,
            tags,
            ...(plan.category ? { category: plan.category } : {}),
            metadata: {
              ...(plan.entityCategory !== undefined
                ? { entityCategory: plan.entityCategory }
                : {}),
              ...(plan.gameplayTags !== undefined
                ? { gameplayTags: plan.gameplayTags }
                : {}),
              ...(plan.group !== undefined ? { assetGroup } : {}),
              ...(plan.auxiliaryRole !== undefined
                ? { auxiliaryRole: plan.auxiliaryRole }
                : {}),
            },
          },
        };
      });
      if (plan.projectId && !c.projects().some((p) => p.id === plan.projectId))
        throw new Error("项目不存在");
      if (
        plan.collectionId &&
        !c.collections().some((v) => v.id === plan.collectionId && !v.query)
      )
        throw new Error("请选择普通收藏集");
      c.db.transaction(() => {
        changes.forEach((v) => c.update([v.id], v.change));
        if (plan.projectId) c.attach(plan.projectId, ids);
        if (plan.collectionId) c.collect(plan.collectionId, ids);
      })();
      await rt.changed();
      return { value: { count: ids.length } };
    }
    case "collections.update": {
      const v = z
        .object({
          id,
          name: z.string().min(1).max(100),
          query: querySchema.optional(),
        })
        .parse(input);
      if (!c.collections().some((vv) => vv.id === v.id))
        throw new Error("收藏集不存在");
      c.saveCollection(v.name, v.query, v.id);
      await rt.changed();
      return { value: true };
    }
    case "collections.detach": {
      const v = z
        .object({ collectionId: id, assetIds: idsSchema })
        .parse(input);
      if (!c.collections().some((vv) => vv.id === v.collectionId && !vv.query))
        throw new Error("智能收藏集由规则管理");
      c.db.transaction(() =>
        v.assetIds.forEach((a) =>
          c.db
            .prepare(
              "DELETE FROM collection_assets WHERE collection_id=? AND asset_id=?",
            )
            .run(v.collectionId, a),
        ),
      )();
      await rt.changed();
      return { value: true };
    }
    case "collections.delete":
      c.db
        .prepare("DELETE FROM collections WHERE id=?")
        .run(id.parse(input.id));
      await rt.changed();
      return { value: true };
    case "materials.manage": {
      const v = z
        .object({
          id,
          action: z.enum(["copy", "rename", "delete"]),
          name: z.string().min(1).max(200).optional(),
        })
        .parse(input);
      const old = c.variants().find((x) => x.id === v.id);
      if (!old) throw new Error("变体不存在");
      if (v.action === "delete") {
        if (
          c.db
            .prepare("SELECT 1 FROM project_assets WHERE variant_id=?")
            .get(old.id)
        )
          throw new Error("该变体仍被项目引用，请先更改项目关联");
        // Move the persistent record out of service before removing its catalog row.
        const file = inside(rt.root, `variants/${old.id}.json`),
          tomb = inside(rt.root, `trash/variant-${old.id}.json`);
        await fs.rename(file, tomb).catch((e: any) => {
          if (e.code !== "ENOENT") throw e;
        });
        c.db.prepare("DELETE FROM variants WHERE id=?").run(old.id);
        await rt.changed();
        return { value: true };
      }
      const value = {
        ...old,
        id: v.action === "copy" ? uid() : old.id,
        name: v.name ?? `${old.name} 副本`,
      };
      await atomicJSON(inside(rt.root, `variants/${value.id}.json`), value);
      c.saveVariant(value);
      await rt.changed();
      return { value };
    }
    case "previews.rebuild": {
      const ids = [...new Set(idsSchema.parse(input.ids))];
      ids.forEach((i) => c.get(i));
      return {
        value: rt.start("thumbnails", { ids }, `重建 ${ids.length} 个缩略图`)
          .id,
      };
    }
    case "exports.quick": {
      const v = z
        .object({
          projectId: id,
          assetIds: idsSchema.optional(),
          variantIds: z.array(id).optional(),
          aggregate: z.boolean().optional(),
        })
        .parse(input);
      const project = c.projects().find((p) => p.id === v.projectId);
      if (!project?.godotPath) throw new Error("此项目未绑定 Godot 工程");
      const rows = c.db
        .prepare(
          "SELECT asset_id,variant_id FROM project_assets WHERE project_id=?",
        )
        .all(project.id);
      const assetIds = v.assetIds ?? rows.map((r: any) => r.asset_id);
      if (!assetIds.length) throw new Error("项目中没有素材");
      const variants =
        v.variantIds ??
        rows
          .filter((r: any) => assetIds.includes(r.asset_id) && r.variant_id)
          .map((r: any) => r.variant_id);
      const plan = inspectExport(c, {
        assetIds,
        variantIds: variants,
        target: project.godotPath,
        mode: "godot",
        aggregate: v.aggregate,
      });
      if (
        !(await fs
          .stat(path.join(project.godotPath, "project.godot"))
          .catch(() => null))
      )
        plan.issues.push("绑定目录中没有 project.godot，请重新绑定工程");
      rt.plans.set(plan.id, plan);
      if (!plan.issues.length) {
        const probeId = uid();
        const ctx = {
          job: { id: probeId },
          check: async () => {},
          progress: () => {},
          event: () => {},
        } as unknown as JobContext;
        try {
          await runExport(c, plan, ctx, true);
        } catch (e: any) {
          plan.issues.push(e.message);
        } finally {
          await fs.rm(inside(rt.root, `staging/${probeId}-export`), {
            recursive: true,
            force: true,
          });
        }
      }
      return {
        value: plan.issues.length
          ? { plan }
          : {
              jobId: rt.start("export", plan, `导出到 ${project.name}`).id,
              plan,
            },
      };
    }
    default:
      return undefined;
  }
}
