import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  atomicJSON,
  copyVerified,
  extractZip,
  inside,
  now,
  slash,
  uid,
  walk,
  WorkshopError,
  hashFile,
  readJSON,
  inspectZip,
} from "./files";
import {
  categoryOf,
  dependenciesOf,
  imageExtensions,
  inspectMedia,
  materialGroups,
  modelExtensions,
} from "./media";
import type { Catalog } from "./catalog";
import { variantSchema } from "./schemas";
import { entityMetadata } from "../shared/entities";
import { validateSkinDirectory } from "./skins";
import type {
  FileRecord,
  ImportPlan,
  Job,
  ManifestAsset,
  PackageManifest,
} from "../shared/types";

export interface JobContext {
  parse?: typeof inspectMedia;
  job: Job;
  check(): Promise<void>;
  progress(stage: string, done: number, total: number): void;
  event(type: string, data: any): void;
}
export async function inspectImport(paths: string[]): Promise<ImportPlan> {
  const roots: ImportPlan["roots"] = [],
    files: string[] = [],
    issues: string[] = [],
    allFiles: { path: string; bytes: number; filename?: string }[] = [];
  let bytes = 0,
    fileCount = 0;
  for (const p of paths) {
    const stat = await fs.lstat(p);
    if (stat.isSymbolicLink())
      throw new WorkshopError("SYMLINK", "请选择真实文件或目录");
    const archive = [".zip", ".awskin"].includes(path.extname(p).toLowerCase());
    roots.push({ path: p, label: path.basename(p), archive });
    if (stat.isDirectory()) {
      const entries = await walk(p);
      const names = new Set<string>();
      for (const f of entries) {
        const key = f.path.normalize("NFC").toLowerCase();
        if (names.has(key))
          throw new WorkshopError(
            "PATH_COLLISION",
            `文件大小写冲突：${f.path}`,
          );
        names.add(key);
        allFiles.push({ ...f, filename: inside(p, f.path) });
      }
      files.push(
        ...entries
          .slice(0, 200)
          .map((f) => slash(path.join(path.basename(p), f.path))),
      );
      bytes += entries.reduce((n, f) => n + f.bytes, 0);
      fileCount += entries.length;
    } else if (archive) {
      const expanded = await inspectZip(p);
      if(path.extname(p).toLowerCase()===".awskin" && (!expanded.files.some(f=>f.path==="skin.json") || expanded.bytes>256*1024**2 || expanded.files.length>4096))throw new Error("皮肤包必须包含根目录 skin.json，且不超过 256 MiB／4096 文件");
      files.push(...expanded.files.slice(0, 200).map((f) => f.path));
      bytes += expanded.bytes;
      fileCount += expanded.files.length;
      allFiles.push(...expanded.files);
      issues.push(
        `${path.basename(p)}：已检查 ZIP 目录，解压后校验模型依赖与内容哈希`,
      );
    } else {
      files.push(path.basename(p));
      allFiles.push({ path: path.basename(p), bytes: stat.size, filename: p });
      bytes += stat.size;
      fileCount++;
    }
  }
  const known = new Set(allFiles.map((f) => f.path));
  for (const f of allFiles
    .filter(
      (f) =>
        f.filename &&
        [".gltf", ".glb", ".obj", ".mtl", ".fbx"].includes(
          path.extname(f.path).toLowerCase(),
        ),
    )
    .slice(0, 500)) {
    try {
      for (const d of await dependenciesOf(f.filename!, f.path)) {
        if (d.status === "remote")
          issues.push(`${f.path}：远程资源已阻止 ${d.target}`);
        else if (!known.has(d.target))
          issues.push(`${f.path}：缺少 ${d.target}`);
      }
    } catch (e: any) {
      issues.push(`${f.path}：依赖检查失败 ${e.message}`);
    }
  }
  if (!fileCount) issues.push("没有找到可导入文件");
  return {
    id: uid(),
    paths,
    roots,
    fileCount,
    bytes,
    files: files.slice(0, 200),
    issues,
    counts: {
      images: allFiles.filter((f) =>
        imageExtensions.has(path.extname(f.path).toLowerCase()),
      ).length,
      models: allFiles.filter((f) =>
        modelExtensions.has(path.extname(f.path).toLowerCase()),
      ).length,
      materialSets: materialGroups(
        allFiles.map(
          (f) =>
            ({
              path: f.path,
              extension: path.extname(f.path).toLowerCase(),
            }) as FileRecord,
        ),
      ).length,
    },
  };
}
export async function runImport(
  catalog: Catalog,
  plan: ImportPlan,
  ctx: JobContext,
) {
  const stage = path.join(catalog.root, "staging", ctx.job.id),
    source = path.join(stage, "source");
  await fs.mkdir(source, { recursive: true });
  const existing = await readJSON<
    Record<string, { sha256: string; bytes: number }>
  >(path.join(stage, "checkpoint.json"), {});
  let copyCount = 0,
    lastCheckpoint = 0;
  for (const [i, root] of plan.roots.entries()) {
    await ctx.check();
    const stat = await fs.stat(root.path),
      prefix =
        plan.roots.length === 1
          ? ""
          : `${i + 1}-${path.basename(root.label, path.extname(root.label))}`;
    if (root.archive) {
      const extracted = prefix ? inside(source, prefix) : source;
      ctx.progress("解压并检查", i, plan.roots.length);
      await extractZip(root.path, extracted, () => ctx.check());
      if (path.extname(root.path).toLowerCase() === ".awskin")
        await validateSkinDirectory(extracted);
    } else if (stat.isDirectory()) {
      const list = await walk(root.path, { check: () => ctx.check() });
      const names = new Set<string>();
      for (const f of list) {
        const rel = slash(path.join(prefix, f.path)),
          key = rel.normalize("NFC").toLowerCase();
        if (names.has(key))
          throw new WorkshopError("PATH_COLLISION", `文件大小写冲突：${rel}`);
        names.add(key);
        const dest = inside(source, rel);
        if (
          existing[rel]?.bytes !== f.bytes ||
          !(await fs.stat(dest).catch(() => null)) ||
          (await hashFile(dest, () => ctx.check())) !== existing[rel]?.sha256 ||
          (await hashFile(path.join(root.path, f.path), () => ctx.check())) !==
            existing[rel]?.sha256
        ) {
          const sha256 = await copyVerified(
            path.join(root.path, f.path),
            dest,
            () => ctx.check(),
          );
          existing[rel] = { sha256, bytes: f.bytes };
        }
        ctx.progress("复制到素材库", ++copyCount, list.length);
        if (Date.now() - lastCheckpoint > 2000) {
          await atomicJSON(path.join(stage, "checkpoint.json"), existing);
          lastCheckpoint = Date.now();
        }
      }
    } else {
      const rel = slash(path.join(prefix, path.basename(root.path))),
        dest = inside(source, rel);
      const sha256 = await copyVerified(root.path, dest, () => ctx.check());
      existing[rel] = { sha256, bytes: stat.size };
      ctx.progress("复制到素材库", ++copyCount, plan.roots.length);
    }
  }
  await atomicJSON(path.join(stage, "checkpoint.json"), existing);
  const entries = await walk(source, { exclude: [], check: () => ctx.check() }),
    files: FileRecord[] = [],
    thumbs: Record<string, string> = {};
  for(const entry of entries.filter(e=>path.posix.basename(e.path)==="skin.json" && e.bytes<1024*1024)) {
    const filename=inside(source,entry.path);let value:any;
    try{value=await readJSON<any>(filename);}catch{continue;}
    if(value?.kind==="asset-workshop-skin")await validateSkinDirectory(path.dirname(filename));
  }
  const parent = plan.parentAssetId
    ? catalog.get(plan.parentAssetId)
    : undefined;
  const packageId = parent?.packageId ?? uid(),
    revisionId = uid(),
    createdAt = now();
  const parsedByHash = new Map<
    string,
    Awaited<ReturnType<typeof inspectMedia>>
  >();
  for (const [i, e] of entries.entries()) {
    await ctx.check();
    const filename = inside(source, e.path),
      sha256 =
        existing[e.path]?.sha256 ??
        (await hashFile(filename, () => ctx.check()));
    const file: FileRecord = {
      id: uid(),
      path: e.path,
      bytes: e.bytes,
      sha256,
      extension: path.extname(e.path).toLowerCase(),
      metadata: {},
    };
    ctx.progress("识别与生成预览", i + 1, entries.length);
    const key = sha256 + file.extension;
    const media =
      parsedByHash.get(key) ??
      (await (ctx.parse ?? inspectMedia)(
        filename,
        file,
        path.join(catalog.root, "cache"),
      ));
    parsedByHash.set(key, media);
    file.metadata = { ...media.metadata };
    if (media.thumbnail) thumbs[e.path] = media.thumbnail;
    files.push(file);
  }
  const known = new Set(files.map((f) => f.path)),
    dependencies = [] as PackageManifest["dependencies"];
  for (const f of files) {
    if (![".gltf", ".glb", ".obj", ".mtl", ".fbx"].includes(f.extension))
      continue;
    try {
      for (const d of await dependenciesOf(inside(source, f.path), f.path)) {
        if (d.status !== "remote" && known.has(d.target)) d.status = "resolved";
        dependencies.push(d);
      }
    } catch (error: any) {
      f.metadata.dependencyError = error.message;
    }
  }
  const depended = new Set(
    dependencies.filter((d) => d.status === "resolved").map((d) => d.target),
  );
  const groups = materialGroups(files),
    grouped = new Set(
      groups.flatMap(
        (g) => Object.values(g.set).filter((p) => known.has(p!)) as string[],
      ),
    );
  const assets: ManifestAsset[] = [];
  for (const f of files) {
    if (
      !imageExtensions.has(f.extension) &&
      !modelExtensions.has(f.extension) &&
      ![".hdr", ".exr", ".dds", ".ktx2"].includes(f.extension)
    )
      continue;
    const category =
      (plan.category === "model" || plan.category === "animation") &&
      imageExtensions.has(f.extension)
        ? "texture"
        : (plan.category ?? categoryOf(f.path));
    const deps = dependencies.filter((d) => d.from === f.path);
    const tags = [
      ...new Set([...(plan.tags ?? []), ...(plan.source?.tags ?? [])]),
    ];
    assets.push({
      id: uid(),
      path: f.path,
      title: plan.title ?? path.basename(f.path, f.extension),
      category,
      tags,
      dependencies: deps
        .filter((d) => d.status === "resolved")
        .map((d) => d.target),
      metadata: {
        ...f.metadata,
        ...(plan.generation ? { generation: plan.generation } : {}),
        ...(plan.processing ? { processing: plan.processing } : {}),
        ...(plan.organizing ? { organizing: plan.organizing } : {}),
        dependent: depended.has(f.path),
        groupMember: grouped.has(f.path),
        missing: deps
          .filter((d) => d.status !== "resolved")
          .map((d) => d.target),
      },
    });
  }
  for (const file of files.filter(f => path.posix.basename(f.path) === "skin.json")) {
    let value:any;try{value=await readJSON<any>(inside(source,file.path));}catch{continue;}
    if (value?.kind !== "asset-workshop-skin") continue;
    const prefix = path.posix.dirname(file.path);
    const skin = await validateSkinDirectory(path.dirname(inside(source,file.path)));
    const resourcePaths = skin.resources.map(r => path.posix.join(prefix === "." ? "" : prefix, r.path));
    const exportsPrefix=path.posix.join(prefix === "." ? "" : prefix,"exports")+"/", previewPrefix=path.posix.join(prefix === "." ? "" : prefix,"preview")+"/";
    const extras=files.filter(f=>f.path.startsWith(exportsPrefix)||f.path.startsWith(previewPrefix)).map(f=>f.path);
    assets.push({ id: uid(), path: file.path, title: skin.name, category: "skin", tags: [...new Set([...(plan.tags ?? []), "皮肤", skin.basePreset])], dependencies: resourcePaths, relatedPaths: [...resourcePaths,...extras], metadata: { skin, portableSource: { provider: "skin", pageUrl: "", author: skin.author, license: skin.license }, dependent: false } });
    const index=await readJSON<any>(path.join(path.dirname(inside(source,file.path)),"exports","index.json"),{items:[]});
    for(const a of assets.filter(a=>extras.includes(a.path))) {
      a.category="controls";a.metadata.dependent=true;
      const item=(Array.isArray(index.items)?index.items:[]).find((i:any)=>a.path.endsWith("/"+i.png1x)||a.path.endsWith("/"+i.png2x));
      const scale=a.path.endsWith("@2x.png")?2:1;
      a.metadata.skinResource={skinId:skin.id,resourceId:a.path,scale,bindings:item?[item]:[]};
      if(item?.slices)a.metadata.nineSlice=Object.fromEntries(Object.entries(item.slices).map(([side,value])=>[side,Number(value)*scale]));
      const provenance=item?.source ?? {author:skin.author,license:skin.license};
      a.metadata.portableSource={provider:"skin-resource",pageUrl:provenance.pageUrl ?? "",author:provenance.author,license:provenance.license};
      if(a.path.startsWith(previewPrefix))a.metadata.auxiliaryRole="preview";
    }
    for (const r of skin.resources) {
      const a = assets.find(a => a.path === path.posix.join(prefix === "." ? "" : prefix, r.path));
      if (a) {
        const bindings = skin.bindings.filter(b => b.resource === r.id);
        a.category = "controls"; a.metadata.dependent = true;
        a.metadata.skinResource = { skinId: skin.id, resourceId: r.id, scale:r.scale, atlasRegion:r.atlasRegion, bindings };
        if (bindings[0]?.slices) a.metadata.nineSlice = Object.fromEntries(Object.entries(bindings[0].slices).map(([side,value])=>[side,value*r.scale]));
        if (r.source) a.metadata.portableSource = { provider: "skin-resource", pageUrl: r.source.pageUrl ?? "", author: r.source.author, license: r.source.license };
      }
    }
    const cover=extras.find(p=>/cover@1x\.png$/.test(p));
    if (cover && thumbs[cover]) thumbs[file.path]=thumbs[cover];
    else if (resourcePaths.length && thumbs[resourcePaths[0]]) thumbs[file.path] = thumbs[resourcePaths[0]];
  }
  for (const file of files.filter(
    (f) => f.extension === ".json" && f.bytes < 16 * 1024 * 1024,
  )) {
    try {
      const atlas = await readJSON<any>(inside(source, file.path));
      if (!atlas.frames || !atlas.meta?.image) continue;
      const imagePath = path.posix.normalize(
        path.posix.join(path.posix.dirname(file.path), atlas.meta.image),
      );
      const a = assets.find((a) => a.path === imagePath);
      if (!a) continue;
      const rows = Array.isArray(atlas.frames)
        ? atlas.frames
        : Object.entries(atlas.frames).map(([name, data]: [string, any]) => ({
            ...data,
            filename: name,
          }));
      a.metadata.atlas = rows
        .filter((r: any) => !r.rotated)
        .map((r: any) => ({
          name: r.filename,
          x: r.frame.x,
          y: r.frame.y,
          width: r.frame.w,
          height: r.frame.h,
        }));
      a.relatedPaths = [...(a.relatedPaths ?? []), file.path];
    } catch {
      /* Unrelated JSON is archived without being executed. */
    }
  }
  for (const g of groups) {
    const entry =
      g.set.baseColor ?? g.set.normal ?? g.set.roughness ?? g.set.orm!;
    const a = assets.find((a) => a.path === entry);
    if (a) {
      a.category = "texture";
      a.title = path.basename(g.name);
      a.metadata = {
        ...a.metadata,
        materialSet: g.set,
        groupMember: false,
        dependent: false,
      };
      a.relatedPaths = Object.values(g.set).filter((p) =>
        known.has(p!),
      ) as string[];
      a.dependencies = a.relatedPaths;
    }
  }
  const fbxModel = assets.find(
    (a) =>
      a.path.toLowerCase().endsWith(".fbx") &&
      /model|character/i.test(a.path) &&
      !/animations?\//i.test(a.path),
  );
  const clips = files
    .filter((f) => f.extension === ".fbx" && /animations?\//i.test(f.path))
    .map((f) => f.path);
  const fbxResourceMap = Object.fromEntries(
    files
      .filter((f) => imageExtensions.has(f.extension))
      .map((f) => [path.basename(f.path).toLowerCase(), f.path]),
  );
  for (const a of assets.filter((a) => a.path.toLowerCase().endsWith(".fbx"))) {
    a.metadata.resourceMap = fbxResourceMap;
    if (fbxModel && clips.length) {
      a.metadata.animationModel = fbxModel.path;
      a.metadata.animationFiles = clips;
      a.metadata.animations = clips.map((p) => ({
        name: path.basename(p, ".fbx"),
      }));
      a.relatedPaths = [
        ...(a.relatedPaths ?? []),
        fbxModel.path,
        ...clips,
        ...Object.values(fbxResourceMap),
      ];
      if (a !== fbxModel) a.metadata.dependent = true;
    }
  }
  // Preserve metadata from a portable export; physical file paths remain authoritative.
  if (parent) {
    const old = catalog.revision(parent.revisionId).assets;
    for (const a of assets) {
      const prior =
        old.find((p) => p.path === a.path) ??
        (assets.length === 1 ? parent : undefined);
      if (prior) {
        const edited = catalog.get(prior.id);
        a.metadata.logicalId = edited.metadata.logicalId ?? prior.id;
        a.metadata.previousAssetId = prior.id;
        a.title = edited.title;
        if (!plan.category) a.category = edited.category;
        a.tags = [...new Set([...edited.tags, ...a.tags])];
        for (const key of ["entityCategory", "gameplayTags", "assetGroup"]) {
          if (edited.metadata[key] !== undefined)
            a.metadata[key] = edited.metadata[key];
        }
      }
    }
  }
  const portable = await readJSON<any>(
    path.join(source, "workshop-manifest.json"),
    null,
  );
  const idMapping: Record<string, string> = {};
  const portableVariants = Array.isArray(portable?.variants)
    ? portable.variants.map((record: any) => variantSchema.parse(record))
    : [];
  if (portable?.schemaVersion === 1 && Array.isArray(portable.assets))
    for (const record of portable.assets) {
      const a = assets.find((a) => a.path === record.path);
      if (a) {
        if (
          typeof record.id === "string" &&
          /^[a-z0-9-]{1,100}$/i.test(record.id)
        ) {
          const exists = catalog.db
            .prepare("SELECT 1 FROM assets WHERE id=?")
            .get(record.id);
          a.id = exists ? uid() : record.id;
          idMapping[record.id] = a.id;
        }
        a.title = record.title ?? a.title;
        a.tags = record.tags ?? a.tags;
        if (record.category) a.category = record.category;
        if (record.source) a.metadata.portableSource = record.source;
        for (const key of [
          "grid",
          "fps",
          "viewMode",
          "nineSlice",
          "stateGroup",
          "auxiliaryRole",
          "imageView",
          "entityCategory",
          "gameplayTags",
          "assetGroup",
          "generation",
          "processing",
          "organizing",
          "family",
        ])
          if (record.metadata?.[key] !== undefined)
            a.metadata[key] = record.metadata[key];
        if (record.notes) a.metadata.portableNotes = record.notes;
      }
    }
  const groupMapping = new Map<string, string>();
  for (const a of assets) {
    a.metadata = { ...a.metadata, ...entityMetadata(a) };
    if (plan.entityCategory !== undefined)
      a.metadata.entityCategory = plan.entityCategory;
    if (plan.gameplayTags) a.metadata.gameplayTags = plan.gameplayTags;
    const group = a.metadata.assetGroup;
    if (
      group &&
      typeof group.id === "string" &&
      typeof group.name === "string"
    ) {
      if (!groupMapping.has(group.id)) groupMapping.set(group.id, uid());
      a.metadata.assetGroup = {
        id: groupMapping.get(group.id),
        name: group.name.slice(0, 100),
      };
    } else delete a.metadata.assetGroup;
    if (a.metadata.stateGroup)
      a.metadata.stateGroup = a.metadata.stateGroup.map((s: any) => ({
        ...s,
        id: idMapping[s.id] ?? s.id,
      }));
  }
  if (portable?.files)
    for (const f of portable.files) {
      const actual = files.find((a) => a.path === f.path);
      if (!actual || actual.sha256 !== f.sha256)
        throw new WorkshopError(
          "MANIFEST_HASH",
          `标准素材包文件校验失败：${f.path}`,
        );
    }
  if (!assets.length)
    for (const f of files)
      assets.push({
        id: uid(),
        path: f.path,
        title: path.basename(f.path),
        category: "other",
        tags: plan.tags ?? [],
        metadata: f.metadata,
        dependencies: [],
      });
  const contentHash = createHash("sha256")
    .update(
      files
        .map((f) => `${f.path}\0${f.sha256}`)
        .sort()
        .join("\n"),
    )
    .digest("hex");
  const manifest: PackageManifest = {
    schemaVersion: 1,
    packageId,
    revisionId,
    name: plan.source?.assetId ?? plan.roots.map((r) => r.label).join("、"),
    contentHash,
    createdAt,
    files,
    dependencies,
    source: plan.source,
    assets,
  };
  await atomicJSON(path.join(stage, "manifest.json"), manifest);
  if (plan.source) {
    await fs.mkdir(path.join(stage, "licenses"), { recursive: true });
    await fs.writeFile(
      path.join(stage, "licenses", "SOURCE.txt"),
      `${plan.source.license}\n${plan.source.author}\n${plan.source.pageUrl}\n\n${plan.source.evidence ?? ""}`,
      "utf8",
    );
  }
  await ctx.check();
  ctx.progress("提交素材索引", 0, 1);
  const destination = path.join(
    catalog.root,
    "packages",
    packageId,
    revisionId,
  );
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.rename(stage, destination);
  let result;
  try {
    result = catalog.add(manifest, thumbs);
  } catch (error) {
    await fs.rename(destination, stage);
    throw error;
  }
  if (result.duplicate)
    await fs.rm(destination, { recursive: true, force: true });
  if (!result.duplicate)
    for (const record of portableVariants) {
      const assetId = idMapping[record.assetId];
      if (!assetId) continue;
      const bindings: any = {};
      let complete = true;
      for (const [slot, b] of Object.entries(record.bindings ?? {}) as [
        string,
        any,
      ][]) {
        if (!idMapping[b.assetId]) {
          complete = false;
          break;
        }
        bindings[slot] = { ...b, assetId: idMapping[b.assetId], revisionId };
      }
      if (complete) {
        const v = catalog.saveVariant(
          variantSchema.parse({
            ...record,
            id: catalog.variants().some((v) => v.id === record.id)
              ? uid()
              : record.id,
            assetId,
            revisionId,
            bindings,
          }),
        );
        await atomicJSON(
          path.join(catalog.root, "variants", v.id + ".json"),
          v,
        );
      }
    }
  if (plan.projectId) catalog.attach(plan.projectId, result.assets);
  if (!result.duplicate)
    for (const a of assets)
      if (a.metadata.portableNotes)
        catalog.update([a.id], { notes: a.metadata.portableNotes });
  await catalog.snapshot();
  ctx.progress("完成", 1, 1);
  ctx.event("catalog.changed", result);
  return {
    ...result,
    fileCount: files.length,
    bytes: files.reduce((n, f) => n + f.bytes, 0),
    idMapping,
  };
}
