import { _electron as electron, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const start = performance.now(),
  app = await electron.launch({
    args: ["out/main/index.cjs"],
    env: { ...process.env, WORKSHOP_LIBRARY: path.resolve(".data/library") },
  }),
  page = await app.firstWindow(),
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.waitForSelector(".asset-card");
  const firstScreenMs = performance.now() - start;
  await page.getByLabel("搜索素材", { exact: true }).fill("wooden_crate_02_2k");
  await expect(page.locator(".asset-card")).toHaveCount(1);
  await page.waitForTimeout(5000);
  const cdp = await page.context().newCDPSession(page),
    samples = [];
  const sample = async (step) => {
    await cdp.send("HeapProfiler.collectGarbage");
    const heap = await cdp.send("Runtime.getHeapUsage"),
      processes = await app.evaluate(({ app }) =>
        app
          .getAppMetrics()
          .map((p) => ({
            type: p.type,
            memory: p.memory,
            cpu: p.cpu.percentCPUUsage,
          })),
      );
    samples.push({
      step,
      jsHeapMiB: heap.usedSize / 1024 ** 2,
      backingStorageMiB: (heap.backingStorageSize ?? 0) / 1024 ** 2,
      processes,
    });
  };
  await sample(0);
  for (
    let i = 1;
    i <= Number(process.env.WORKSHOP_MODEL_ITERATIONS ?? 100);
    i++
  ) {
    await page.locator(".asset-card").dblclick();
    await expect(
      page.getByRole("dialog").locator(".model-canvas canvas"),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").locator(".viewer-message"),
    ).toHaveCount(0, { timeout: 30000 });
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    if (i % 10 === 0) {
      await sample(i);
      console.log("模型切换", i, samples.at(-1).jsHeapMiB.toFixed(1), "MiB");
    }
  }
  await page.waitForTimeout(3000);
  await sample(101);
  const idle = [];
  for (let i = 0; i < 5; i++) {
    await page.waitForTimeout(1000);
    idle.push(
      (
        await app.evaluate(({ app }) =>
          app
            .getAppMetrics()
            .map((p) => ({ type: p.type, cpu: p.cpu.percentCPUUsage })),
        )
      ).reduce((n, p) => n + p.cpu, 0),
    );
  }
  if (process.env.WORKSHOP_HEAP) {
    const chunks = [];
    cdp.on("HeapProfiler.addHeapSnapshotChunk", (event) =>
      chunks.push(event.chunk),
    );
    await cdp.send("HeapProfiler.takeHeapSnapshot");
    await fs.writeFile(".data/viewer.heapsnapshot", chunks.join(""));
  }
  const report = {
    date: new Date().toISOString(),
    cpu: os.cpus()[0].model,
    ramGiB: os.totalmem() / 1024 ** 3,
    firstScreenMs,
    iterations: Number(process.env.WORKSHOP_MODEL_ITERATIONS ?? 100),
    resource: "Poly Haven wooden_crate_02 2K glTF",
    method:
      "Electron process metrics; renderer JS heap after explicit GC; existing OS caches",
    samples,
    idleCPUSumPercent: idle,
    errors,
    heapGrowthMiB: samples.at(-1).jsHeapMiB - samples[1].jsHeapMiB,
  };
  await fs.writeFile(
    process.env.WORKSHOP_HEAP
      ? "docs/viewer-performance-debug.json"
      : "docs/viewer-performance.json",
    JSON.stringify(report, null, 2),
  );
  if (errors.length) process.exitCode = 1;
} finally {
  await app.close();
}
