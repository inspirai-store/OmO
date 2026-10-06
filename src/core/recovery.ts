import fs from "node:fs/promises";
import path from "node:path";
import { Catalog, processingTables } from "./catalog";
import {
  atomicJSON,
  copyVerified,
  hashFile,
  inside,
  readJSON,
  walk,
} from "./files";
import type { PackageManifest } from "../shared/types";

// Build a new library; the damaged catalog and its originals are never modified.
export async function rebuildLibrary(
  source: string,
  target: string,
  check: () => Promise<void> = async () => {},
  progress: (done: number, total: number) => void = () => {},
) {
  source = path.resolve(source);
  target = path.resolve(target);
  const rel = path.relative(source, target);
  if (!rel || (!rel.startsWith("..") && !path.isAbsolute(rel)))
    throw new Error("重建目标必须在原库目录之外");
  if ((await fs.readdir(target).catch(() => [])).length)
    throw new Error("重建目标必须为空");
  const metadata = await readJSON<any>(
    path.join(source, "metadata", "catalog.json"),
    null,
  );
  const entries = (
    await walk(path.join(source, "packages"), { exclude: [] })
  ).filter((f) => /^[^/]+\/[^/]+\/manifest\.json$/.test(f.path));
  const catalog = new Catalog(target);
  let count = 0;
  try {
    for (const entry of entries) {
      await check();
      const manifest = await readJSON<PackageManifest>(
        inside(path.join(source, "packages"), entry.path),
      );
      if (manifest.schemaVersion !== 1) throw new Error("素材清单版本不支持");
      const prefix = `packages/${manifest.packageId}/${manifest.revisionId}`;
      for (const f of manifest.files) {
        await check();
        const from = inside(source, `${prefix}/source/${f.path}`);
        if ((await hashFile(from, check)) !== f.sha256)
          throw new Error(`原件校验失败：${f.path}`);
        await copyVerified(
          from,
          inside(target, `${prefix}/source/${f.path}`),
          check,
        );
      }
      await atomicJSON(inside(target, `${prefix}/manifest.json`), manifest);
      for (const f of await walk(inside(source, `${prefix}/licenses`), {
        exclude: [],
      }).catch(() => []))
        await copyVerified(
          inside(source, `${prefix}/licenses/${f.path}`),
          inside(target, `${prefix}/licenses/${f.path}`),
          check,
        );
      catalog.add(manifest, {});
      progress(++count, entries.length);
    }
    if (metadata?.schemaVersion === 1) {
      const recorded = new Set(
        (metadata.assetMetadata ?? []).map((r: any) => r.id),
      );
      for (const row of catalog.db
        .prepare("SELECT id,created_at FROM assets")
        .all())
        if (!recorded.has(row.id) && row.created_at <= metadata.createdAt)
          catalog.db.prepare("DELETE FROM assets WHERE id=?").run(row.id);
      for (const row of metadata.assetMetadata ?? []) {
        if (!catalog.db.prepare("SELECT 1 FROM assets WHERE id=?").get(row.id))
          continue;
        const media = JSON.parse(row.metadata);
        delete media.previewCache;
        catalog.update([row.id], {
          title: row.title,
          category: row.category,
          tags: JSON.parse(row.tags),
          notes: row.notes,
          favorite: !!row.favorite,
          trashed: !!row.trashed,
          metadata: media,
        });
      }
      const tables = [
        "projects",
        "collections",
        "variants",
        "project_assets",
        "collection_assets",
        "provenance",
        "generation_runs",
        "generation_candidates",
        "generation_inputs",
        "generation_templates",
        ...processingTables,
      ];
      catalog.db.transaction(() => {
        for (const table of tables) {
          const columns = catalog.db
            .prepare(`PRAGMA table_info(${table})`)
            .all()
            .map((c: any) => c.name);
          const stmt = catalog.db.prepare(
            `INSERT OR REPLACE INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
          );
          for (const row of metadata.tables?.[table] ?? [])
            stmt.run(...columns.map((c: string) => row[c] ?? null));
        }
      })();
    }
    for (const table of [
      "generation_inputs",
      "generation_candidates",
      "processing_inputs",
      "processing_artifacts",
    ] as const)
      for (const record of catalog.generationList<any>(table, 100000)) {
        await check();
        const from = inside(source, record.relativePath);
        if ((await hashFile(from, check)) !== record.sha256)
          throw new Error("生成图片校验失败");
        await copyVerified(from, inside(target, record.relativePath), check);
      }
    for (const v of catalog.variants())
      await atomicJSON(inside(target, `variants/${v.id}.json`), v);
    for (const run of catalog.generationList<any>("generation_runs", 100000)) {
      if (["queued", "running", "paused"].includes(run.status))
        run.status = "interrupted";
      for (const item of run.items)
        if (item.state === "submitting" && !item.remoteTaskId)
          item.state = "uncertain";
      catalog.generationSave("generation_runs", run);
    }
    catalog.db.prepare("UPDATE projects SET godot_path=NULL").run();
    for (const run of catalog.generationList<any>("processing_runs", 100000)) {
      if (["queued", "running", "paused"].includes(run.status)) {
        run.status = "interrupted";
        for (const item of run.items)
          if (item.state !== "completed") item.state = "uncertain";
      }
      catalog.generationSave("processing_runs", run);
    }
    for (const session of catalog.generationList<any>(
      "agent_sessions",
      100000,
    )) {
      if (["planning", "executing", "reviewing"].includes(session.state))
        session.state = "needsInput";
      catalog.generationSave("agent_sessions", session);
    }
    for (const proposal of catalog.generationList<any>(
      "processing_save_proposals",
      100000,
    )) {
      if (["queued", "analyzing"].includes(proposal.state)) {
        proposal.state = "interrupted";
        proposal.warnings.push("重建素材库后未重放识图调用，可使用已保存建议");
      }
      catalog.generationSave("processing_save_proposals", proposal);
    }
    await atomicJSON(path.join(target, "library.json"), {
      ...(await readJSON<any>(path.join(source, "library.json"))),
      godotPath: "",
      blenderPath: "",
    });
    await catalog.snapshot();
    return {
      target,
      packages: count,
      assets: catalog.stats().assets,
      metadataRecovered: !!metadata,
    };
  } finally {
    catalog.close();
  }
}
