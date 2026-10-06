import { beforeEach, afterEach, test, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";
import { Runtime } from "../src/core/runtime";
import { Catalog } from "../src/core/catalog";
import {
  OpenAIImageAdapter,
  RunningHubImageAdapter,
  CodexImageAdapter,
  type AdapterContext,
} from "../src/core/generation-adapters";
import { GenerationProviderStore } from "../src/core/generation-provider-store";
import { providerSchema } from "../src/core/generation-schemas";
import {
  capabilitiesFor,
  type GenerationProviderConfig,
  type GenerationRequest,
  type GenerationRun,
} from "../src/shared/generation";
import { WorkshopError, uid, now, inside, hashFile } from "../src/core/files";
import {
  type JobContext,
  inspectImport,
  runImport,
} from "../src/core/importer";
import { inspectExport, runExport } from "../src/core/exporter";
import { rebuildLibrary } from "../src/core/recovery";

let base: string,
  image: Buffer,
  runtime: Runtime | undefined,
  server: http.Server | undefined;
const secret = "fake-private-key-for-tests";
const provider = (
  kind: GenerationProviderConfig["kind"] = "openai",
  endpoint = "http://127.0.0.1:1/v1",
): GenerationProviderConfig => ({
  id: `test-${kind}`,
  name: kind,
  kind,
  enabled: true,
  endpoint,
  models: kind === "openai" ? ["test-image"] : [],
  bindings: [],
  capabilities: capabilitiesFor(kind),
});
const request = (
  p = provider(),
  patch: Partial<GenerationRequest> = {},
): GenerationRequest => ({
  providerId: p.id,
  model: p.models[0] ?? "",
  prompt: "制作药水游戏图标",
  referenceIds: [],
  width: 128,
  height: 128,
  count: 1,
  category: "ui",
  tags: ["生成"],
  ...patch,
});
const context = (
  p = provider(),
  patch: Partial<AdapterContext> = {},
): AdapterContext => ({
  provider: p,
  request: request(p),
  key: secret,
  inputFiles: [],
  outputDirectory: base,
  signal: new AbortController().signal,
  submitted: async () => {},
  outputs: async () => {},
  progress: () => {},
  ...patch,
});
function jobContext(): JobContext {
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
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "工坊-generation-"));
  image = await sharp({
    create: { width: 128, height: 128, channels: 4, background: "#826235" },
  })
    .png()
    .toBuffer();
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (runtime) await runtime.shutdown();
  runtime = undefined;
  server?.closeAllConnections();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
  await fs.rm(base, { recursive: true, force: true });
});
async function serve(
  handler: (
    url: string,
    body: Buffer,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) => void | Promise<void>,
) {
  server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    await handler(req.url!, Buffer.concat(chunks), req, res);
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as any).port}`;
}
const json = (res: http.ServerResponse, data: unknown, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
};
async function library(p = provider()) {
  runtime = await new Runtime(path.join(base, "库"), undefined, undefined, {
    providers: [p],
    keys: { [p.id]: secret },
  }).init();
  return runtime;
}
async function start(
  r: Runtime,
  p = provider(),
  patch: Partial<GenerationRequest> = {},
) {
  const plan = await r.handle("generation.preview", {
    items: [request(p, patch)],
  });
  return r.handle("generation.start", { planId: plan.id });
}
async function finished(r: Runtime, id: string) {
  await vi.waitFor(
    () => {
      expect(r.active.has(id)).toBe(false);
      expect(r.catalog.jobs().find((j) => j.id === id)?.status).not.toBe(
        "queued",
      );
    },
    { timeout: 6000, interval: 15 },
  );
  return r.catalog.jobs().find((j) => j.id === id)!;
}

test("connection checks only query authentication and workflow access", async () => {
  const calls: string[] = [];
  const endpoint = await serve((url, body, req, res) => {
    calls.push(url);
    expect(req.headers.authorization).toBe(`Bearer ${secret}`);
    json(
      res,
      url === "/v1/models"
        ? { data: [{ id: "test-image" }] }
        : {
            code: 0,
            data: {
              prompt: JSON.stringify({
                "1": {
                  class_type: "CLIPTextEncode",
                  inputs: { text: "hello" },
                },
              }),
            },
          },
    );
  });
  expect(
    (
      await new OpenAIImageAdapter().check(
        provider("openai", endpoint + "/v1"),
        secret,
      )
    ).models,
  ).toEqual(["test-image"]);
  await new RunningHubImageAdapter().check(
    { ...provider("runninghub", endpoint), workflowId: "123" },
    secret,
  );
  expect(calls).toEqual(["/v1/models", "/api/openapi/getJsonApiFormat"]);
});
test("OpenAI generates actual PNG and sends reference plus alpha mask to edits", async () => {
  const calls: any[] = [];
  const endpoint = await serve((url, body, req, res) => {
    calls.push({
      url,
      body: body.toString(),
      type: req.headers["content-type"],
    });
    json(res, { data: [{ b64_json: image.toString("base64") }] });
  });
  const p = provider("openai", endpoint + "/v1"),
    adapter = new OpenAIImageAdapter();
  expect(await adapter.generate(context(p))).toEqual([image]);
  const ref = path.join(base, "ref.png"),
    mask = path.join(base, "mask.png");
  await fs.writeFile(ref, image);
  await fs.writeFile(mask, image);
  await adapter.generate(context(p, { inputFiles: [ref], maskFile: mask }));
  expect(JSON.parse(calls[0].body)).toMatchObject({
    model: "test-image",
    n: 1,
    size: "128x128",
  });
  expect(calls[1].url).toBe("/v1/images/edits");
  expect(calls[1].type).toContain("multipart/form-data");
  expect(calls[1].body).toContain('name="image"');
  expect(calls[1].body).toContain('name="mask"');
});
test.each([401, 429])(
  "permission and rate-limit failures (%i) remain explicit and redact keys",
  async (status) => {
    const endpoint = await serve((_url, _body, _req, res) =>
      json(res, { error: { message: `Rejected ${secret}` } }, status),
    );
    await expect(
      new OpenAIImageAdapter().generate(context(provider("openai", endpoint))),
    ).rejects.toMatchObject({ code: `HTTP_${status}` });
    try {
      await new OpenAIImageAdapter().check(
        provider("openai", endpoint),
        secret,
      );
    } catch (e) {
      expect(String(e)).not.toContain(secret);
    }
  },
);
test("HTTP timeout is uncertain; user cancellation is explicit", async () => {
  const endpoint = await serve(() => {}),
    p = provider("openai", endpoint),
    adapter = new OpenAIImageAdapter();
  const timeout = new AbortController();
  vi.spyOn(AbortSignal, "timeout").mockImplementation(() => timeout.signal);
  setTimeout(() => timeout.abort(), 30);
  await expect(adapter.generate(context(p))).rejects.toMatchObject({
    code: "NETWORK_UNCERTAIN",
  });
  vi.restoreAllMocks();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await expect(
    adapter.generate(context(p, { signal: controller.signal })),
  ).rejects.toMatchObject({ code: "CANCELLED" });
});
test("RunningHub uploads references and mask, saves task ID before polling, downloads and cancels", async () => {
  const routes: string[] = [],
    mapped: any[] = [];
  let saved = false,
    uploads = 0;
  const endpoint = await serve((url, body, _req, res) => {
    routes.push(url);
    if (url === "/task/openapi/upload") {
      expect(body.toString()).toContain('name="fileType"');
      return json(res, {
        code: 0,
        data: { fileName: `inputs/${++uploads}.png` },
      });
    }
    if (url === "/task/openapi/create") {
      mapped.push(...JSON.parse(body.toString()).nodeInfoList);
      return json(res, { code: 0, data: { taskId: "remote-123" } });
    }
    if (url === "/task/openapi/outputs") {
      expect(saved).toBe(true);
      return json(res, {
        code: 0,
        data: [{ fileUrl: endpoint + "/result.png", fileType: "png" }],
      });
    }
    if (url === "/result.png") {
      res.end(image);
      return;
    }
    json(res, { code: 0, data: {} });
  });
  const p = {
    ...provider("runninghub", endpoint),
    workflowId: "123",
    bindings: [
      { nodeId: "1", fieldName: "text", role: "prompt" },
      { nodeId: "2", fieldName: "image", role: "reference" },
      { nodeId: "3", fieldName: "image", role: "mask" },
      { nodeId: "4", fieldName: "seed", role: "seed" },
    ],
  } as GenerationProviderConfig;
  const filename = path.join(base, "input.png");
  await fs.writeFile(filename, image);
  const adapter = new RunningHubImageAdapter();
  expect(
    await adapter.generate(
      context(p, {
        request: request(p, { seed: 42 }),
        inputFiles: [filename],
        maskFile: filename,
        submitted: async (id) => {
          expect(id).toBe("remote-123");
          saved = true;
        },
      }),
    ),
  ).toEqual([image]);
  expect(mapped).toContainEqual({
    nodeId: "2",
    fieldName: "image",
    fieldValue: "inputs/1.png",
  });
  expect(mapped).toContainEqual({
    nodeId: "3",
    fieldName: "image",
    fieldValue: "inputs/2.png",
  });
  expect(mapped).toContainEqual({
    nodeId: "4",
    fieldName: "seed",
    fieldValue: 42,
  });
  await adapter.cancel(p, secret, "remote-123");
  expect(routes.at(-1)).toBe("/task/openapi/cancel");
});
test("Codex refuses success without a real generated file", async () => {
  const r = await library(provider("codex"));
  r.generation.adapters = {
    codex: {
      check: async () => ({ message: "test" }),
      generate: async () => [Buffer.from("I saved an image")],
    },
  };
  const started = await start(r, provider("codex"));
  expect((await finished(r, started.jobId)).status).toBe("interrupted");
  expect(
    (await r.handle("generation.detail", { id: started.runId })).candidates,
  ).toHaveLength(0);
  await expect(
    new CodexImageAdapter().generate(
      context({
        ...provider("codex"),
        executable: path.join(base, "missing.exe"),
      }),
    ),
  ).rejects.toThrow("无法启动");
});
test("partial batch success survives, and retry submits only rejected items", async () => {
  const r = await library();
  let calls = 0;
  r.generation.adapters = {
    openai: {
      check: async () => ({ message: "ok" }),
      generate: async () => {
        if (++calls === 2)
          throw new WorkshopError("HTTP_429", `limited ${secret}`);
        return [image];
      },
    },
  };
  const started = await start(r, provider(), { count: 3 });
  expect((await finished(r, started.jobId)).status).toBe("failed");
  let detail = await r.handle("generation.detail", { id: started.runId });
  expect(detail.candidates).toHaveLength(2);
  expect(JSON.stringify(detail)).not.toContain(secret);
  await r.handle("jobs.control", { id: started.jobId, action: "retry" });
  expect((await finished(r, started.jobId)).status).toBe("completed");
  detail = await r.handle("generation.detail", { id: started.runId });
  expect(detail.candidates).toHaveLength(3);
  expect(calls).toBe(4);
});
test("unknown submission is never auto-replayed and requires an explicit checked retry", async () => {
  const p = provider(),
    r = await library(p);
  let calls = 0;
  r.generation.adapters = {
    openai: {
      check: async () => ({ message: "ok" }),
      generate: async () => {
        calls++;
        throw new WorkshopError("NETWORK_UNCERTAIN", "response lost");
      },
    },
  };
  const started = await start(r, p);
  expect((await finished(r, started.jobId)).status).toBe("interrupted");
  await expect(
    r.handle("jobs.control", { id: started.jobId, action: "retry" }),
  ).rejects.toThrow("先检查");
  await r.shutdown();
  runtime = undefined;
  const reopened = await library(p);
  await new Promise((r) => setTimeout(r, 50));
  expect(reopened.active.size).toBe(0);
  expect(calls).toBe(1);
  expect(
    reopened.catalog.jobs().find((j) => j.id === started.jobId)?.status,
  ).toBe("interrupted");
});
test("restart resumes a persisted RunningHub task and never creates it again", async () => {
  const p = provider("runninghub"),
    r = await library(p);
  p.workflowId = "123";
  p.bindings = [{ nodeId: "1", fieldName: "text", role: "prompt" }];
  let submits = 0;
  r.generation.adapters = {
    runninghub: {
      check: async () => ({ message: "ok" }),
      generate: async (ctx) => {
        submits++;
        await ctx.submitted("persisted-remote");
        return new Promise<Buffer[]>((_res, reject) =>
          ctx.signal.addEventListener(
            "abort",
            () => reject(new Error("stop")),
            { once: true },
          ),
        );
      },
    },
  };
  const started = await start(r, p);
  await vi.waitFor(() =>
    expect(
      r.catalog.generationGet<GenerationRun>("generation_runs", started.runId)
        ?.items[0].remoteTaskId,
    ).toBe("persisted-remote"),
  );
  await r.shutdown();
  runtime = undefined;
  const reopened = new Runtime(path.join(base, "库"), undefined, undefined, {
    providers: [p],
    keys: { [p.id]: secret },
  });
  runtime = reopened;
  await reopened.init();
  // init schedules asynchronously; install the adapter before its first submission boundary.
  reopened.generation.adapters = {
    runninghub: {
      check: async () => ({ message: "ok" }),
      generate: async (ctx) => {
        expect(ctx.remoteTaskId).toBe("persisted-remote");
        return [image];
      },
    },
  };
  expect((await finished(reopened, started.jobId)).status).toBe("completed");
  expect(submits).toBe(1);
});
test("interrupted result download retries the saved URL without another generation call", async () => {
  let downloads = 0,
    calls = 0;
  const endpoint = await serve((_url, _body, _req, res) => {
    if (++downloads === 1) {
      res.writeHead(503);
      res.end("retry");
    } else res.end(image);
  });
  const r = await library();
  r.generation.adapters = {
    openai: {
      check: async () => ({ message: "ok" }),
      generate: async (ctx) => {
        calls++;
        await ctx.outputs([endpoint + "/result.png"]);
        throw new Error("download interrupted");
      },
    },
  };
  const started = await start(r);
  expect((await finished(r, started.jobId)).status).toBe("failed");
  await r.handle("jobs.control", { id: started.jobId, action: "retry" });
  expect((await finished(r, started.jobId)).status).toBe("failed");
  await r.handle("jobs.control", { id: started.jobId, action: "retry" });
  expect((await finished(r, started.jobId)).status).toBe("completed");
  expect(calls).toBe(1);
});
test("accept is idempotent; provenance, reference hashes and mask survive export, backup and rebuild", async () => {
  const r = await library(),
    refFile = path.join(base, "参考.png");
  await fs.writeFile(refFile, image);
  const ref = await r.handle("generation.inputs.add", { filePath: refFile });
  const mask = await r.handle("generation.mask.save", {
    referenceId: ref.id,
    base64: image.toString("base64"),
  });
  r.generation.adapters = {
    openai: {
      check: async () => ({ message: "ok" }),
      generate: async () => [image],
    },
  };
  const project = r.catalog.saveProject({ name: "生成游戏" }),
    started = await start(r, provider(), {
      referenceIds: [ref.id],
      maskId: mask.id,
      projectId: project.id,
    });
  await finished(r, started.jobId);
  const detail = await r.handle("generation.detail", { id: started.runId }),
    candidate = detail.candidates[0];
  const a = await r.handle("generation.accept", {
      candidateIds: [candidate.id],
    }),
    b = await r.handle("generation.accept", { candidateIds: [candidate.id] });
  expect(a.jobId).toBe(b.jobId);
  await finished(r, a.jobId);
  await r.handle("generation.accept", { candidateIds: [candidate.id] });
  expect(r.catalog.stats().assets).toBe(1);
  const asset = r.catalog.query({}).items[0];
  expect(asset.metadata.generation.references).toEqual([
    { sha256: ref.sha256, role: "reference" },
    { sha256: mask.sha256, role: "mask" },
  ]);
  expect(r.catalog.projects()[0].assetCount).toBe(1);
  await r.handle("generation.templates.save", {
    name: "药水风格",
    request: request(provider(), { referenceIds: [ref.id], maskId: mask.id }),
  });
  const output = await runExport(
    r.catalog,
    inspectExport(r.catalog, {
      assetIds: [asset.id],
      mode: "generic",
      target: path.join(base, "导出"),
    }),
    jobContext(),
  );
  const target = new Catalog(path.join(base, "再导入"));
  try {
    const imported = await runImport(
      target,
      await inspectImport([output.target]),
      jobContext(),
    );
    expect(target.get(imported.assets[0]).metadata.generation.candidateId).toBe(
      candidate.id,
    );
  } finally {
    target.close();
  }
  const backup = await r.backup(path.join(base, "备份"), jobContext());
  await r.restore(backup.target, path.join(base, "恢复"), jobContext());
  const restored = new Catalog(path.join(base, "恢复"));
  try {
    expect(restored.generationList("generation_templates")).toHaveLength(1);
    const c: any = restored.generationGet(
      "generation_candidates",
      candidate.id,
    );
    expect(await hashFile(inside(restored.root, c.relativePath))).toBe(
      candidate.sha256,
    );
    expect(restored.get(asset.id).metadata.generation.prompt).toBe(
      "制作药水游戏图标",
    );
    expect(
      await fs.readFile(
        path.join(backup.target, "metadata", "catalog.json"),
        "utf8",
      ),
    ).not.toContain(secret);
  } finally {
    restored.close();
  }
  await rebuildLibrary(r.root, path.join(base, "重建"));
  const rebuilt = new Catalog(path.join(base, "重建"));
  try {
    expect(rebuilt.generationList("generation_candidates")).toHaveLength(1);
    expect(rebuilt.get(asset.id).metadata.generation.candidateId).toBe(
      candidate.id,
    );
  } finally {
    rebuilt.close();
  }
});
test("unreadable saved keys do not prevent Codex startup and retain their encrypted records", async () => {
  const folder = path.join(base, "unreadable-provider"),
    store = await new GenerationProviderStore(
      folder,
      (k) => `encrypted:${k}`,
      () => {
        throw new Error("decrypt failed");
      },
    ).init();
  await store.save(provider(), "synthetic-test-secret");
  const before = await fs.readFile(
    path.join(folder, "generation-providers.json"),
    "utf8",
  );
  const access = store.access();
  expect(access.providers.some((p) => p.kind === "codex" && p.enabled)).toBe(
    true,
  );
  expect(access.keys).toEqual({});
  expect(store.list().find((p) => p.id === provider().id)).toMatchObject({
    hasKey: false,
    keyError: expect.stringContaining("重新保存"),
  });
  expect(
    await fs.readFile(path.join(folder, "generation-providers.json"), "utf8"),
  ).toBe(before);
});
test("missing persisted Codex executables rediscover the installed bundle without changing saved keys", async () => {
  const fakeLocal = path.join(base, "local"),
    bundle = path.join(
      fakeLocal,
      "OpenAI",
      "Codex",
      "bin",
      "new-version",
      "codex.exe",
    );
  await fs.mkdir(path.dirname(bundle), { recursive: true });
  await fs.writeFile(bundle, "synthetic exe");
  const folder = path.join(base, "rediscover");
  await fs.mkdir(folder);
  await fs.writeFile(
    path.join(folder, "generation-providers.json"),
    JSON.stringify({
      providers: [
        {
          config: {
            ...provider("codex"),
            executable: path.join(fakeLocal, "missing.exe"),
          },
        },
      ],
    }),
  );
  const old = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = fakeLocal;
  try {
    const store = await new GenerationProviderStore(
      folder,
      (k) => k,
      (k) => k,
    ).init();
    expect(store.list()[0].executable).toBe(bundle);
  } finally {
    if (old === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = old;
  }
});
test("provider secrets are encrypted and are not carried to a changed endpoint", async () => {
  const store = await new GenerationProviderStore(
    base,
    (s) => Buffer.from(s).toString("base64"),
    (s) => Buffer.from(s, "base64").toString(),
  ).init();
  const p = provider();
  await store.save(p, secret);
  expect(store.list().find((c) => c.id === p.id)?.hasKey).toBe(true);
  expect(
    await fs.readFile(path.join(base, "generation-providers.json"), "utf8"),
  ).not.toContain(secret);
  await store.save({ ...p, endpoint: "https://different.example/v1" });
  expect(store.access().keys[p.id]).toBeUndefined();
  expect(() =>
    providerSchema.parse({
      ...p,
      workflowJSON: {
        "1": { class_type: "Node", inputs: { api_key: secret } },
      },
    }),
  ).toThrow("密钥");
});
test("scheduler keeps total concurrency two and Codex concurrency one", async () => {
  const p = provider("codex"),
    r = await library(p);
  let active = 0,
    max = 0;
  r.generation.adapters = {
    codex: {
      check: async () => ({ message: "ok" }),
      generate: async () => {
        max = Math.max(max, ++active);
        await new Promise((r) => setTimeout(r, 60));
        active--;
        return [image];
      },
    },
  };
  const jobs = await Promise.all([start(r, p), start(r, p), start(r, p)]);
  await Promise.all(jobs.map((j) => finished(r, j.jobId)));
  expect(max).toBe(1);
  expect(r.active.size).toBe(0);
});

test("cancel preserves partial candidates and retry clears a confirmed cancelled remote task", async () => {
  const p = provider("runninghub");
  p.workflowId = "123";
  p.bindings = [{ nodeId: "1", fieldName: "text", role: "prompt" }];
  const r = await library(p);
  let submits = 0,
    cancelled = "";
  r.generation.adapters = {
    runninghub: {
      check: async () => ({ message: "ok" }),
      cancel: async (_p, _k, id) => {
        cancelled = id;
      },
      generate: async (ctx) => {
        if (++submits === 1) return [image];
        await ctx.submitted("to-cancel");
        return new Promise<Buffer[]>((_resolve, reject) =>
          ctx.signal.addEventListener(
            "abort",
            () => reject(new WorkshopError("CANCELLED", "cancel")),
            { once: true },
          ),
        );
      },
    },
  };
  const started = await start(r, p, { count: 2 });
  await vi.waitFor(() =>
    expect(
      r.catalog.generationGet<GenerationRun>("generation_runs", started.runId)
        ?.items[1].remoteTaskId,
    ).toBe("to-cancel"),
  );
  await r.handle("jobs.control", { id: started.jobId, action: "cancel" });
  expect(cancelled).toBe("to-cancel");
  expect((await finished(r, started.jobId)).cancellation?.message).toContain(
    "远端取消已确认",
  );
  const detail = await r.handle("generation.detail", { id: started.runId });
  expect(detail.candidates).toHaveLength(1);
  expect(detail.run.items[1].remoteCancellation).toBe("cancelled");
  r.generation.adapters.runninghub.generate = async (ctx) => {
    expect(ctx.remoteTaskId).toBeUndefined();
    return [image];
  };
  await r.handle("jobs.control", { id: started.jobId, action: "retry" });
  expect((await finished(r, started.jobId)).status).toBe("completed");
  expect(
    (await r.handle("generation.detail", { id: started.runId })).candidates,
  ).toHaveLength(2);
});
test("a committed candidate missing its run pointer is recovered without another model call", async () => {
  const r = await library();
  r.generation.adapters = {
    openai: {
      check: async () => ({ message: "ok" }),
      generate: async () => [image],
    },
  };
  const started = await start(r);
  await finished(r, started.jobId);
  const run = r.catalog.generationGet<GenerationRun>(
    "generation_runs",
    started.runId,
  )!;
  run.items[0].candidateIds = [];
  run.items[0].state = "submitting";
  run.status = "running";
  r.catalog.generationSave("generation_runs", run);
  const job = r.catalog.jobs().find((j) => j.id === started.jobId)!;
  job.status = "running";
  r.catalog.saveJob(job);
  await r.shutdown();
  runtime = undefined;
  const reopened = await library();
  let calls = 0;
  reopened.generation.adapters.openai.generate = async () => {
    calls++;
    return [image];
  };
  expect((await finished(reopened, started.jobId)).status).toBe("completed");
  expect(calls).toBe(0);
  expect(
    (await reopened.handle("generation.detail", { id: started.runId }))
      .candidates,
  ).toHaveLength(1);
});
test("mismatched masks and unsupported controls fail before any generation is submitted", async () => {
  const r = await library(provider("codex")),
    file = path.join(base, "ref.png");
  await fs.writeFile(file, image);
  const ref = await r.handle("generation.inputs.add", { filePath: file });
  const small = await sharp(image).resize(64, 64).png().toBuffer();
  await expect(
    r.handle("generation.mask.save", {
      referenceId: ref.id,
      base64: small.toString("base64"),
    }),
  ).rejects.toThrow("同尺寸");
  await expect(
    r.handle("generation.preview", {
      items: [request(provider("codex"), { seed: 1 })],
    }),
  ).rejects.toThrow("不支持种子");
  expect(r.catalog.generationList("generation_runs")).toHaveLength(0);
});
test("mixed cloud and Codex jobs fill only two global slots", async () => {
  const p = provider("codex"),
    cloud = provider(),
    r = await library(p);
  r.generation.configure({
    providers: [p, cloud],
    keys: { [cloud.id]: secret },
  });
  let concurrent = 0,
    peak = 0;
  const generate = async () => {
    peak = Math.max(peak, ++concurrent);
    await new Promise((resolve) => setTimeout(resolve, 80));
    concurrent--;
    return [image];
  };
  r.generation.adapters = {
    codex: { check: async () => ({ message: "ok" }), generate },
    openai: { check: async () => ({ message: "ok" }), generate },
  };
  const jobs = await Promise.all([
    start(r, p),
    start(r, cloud),
    start(r, p),
    start(r, cloud),
  ]);
  await Promise.all(jobs.map((j) => finished(r, j.jobId)));
  expect(peak).toBe(2);
});

test("retry cannot send a new endpoint credential to the saved old service", async () => {
  const p = provider(),
    r = await library(p);
  r.generation.adapters = {
    openai: {
      check: async () => ({ message: "ok" }),
      generate: async () => {
        throw new WorkshopError("HTTP_429", "limited");
      },
    },
  };
  const started = await start(r, p);
  await finished(r, started.jobId);
  r.generation.configure({
    providers: [{ ...p, endpoint: "https://new.example/v1" }],
    keys: { [p.id]: "new-account-secret" },
  });
  await expect(
    r.handle("jobs.control", { id: started.jobId, action: "retry" }),
  ).rejects.toThrow("地址已变更");
  expect(r.active.size).toBe(0);
});
