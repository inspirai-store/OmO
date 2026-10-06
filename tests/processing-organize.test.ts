import { beforeEach, afterEach, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Runtime } from "../src/core/runtime";
import {
  capabilitiesFor,
  type GenerationProviderConfig,
} from "../src/shared/generation";
import type {
  ProcessingSaveProposal,
  ProcessingSaveItem,
} from "../src/shared/processing";
import {
  inspectImport,
  runImport,
  type JobContext,
} from "../src/core/importer";
import { inspectExport, runExport } from "../src/core/exporter";
import { rebuildLibrary } from "../src/core/recovery";
import { processingFilename } from "../src/core/processing-organize";
import { now, uid } from "../src/core/files";

let base: string, runtime: Runtime, png: Buffer;
const codex: GenerationProviderConfig = {
  id: "organize-codex",
  name: "整理 Codex",
  kind: "codex",
  enabled: true,
  models: [],
  bindings: [],
  capabilities: capabilitiesFor("codex"),
};
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "workshop-organize-"));
  png = await sharp({
    create: { width: 80, height: 96, channels: 4, background: "#ff000080" },
  })
    .png()
    .toBuffer();
  runtime = await new Runtime(
    path.join(base, "library"),
    undefined,
    undefined,
    { providers: [codex], keys: {} },
  ).init();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await runtime.shutdown();
  await fs.rm(base, { recursive: true, force: true });
});
function context(): JobContext {
  return {
    job: {
      id: uid(),
      type: "qa",
      title: "qa",
      status: "running",
      stage: "",
      progress: 0,
      done: 0,
      total: 1,
      request: {},
      createdAt: now(),
      updatedAt: now(),
    },
    check: async () => {},
    progress: () => {},
    event: () => {},
  };
}
async function finished(id: string) {
  await vi.waitFor(
    () =>
      expect(["completed", "failed", "cancelled", "interrupted"]).toContain(
        runtime.catalog.jobs().find((j) => j.id === id)?.status,
      ),
    { timeout: 10000 },
  );
  return runtime.catalog.jobs().find((j) => j.id === id)!;
}
async function artifacts(count = 1, assetId?: string) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const file = path.join(base, `health_potion_${uid()}.png`);
    await fs.writeFile(file, png);
    ids.push(
      (
        await runtime.handle(
          "processing.inputs.add",
          assetId ? { source: { kind: "asset", id: assetId } } : { path: file },
        )
      ).id,
    );
  }
  const plan = await runtime.handle("processing.preview", {
    inputIds: ids,
    operations: [
      { type: "resize", width: 64, height: 64, fit: "fill", kernel: "nearest" },
    ],
  });
  const run = await runtime.handle("processing.start", { planId: plan.id });
  expect((await finished(run.jobId)).status).toBe("completed");
  return (await runtime.handle("processing.detail", { id: run.runId }))
    .artifacts;
}
async function draft(
  ids: string[],
  extra: any = {},
): Promise<ProcessingSaveProposal> {
  return runtime.handle("processing.organize.preview", {
    artifactIds: ids,
    ...extra,
  });
}
const analysis = (files: string[]) => ({
  items: files.map((file, i) => ({
    artifactId: path.basename(file, ".png"),
    title: `红色生命药水图标 ${i + 1}`,
    englishName: "health_potion_red",
    category: "ui",
    entityCategory: "pickup",
    gameplayTags: ["pickup"],
    tags: ["药水", "红色"],
    confidence: "high",
    reason: "画面是红色药水，可用作消耗品图标",
  })),
});
async function analyze(p: ProcessingSaveProposal) {
  const started = await runtime.handle("processing.organize.start", {
    id: p.id,
  });
  expect((await finished(started.jobId)).status).toBe("completed");
  return runtime.handle("processing.organize.detail", {
    id: p.id,
  }) as Promise<ProcessingSaveProposal>;
}
async function accept(
  p: ProcessingSaveProposal,
  items: ProcessingSaveItem[] = p.items,
) {
  const result = await runtime.handle("processing.accept", {
    proposalId: p.id,
    items,
  });
  return result.jobId
    ? finished(result.jobId)
    : { status: "completed", result };
}

test("local suggestions measure pixels, leave originals unchanged and validate real filenames", async () => {
  runtime.generationAccess.providers = [];
  const [a] = await artifacts();
  const before = await fs.readFile(
    await runtime.handle("processing.files.resolve", {
      kind: "artifact",
      id: a.id,
    }),
  );
  const p = await draft([a.id]);
  expect(p.estimatedCalls).toBe(0);
  expect(p.state).toBe("ready");
  expect(p.items[0].tags).toEqual(
    expect.arrayContaining(["64×64", "透明通道"]),
  );
  expect(p.items[0].category).toBe("other");
  p.items[0].filename = "health_potion_red_1024x1024_v07.png";
  p.items[0].title = "红色生命药水图标";
  const job = await accept(p);
  expect(job.status).toBe("completed");
  const a1 = runtime.catalog.get(job.result.assets[0]);
  expect(a1.path).toBe("health_potion_red_64x64_v01.png");
  expect(a1.title).toBe("红色生命药水图标");
  expect(a1.metadata.organizing.filename).toBe(a1.path);
  expect(
    await fs.readFile(
      await runtime.handle("processing.files.resolve", {
        kind: "artifact",
        id: a.id,
      }),
    ),
  ).toEqual(before);
  for (const name of [
    "../escape.png",
    "C:/file.png",
    "生命药水.png",
    "Hello.png",
    "thing.jpg",
    "bad.name.png",
    "1.png",
    "a".repeat(151),
  ])
    expect(() => processingFilename(name, 64, 64)).toThrow();
});

test("analysis uses batches of at most five, cached content and no repeated calls on reopening", async () => {
  const seen: number[] = [];
  vi.spyOn(runtime.processing.harness, "round").mockImplementation(
    async (_p, s, _dir, _prompt, files) => {
      seen.push(files.length);
      s.rounds++;
      return analysis(files);
    },
  );
  const rows = await artifacts(6),
    ids = rows.map((a: any) => a.id);
  const p = await draft(ids);
  expect(p.estimatedCalls).toBe(2);
  const ready = await analyze(p);
  expect(seen).toEqual([5, 1]);
  expect(ready.calls).toBe(2);
  expect(ready.items.every((i) => i.analysis === "ai")).toBe(true);
  const reopened = await draft(ids);
  expect(reopened.id).toBe(p.id);
  expect(
    (await runtime.handle("processing.organize.start", { id: reopened.id }))
      .jobId,
  ).toBe(p.jobId ?? ready.jobId);
  const cached = await draft(ids, { fresh: true });
  expect(cached.estimatedCalls).toBe(0);
  expect(cached.items.every((i) => i.analysis === "cached")).toBe(true);
  const changed = await draft(ids, { model: "different-model" });
  expect(changed.estimatedCalls).toBe(2);
  expect(JSON.stringify(ready)).not.toContain("relativePath");
});

test("manual changes survive an AI reply received later", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  vi.spyOn(runtime.processing.harness, "round").mockImplementation(
    async (_p, _s, _d, _t, files) => {
      await gate;
      return analysis(files);
    },
  );
  const [a] = await artifacts(),
    p = await draft([a.id]);
  const task = await runtime.handle("processing.organize.start", { id: p.id });
  await vi.waitFor(() =>
    expect(
      runtime.catalog.generationGet<any>("processing_save_proposals", p.id)
        .state,
    ).toBe("analyzing"),
  );
  await runtime.handle("processing.organize.update", {
    id: p.id,
    items: [
      {
        artifactId: a.id,
        title: "我命名的道具",
        filename: "my_item.png",
        category: "sprite",
        tags: ["手工分类"],
      },
    ],
  });
  release();
  await finished(task.jobId);
  const final = await runtime.handle("processing.organize.detail", {
    id: p.id,
  });
  expect(final.items[0]).toMatchObject({
    title: "我命名的道具",
    filename: "my_item.png",
    category: "sprite",
    tags: ["手工分类"],
    analysis: "ai",
  });
});

test("analysis errors and invalid result IDs preserve editable local suggestions without retry", async () => {
  const mock = vi.spyOn(runtime.processing.harness, "round").mockResolvedValue({
    items: [{ ...analysis(["unknown.png"]).items[0], artifactId: "unknown" }],
  });
  const [a] = await artifacts(),
    p = await draft([a.id]);
  const ready = await analyze(p);
  expect(ready.items[0].analysis).toBe("failed");
  expect(ready.warnings.join(" ")).toContain("ID");
  await runtime.handle("processing.organize.start", { id: p.id });
  expect(mock).toHaveBeenCalledTimes(1);
  expect((await accept(ready)).status).toBe("completed");
});

test("source categories are preserved while AI alternatives and truthful destination recommendations are offered", async () => {
  const originalFile = path.join(base, "health_potion.png");
  await fs.writeFile(originalFile, png);
  const importPlan = await inspectImport([originalFile]);
  Object.assign(importPlan, {
    category: "sprite",
    entityCategory: "pickup",
    gameplayTags: ["pickup"],
    tags: ["药水"],
    source: {
      provider: "artist",
      pageUrl: "https://example.test",
      author: "作者",
      license: "CC0",
    },
  });
  const imported = await runImport(runtime.catalog, importPlan, context()),
    source = runtime.catalog.get(imported.assets[0]);
  const sourceProject = runtime.catalog.saveProject({ name: "原项目" }),
    current = runtime.catalog.saveProject({ name: "当前项目" });
  const unrelated = runtime.catalog.saveProject({ name: "赛车模型" });
  runtime.catalog.attach(sourceProject.id, [source.id]);
  const manual = runtime.catalog.saveCollection("药水收藏");
  runtime.catalog.collect(manual, [source.id]);
  const smart = runtime.catalog.saveCollection("图标筛选", {
    category: "ui",
    entityCategory: "pickup",
    projectId: current.id,
    license: "CC0",
    search: "药水",
    minWidth: 64,
  });
  vi.spyOn(runtime.processing.harness, "round").mockImplementation(
    async (_p, _s, _d, _t, files) => analysis(files),
  );
  const [a] = await artifacts(1, source.id),
    p = await draft([a.id], {
      context: { projectId: current.id, collectionId: manual },
    });
  const ready = await analyze(p),
    item = ready.items[0];
  expect(item.category).toBe("sprite");
  expect(item.classificationSuggestion?.category).toBe("ui");
  expect(
    item.recommendations.filter((r) => r.kind === "project").map((r) => r.id),
  ).toEqual([current.id, sourceProject.id]);
  expect(item.recommendations.some((r) => r.id === unrelated.id)).toBe(false);
  expect(item.projectIds).toEqual([current.id]);
  expect(item.collectionIds).toEqual([manual]);
  const changed = await runtime.handle("processing.organize.update", {
    id: p.id,
    items: [{ artifactId: a.id, category: "ui" }],
  });
  expect(
    changed.items[0].recommendations.some(
      (r: any) => r.kind === "smartCollection" && r.id === smart,
    ),
  ).toBe(true);
  const job = await accept(changed);
  const asset = runtime.catalog.get(job.result.assets[0]);
  expect(
    runtime.catalog.query({ collectionId: smart }).items.map((a) => a.id),
  ).toContain(asset.id);
  expect(asset.source).toMatchObject({ license: "CC0", author: "作者" });
});

test("smart collection prediction shares all library filters and changes with selected memberships", async () => {
  runtime.generationAccess.providers = [];
  const [a] = await artifacts(),
    p = await draft([a.id]);
  const project = runtime.catalog.saveProject({ name: "UI 项目" });
  const smart = runtime.catalog.saveCollection("仅此项目图标", {
    projectId: project.id,
    category: "ui",
    imageOnly: true,
    search: "生命药水",
    minWidth: 64,
  });
  const rejected = runtime.catalog.saveCollection("大图或收藏", {
    category: "ui",
    minWidth: 128,
    favorite: true,
  });
  const changed = await runtime.handle("processing.organize.update", {
    id: p.id,
    items: [
      {
        artifactId: a.id,
        title: "红色生命药水图标",
        category: "ui",
        projectIds: [project.id],
      },
    ],
  });
  expect(
    changed.items[0].recommendations.some((r: any) => r.id === smart),
  ).toBe(true);
  expect(
    changed.items[0].recommendations.some((r: any) => r.id === rejected),
  ).toBe(false);
  const noProject = await runtime.handle("processing.organize.update", {
    id: p.id,
    items: [{ artifactId: a.id, projectIds: [] }],
  });
  expect(
    noProject.items[0].recommendations.some((r: any) => r.id === smart),
  ).toBe(false);
  await expect(
    runtime.handle("processing.accept", {
      items: [{ ...p.items[0], collectionIds: [smart] }],
    }),
  ).rejects.toThrow("智能收藏集");
  runtime.catalog.db.prepare("DELETE FROM projects WHERE id=?").run(project.id);
  await expect(
    runtime.handle("processing.accept", {
      items: [{ ...p.items[0], projectIds: [project.id] }],
    }),
  ).rejects.toThrow("不存在");
  expect(runtime.catalog.stats().assets).toBe(0);
});

test("simultaneous saves reserve distinct names, repeated acceptance imports once and mixed batches attach every result", async () => {
  runtime.generationAccess.providers = [];
  const rows = await artifacts(2),
    p = await draft(rows.map((a: any) => a.id));
  p.items.forEach((i) => {
    i.title = "红色药水";
    i.filename = "health_potion_red.png";
  });
  const first = await runtime.handle("processing.accept", {
    proposalId: p.id,
    items: [p.items[0]],
  });
  const second = await runtime.handle("processing.accept", {
    proposalId: p.id,
    items: [p.items[1]],
  });
  await finished(first.jobId);
  await finished(second.jobId);
  const filenames = runtime.catalog
    .query({})
    .items.map((a) => a.path)
    .sort();
  expect(filenames).toEqual([
    "health_potion_red_64x64_v01.png",
    "health_potion_red_64x64_v02.png",
  ]);
  const project = runtime.catalog.saveProject({ name: "新归属" }),
    collection = runtime.catalog.saveCollection("新收藏");
  const repeated = await runtime.handle("processing.accept", {
    items: p.items.map((i) => ({
      ...i,
      title: "不得覆盖",
      filename: "changed.png",
      projectIds: [project.id],
      collectionIds: [collection],
    })),
  });
  expect(repeated.assets).toHaveLength(2);
  expect(runtime.catalog.stats().assets).toBe(2);
  expect(runtime.catalog.query({ projectId: project.id }).total).toBe(2);
  expect(runtime.catalog.query({ collectionId: collection }).total).toBe(2);
  expect(
    runtime.catalog.query({}).items.every((a) => a.title === "红色药水"),
  ).toBe(true);
  const [newResult] = await artifacts(),
    next = await draft([newResult.id]);
  const mixed = await runtime.handle("processing.accept", {
    items: [
      { ...p.items[0], projectIds: [project.id] },
      { ...next.items[0], projectIds: [project.id] },
    ],
  });
  expect((await finished(mixed.jobId)).status).toBe("completed");
  expect(runtime.catalog.query({ projectId: project.id }).total).toBe(3);
});

test("partial association failure retains imported assets and resumes only missing associations with the same filename", async () => {
  runtime.generationAccess.providers = [];
  const rows = await artifacts(2),
    p = await draft(rows.map((a: any) => a.id));
  const project = runtime.catalog.saveProject({ name: "项目" }),
    collection = runtime.catalog.saveCollection("道具"),
    original = runtime.catalog.collect.bind(runtime.catalog);
  let calls = 0;
  const spy = vi
    .spyOn(runtime.catalog, "collect")
    .mockImplementation((id, ids) => {
      if (++calls === 1) throw new Error("模拟写入中断");
      return original(id, ids);
    });
  p.items.forEach((i) => {
    i.projectIds = [project.id];
    i.collectionIds = [collection];
    i.filename = "potion.png";
  });
  const job = await accept(p);
  expect(job.status).toBe("failed");
  expect(job.result.assets).toHaveLength(2);
  expect(runtime.catalog.stats().assets).toBe(2);
  expect(runtime.catalog.query({ projectId: project.id }).total).toBe(2);
  const paths = runtime.catalog
    .query({})
    .items.map((a) => a.path)
    .sort();
  spy.mockRestore();
  await runtime.handle("jobs.control", {
    id: (job as any).id,
    action: "retry",
  });
  expect((await finished((job as any).id)).status).toBe("completed");
  expect(runtime.catalog.query({ collectionId: collection }).total).toBe(2);
  expect(
    runtime.catalog
      .query({})
      .items.map((a) => a.path)
      .sort(),
  ).toEqual(paths);
});

test("restart never replays an attempted analysis and preserves completed local import recovery", async () => {
  const [a] = await artifacts(),
    p = await draft([a.id]);
  p.state = "analyzing";
  p.calls = 1;
  p.batches[0].state = "started";
  const interrupted = {
    id: uid(),
    type: "processing-organize",
    title: "识图",
    status: "running",
    stage: "",
    progress: 0,
    done: 0,
    total: 1,
    request: { proposalId: p.id },
    createdAt: now(),
    updatedAt: now(),
  };
  p.jobId = interrupted.id;
  runtime.catalog.generationSave("processing_save_proposals", p);
  runtime.catalog.saveJob(interrupted as any);
  await runtime.shutdown();
  runtime = await new Runtime(
    path.join(base, "library"),
    undefined,
    undefined,
    { providers: [codex], keys: {} },
  ).init();
  const mock = vi.spyOn(runtime.processing.harness, "round");
  const reopened = await draft([a.id]);
  expect(reopened.state).toBe("interrupted");
  await runtime.handle("processing.organize.start", { id: p.id });
  expect(mock).not.toHaveBeenCalled();
  await expect(
    runtime.handle("jobs.control", { id: interrupted.id, action: "retry" }),
  ).rejects.toThrow("不自动重复");
  const first = await accept(reopened);
  const assetId = first.result.assets[0];
  const record = runtime.catalog.generationGet<any>(
    "processing_save_items",
    a.id,
  );
  record.importedAssetIds = [];
  runtime.catalog.generationSave("processing_save_items", record);
  const artifact = runtime.catalog.generationGet<any>(
    "processing_artifacts",
    a.id,
  );
  artifact.importedAssetIds = [];
  runtime.catalog.generationSave("processing_artifacts", artifact);
  const recovered = await accept(reopened);
  expect(recovered.result.assets).toEqual([assetId]);
  expect(runtime.catalog.stats().assets).toBe(1);
});

test("cancellation keeps draft edits and prevents another automatic analysis attempt", async () => {
  const [a] = await artifacts(),
    p = await draft([a.id]);
  vi.spyOn(runtime.processing.harness, "round").mockImplementation(
    async (_p, _s, _d, _t, _i, signal) => {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      throw new Error("停止识别");
    },
  );
  const started = await runtime.handle("processing.organize.start", {
    id: p.id,
  });
  await expect(
    runtime.handle("processing.delete", { id: a.id }),
  ).rejects.toThrow("请先停止整理识别任务");
  await vi.waitFor(() =>
    expect(
      runtime.catalog.generationGet<any>("processing_save_proposals", p.id)
        .calls,
    ).toBe(1),
  );
  await runtime.handle("processing.organize.update", {
    id: p.id,
    items: [{ artifactId: a.id, title: "保留草稿" }],
  });
  await runtime.handle("jobs.control", { id: started.jobId, action: "cancel" });
  await finished(started.jobId);
  const stopped = await runtime.handle("processing.organize.detail", {
    id: p.id,
  });
  expect(stopped.state).toBe("cancelled");
  expect(stopped.items[0].title).toBe("保留草稿");
  expect((await accept(stopped)).status).toBe("completed");
});

test("organizer shares the Codex slot with assistant jobs while local processing can use the second slot", async () => {
  const rows = await artifacts(2);
  let release!: () => void,
    active = 0,
    maximum = 0;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const mock = vi
    .spyOn(runtime.processing.harness, "round")
    .mockImplementation(async (_p, _s, _d, _t, files) => {
      active++;
      maximum = Math.max(maximum, active);
      await gate;
      active--;
      return analysis(files);
    });
  const p1 = await draft([rows[0].id]),
    p2 = await draft([rows[1].id]);
  const a1 = await runtime.handle("processing.organize.start", { id: p1.id });
  const a2 = await runtime.handle("processing.organize.start", { id: p2.id });
  await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
  expect(runtime.catalog.jobs().find((j) => j.id === a2.jobId)?.status).toBe(
    "queued",
  );
  expect(
    await runtime.handle("generation.providers.busy", { id: codex.id }),
  ).toBe(true);
  expect(await artifacts()).toHaveLength(1);
  expect(mock).toHaveBeenCalledTimes(1);
  release();
  await finished(a1.jobId);
  await finished(a2.jobId);
  expect(maximum).toBe(1);
});

test("restoring an unfinished draft never starts analysis", async () => {
  const [a] = await artifacts(),
    p = await draft([a.id]);
  p.state = "analyzing";
  p.calls = 1;
  p.batches[0].state = "started";
  runtime.catalog.generationSave("processing_save_proposals", p);
  const backup = await runtime.backup(path.join(base, "backup"), context());
  await runtime.restore(
    backup.target,
    path.join(base, "restored-draft"),
    context(),
  );
  const other = await new Runtime(path.join(base, "restored-draft")).init();
  try {
    const restored = await other.handle("processing.organize.detail", {
      id: p.id,
    });
    expect(restored.state).toBe("interrupted");
    expect(restored.calls).toBe(1);
    expect(
      other.catalog.jobs().filter((j) => j.type === "processing-organize"),
    ).toHaveLength(0);
  } finally {
    await other.shutdown();
  }
});

test("backup restore, rebuild and portable export preserve organization and lineage without cross-library destination binding", async () => {
  vi.spyOn(runtime.processing.harness, "round").mockImplementation(
    async (_p, _s, _d, _t, files) => analysis(files),
  );
  const [a] = await artifacts(),
    p = await analyze(await draft([a.id]));
  const project = runtime.catalog.saveProject({ name: "药水项目" }),
    collection = runtime.catalog.saveCollection("消耗品");
  p.items[0].projectIds = [project.id];
  p.items[0].collectionIds = [collection];
  const job = await accept(p),
    asset = runtime.catalog.get(job.result.assets[0]);
  const backup = await runtime.backup(path.join(base, "backup"), context());
  await runtime.restore(backup.target, path.join(base, "restore"), context());
  await rebuildLibrary(runtime.root, path.join(base, "rebuild"));
  for (const dir of ["restore", "rebuild"]) {
    const other = await new Runtime(path.join(base, dir)).init();
    try {
      expect(other.catalog.get(asset.id).metadata.organizing).toEqual(
        asset.metadata.organizing,
      );
      expect(
        other.catalog.generationGet<any>("processing_save_items", a.id)
          .filename,
      ).toBe(asset.path);
      expect(
        other.catalog.generationList("processing_organize_cache"),
      ).toHaveLength(1);
      expect(other.catalog.query({ projectId: project.id }).total).toBe(1);
      expect(other.catalog.query({ collectionId: collection }).total).toBe(1);
    } finally {
      await other.shutdown();
    }
  }
  const exportPlan = await inspectExport(runtime.catalog, {
    assetIds: [asset.id],
    mode: "generic",
    target: path.join(base, "export"),
    zip: true,
  });
  const exported = await runExport(runtime.catalog, exportPlan, context()),
    other = await new Runtime(path.join(base, "portable")).init();
  try {
    const result = await runImport(
        other.catalog,
        await inspectImport([exported.zipPath!]),
        context(),
      ),
      reimported = other.catalog.get(result.assets[0]);
    expect(reimported.title).toBe(asset.title);
    expect(path.basename(reimported.path)).toBe(asset.path);
    expect(reimported.metadata.organizing).toEqual(asset.metadata.organizing);
    expect(reimported.metadata.processing.sourceHash).toBe(
      asset.metadata.processing.sourceHash,
    );
    expect(other.catalog.projects()).toHaveLength(0);
    expect(other.catalog.collections()).toHaveLength(0);
    expect(JSON.stringify(reimported.metadata.organizing)).not.toContain(
      project.id,
    );
  } finally {
    await other.shutdown();
  }
});
