import { fork } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(process.env.WORKSHOP_LIBRARY ?? ".data/library");
const child = fork(path.resolve("out/main/service.cjs"), [], {
  execPath: require("electron"),
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
let seq = 0;
const pending = new Map();
const jobs = new Map();
let readyResolve, readyReject;
const ready = new Promise((r, j) => {
  readyResolve = r;
  readyReject = j;
});
child.on("message", (m) => {
  if (m.type === "ready") readyResolve();
  else if (m.type === "init-error") readyReject(new Error(m.error.message));
  else if (m.type === "response") {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) p?.reject(new Error(m.error.message));
    else p?.resolve(m.result);
  } else if (m.type === "event" && m.event.type === "job.updated") {
    const j = m.event.data,
      old = jobs.get(j.id);
    jobs.set(j.id, j);
    if (old?.stage !== j.stage || old?.status !== j.status)
      console.log(
        `${j.title} · ${j.stage} · ${j.status}${j.error ? " · " + j.error : ""}`,
      );
  }
});
child.on("exit", (code) => {
  readyReject(new Error(`后台服务退出 ${code}`));
  for (const p of pending.values()) p.reject(new Error("后台服务已退出"));
  if (code) process.exitCode = code;
});
const call = (method, input = {}) =>
  new Promise((resolve, reject) => {
    const id = String(++seq);
    pending.set(id, { resolve, reject });
    child.send({ type: "request", id, method, input });
  });
child.send({ type: "init", root });
await ready;
const waitJob = async (id) => {
  while (true) {
    const j = (await call("jobs.list")).find((j) => j.id === id);
    if (j && ["completed", "failed", "cancelled"].includes(j.status)) {
      if (j.status !== "completed")
        throw new Error(`${j.title}: ${j.error ?? j.status}`);
      return j.result;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
};
try {
  const command = process.argv[2] ?? "stats";
  if (command === "seed") {
    const ids = await call("samples.installAll");
    const result = await Promise.allSettled(ids.map(waitJob));
    await fs.mkdir("docs", { recursive: true });
    const stats = await call("library.stats");
    const report = {
      date: new Date().toISOString(),
      root,
      stats: { ...stats, recent: undefined },
      samples: await call("sources.samples"),
      jobs: (await call("jobs.list")).map((j) => ({
        ...j,
        request: undefined,
      })),
    };
    await fs.writeFile(
      "docs/sample-downloads.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report.stats, null, 2));
    if (result.some((r) => r.status === "rejected")) process.exitCode = 1;
  } else if (command === "aggregation-check") {
    await (
      await import("./qa-aggregation.mjs")
    ).verifyAggregation(call, waitJob);
  } else if (command === "backup-check") {
    const before = await call("library.stats"),
      variants = await call("materials.list"),
      projects = await call("projects.list");
    const saved = await waitJob(
      await call("backups.create", { target: path.resolve(".data/backups") }),
    );
    const target = path.resolve(".data/restored-" + Date.now());
    const result = await waitJob(
      await call("backups.restore", { backup: saved.target, target }),
    );
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(target, "catalog.sqlite"));
    const assets = db
        .prepare("SELECT COUNT(*) n FROM assets WHERE trashed=0")
        .get().n,
      projectCount = db.prepare("SELECT COUNT(*) n FROM projects").get().n,
      variantCount = db.prepare("SELECT COUNT(*) n FROM variants").get().n;
    const passed =
      before.assets === assets &&
      projects.length === projectCount &&
      variants.length === variantCount;
    db.close();
    await fs.writeFile(
      "docs/backup-validation.json",
      JSON.stringify(
        {
          date: new Date().toISOString(),
          passed,
          backup: saved.target,
          restored: result,
          before: {
            assets: before.assets,
            projects: projects.length,
            variants: variants.length,
          },
          after: { assets, projects: projectCount, variants: variantCount },
        },
        null,
        2,
      ),
    );
    console.log("完整示例库备份恢复", passed ? "PASS" : "FAIL");
    if (!passed) process.exitCode = 1;
  } else if (command === "source-check") {
    const results = [];
    for (const provider of ["ambientcg", "polyhaven"]) {
      const first = await call("sources.search", {
          provider,
          search: "wood",
          offset: 0,
        }),
        next = await call("sources.search", {
          provider,
          search: "wood",
          offset: 30,
        });
      results.push({
        provider,
        total: first.total,
        first: first.items.length,
        next: next.items.length,
        firstId: first.items[0]?.upstreamId,
        passed:
          first.items.length > 0 &&
          (!next.items.length ||
            next.items[0]?.upstreamId !== first.items[0]?.upstreamId),
      });
    }
    await fs.writeFile(
      "docs/source-validation.json",
      JSON.stringify({ date: new Date().toISOString(), results }, null, 2),
    );
    console.log(results);
    if (results.some((r) => !r.passed)) process.exitCode = 1;
  } else if (command === "demos") {
    await (await import("./create-demos.mjs")).createDemos(call, waitJob);
  } else if (command === "stats")
    console.log(JSON.stringify(await call("library.stats"), null, 2));
  else if (command === "import") {
    const plan = await call("imports.inspect", {
      paths: process.argv.slice(3).map((p) => path.resolve(p)),
    });
    console.log(
      await waitJob(await call("imports.start", { planId: plan.id })),
    );
  } else throw new Error("使用 seed / stats / import");
} finally {
  child.send({ type: "shutdown" });
  await new Promise((r) => child.once("exit", r));
}
