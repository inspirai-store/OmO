// Optional live smoke test. This consumes the current Codex account's generation allowance.
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const root = path.resolve(
  process.env.WORKSHOP_LIBRARY ?? `.data/generation-codex-qa-${Date.now()}`,
);
const bin = path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
const candidates = await Promise.all(
  (await fs.readdir(bin)).map(async (dir) => {
    const file = path.join(bin, dir, "codex.exe");
    const s = await fs.stat(file).catch(() => null);
    return { file, time: s?.mtimeMs ?? 0 };
  }),
);
candidates.sort((a, b) => b.time - a.time);
const provider = {
  id: "codex-default",
  name: "Codex 真实验收",
  kind: "codex",
  enabled: true,
  models: [],
  executable: candidates[0].file,
  bindings: [],
  capabilities: {
    references: true,
    maxReferences: 5,
    mask: false,
    seed: false,
    negativePrompt: false,
    transparent: true,
    quality: false,
    cancelRemote: false,
  },
};
const child = fork(path.resolve("out/main/service.cjs"), [], {
  execPath: require("electron"),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
const pending = new Map();
let sequence = 0,
  readyResolve,
  readyReject;
const ready = new Promise((r, j) => {
  readyResolve = r;
  readyReject = j;
});
child.stderr.pipe(process.stderr);
child.on("message", (m) => {
  if (m.type === "ready") readyResolve();
  else if (m.type === "init-error") readyReject(new Error(m.error.message));
  else if (m.type === "response") {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p?.reject(new Error(m.error.message)) : p?.resolve(m.result);
  } else if (m.type === "event" && m.event.type === "job.updated")
    console.log(
      `${m.event.data.type}: ${m.event.data.status} ${m.event.data.stage}`,
    );
});
const call = (method, input = {}) =>
  new Promise((resolve, reject) => {
    const id = String(++sequence);
    pending.set(id, { resolve, reject });
    child.send({ type: "request", id, method, input });
  });
child.send({
  type: "init",
  root,
  generationAccess: { providers: [provider], keys: {} },
});
await ready;
const wait = async (id) => {
  for (;;) {
    const job = (await call("jobs.list")).find((j) => j.id === id);
    if (
      ["completed", "failed", "cancelled", "interrupted"].includes(job?.status)
    ) {
      if (job.status !== "completed") throw new Error(job.error ?? job.status);
      return job.result;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
};
try {
  console.log(await call("generation.providers.test", { id: provider.id }));
  const request = {
    providerId: provider.id,
    model: "",
    prompt:
      "制作一个奇幻游戏药水瓶图标，深蓝色药水，金色瓶塞，居中构图，清晰轮廓，纯白背景，不含文字。",
    referenceIds: [],
    width: 1024,
    height: 1024,
    count: 1,
    category: "ui",
    tags: ["真实验收"],
  };
  const assistant = await call("generation.assistant.plan", {
    base: request,
    brief: "把需求改写成一个可直接生图的完整方案，不要生成图片。",
  });
  const assistantResult = await wait(assistant.jobId);
  if ((await call("generation.list")).length)
    throw new Error("Assistant unexpectedly started generation");
  const plan = await call("generation.preview", {
    items: assistantResult.plan.items,
  });
  const run = await call("generation.start", { planId: plan.id });
  await wait(run.jobId);
  const detail = await call("generation.detail", { id: run.runId });
  if (!detail.candidates.length) throw new Error("No actual image");
  const accepted = await call("generation.accept", {
    candidateIds: [detail.candidates[0].id],
  });
  await wait(accepted.jobId);
  const report = {
    date: new Date().toISOString(),
    root,
    assistant: "passed without automatic generation",
    candidate: detail.candidates[0],
    assets: (await call("assets.query", {})).items.map((a) => ({
      id: a.id,
      generation: a.metadata.generation,
    })),
  };
  await fs.mkdir(path.resolve("docs"), { recursive: true });
  await fs.writeFile(
    path.resolve("docs/generation-codex-qa.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  child.send({ type: "shutdown" });
  await new Promise((resolve) => child.once("exit", resolve));
}
