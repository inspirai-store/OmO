import { test, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { Catalog } from "../src/core/catalog";
import {
  inspectImport,
  runImport,
  type JobContext,
} from "../src/core/importer";
import { uid } from "../src/core/files";
test.skipIf(process.env.WORKSHOP_BENCHMARK !== "1")(
  "100,000 actual files / 10,000 images and search timings",
  async () => {
    const base = path.resolve(".data/benchmark"),
      source = path.join(base, "source"),
      root = path.join(base, "library");
    await fs.mkdir(source, { recursive: true });
    const png = await sharp({
      create: { width: 2, height: 2, channels: 4, background: "#bd9d68" },
    })
      .png()
      .toBuffer();
    const txt = Buffer.from("用于容量压力验证的归档文件");
    let generated = 0;
    const generatedAt = performance.now();
    for (let group = 0; group < 1000; group++) {
      const dir = path.join(source, String(group).padStart(4, "0"));
      await fs.mkdir(dir, { recursive: true });
      await Promise.all(
        Array.from({ length: 100 }, (_, i) => {
          const isImage = i < 10;
          return fs.writeFile(
            path.join(
              dir,
              `${isImage ? "木材地板" : "说明"}-${i}.${isImage ? "png" : "txt"}`,
            ),
            isImage ? png : txt,
          );
        }),
      );
      generated += 100;
      if (group % 100 === 0) console.log("generated", generated);
    }
    const catalog = new Catalog(root);
    await fs.mkdir(path.join(root, "cache"), { recursive: true });
    const plan = await inspectImport([source]);
    expect(plan.fileCount).toBe(100000);
    let checkpoints = 0,
      lastLog = 0;
    const ctx: JobContext = {
      job: {
        id: uid(),
        type: "import",
        title: "压力测试",
        status: "running",
        stage: "",
        progress: 0,
        done: 0,
        total: 1,
        request: {},
        createdAt: "",
        updatedAt: "",
      },
      check: async () => {
        checkpoints++;
        await new Promise<void>((r) => setImmediate(r));
      },
      event: () => {},
      progress: (stage, done, total) => {
        if (Date.now() - lastLog > 10000) {
          console.log(stage, done, total);
          lastLog = Date.now();
        }
      },
    };
    const start = performance.now();
    try {
      const result = await runImport(catalog, plan, ctx);
      expect(result.fileCount).toBe(100000);
      expect(catalog.query().total).toBe(10000);
      const timings: Record<string, any> = {};
      for (const q of ["木", "木材", "木材地板", "不存在", "png"]) {
        const all = [];
        for (let i = 0; i < 100; i++) {
          const t = performance.now();
          catalog.query({ search: q, limit: 100 });
          all.push(performance.now() - t);
        }
        all.sort((a, b) => a - b);
        timings[q] = { p50: all[49], p95: all[94] };
      }
      const report = {
        date: new Date().toISOString(),
        platform: process.platform,
        cpu: os.cpus()[0].model,
        ramGB: os.totalmem() / 1024 ** 3,
        node: process.version,
        files: 100000,
        assets: 10000,
        generateSeconds: (start - generatedAt) / 1000,
        importSeconds: (performance.now() - start) / 1000,
        checkpoints,
        queryMilliseconds: timings,
        rssMB: process.memoryUsage().rss / 1024 ** 2,
      };
      await fs.mkdir("docs", { recursive: true });
      await fs.writeFile(
        "docs/performance.json",
        JSON.stringify(report, null, 2),
      );
      console.log(JSON.stringify(report, null, 2));
    } finally {
      catalog.close();
    }
  },
  1800000,
);
