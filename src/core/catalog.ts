import { openDatabase } from "./sqlite";
import path from "node:path";
import fs from "node:fs";
import { uid, now, atomicJSON } from "./files";
import {
  entityMetadata,
  entityCategories,
  gameplayTags,
} from "../shared/entities";
import type {
  Asset,
  AssetPage,
  AssetQuery,
  Collection,
  Job,
  MaterialVariant,
  PackageManifest,
  Project,
  Stats,
} from "../shared/types";

const json = (v: unknown) => JSON.stringify(v);
export const processingTables = [
  "family_templates",
  "family_batches",
  "processing_inputs",
  "processing_runs",
  "processing_artifacts",
  "processing_recipes",
  "agent_sessions",
  "processing_save_proposals",
  "processing_organize_cache",
  "processing_save_items",
] as const;
type RecordTable =
  | "generation_runs"
  | "generation_candidates"
  | "generation_inputs"
  | "generation_templates"
  | (typeof processingTables)[number];
export class Catalog {
  db: any;
  private snapshotTail: Promise<void> = Promise.resolve();
  constructor(public root: string) {
    fs.mkdirSync(root, { recursive: true });
    this.db = openDatabase(path.join(root, "catalog.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS revisions(id TEXT PRIMARY KEY,package_id TEXT NOT NULL,hash TEXT UNIQUE NOT NULL,manifest TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,revision_id TEXT NOT NULL REFERENCES revisions(id),package_id TEXT NOT NULL,path TEXT NOT NULL,title TEXT NOT NULL,category TEXT NOT NULL,extension TEXT NOT NULL,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,metadata TEXT NOT NULL,tags TEXT NOT NULL,dependencies TEXT NOT NULL,related_paths TEXT NOT NULL,source TEXT,notes TEXT NOT NULL DEFAULT '',favorite INTEGER NOT NULL DEFAULT 0,trashed INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,viewed_at TEXT,search_text TEXT NOT NULL,thumbnail TEXT);
      CREATE INDEX IF NOT EXISTS asset_category ON assets(category,trashed,created_at);
      CREATE INDEX IF NOT EXISTS asset_extension ON assets(extension);
      CREATE INDEX IF NOT EXISTS asset_sha ON assets(sha256);
      CREATE INDEX IF NOT EXISTS asset_revision ON assets(revision_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS asset_search USING fts5(search_text,content='assets',content_rowid='rowid',tokenize='trigram');
      CREATE TRIGGER IF NOT EXISTS assets_ai AFTER INSERT ON assets BEGIN INSERT INTO asset_search(rowid,search_text) VALUES(new.rowid,new.search_text); END;
      CREATE TRIGGER IF NOT EXISTS assets_ad AFTER DELETE ON assets BEGIN INSERT INTO asset_search(asset_search,rowid,search_text) VALUES('delete',old.rowid,old.search_text); END;
      CREATE TRIGGER IF NOT EXISTS assets_au AFTER UPDATE OF search_text ON assets BEGIN INSERT INTO asset_search(asset_search,rowid,search_text) VALUES('delete',old.rowid,old.search_text); INSERT INTO asset_search(rowid,search_text) VALUES(new.rowid,new.search_text); END;
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL,color TEXT NOT NULL,godot_path TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS project_assets(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,asset_id TEXT NOT NULL REFERENCES assets(id),revision_id TEXT NOT NULL,variant_id TEXT,PRIMARY KEY(project_id,asset_id));
      CREATE TABLE IF NOT EXISTS collections(id TEXT PRIMARY KEY,name TEXT NOT NULL,query TEXT);
      CREATE TABLE IF NOT EXISTS collection_assets(collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,asset_id TEXT NOT NULL REFERENCES assets(id),PRIMARY KEY(collection_id,asset_id));
      CREATE TABLE IF NOT EXISTS variants(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES assets(id),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS exports(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS provenance(id TEXT PRIMARY KEY,revision_id TEXT NOT NULL REFERENCES revisions(id),data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS generation_runs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS generation_candidates(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS generation_inputs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS generation_templates(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS family_templates(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS family_batches(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS processing_inputs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS processing_runs(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS processing_artifacts(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS processing_recipes(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS processing_save_proposals(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS processing_organize_cache(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS processing_save_items(id TEXT PRIMARY KEY,data TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS processing_save_filename ON processing_save_items(json_extract(data,'$.filename'));
      PRAGMA user_version = 1;
    `);
    // A one-time, additive migration also covers libraries created before entity classification.
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS workshop_migrations(id TEXT PRIMARY KEY)",
    );
    if (
      !this.db
        .prepare("SELECT 1 FROM workshop_migrations WHERE id='entities-v1'")
        .get()
    ) {
      this.db.transaction(() => {
        for (const row of this.db.prepare("SELECT * FROM assets").all()) {
          const a = this.hydrate(row);
          this.update([a.id], { metadata: entityMetadata(a) });
        }
        this.db
          .prepare("INSERT INTO workshop_migrations VALUES('entities-v1')")
          .run();
      })();
    }
  }
  close() {
    this.db.close();
  }
  hydrate(row: any): Asset {
    const metadata = JSON.parse(row.metadata);
    const ext = row.extension;
    const preview = metadata.skin
      ? "skin"
      : metadata.materialSet
      ? "material"
      : [".glb", ".gltf", ".obj", ".fbx"].includes(ext)
        ? "model"
        : [".dds", ".ktx2"].includes(ext)
          ? "material"
          : [".hdr", ".exr"].includes(ext)
            ? "environment"
            : row.thumbnail ||
                [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(ext)
              ? "image"
              : "archive";
    return {
      id: row.id,
      packageId: row.package_id,
      revisionId: row.revision_id,
      fileId: metadata.fileId ?? row.id,
      path: row.path,
      title: row.title,
      category: row.category,
      extension: ext,
      bytes: row.bytes,
      sha256: row.sha256,
      metadata,
      tags: JSON.parse(row.tags),
      dependencies: JSON.parse(row.dependencies),
      relatedPaths: JSON.parse(row.related_paths),
      source: row.source ? JSON.parse(row.source) : undefined,
      notes: row.notes,
      favorite: !!row.favorite,
      trashed: !!row.trashed,
      createdAt: row.created_at,
      viewedAt: row.viewed_at,
      thumbnailUrl: row.thumbnail
        ? `workshop://cache/${row.thumbnail}`
        : undefined,
      capabilities: {
        preview,
        reason:
          metadata.previewError ??
          (preview === "archive"
            ? "此格式保存原件，可使用外部工具打开"
            : undefined),
      },
    };
  }
  get(id: string): Asset {
    const row = this.db.prepare("SELECT * FROM assets WHERE id=?").get(id);
    if (!row) throw new Error("素材不存在");
    return this.hydrate(row);
  }
  revision(id: string): PackageManifest {
    const row = this.db
      .prepare("SELECT manifest FROM revisions WHERE id=?")
      .get(id) as any;
    if (!row) throw new Error("素材版本不存在");
    return JSON.parse(row.manifest);
  }
  private filter(q: AssetQuery, auxiliaryOnly = false, preview = false) {
    if (q.collectionId) {
      const collection = this.db
        .prepare("SELECT query FROM collections WHERE id=?")
        .get(q.collectionId) as any;
      if (collection?.query)
        q = { ...JSON.parse(collection.query), ...q, collectionId: undefined };
    }
    const clauses = ["a.trashed=?"];
    const values: any[] = [q.trash ? 1 : 0];
    const includeAuxiliary = q.includeAuxiliary ?? !!(q.showRelated || q.trash);
    if (!includeAuxiliary)
      clauses.push(
        "COALESCE(json_extract(a.metadata,'$.auxiliaryRole'),'') <> 'preview'",
      );
    if (auxiliaryOnly)
      clauses.push("json_extract(a.metadata,'$.auxiliaryRole')='preview'");
    if (!q.showRelated && !q.search && !q.trash && !includeAuxiliary)
      clauses.push(
        "COALESCE(json_extract(a.metadata,'$.dependent'),0)=0 AND COALESCE(json_extract(a.metadata,'$.groupMember'),0)=0",
      );
    if (q.category) {
      clauses.push("a.category=?");
      values.push(q.category);
    }
    if (q.entityCategory) {
      clauses.push("json_extract(a.metadata,'$.entityCategory')=?");
      values.push(q.entityCategory);
    }
    if (q.gameplayTag) {
      clauses.push(
        "EXISTS(SELECT 1 FROM json_each(a.metadata,'$.gameplayTags') WHERE value=?)",
      );
      values.push(q.gameplayTag);
    }
    if (q.projectId) {
      clauses.push(
        "EXISTS(SELECT 1 FROM project_assets p WHERE p.asset_id=a.id AND p.project_id=?)",
      );
      values.push(q.projectId);
    }
    if (q.collectionId) {
      clauses.push(
        "EXISTS(SELECT 1 FROM collection_assets c WHERE c.asset_id=a.id AND c.collection_id=?)",
      );
      values.push(q.collectionId);
    }
    if (q.imageOnly)
      clauses.push(
        "a.extension IN('.png','.jpg','.jpeg','.webp','.tif','.tiff','.svg')",
      );
    if (q.modelOnly) clauses.push("a.extension IN('.glb','.gltf')");
    if (q.favorite) clauses.push("a.favorite=1");
    if (q.recent) clauses.push("a.viewed_at IS NOT NULL");
    if (q.unsorted) clauses.push("a.tags='[]'");
    if (q.extension) {
      clauses.push("a.extension=?");
      values.push(
        q.extension.startsWith(".") ? q.extension : `.${q.extension}`,
      );
    }
    if (q.license) {
      clauses.push("json_extract(a.source,'$.license')=?");
      values.push(q.license);
    }
    if (q.minWidth) {
      clauses.push("json_extract(a.metadata,'$.width')>=?");
      values.push(q.minWidth);
    }
    if (q.maxTriangles) {
      clauses.push("json_extract(a.metadata,'$.triangles')<=?");
      values.push(q.maxTriangles);
    }
    if (q.hasAnimation)
      clauses.push(
        "json_array_length(json_extract(a.metadata,'$.animations'))>0",
      );
    if (q.missing)
      clauses.push("json_array_length(json_extract(a.metadata,'$.missing'))>0");
    const search = q.search?.normalize("NFKC").toLowerCase().trim();
    if (search) {
      if ([...search].length >= 3) {
        clauses.push(
          preview
            ? "a.rowid IN(SELECT rowid FROM processing_draft_search WHERE processing_draft_search MATCH ?)"
            : "a.rowid IN(SELECT rowid FROM asset_search WHERE asset_search MATCH ?)",
        );
        values.push(`"${search.replace(/"/g, '""')}"`);
      } else {
        clauses.push("a.search_text LIKE ? ESCAPE '\\'");
        values.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`);
      }
    }
    const where = clauses.join(" AND ");
    return { q, where, values };
  }
  query(q: AssetQuery = {}, idsOnly = false, auxiliaryOnly = false): AssetPage {
    const filter = this.filter(q, auxiliaryOnly);
    q = filter.q;
    const { where, values } = filter;
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) n FROM assets a WHERE ${where}`)
        .get(...values) as any
    ).n;
    const order =
      q.sort === "title"
        ? "a.title COLLATE NOCASE,a.id"
        : q.sort === "size"
          ? "a.bytes DESC,a.id"
          : q.sort === "viewed" || q.recent
            ? "a.viewed_at DESC,a.id"
            : "a.created_at DESC,a.title,a.id";
    const limit = Math.min(
        Math.max(q.limit ?? 100, 1),
        idsOnly ? 100000 : 1000,
      ),
      offset = Math.max(q.offset ?? 0, 0);
    const rows = this.db
      .prepare(
        `SELECT ${idsOnly ? "a.id" : "a.*"} FROM assets a WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset);
    return {
      items: idsOnly ? rows : rows.map((r: any) => this.hydrate(r)),
      total,
      offset,
      limit,
    };
  }
  matchesDraft(
    q: AssetQuery,
    draft: {
      id: string;
      category: string;
      extension: string;
      tags: string[];
      metadata: any;
      source?: any;
      searchText: string;
      projectIds: string[];
      collectionIds: string[];
      favorite?: boolean;
      viewedAt?: string;
    },
  ) {
    const { where, values } = this.filter(q, false, true);
    this.db.exec(
      "CREATE VIRTUAL TABLE IF NOT EXISTS temp.processing_draft_search USING fts5(search_text,tokenize='trigram')",
    );
    this.db.prepare("DELETE FROM processing_draft_search").run();
    this.db
      .prepare(
        "INSERT INTO processing_draft_search(rowid,search_text) VALUES(1,?)",
      )
      .run(draft.searchText);
    try {
      return !!this.db
        .prepare(
          `WITH assets AS (
        SELECT 1 rowid,? id,? category,? extension,? tags,? metadata,? source,? search_text,0 trashed,? favorite,? viewed_at
      ), project_assets AS (SELECT value project_id,? asset_id FROM json_each(?)),
      collection_assets AS (SELECT value collection_id,? asset_id FROM json_each(?))
      SELECT 1 FROM assets a WHERE ${where}`,
        )
        .get(
          draft.id,
          draft.category,
          draft.extension,
          json(draft.tags),
          json(draft.metadata),
          draft.source ? json(draft.source) : null,
          draft.searchText,
          Number(!!draft.favorite),
          draft.viewedAt ?? null,
          draft.id,
          json(draft.projectIds),
          draft.id,
          json(draft.collectionIds),
          ...values,
        );
    } finally {
      this.db.prepare("DELETE FROM processing_draft_search").run();
    }
  }
  add(manifest: PackageManifest, thumbnails: Record<string, string>) {
    for (const a of manifest.assets)
      a.metadata = { ...a.metadata, ...entityMetadata(a) };
    const duplicate = this.db
      .prepare("SELECT id FROM revisions WHERE hash=?")
      .get(manifest.contentHash) as any;
    if (duplicate) {
      if (manifest.source)
        this.db
          .prepare("INSERT INTO provenance VALUES(?,?,?)")
          .run(uid(), duplicate.id, json(manifest.source));
      return {
        duplicate: true,
        revisionId: duplicate.id,
        assets: this.db
          .prepare("SELECT id FROM assets WHERE revision_id=?")
          .all(duplicate.id)
          .map((r: any) => r.id),
      };
    }
    const insert = this.db.prepare(
      "INSERT INTO assets(id,revision_id,package_id,path,title,category,extension,bytes,sha256,metadata,tags,dependencies,related_paths,source,created_at,search_text,thumbnail) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    this.db.transaction(() => {
      this.db
        .prepare("INSERT INTO revisions VALUES(?,?,?,?,?)")
        .run(
          manifest.revisionId,
          manifest.packageId,
          manifest.contentHash,
          json(manifest),
          manifest.createdAt,
        );
      const fileMap = new Map(manifest.files.map((f) => [f.path, f]));
      for (const a of manifest.assets) {
        const f = fileMap.get(a.path)!;
        const search = [
          a.title,
          a.path,
          ...a.tags,
          manifest.source?.author,
          manifest.source?.provider,
          manifest.source?.assetId,
          entityCategories[
            a.metadata.entityCategory as keyof typeof entityCategories
          ],
          ...(a.metadata.gameplayTags ?? []).map(
            (t: keyof typeof gameplayTags) => gameplayTags[t],
          ),
          a.metadata.assetGroup?.name,
          a.metadata.skinResource?.skinId,
        ]
          .filter(Boolean)
          .join(" ")
          .normalize("NFKC")
          .toLowerCase();
        insert.run(
          a.id,
          manifest.revisionId,
          manifest.packageId,
          a.path,
          a.title,
          a.category,
          f.extension,
          f.bytes,
          f.sha256,
          json({ ...f.metadata, ...a.metadata, fileId: f.id }),
          json(a.tags),
          json(a.dependencies),
          json(a.relatedPaths ?? []),
          a.metadata.portableSource
            ? json(a.metadata.portableSource)
            : manifest.source
              ? json(manifest.source)
              : null,
          manifest.createdAt,
          search,
          thumbnails[a.path] ?? null,
        );
      }
    })();
    return {
      duplicate: false,
      revisionId: manifest.revisionId,
      assets: manifest.assets.map((a) => a.id),
    };
  }
  update(
    ids: string[],
    change: Partial<
      Pick<
        Asset,
        "title" | "category" | "tags" | "notes" | "favorite" | "trashed"
      >
    > & { metadata?: any },
  ) {
    this.db.transaction(() => {
      for (const id of ids) {
        const a = { ...this.get(id), ...change };
        if (change.metadata)
          a.metadata = { ...this.get(id).metadata, ...change.metadata };
        const search = [
          a.title,
          a.path,
          ...a.tags,
          a.notes,
          a.source?.author,
          a.source?.provider,
          a.source?.assetId,
          entityCategories[
            a.metadata.entityCategory as keyof typeof entityCategories
          ],
          ...(a.metadata.gameplayTags ?? []).map(
            (t: keyof typeof gameplayTags) => gameplayTags[t],
          ),
          a.metadata.assetGroup?.name,
              a.metadata.skinResource?.skinId,
        ]
          .filter(Boolean)
          .join(" ")
          .normalize("NFKC")
          .toLowerCase();
        this.db
          .prepare(
            "UPDATE assets SET title=?,category=?,tags=?,notes=?,favorite=?,trashed=?,metadata=?,search_text=? WHERE id=?",
          )
          .run(
            a.title,
            a.category,
            json(a.tags),
            a.notes,
            +a.favorite,
            +a.trashed,
            json(a.metadata),
            search,
            id,
          );
      }
    })();
  }
  viewed(id: string) {
    this.db.prepare("UPDATE assets SET viewed_at=? WHERE id=?").run(now(), id);
  }
  setThumbnail(id: string, file: string) {
    this.db.prepare("UPDATE assets SET thumbnail=? WHERE id=?").run(file, id);
  }
  projects(): Project[] {
    return (
      this.db
        .prepare(
          "SELECT p.*,COUNT(a.id) asset_count FROM projects p LEFT JOIN project_assets pa ON pa.project_id=p.id LEFT JOIN assets a ON a.id=pa.asset_id AND a.trashed=0 AND COALESCE(json_extract(a.metadata,'$.auxiliaryRole'),'') <> 'preview' GROUP BY p.id ORDER BY p.created_at",
        )
        .all() as any[]
    ).map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      color: p.color,
      godotPath: p.godot_path ?? undefined,
      createdAt: p.created_at,
      assetCount: p.asset_count,
    }));
  }
  saveProject(input: Partial<Project> & { name: string }) {
    const id = input.id || uid();
    const old = this.projects().find((p) => p.id === id);
    this.db
      .prepare(
        "INSERT INTO projects VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description,color=excluded.color,godot_path=excluded.godot_path",
      )
      .run(
        id,
        input.name,
        input.description ?? old?.description ?? "",
        input.color ?? old?.color ?? "#c2a777",
        input.godotPath ?? old?.godotPath ?? null,
        old?.createdAt ?? now(),
      );
    return this.projects().find((p) => p.id === id)!;
  }
  attach(projectId: string, ids: string[], variantId?: string) {
    const insert = this.db.prepare(
      "INSERT INTO project_assets VALUES(?,?,?,?) ON CONFLICT(project_id,asset_id) DO UPDATE SET variant_id=excluded.variant_id",
    );
    this.db.transaction(() => {
      for (const id of ids) {
        const a = this.get(id);
        if (
          variantId &&
          !this.variants(a.id).some(
            (v) => v.id === variantId && v.revisionId === a.revisionId,
          )
        )
          throw new Error("所选变体不属于该素材版本");
        insert.run(projectId, id, a.revisionId, variantId ?? null);
      }
    })();
  }
  detach(projectId: string, ids: string[]) {
    this.db.transaction(() =>
      ids.forEach((id) =>
        this.db
          .prepare(
            "DELETE FROM project_assets WHERE project_id=? AND asset_id=?",
          )
          .run(projectId, id),
      ),
    )();
  }
  collections(): Collection[] {
    return (
      this.db
        .prepare(
          "SELECT c.*,COUNT(a.id) count FROM collections c LEFT JOIN collection_assets ca ON ca.collection_id=c.id LEFT JOIN assets a ON a.id=ca.asset_id AND a.trashed=0 AND COALESCE(json_extract(a.metadata,'$.auxiliaryRole'),'') <> 'preview' GROUP BY c.id",
        )
        .all() as any[]
    ).map((c) => ({
      id: c.id,
      name: c.name,
      query: c.query ? JSON.parse(c.query) : undefined,
      count: c.query ? this.query(JSON.parse(c.query)).total : c.count,
    }));
  }
  saveCollection(name: string, query?: AssetQuery, existingId?: string) {
    const id = existingId || uid();
    this.db
      .prepare(
        "INSERT INTO collections VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,query=excluded.query",
      )
      .run(id, name, query ? json(query) : null);
    return id;
  }
  collect(id: string, ids: string[]) {
    const collection = this.db
      .prepare("SELECT query FROM collections WHERE id=?")
      .get(id);
    if (!collection) throw new Error("收藏集不存在");
    if (collection.query) throw new Error("智能收藏集由筛选规则管理");
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO collection_assets VALUES(?,?)",
    );
    this.db.transaction(() => ids.forEach((a) => insert.run(id, a)))();
  }
  variants(assetId?: string): MaterialVariant[] {
    return (
      assetId
        ? this.db
            .prepare("SELECT data FROM variants WHERE asset_id=?")
            .all(assetId)
        : this.db.prepare("SELECT data FROM variants").all()
    ).map((r: any) => JSON.parse(r.data));
  }
  saveVariant(v: MaterialVariant) {
    const a = this.get(v.assetId);
    if (a.revisionId !== v.revisionId)
      throw new Error("材质变体与模型版本不一致");
    const value = { ...v, id: v.id || uid(), createdAt: v.createdAt || now() };
    this.db
      .prepare(
        "INSERT INTO variants VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(value.id, value.assetId, json(value));
    return value;
  }
  jobs(): Job[] {
    return this.db
      .prepare("SELECT data FROM jobs ORDER BY rowid DESC LIMIT 200")
      .all()
      .map((r: any) => JSON.parse(r.data));
  }
  saveJob(job: Job) {
    this.db
      .prepare(
        "INSERT INTO jobs VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(job.id, json(job));
  }
  stats(): Stats {
    const r = this.db
      .prepare(
        "SELECT COUNT(*) assets,COALESCE(SUM(bytes),0) bytes,COALESCE(SUM(favorite),0) favorites FROM assets WHERE trashed=0 AND COALESCE(json_extract(metadata,'$.auxiliaryRole'),'') <> 'preview'",
      )
      .get() as any;
    const revs = this.db
      .prepare("SELECT manifest FROM revisions")
      .all() as any[];
    const manifests = revs.map(
      (r) => JSON.parse(r.manifest) as PackageManifest,
    );
    return {
      ...r,
      auxiliaryAssets: this.db
        .prepare(
          "SELECT COUNT(*) n FROM assets WHERE trashed=0 AND json_extract(metadata,'$.auxiliaryRole')='preview'",
        )
        .get().n,
      bytes: manifests.reduce(
        (n, m) => n + m.files.reduce((x, f) => x + f.bytes, 0),
        0,
      ),
      files: manifests.reduce((n, m) => n + m.files.length, 0),
      packages: revs.length,
      projects: this.projects().length,
      categories: Object.fromEntries(
        (
          this.db
            .prepare(
              "SELECT category,COUNT(*) n FROM assets WHERE trashed=0 AND COALESCE(json_extract(metadata,'$.auxiliaryRole'),'') <> 'preview' GROUP BY category",
            )
            .all() as any[]
        ).map((r) => [r.category, r.n]),
      ),
      recent: this.query({ recent: true, limit: 8 }).items,
      cacheBytes: 0,
    };
  }
  snapshot() {
    const next = this.snapshotTail.then(() => this.writeSnapshot());
    this.snapshotTail = next.catch(() => {});
    return next;
  }
  private async writeSnapshot() {
    const tables = [
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
    ];
    await atomicJSON(path.join(this.root, "metadata", "catalog.json"), {
      schemaVersion: 1,
      createdAt: now(),
      tables: Object.fromEntries(
        tables.map((t) => [t, this.db.prepare(`SELECT * FROM ${t}`).all()]),
      ),
      assetMetadata: this.db
        .prepare(
          "SELECT id,title,category,tags,notes,favorite,trashed,metadata FROM assets",
        )
        .all(),
    });
  }
  generationGet<T = any>(table: RecordTable, id: string): T | undefined {
    const row = this.db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id);
    return row ? JSON.parse(row.data) : undefined;
  }
  generationList<T = any>(table: RecordTable, limit = 100): T[] {
    return this.db
      .prepare(`SELECT data FROM ${table} ORDER BY rowid DESC LIMIT ?`)
      .all(limit)
      .map((r: any) => JSON.parse(r.data));
  }
  generationSave<T extends { id: string }>(table: RecordTable, value: T) {
    this.db
      .prepare(
        `INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`,
      )
      .run(value.id, JSON.stringify(value));
  }
}
