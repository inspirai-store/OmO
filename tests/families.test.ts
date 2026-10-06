import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { Runtime } from "../src/core/runtime";
import {
  zizhenIconRows,
  zizhenIconStyle,
  familyIconOperations,
} from "../src/shared/families";
import { capabilitiesFor } from "../src/shared/generation";
import { inspectExport, runExport, sourcePath } from "../src/core/exporter";
import { inspectImport, runImport } from "../src/core/importer";
import { now, uid, WorkshopError } from "../src/core/files";
import { rebuildLibrary } from "../src/core/recovery";
let dir: string, r: Runtime, image: Buffer, calls: number, failAt: number;
const provider = {
  id: "family-test",
  name: "test",
  kind: "openai" as const,
  enabled: true,
  models: ["test"],
  bindings: [],
  endpoint: "http://127.0.0.1:1/v1",
  unitPrice: 0.01,
  currency: "USD" as const,
  capabilities: capabilitiesFor("openai"),
};
const base = {
  providerId: provider.id,
  model: "test",
  prompt: "",
  referenceIds: [],
  width: 1024,
  height: 1024,
  count: 1,
  category: "ui",
  tags: [],
  transparent: true,
};
const context = () => ({
  job: {
    id: uid(),
    type: "qa",
    title: "qa",
    status: "running" as const,
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
});
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "workshop-family-"));
  calls = 0;
  failAt = -1;
  image = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect x="20" y="10" width="60" height="80" fill="#498575"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  r = await new Runtime(path.join(dir, "library"), undefined, undefined, {
    providers: [provider],
    keys: { [provider.id]: "test" },
  }).init();
  vi.spyOn(
    (r.generation as any).adapters.openai,
    "generate",
  ).mockImplementation(async () => {
    calls++;
    if (calls === failAt)
      throw new WorkshopError("REMOTE_FAILED", "temporary failure");
    return [image];
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await r.shutdown();
  await fs.rm(dir, { recursive: true, force: true });
});
async function template(patch: any = {}) {
  return r.handle("families.templates.save", {
    name: "青绿物件",
    style: zizhenIconStyle,
    base,
    operations: familyIconOperations,
    ...patch,
  });
}
async function batch(items = zizhenIconRows.slice(0, 2), t?: any) {
  return r.handle("families.batches.create", {
    templateId: (t ?? (await template())).id,
    items,
  });
}
async function finished(id: string) {
  await vi.waitFor(
    () =>
      expect(["completed", "failed", "cancelled", "interrupted"]).toContain(
        r.catalog.jobs().find((j) => j.id === id)?.status,
      ),
    { timeout: 15000 },
  );
  return r.catalog.jobs().find((j) => j.id === id)!;
}
async function generate(b: any, keys?: string[]) {
  const p = await r.handle("families.generate.preview", {
    batchId: b.id,
    keys,
  });
  const s = await r.handle("families.generate.start", {
    batchId: b.id,
    planId: p.id,
  });
  await finished(s.jobId);
  return r.handle("families.batches.detail", { id: b.id });
}
async function selectAll(d: any) {
  for (const i of d.batch.items)
    await r.handle("families.batches.select", {
      batchId: d.batch.id,
      key: i.key,
      candidateId: d.candidates[i.key][0].id,
    });
}
async function save(b: any, prepare = false) {
  const s = await r.handle(
    prepare ? "families.prepare.start" : "families.save.start",
    { batchId: b.id },
  );
  const job = await finished(s.jobId);
  expect(job.error).toBeUndefined();
  return r.handle("families.batches.detail", { id: b.id });
}
test("template versions remain immutable, plans split 28 calls into 20+8 and invalidate edits", async () => {
  const t = await template(),
    b = await batch(zizhenIconRows, t),
    t2 = await template({ id: t.id, style: "new jade style" });
  expect(t2.version).toBe(2);
  expect(
    (await r.handle("families.batches.detail", { id: b.id })).batch.template
      .style,
  ).toBe(t.style);
  const p = await r.handle("families.generate.preview", { batchId: b.id });
  expect(p.totalCalls).toBe(28);
  expect(p.segments.map((s: any) => s.keys.length)).toEqual([20, 8]);
  expect(p.estimatedCost).toBeCloseTo(0.28);
  await r.handle("families.batches.update", {
    batchId: b.id,
    items: [{ key: "gear.blade", name: "新名称" }],
  });
  await expect(
    r.handle("families.generate.start", { batchId: b.id, planId: p.id }),
  ).rejects.toThrow("清单已改变");
  expect(calls).toBe(0);
});
test("partial edits preserve fixed row variations and generation counts", async () => {
  const b = await batch([
    {
      ...zizhenIconRows[0],
      count: 1,
      category: "concept",
      accent: "铜金",
      motif: "朱砂结",
    },
  ]);
  await r.handle("families.batches.update", {
    batchId: b.id,
    items: [{ key: "gear.blade", name: "新刀" }],
  });
  const d = await r.handle("families.batches.detail", { id: b.id });
  expect(d.batch.items[0]).toMatchObject({
    count: 1,
    category: "concept",
    accent: "铜金",
    motif: "朱砂结",
  });
});
test("candidates belong to rows, a partial retry keeps completed calls and continues remaining segments", async () => {
  failAt = 2;
  const b = await batch(zizhenIconRows);
  let d = await generate(b);
  expect(calls).toBe(20);
  expect(d.candidates["gear.blade"]).toHaveLength(1);
  await expect(
    r.handle("families.batches.select", {
      batchId: b.id,
      key: "gear.pike",
      candidateId: d.candidates["gear.blade"][0].id,
    }),
  ).rejects.toThrow("不属于");
  await vi.waitFor(() => expect((r as any).coordinating.size).toBe(0));
  await r.handle("jobs.control", { id: d.batch.jobId, action: "retry" });
  const j = await finished(d.batch.jobId);
  expect(j.error).toBeUndefined();
  expect(calls).toBe(29);
  d = await r.handle("families.batches.detail", { id: b.id });
  for (const i of b.items) expect(d.candidates[i.key]).toHaveLength(2);
  expect(JSON.stringify(d)).not.toContain("relativePath");
});
test("continued candidates and new samples preserve original batches and provenance", async () => {
  const b = await batch(zizhenIconRows.slice(0, 1));
  const d = await generate(b);
  await selectAll(d);
  const c = d.candidates["gear.blade"][0];
  const p = await r.handle("families.generate.preview", {
    batchId: b.id,
    keys: ["gear.blade"],
    continueKey: "gear.blade",
    instruction: "加青绿刀柄",
  });
  expect(p.segments[0].requests[0].parentCandidateId).toBe(c.id);
  expect(p.segments[0].requests[0].referenceIds).toHaveLength(1);
  const ref = await r.handle("generation.inputs.add", { candidateId: c.id });
  const t = await template({
    id: b.template.id,
    base: { ...base, referenceIds: [ref.id] },
  });
  const fork = await r.handle("families.batches.create", {
    templateId: t.id,
    items: b.items,
    sourceBatchId: b.id,
  });
  expect(fork.items[0].selectedCandidateId).toBe(c.id);
  expect(fork.template.version).toBe(2);
  expect(
    (await r.handle("families.batches.detail", { id: b.id })).batch.template
      .version,
  ).toBe(1);
});
test("stopping a family stops its child; interrupted submissions require explicit confirmation", async () => {
  const b = await batch(zizhenIconRows.slice(0, 1));
  const adapter = (r.generation as any).adapters.openai;
  adapter.generate.mockImplementation(
    (ctx: any) =>
      new Promise((_, reject) => {
        calls++;
        ctx.signal.addEventListener(
          "abort",
          () => reject(new WorkshopError("CANCELLED", "stop")),
          { once: true },
        );
      }),
  );
  const p = await r.handle("families.generate.preview", { batchId: b.id });
  const start = await r.handle("families.generate.start", {
    batchId: b.id,
    planId: p.id,
  });
  await vi.waitFor(() => expect(calls).toBe(1));
  await r.handle("jobs.control", { id: start.jobId, action: "cancel" });
  const d = await r.handle("families.batches.detail", { id: b.id }),
    child = r.catalog.jobs().find((j) => j.id === d.batch.segments[0].jobId)!;
  expect(child.status).toBe("cancelled");
  await vi.waitFor(() =>
    expect((r as any).active.size + (r as any).coordinating.size).toBe(0),
  );
  const run = r.catalog.generationGet<any>(
    "generation_runs",
    d.batch.segments[0].runId,
  )!;
  run.items[0].state = "uncertain";
  r.catalog.generationSave("generation_runs", run);
  await expect(
    r.handle("jobs.control", { id: start.jobId, action: "retry" }),
  ).rejects.toThrow("确认未成功");
  expect(calls).toBe(1);
  adapter.generate.mockResolvedValue([image]);
  await r.handle("jobs.control", {
    id: start.jobId,
    action: "retry",
    confirmUnknown: true,
  });
  expect((await finished(start.jobId)).status).toBe("completed");
});
test("opaque candidates fail without losing successful rows and imported results resume after a parent interruption", async () => {
  const b = await batch(),
    d = await generate(b);
  await selectAll(d);
  const candidate = r.catalog.generationGet<any>(
    "generation_candidates",
    d.candidates["gear.blade"][0].id,
  )!;
  await sharp({
    create: { width: 128, height: 128, channels: 4, background: "#ff0000" },
  })
    .png()
    .toFile(path.join(r.root, candidate.relativePath));
  const start = await r.handle("families.save.start", { batchId: b.id });
  expect((await finished(start.jobId)).status).toBe("failed");
  let result = await r.handle("families.batches.detail", { id: b.id });
  expect(result.batch.items[0].error).toContain("真实透明");
  expect(
    result.batch.items[1].outputs.every((o: any) => o.assetIds.length),
  ).toBe(true);
  await r.handle("families.batches.select", {
    batchId: b.id,
    key: "gear.blade",
    candidateId: d.candidates["gear.blade"][1].id,
  });
  await save(b);
  const saved = r.catalog.generationGet<any>("family_batches", b.id)!;
  for (const i of saved.items) for (const o of i.outputs) o.assetIds = [];
  r.catalog.generationSave("family_batches", saved);
  result = await save(b);
  expect(result.batch.items[0].outputs[0].assetIds).toHaveLength(1);
  expect(r.catalog.stats().assets).toBe(6);
});
test("prepare is free of AI analysis, saves three real alpha sizes, survives restart and is idempotent", async () => {
  image = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="100"><rect x="20" y="10" width="60" height="80" fill="#498575"/><rect x="0" y="99" width="1" height="1" fill="#498575" opacity="0.004"/></svg>',
    ),
  )
    .png()
    .toBuffer();
  const b = await batch();
  const d = await generate(b);
  await selectAll(d);
  let result = await save(b, true);
  expect(result.batch.items[0].outputs.map((o: any) => o.size)).toEqual([
    512, 128, 64,
  ]);
  expect(r.catalog.stats().assets).toBe(0);
  const proposals = r.catalog.generationList<any>(
    "processing_save_proposals",
    100,
  );
  expect(proposals.every((p) => p.estimatedCalls === 0)).toBe(true);
  result = await save(b);
  const ids = result.batch.items.flatMap((i: any) =>
    i.outputs.flatMap((o: any) => o.assetIds),
  );
  expect(ids).toHaveLength(6);
  for (const id of ids) {
    const a = r.catalog.get(id),
      s = await sharp(sourcePath(r.catalog, a)).metadata();
    expect(s.width).toBe(a.metadata.family.size);
    expect(s.height).toBe(s.width);
    expect(s.hasAlpha).toBe(true);
    expect(a.metadata.family.batchId).toBe(b.id);
    expect(a.metadata.processing).toBeTruthy();
    expect(a.metadata.generation).toBeTruthy();
  }
  const master = r.catalog.get(result.batch.items[0].outputs[0].assetIds[0]);
  const trimmed = await sharp(sourcePath(r.catalog, master))
    .trim()
    .toBuffer({ resolveWithObject: true });
  const stats = await sharp(sourcePath(r.catalog, master)).stats();
  expect(stats.channels[3].min).toBe(0);
  expect(trimmed.info.width).toBeLessThanOrEqual(384);
  expect(trimmed.info.height).toBe(384);
  const { data, info } = await sharp(sourcePath(r.catalog, master))
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width,
    top = info.height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (x < 64 || x >= 448 || y < 64 || y >= 448) expect(alpha).toBe(0);
      if (alpha > 0) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  expect(Math.abs((left + right + 1) / 2 - 256)).toBeLessThanOrEqual(0.5);
  expect(Math.abs((top + bottom + 1) / 2 - 256)).toBeLessThanOrEqual(0.5);
  await r.shutdown();
  r = await new Runtime(path.join(dir, "library"), undefined, undefined, {
    providers: [provider],
    keys: { [provider.id]: "test" },
  }).init();
  await save(b);
  expect(r.catalog.stats().assets).toBe(6);
  await expect(
    r.handle("families.batches.select", {
      batchId: b.id,
      key: "gear.blade",
      candidateId: d.candidates["gear.blade"][1].id,
    }),
  ).rejects.toThrow("已保存");
});
test("family index follows exported paths, rejects manual overwrite, portable zip and recovery preserve relationships", async () => {
  const b = await batch([
    zizhenIconRows[0],
    { ...zizhenIconRows[1], key: "constructor" },
  ]);
  const d = await generate(b);
  await selectAll(d);
  const saved = await save(b);
  const ids = saved.batch.items.flatMap((i: any) =>
    i.outputs.flatMap((o: any) => o.assetIds),
  );
  const target = path.join(dir, "godot");
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, "project.godot"), "config_version=5");
  const p = inspectExport(r.catalog, {
    assetIds: ids,
    target,
    mode: "godot",
    aggregate: true,
    familyBatchId: b.id,
  });
  expect(p.issues).toEqual([]);
  const out = await runExport(r.catalog, p, context()),
    filename = path.join(out.target, "workshop-family-index.json");
  const index = JSON.parse(await fs.readFile(filename, "utf8"));
  expect(Object.keys(index.items)).toEqual(["gear.blade", "constructor"]);
  for (const entry of Object.values(index.items) as any[])
    for (const v of Object.values(entry.sizes) as any[])
      expect(
        (await sharp(path.join(out.target, v.path)).metadata()).width,
      ).toBe(v.width);
  await fs.writeFile(filename, "hand edited");
  await expect(runExport(r.catalog, p, context())).rejects.toThrow(
    "目标文件已被修改",
  );
  const portable = await runExport(
    r.catalog,
    inspectExport(r.catalog, {
      assetIds: ids,
      target: path.join(dir, "portable"),
      mode: "generic",
      zip: true,
      aggregate: true,
      familyBatchId: b.id,
    }),
    context(),
  );
  const backup = await r.backup(path.join(dir, "backup"), context());
  await r.restore(backup.target, path.join(dir, "restored"), context());
  const restored = await new Runtime(path.join(dir, "restored")).init();
  try {
    const d = await restored.handle("families.batches.detail", { id: b.id });
    expect(d.batch.template.id).toBe(b.template.id);
    expect(d.batch.items[0].outputs).toEqual(saved.batch.items[0].outputs);
    expect(
      await restored.handle("generation.files.resolve", {
        id: d.batch.items[0].selectedCandidateId,
        kind: "candidate",
      }),
    ).toContain("restored");
  } finally {
    await restored.shutdown();
  }
  const other = await new Runtime(path.join(dir, "other")).init();
  try {
    const imported = await runImport(
      other.catalog,
      await inspectImport([portable.zipPath!]),
      context(),
    );
    expect(other.catalog.get(imported.assets[0]).metadata.family.batchId).toBe(
      b.id,
    );
    expect(
      other.catalog.get(imported.assets[0]).metadata.assetGroup,
    ).toBeTruthy();
  } finally {
    await other.shutdown();
  }
  await r.shutdown();
  await rebuildLibrary(path.join(dir, "library"), path.join(dir, "recovered"));
  r = await new Runtime(path.join(dir, "recovered")).init();
  expect(
    (await r.handle("families.batches.detail", { id: b.id })).batch.items[0]
      .outputs[0].assetIds,
  ).toEqual(saved.batch.items[0].outputs[0].assetIds);
});
