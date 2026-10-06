import { beforeEach, afterEach, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { Runtime } from "../src/core/runtime";
import {
  applyImageOperation,
  compositeMaskedEdit,
  executeProcessingTool,
} from "../src/core/processing-tools";
import {
  capabilitiesFor,
  type GenerationProviderConfig,
} from "../src/shared/generation";
import type { ImageOperation, ProcessingRun } from "../src/shared/processing";
import { inspectExport, runExport } from "../src/core/exporter";
import {
  inspectImport,
  runImport,
  type JobContext,
} from "../src/core/importer";
import { rebuildLibrary } from "../src/core/recovery";
import { now, uid } from "../src/core/files";
import http from "node:http";

let base: string, runtime: Runtime, png: Buffer;
const provider: GenerationProviderConfig = {
  id: "test-edit",
  name: "测试图像",
  kind: "openai",
  enabled: true,
  endpoint: "http://127.0.0.1:1/v1",
  models: ["test-image"],
  bindings: [],
  capabilities: capabilitiesFor("openai"),
};
const resize: ImageOperation = {
  type: "resize",
  width: 64,
  height: 64,
  fit: "contain",
  kernel: "nearest",
};
const ai: ImageOperation = {
  type: "ai",
  purpose: "edit",
  providerId: provider.id,
  model: "test-image",
  prompt: "将选区改蓝色",
  width: 128,
  height: 128,
};
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-processing-"));
  png = await sharp({
    create: { width: 128, height: 128, channels: 4, background: "#ff000080" },
  })
    .png()
    .toBuffer();
  runtime = await new Runtime(path.join(base, "库"), undefined, undefined, {
    providers: [provider],
    keys: { [provider.id]: "fake-processing-key" },
  }).init();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await runtime?.shutdown();
  await fs.rm(base, { recursive: true, force: true });
});
async function input(bytes = png) {
  const file = path.join(base, `${uid()}.png`);
  await fs.writeFile(file, bytes);
  return runtime.handle("processing.inputs.add", { path: file });
}
async function run(
  operations: ImageOperation[],
  inputIds?: string[],
  sessionId?: string,
) {
  const ids = inputIds ?? [(await input()).id];
  const plan = await runtime.handle("processing.preview", {
    inputIds: ids,
    operations,
    sessionId,
  });
  return runtime.handle("processing.start", { planId: plan.id });
}
async function finished(id: string) {
  await vi.waitFor(
    () => {
      const j = runtime.catalog.jobs().find((j) => j.id === id);
      expect(j).toBeDefined();
      expect(["completed", "failed", "interrupted", "cancelled"]).toContain(
        j!.status,
      );
    },
    { timeout: 10000 },
  );
  return runtime.catalog.jobs().find((j) => j.id === id)!;
}
async function bytes(artifactId: string) {
  return fs.readFile(
    await runtime.handle("processing.files.resolve", {
      kind: "artifact",
      id: artifactId,
    }),
  );
}
function context(): JobContext {
  return {
    job: {
      id: uid(),
      type: "test",
      title: "test",
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

test("ordered operations preserve full resolution and alpha, and do not resize only the preview", async () => {
  const { runId, jobId } = await run([
    { type: "crop", x: 16, y: 8, width: 96, height: 80 },
    { type: "rotate", angle: 90 },
    resize,
    { type: "adjust", brightness: 1.1, contrast: 1.2, saturation: 1, hue: 90 },
  ]);
  expect((await finished(jobId)).status).toBe("completed");
  const { artifacts } = await runtime.handle("processing.detail", {
    id: runId,
  });
  expect(artifacts).toHaveLength(4);
  const raw = await sharp(await bytes(artifacts[3].id))
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(raw.info.width).toBe(64);
  expect(raw.info.height).toBe(64);
  expect(raw.info.channels).toBe(4);
  expect(artifacts[3].processing.steps).toHaveLength(4);
  expect(artifacts[0].width).toBe(96);
  expect(artifacts[0].height).toBe(80);
});
test("adjustments preserve every alpha byte, including transparent and antialiased pixels", async () => {
  const raw = Buffer.from([240, 40, 20, 0, 240, 40, 20, 127, 240, 40, 20, 255]);
  const original = await sharp(raw, {
    raw: { width: 3, height: 1, channels: 4 },
  })
    .png()
    .toBuffer();
  const adjusted = await applyImageOperation(original, {
    type: "adjust",
    brightness: 1.2,
    contrast: 1.1,
    saturation: 0.3,
    hue: 50,
    tint: "#4488ff",
  });
  const data = await sharp(adjusted).raw().toBuffer();
  expect([data[3], data[7], data[11]]).toEqual([0, 127, 255]);
});
test("nearest-neighbour pixel scaling introduces no intermediate colours", async () => {
  const pixels = await sharp(Buffer.from([255, 0, 0, 255, 0, 0, 255, 255]), {
    raw: { width: 2, height: 1, channels: 4 },
  })
    .png()
    .toBuffer();
  const output = await applyImageOperation(pixels, {
    type: "resize",
    width: 8,
    height: 4,
    fit: "fill",
    kernel: "nearest",
  });
  const data = await sharp(output).raw().toBuffer();
  expect(
    new Set(
      Array.from({ length: data.length / 4 }, (_, i) =>
        data.subarray(i * 4, i * 4 + 4).toString("hex"),
      ),
    ),
  ).toEqual(new Set(["ff0000ff", "0000ffff"]));
});
test("input normalises EXIF orientation before assigning crop coordinates", async () => {
  const jpeg = await sharp({
    create: { width: 40, height: 20, channels: 3, background: "#ff8800" },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const image = await input(jpeg);
  expect([image.width, image.height]).toEqual([20, 40]);
  await expect(
    runtime.handle("processing.preview", {
      inputIds: [image.id],
      operations: [{ type: "crop", x: 20, y: 0, width: 10, height: 10 }],
    }),
  ).rejects.toThrow("裁剪区域");
});
test("multi-page input requires explicit selection and rejects missing pages", async () => {
  const frames = Buffer.alloc(2 * 4 * 4 * 4, 200);
  frames.fill(10, 4 * 4 * 4);
  const gif = await sharp(frames, {
    raw: { width: 4, height: 8, channels: 4, pageHeight: 4 },
  })
    .gif({ loop: 0, delay: [100, 100] })
    .toBuffer();
  const file = path.join(base, "frames.gif");
  await fs.writeFile(file, gif);
  await expect(
    runtime.handle("processing.inputs.add", { path: file }),
  ).rejects.toThrow("页或帧");
  const frame = await runtime.handle("processing.inputs.add", {
    path: file,
    page: 1,
  });
  expect(frame.height).toBe(4);
});
test("AI masks preserve every outside pixel and mismatching results are retained", async () => {
  const image = await input();
  const maskPixels = Buffer.alloc(128 * 128 * 4, 255);
  for (let y = 16; y < 32; y++)
    for (let x = 16; x < 32; x++) maskPixels[(y * 128 + x) * 4 + 3] = 0;
  const mask = await runtime.handle("processing.mask.save", {
    source: { kind: "input", id: image.id },
    base64: (
      await sharp(maskPixels, { raw: { width: 128, height: 128, channels: 4 } })
        .png()
        .toBuffer()
    ).toString("base64"),
  });
  const blue = await sharp({
    create: { width: 128, height: 128, channels: 4, background: "#0000ff" },
  })
    .png()
    .toBuffer();
  runtime.generation.adapters = {
    ...runtime.generation.adapters,
    openai: {
      check: async () => ({ message: "ok" }),
      generate: async () => [blue],
    },
  };
  const op = { ...ai, maskId: mask.id, maskInputHash: mask.maskInputHash };
  const { jobId, runId } = await run([op], [image.id]);
  expect((await finished(jobId)).status).toBe("completed");
  const { artifacts } = await runtime.handle("processing.detail", {
    id: runId,
  });
  const result = await sharp(await bytes(artifacts[0].id))
    .raw()
    .toBuffer();
  const original = await sharp(png).raw().toBuffer();
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 128; x++)
      if (x < 16 || x >= 32 || y < 16 || y >= 32)
        expect(
          result.subarray((y * 128 + x) * 4, (y * 128 + x + 1) * 4),
        ).toEqual(original.subarray((y * 128 + x) * 4, (y * 128 + x + 1) * 4));
  runtime.generation.adapters.openai.generate = async () => [
    await sharp(blue).resize(256, 256).png().toBuffer(),
  ];
  const other = await run([op], [image.id]);
  expect((await finished(other.jobId)).status).toBe("failed");
  expect(
    (await runtime.handle("processing.detail", { id: other.runId })).run
      .items[0].error,
  ).toContain("不匹配");
  expect(runtime.catalog.generationList("generation_candidates").length).toBe(
    2,
  );
});
test("changed geometry invalidates a mask before any model invocation", async () => {
  const image = await input();
  const mask = await runtime.handle("processing.mask.save", {
    source: { kind: "input", id: image.id },
    base64: png.toString("base64"),
  });
  await expect(
    runtime.handle("processing.preview", {
      inputIds: [image.id],
      operations: [
        resize,
        { ...ai, maskId: mask.id, maskInputHash: mask.maskInputHash },
      ],
    }),
  ).rejects.toThrow("蒙版");
});
test("AI usage purposes and actual capabilities are required without provider substitution", async () => {
  await expect(run([{ ...ai, purpose: "upscale" }])).rejects.toThrow(
    "专用工作流",
  );
  provider.capabilities.mask = false;
  try {
    const image = await input();
    await expect(
      runtime.handle("processing.preview", {
        inputIds: [image.id],
        operations: [{ ...ai, maskId: "none", maskInputHash: image.sha256 }],
      }),
    ).rejects.toThrow("蒙版");
  } finally {
    provider.capabilities.mask = true;
  }
});
test("partial batch success persists and retry submits only the failed input", async () => {
  let calls = 0;
  runtime.generation.adapters = {
    ...runtime.generation.adapters,
    openai: {
      check: async () => ({ message: "ok" }),
      generate: async () => {
        if (++calls === 2)
          throw Object.assign(new Error("permission"), { code: "HTTP_403" });
        return [png];
      },
    },
  };
  const { jobId, runId } = await run(
    [ai],
    [(await input()).id, (await input()).id],
  );
  expect((await finished(jobId)).status).toBe("failed");
  expect(
    (await runtime.handle("processing.detail", { id: runId })).artifacts,
  ).toHaveLength(1);
  await runtime.handle("jobs.control", { id: jobId, action: "retry" });
  expect((await finished(jobId)).status).toBe("completed");
  expect(calls).toBe(3);
  expect(
    (await runtime.handle("processing.detail", { id: runId })).run.calls,
  ).toBe(3);
});
test("uncertain submission is never automatically repeated after restart", async () => {
  let calls = 0;
  runtime.generation.adapters = {
    ...runtime.generation.adapters,
    openai: {
      check: async () => ({ message: "ok" }),
      generate: async () => {
        calls++;
        throw new Error("lost response");
      },
    },
  };
  const { jobId, runId } = await run([ai]);
  expect((await finished(jobId)).status).toBe("interrupted");
  await runtime.shutdown();
  runtime = await new Runtime(path.join(base, "库"), undefined, undefined, {
    providers: [provider],
    keys: { [provider.id]: "fake-processing-key" },
  }).init();
  expect(calls).toBe(1);
  expect(
    (await runtime.handle("processing.detail", { id: runId })).run.status,
  ).toBe("interrupted");
  await expect(
    runtime.handle("jobs.control", { id: jobId, action: "retry" }),
  ).rejects.toThrow("确认");
});
test("duplicate acceptance imports once and portable packages retain processing lineage", async () => {
  const { jobId, runId } = await run([resize]);
  await finished(jobId);
  const { artifacts } = await runtime.handle("processing.detail", {
    id: runId,
  });
  const [a, b] = await Promise.all([
    runtime.handle("processing.accept", { artifactIds: [artifacts[0].id] }),
    runtime.handle("processing.accept", { artifactIds: [artifacts[0].id] }),
  ]);
  expect(a.jobId).toBe(b.jobId);
  await finished(a.jobId);
  const accepted = await runtime.handle("processing.accept", {
    artifactIds: [artifacts[0].id],
  });
  expect(accepted.assets).toHaveLength(1);
  expect(runtime.catalog.stats().assets).toBe(1);
  const asset = runtime.catalog.get(accepted.assets[0]);
  expect(asset.metadata.processing.steps).toHaveLength(1);
  const plan = await inspectExport(runtime.catalog, {
    assetIds: [asset.id],
    mode: "generic",
    target: path.join(base, "export"),
    zip: true,
  });
  const exported = await runExport(runtime.catalog, plan, context());
  const importPlan = await inspectImport([exported.zipPath!]);
  const result = await runImport(runtime.catalog, importPlan, context());
  expect(
    runtime.catalog.get(result.assets[0]).metadata.processing.sourceHash,
  ).toBe(asset.metadata.processing.sourceHash);
});
test("backup and rebuild retain full processing files, recipes and provenance", async () => {
  const { jobId, runId } = await run([resize]);
  await finished(jobId);
  await runtime.handle("processing.recipes.save", {
    name: "像素图配方",
    operations: [resize],
  });
  const before = (await runtime.handle("processing.detail", { id: runId }))
    .artifacts[0];
  const rebuilt = await rebuildLibrary(runtime.root, path.join(base, "重建"));
  expect(rebuilt.metadataRecovered).toBe(true);
  const other = await new Runtime(path.join(base, "重建")).init();
  try {
    expect(
      (await other.handle("processing.detail", { id: runId })).artifacts[0]
        .sha256,
    ).toBe(before.sha256);
    expect(await other.handle("processing.recipes.list")).toHaveLength(1);
    const file = await other.handle("processing.files.resolve", {
      kind: "artifact",
      id: before.id,
    });
    expect(await fs.readFile(file)).toEqual(await bytes(before.id));
  } finally {
    await other.shutdown();
  }
  const backup = await runtime.backup(path.join(base, "备份"), context());
  expect(backup).toBeTruthy();
  await runtime.restore(backup.target, path.join(base, "恢复"), context());
  const restored = await new Runtime(path.join(base, "恢复")).init();
  try {
    const detail = await restored.handle("processing.detail", { id: runId });
    expect(detail.artifacts[0].sha256).toBe(before.sha256);
    expect(await restored.handle("processing.recipes.list")).toHaveLength(1);
    expect(
      await fs.readFile(
        await restored.handle("processing.files.resolve", {
          kind: "artifact",
          id: before.id,
        }),
      ),
    ).toEqual(await bytes(before.id));
    expect(JSON.stringify(detail)).not.toContain("fake-processing-key");
  } finally {
    await restored.shutdown();
  }
});
test("agent proposes without generation, then reviews actual results within confirmed limits", async () => {
  const codex: GenerationProviderConfig = {
    id: "codex-test",
    name: "Codex",
    kind: "codex",
    enabled: true,
    models: [],
    bindings: [],
    capabilities: capabilitiesFor("codex"),
  };
  runtime.generationAccess.providers.push(codex);
  runtime.generation.configure(runtime.generationAccess);
  const image = await input();
  const rounds: string[] = [];
  vi.spyOn(runtime.processing.harness, "round").mockImplementation(
    async (_p, s, _dir, prompt, _images, _signal, review) => {
      s.rounds++;
      rounds.push(prompt);
      return review
        ? { decision: "accept", operationJson: "", note: "检查通过" }
        : { operationsJson: JSON.stringify([resize]), note: "原图保留" };
    },
  );
  const proposed = await runtime.handle("processing.assistant.plan", {
    inputIds: [image.id],
    brief: "做成64像素图标",
  });
  const planned = await finished(proposed.jobId);
  expect(planned.result.plan.totalCalls).toBe(0);
  expect(runtime.catalog.generationList("processing_artifacts")).toHaveLength(
    0,
  );
  const started = await runtime.handle("processing.start", {
    planId: planned.result.plan.id,
  });
  expect((await finished(started.jobId)).status).toBe("completed");
  expect(rounds).toHaveLength(2);
});
test("agent cannot replace a provider or exceed the correction budget", async () => {
  const codex: GenerationProviderConfig = {
    id: "codex-test",
    name: "Codex",
    kind: "codex",
    enabled: true,
    models: [],
    bindings: [],
    capabilities: capabilitiesFor("codex"),
  };
  runtime.generationAccess.providers.push(codex);
  runtime.generation.configure(runtime.generationAccess);
  let calls = 0;
  runtime.generation.adapters = {
    ...runtime.generation.adapters,
    openai: {
      check: async () => ({ message: "ok" }),
      generate: async () => {
        calls++;
        return [png];
      },
    },
  };
  vi.spyOn(runtime.processing.harness, "round").mockImplementation(
    async (_p, s, _dir, _prompt, _images, _signal, review) => {
      s.rounds++;
      return review
        ? {
            decision: "adjust",
            operationJson: JSON.stringify({ ...ai, prompt: "再次修复" }),
            note: "需要再修正",
          }
        : { operationsJson: JSON.stringify([ai]), note: "最多一次修正" };
    },
  );
  const image = await input();
  const proposed = await runtime.handle("processing.assistant.plan", {
    inputIds: [image.id],
    brief: "修复",
    selectedProviderId: provider.id,
    selectedModel: "test-image",
  });
  const planned = await finished(proposed.jobId);
  const started = await runtime.handle("processing.start", {
    planId: planned.result.plan.id,
  });
  expect((await finished(started.jobId)).status).toBe("interrupted");
  expect(calls).toBe(2);
});

test("transparency trim leaves opaque uniform backgrounds intact and bounds only visible alpha", async () => {
  const solid = await applyImageOperation(png, { type: "trim", threshold: 10 });
  expect((await sharp(solid).metadata()).width).toBe(128);
  const padded = await applyImageOperation(png, {
    type: "pad",
    top: 3,
    right: 4,
    bottom: 5,
    left: 6,
    color: "transparent",
  });
  const cropped = await applyImageOperation(padded, {
    type: "trim",
    threshold: 10,
  });
  expect(await sharp(cropped).raw().toBuffer()).toEqual(
    await sharp(png).raw().toBuffer(),
  );
});
test("shared tool registry uses complete inputs and reports actual transparency and pixel changes", async () => {
  const inspected = await executeProcessingTool("image.inspect", {
    bytes: png,
  });
  expect(inspected.alpha.min).toBe(128);
  const preview = await executeProcessingTool("image.preview", {
    bytes: png,
    operations: [resize],
  });
  expect(preview).toEqual(
    await executeProcessingTool("image.apply", {
      bytes: png,
      operation: resize,
    }),
  );
  const same = await executeProcessingTool("image.compare", {
    bytes: png,
    result: png,
  });
  expect(same.changedPixels).toBe(0);
  const resized = await executeProcessingTool("image.compare", {
    bytes: png,
    result: preview,
  });
  expect(resized.sameDimensions).toBe(false);
  await expect(
    executeProcessingTool("image.ai_edit", { bytes: png }),
  ).rejects.toThrow("已确认");
});
test("changed provider configuration requires a new approval before AI execution", async () => {
  const image = await input();
  const plan = await runtime.handle("processing.preview", {
    inputIds: [image.id],
    operations: [ai],
  });
  runtime.generationAccess.providers = [
    { ...provider, endpoint: "https://different.invalid/v1" },
  ];
  runtime.generation.configure(runtime.generationAccess);
  await expect(
    runtime.handle("processing.start", { planId: plan.id }),
  ).rejects.toThrow("连接已改变");
  expect(await runtime.handle("processing.list")).toHaveLength(0);
});
test("duplicate start consumes one approved plan once", async () => {
  const image = await input();
  const plan = await runtime.handle("processing.preview", {
    inputIds: [image.id],
    operations: [resize],
  });
  const attempts = await Promise.allSettled([
    runtime.handle("processing.start", { planId: plan.id }),
    runtime.handle("processing.start", { planId: plan.id }),
  ]);
  expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
  const started = (
    attempts.find(
      (a) => a.status === "fulfilled",
    ) as PromiseFulfilledResult<any>
  ).value;
  expect((await finished(started.jobId)).status).toBe("completed");
  expect(await runtime.handle("processing.list")).toHaveLength(1);
});
test("a parent resumes its persisted RunningHub child after restart without another submission", async () => {
  const rh: GenerationProviderConfig = {
    ...provider,
    id: "rh-processing",
    kind: "runninghub",
    workflowId: "123",
    purposes: ["restore"],
    bindings: [{ nodeId: "1", fieldName: "image", role: "reference" }],
    capabilities: {
      ...capabilitiesFor("runninghub"),
      references: true,
      maxReferences: 1,
    },
  };
  runtime.generationAccess = { providers: [rh], keys: { [rh.id]: "fake-key" } };
  runtime.generation.configure(runtime.generationAccess);
  let submissions = 0;
  runtime.generation.adapters.runninghub = {
    check: async () => ({ message: "ok" }),
    generate: async (ctx) => {
      submissions++;
      await ctx.submitted("existing-remote-task");
      return new Promise<Buffer[]>((_, reject) =>
        ctx.signal.addEventListener(
          "abort",
          () => reject(new Error("shutdown")),
          { once: true },
        ),
      );
    },
  };
  const { jobId, runId } = await run([
    { ...ai, providerId: rh.id, purpose: "restore" },
  ]);
  await vi.waitFor(() => {
    const child = runtime.catalog.generationList<any>("generation_runs")[0];
    expect(child?.items[0].remoteTaskId).toBe("existing-remote-task");
  });
  await runtime.shutdown();
  runtime = new Runtime(path.join(base, "库"), undefined, undefined, {
    providers: [rh],
    keys: { [rh.id]: "fake-key" },
  });
  await runtime.init();
  runtime.generation.adapters.runninghub = {
    check: async () => ({ message: "ok" }),
    generate: async (ctx) => {
      expect(ctx.remoteTaskId).toBe("existing-remote-task");
      return [png];
    },
  };
  expect((await finished(jobId)).status).toBe("completed");
  expect(
    (await runtime.handle("processing.detail", { id: runId })).artifacts,
  ).toHaveLength(1);
  expect(submissions).toBe(1);
});
test("saved result download retries preserve parent call counts and never repeat AI editing", async () => {
  let calls = 0,
    downloads = 0;
  const server = http.createServer((_req, res) => {
    if (++downloads === 1) {
      res.statusCode = 503;
      res.end("interrupted");
    } else res.end(png);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const url = `http://127.0.0.1:${(server.address() as any).port}/image.png`;
    runtime.generation.adapters.openai = {
      check: async () => ({ message: "ok" }),
      generate: async (ctx) => {
        calls++;
        await ctx.outputs([url]);
        throw new Error("download interrupted");
      },
    };
    const { jobId, runId } = await run([ai]);
    expect((await finished(jobId)).status).toBe("failed");
    await runtime.handle("jobs.control", { id: jobId, action: "retry" });
    expect((await finished(jobId)).status).toBe("failed");
    await runtime.handle("jobs.control", { id: jobId, action: "retry" });
    expect((await finished(jobId)).status).toBe("completed");
    const { run: record } = await runtime.handle("processing.detail", {
      id: runId,
    });
    expect(record.calls).toBe(1);
    expect(record.plan.maxCalls).toBe(1);
    expect(calls).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("cancel aborts a cloud child, preserves completed local steps and reports unavailable remote cancellation", async () => {
  let invoked = false;
  runtime.generation.adapters.openai = {
    check: async () => ({ message: "ok" }),
    generate: async (ctx) => {
      invoked = true;
      return new Promise<Buffer[]>((_, reject) =>
        ctx.signal.addEventListener(
          "abort",
          () => reject(new Error("cancel")),
          { once: true },
        ),
      );
    },
  };
  const { jobId, runId } = await run([
    { type: "flip", axis: "horizontal" },
    ai,
  ]);
  await vi.waitFor(() => expect(invoked).toBe(true));
  const stopped = await runtime.handle("jobs.control", {
    id: jobId,
    action: "cancel",
  });
  expect(stopped.cancellation.remoteSupported).toBe(false);
  expect((await finished(jobId)).status).toBe("cancelled");
  expect(
    (await runtime.handle("processing.detail", { id: runId })).artifacts,
  ).toHaveLength(1);
});
test("parent coordinators share two execution slots and serialize Codex generation with assistant turns", async () => {
  const codex: GenerationProviderConfig = {
    id: "codex-test",
    name: "Codex",
    kind: "codex",
    enabled: true,
    models: [],
    bindings: [],
    capabilities: capabilitiesFor("codex"),
  };
  runtime.generationAccess.providers.push(codex);
  runtime.generation.configure(runtime.generationAccess);
  let occupied = 0,
    max = 0;
  const occupy = async () => {
    max = Math.max(max, ++occupied);
    expect(runtime.active.size).toBeLessThanOrEqual(2);
    await new Promise((r) => setTimeout(r, 40));
    occupied--;
  };
  runtime.generation.adapters.codex = {
    check: async () => ({ message: "ok" }),
    generate: async () => {
      await occupy();
      return [png];
    },
  };
  vi.spyOn(runtime.processing.harness, "round").mockImplementation(
    async (_p, s) => {
      await occupy();
      s.rounds++;
      return { operationsJson: JSON.stringify([resize]), note: "ok" };
    },
  );
  const image = await input();
  const plans = await Promise.all([
    run([{ ...ai, providerId: codex.id, model: "" }], [image.id]),
    runtime.handle("processing.assistant.plan", {
      inputIds: [image.id],
      brief: "缩放",
    }),
  ]);
  await Promise.all(plans.map((p) => finished(p.jobId)));
  expect(max).toBe(1);
});
test("backup restore and rebuild stop unfinished processing and assistant records for inspection", async () => {
  const { jobId, runId } = await run([resize]);
  await finished(jobId);
  const { run: record } = await runtime.handle("processing.detail", {
    id: runId,
  });
  record.status = "running";
  record.items[0].state = "running";
  runtime.catalog.generationSave("processing_runs", record);
  const session = {
    id: uid(),
    providerId: "codex-default",
    brief: "恢复检查",
    rounds: 2,
    model: "",
    state: "reviewing",
    history: [],
    createdAt: now(),
  };
  runtime.catalog.generationSave("agent_sessions", session);
  await runtime.catalog.snapshot();
  const backup = await runtime.backup(path.join(base, "备份"), context());
  await runtime.restore(backup.target, path.join(base, "恢复"), context());
  await rebuildLibrary(runtime.root, path.join(base, "重建"));
  for (const name of ["恢复", "重建"]) {
    const other = await new Runtime(path.join(base, name)).init();
    try {
      expect(
        (await other.handle("processing.detail", { id: runId })).run.status,
      ).toBe("interrupted");
      expect(
        other.catalog.generationGet<any>("agent_sessions", session.id).state,
      ).toBe("needsInput");
    } finally {
      await other.shutdown();
    }
  }
});
test("assistant cannot exceed eight analysis rounds and cannot invent a different selected provider", async () => {
  await expect(
    runtime.processing.harness.round(
      provider,
      {
        id: uid(),
        brief: "",
        providerId: provider.id,
        model: "",
        rounds: 8,
        state: "reviewing",
        history: [],
        createdAt: now(),
      },
      base,
      "",
      [],
      new AbortController().signal,
    ),
  ).rejects.toThrow("八个");
  const codex: GenerationProviderConfig = {
    id: "codex-test",
    name: "Codex",
    kind: "codex",
    enabled: true,
    models: [],
    bindings: [],
    capabilities: capabilitiesFor("codex"),
  };
  runtime.generationAccess.providers.push(codex);
  runtime.generation.configure(runtime.generationAccess);
  vi.spyOn(runtime.processing.harness, "round").mockResolvedValue({
    operationsJson: JSON.stringify([
      { ...ai, providerId: "invented-provider" },
    ]),
    note: "切换",
  });
  const job = await runtime.handle("processing.assistant.plan", {
    inputIds: [(await input()).id],
    brief: "改色",
    selectedProviderId: provider.id,
    selectedModel: ai.model,
  });
  expect((await finished(job.jobId)).error).toContain("未选择");
  expect(await runtime.handle("processing.list")).toHaveLength(0);
  expect(
    runtime.catalog.generationGet<any>("agent_sessions", job.sessionId).state,
  ).toBe("needsInput");
});
test("derived asset inherits original source and license while storing the appended chain", async () => {
  const file = path.join(base, "original.png");
  await fs.writeFile(file, png);
  const plan = await inspectImport([file]);
  plan.source = {
    provider: "original-author",
    author: "作者",
    pageUrl: "https://example.com/asset",
    license: "CC0",
  };
  const imported = await runImport(runtime.catalog, plan, context());
  const original = runtime.catalog.get(imported.assets[0]);
  const image = await runtime.handle("processing.inputs.add", {
    source: { kind: "asset", id: original.id },
  });
  const { jobId, runId } = await run([resize], [image.id]);
  await finished(jobId);
  const detail = await runtime.handle("processing.detail", { id: runId });
  const accepted = await runtime.handle("processing.accept", {
    artifactIds: [detail.artifacts[0].id],
  });
  await finished(accepted.jobId);
  const derived = runtime.catalog
    .query({})
    .items.find((a) => a.id !== original.id)!;
  expect(derived.source?.license).toBe("CC0");
  expect(derived.source?.author).toBe("作者");
  expect(derived.metadata.processing.source.id).toBe(original.id);
  expect(runtime.catalog.get(original.id).metadata.processing).toBeUndefined();
});
