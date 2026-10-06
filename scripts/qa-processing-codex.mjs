// Live Codex planning and visual review; consumes two or more account analysis turns.
import { fork } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
const require = createRequire(import.meta.url);
const root = path.resolve(`.data/processing-codex-qa-${Date.now()}`);
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
const provider = {
  id: "codex-default",
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
await sharp({
  create: { width: 128, height: 128, channels: 4, background: "#3377ff" },
})
  .png()
  .toFile(inputFile);
const child = fork(path.resolve("out/main/service.cjs"), [], {
  execPath: require("electron"),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
let serial = 0;
const pending = new Map();
let readyResolve, readyReject;
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
  for (;;) {
    const job = (await call("jobs.list")).find((j) => j.id === id);
    if (
      ["completed", "failed", "interrupted", "cancelled"].includes(job?.status)
    ) {
      if (job.status !== "completed") throw new Error(job.error ?? job.status);
      return job.result;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}
try {
  const image = await call("processing.inputs.add", { path: inputFile });
  const proposed = await call("processing.assistant.plan", {
    inputIds: [image.id],
    brief:
      "只使用本地 resize 工具，将这张蓝色纯色方形图片缩放为64×64，使用最近邻，其他不改。只要一个步骤。",
  });
  const { plan } = await wait(proposed.jobId);
  if ((await call("processing.list")).length)
    throw new Error("助手未经启动就执行加工");
  const started = await call("processing.start", { planId: plan.id });
  await wait(started.jobId);
  const detail = await call("processing.detail", { id: started.runId });
  if (detail.artifacts.at(-1)?.width !== 64)
    throw new Error("Wrong dimensions");
  const accepted = await call("processing.accept", {
    artifactIds: [detail.artifacts.at(-1).id],
  });
  await wait(accepted.jobId);
  const report = {
    date: new Date().toISOString(),
    root,
    transport: detail.session?.threadId
      ? "app-server stdio"
      : "exec json fallback",
    plan,
    rounds: detail.session?.rounds,
    review: detail.session?.history.at(-1),
    artifact: detail.artifacts.at(-1),
    status: "passed",
  };
  await fs.writeFile(
    path.resolve("docs/processing-codex-qa.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: report.status,
      transport: report.transport,
      rounds: report.rounds,
      root,
    }),
  );
} finally {
  child.send({ type: "shutdown" });
  await new Promise((r) => child.once("exit", r));
}
