import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export async function verifyAggregation(call, waitJob) {
  const entityCounts = {};
  for (const category of [
    "character",
    "enemy",
    "animal",
    "equipment",
    "pickup",
    "interactive",
    "architecture",
    "furniture",
    "production",
    "vehicle",
    "nature",
  ])
    entityCounts[category] = (
      await call("assets.query", {
        entityCategory: category,
        showRelated: true,
        limit: 1,
      })
    ).total;
  const start = performance.now();
  const entities = await call("assets.groups", {
    mode: "entity",
    query: { limit: 1 },
  });
  const entityMs = performance.now() - start;
  const cachedStart = performance.now();
  await call("assets.groups", { mode: "entity", query: { limit: 1 } });
  const cachedMs = performance.now() - cachedStart;
  const packages = await call("assets.groups", {
    mode: "package",
    query: { limit: 100 },
  });
  const equipment = await call("assets.groups", {
    mode: "entity",
    query: { search: "blaster-kit", category: "model", limit: 100 },
  });
  const group = equipment.items.find(
    (g) =>
      [".glb", ".gltf"].includes(g.primary.extension) &&
      !g.missing &&
      g.assetIds.length <= 15,
  );
  if (!group) throw new Error("No complete game-ready equipment group found");
  const runRoot = path.resolve(
    `.data/aggregation-validation/run-${Date.now()}`,
  );
  const target = path.join(runRoot, "source-project");
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(
    path.join(target, "project.godot"),
    'config_version=5\n[application]\nconfig/name="素材工坊聚合交付验收"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n',
  );
  const plan = await call("exports.inspect", {
    assetIds: group.assetIds,
    target,
    mode: "godot",
    aggregate: true,
  });
  if (plan.issues.length) throw new Error(plan.issues.join("\n"));
  const exported = await waitJob(
    await call("exports.start", { planId: plan.id }),
  );
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(exported.target, "workshop-manifest.json"),
      "utf8",
    ),
  );
  const uniqueFiles =
    new Set(manifest.files.map((f) => f.path)).size === manifest.files.length;
  const oneDirectory =
    new Set(manifest.entries.map((e) => e.entry.split("/")[0])).size === 1;
  const modelEntry = manifest.entries.find((e) =>
    /\.(glb|gltf)$/.test(e.entry),
  );
  if (!modelEntry) throw new Error("No glTF entry exported");
  const resource = `res://assets/workshop/${modelEntry.entry}`;
  await fs.writeFile(
    path.join(target, "verify.gd"),
    `extends SceneTree\nfunc _initialize():\n var scene = load(${JSON.stringify(resource)})\n if not (scene is PackedScene):\n  push_error("Expected glTF PackedScene")\n  quit(1)\n  return\n var instance = scene.instantiate()\n if instance == null:\n  quit(1)\n  return\n instance.free()\n print("AGGREGATION_VERIFIED")\n quit(0)\n`,
  );
  const engines = [];
  for (const version of ["4.7.2", "4.6.3"]) {
    const engineProject = path.join(runRoot, version);
    await fs.cp(target, engineProject, { recursive: true });
    const executable = path.resolve(
      `.data/tools/${version}/Godot_v${version}-stable_win64_console.exe`,
    );
    const run = (args) =>
      new Promise((resolve, reject) => {
        const child = spawn(executable, args, { windowsHide: true });
        let log = "";
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Godot validation timeout"));
        }, 60000);
        child.stdout.on("data", (d) => (log += d));
        child.stderr.on("data", (d) => (log += d));
        child.on("error", (e) => {
          clearTimeout(timer);
          reject(e);
        });
        child.on("exit", (code) => {
          clearTimeout(timer);
          resolve({ code, log });
        });
      });
    const imports = await run([
      "--headless",
      "--editor",
      "--path",
      engineProject,
      "--import",
    ]);
    const verify = await run([
      "--headless",
      "--path",
      engineProject,
      "--script",
      "res://verify.gd",
    ]);
    const passed =
      imports.code === 0 &&
      verify.code === 0 &&
      verify.log.includes("AGGREGATION_VERIFIED") &&
      !/ERROR:|SCRIPT ERROR:/.test(imports.log + verify.log);
    engines.push({ version, passed, imports, verify });
    console.log(`Godot ${version}: ${passed ? "PASS" : "FAIL"}`);
  }
  const report = {
    date: new Date().toISOString(),
    passed:
      Object.values(entityCounts).every((n) => n > 0) &&
      uniqueFiles &&
      oneDirectory &&
      engines.every((e) => e.passed),
    entityCounts,
    groups: {
      entity: entities.total,
      package: packages.total,
      assets: entities.assetTotal,
      firstMs: Math.round(entityMs),
      cachedMs: Math.round(cachedMs),
    },
    samples: (await call("sources.samples")).filter((s) => s.installed).length,
    delivery: {
      title: group.title,
      assets: plan.assets.length,
      files: manifest.files.length,
      uniqueFiles,
      oneDirectory,
      target: exported.target,
    },
    engines,
  };
  await fs.writeFile(
    "docs/aggregation-validation.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        ...report,
        engines: engines.map(({ version, passed }) => ({ version, passed })),
      },
      null,
      2,
    ),
  );
  if (!report.passed)
    throw new Error(
      "Aggregation validation failed; see docs/aggregation-validation.json",
    );
}
