// Live visual organization in an isolated QA library; one Codex analysis call.
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const require = createRequire(import.meta.url);
const root = path.resolve(`.data/processing-organize-codex-qa-${Date.now()}`);
const bin = path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin");
const executables = await Promise.all(
  (await fs.readdir(bin)).map(async (folder) => {
    const file = path.join(bin, folder, "codex.exe");
    return {
      file,
      time: (await fs.stat(file).catch(() => null))?.mtimeMs ?? 0,
    };
  }),
);
executables.sort((a, b) => b.time - a.time);
if (!executables[0]?.time) throw new Error("No installed Codex executable");
const provider = {
  id: "codex-qa",
  name: "Codex",
  kind: "codex",
  enabled: true,
  models: [],
  executable: executables[0].file,
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
await fs.mkdir(root, { recursive: true });
const inputFile = path.join(root, "qa-input.png");
await sharp(
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect x="47" y="8" width="34" height="18" rx="4" fill="#845833"/><path d="M47 25h34v25c0 8 27 16 27 39 0 22-17 32-44 32S20 111 20 89c0-23 27-31 27-39z" fill="#d0eafa" stroke="#354756" stroke-width="5"/><path d="M30 84q34-12 68 0v6c0 14-12 22-34 22S30 104 30 90z" fill="#ed3454"/><rect x="40" y="73" width="6" height="23" rx="3" fill="#ffffff" opacity=".75"/></svg>`,
  ),
)
  .png()
  .toFile(inputFile);
const child = fork(path.resolve("out/main/service.cjs"), [], {
  execPath: require("electron"),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
let serial = 0,
  readyResolve,
  readyReject;
const pending = new Map(),
  ready = new Promise((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
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
    const id = String(++serial);
    pending.set(id, { resolve, reject });
    child.send({ type: "request", id, method, input });
  });
child.send({
  type: "init",
  root,
  generationAccess: { providers: [provider], keys: {} },
});
await ready;
async function wait(id) {
  const deadline = Date.now() + 620000;
  while (Date.now() < deadline) {
    const job = (await call("jobs.list")).find((j) => j.id === id);
    if (
      ["completed", "failed", "interrupted", "cancelled"].includes(job?.status)
    ) {
      if (job.status !== "completed") throw new Error(job.error ?? job.status);
      return job.result;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("QA deadline exceeded");
}
try {
  const input = await call("processing.inputs.add", { path: inputFile });
  const plan = await call("processing.preview", {
    inputIds: [input.id],
    operations: [
      {
        type: "resize",
        width: 64,
        height: 64,
        fit: "contain",
        kernel: "nearest",
      },
    ],
  });
  const run = await call("processing.start", { planId: plan.id });
  await wait(run.jobId);
  const detail = await call("processing.detail", { id: run.runId });
  const project = await call("projects.save", { name: "消耗品图标项目" });
  const draft = await call("processing.organize.preview", {
    artifactIds: [detail.artifacts.at(-1).id],
    context: { projectId: project.id },
    brief: "这是供游戏道具栏使用的图标。请依据实际画面命名并分类。",
  });
  const analyze = await call("processing.organize.start", { id: draft.id });
  await wait(analyze.jobId);
  const proposal = await call("processing.organize.detail", { id: draft.id });
  if (
    proposal.calls !== 1 ||
    proposal.items[0].analysis !== "ai" ||
    !proposal.items[0].title.match(/[\u3400-\u9fff]/)
  )
    throw new Error(
      `Visual organization did not return an AI suggestion: ${JSON.stringify(proposal.warnings)}`,
    );
  const accepted = await call("processing.accept", {
    proposalId: proposal.id,
    items: proposal.items,
  });
  const result = await wait(accepted.jobId);
  const assets = await call("assets.query", { projectId: project.id });
  if (assets.total !== 1 || assets.items[0].title !== proposal.items[0].title)
    throw new Error("Organized import failed");
  const report = {
    date: new Date().toISOString(),
    root,
    status: "passed",
    calls: proposal.calls,
    proposal,
    asset: assets.items[0],
    importedAssetIds: result.assets,
  };
  await fs.writeFile(
    path.resolve("docs/processing-organize-codex-qa.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: "passed",
      calls: proposal.calls,
      title: assets.items[0].title,
      filename: assets.items[0].path,
    }),
  );
} finally {
  child.send({ type: "shutdown" });
  await new Promise((resolve) => child.once("exit", resolve));
}
