import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
const results = [];
for (const version of ["4.7.2", "4.6.3"])
  for (const project of ["godot-2d", "godot-3d"]) {
    const executable = path.resolve(
        `.data/tools/${version}/Godot_v${version}-stable_win64_console.exe`,
      ),
      dir = path.resolve("examples", project);
    const run = (args) =>
      new Promise((resolve, reject) => {
        const child = spawn(executable, args, { windowsHide: true });
        let log = "";
        child.stdout.on("data", (d) => (log += d));
        child.stderr.on("data", (d) => (log += d));
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Godot timeout"));
        }, 180000);
        child.on("error", reject);
        child.on("exit", (code) => {
          clearTimeout(timer);
          resolve({ code, log });
        });
      });
    const imports = await run([
        "--headless",
        "--editor",
        "--path",
        dir,
        "--import",
      ]),
      verify = await run([
        "--headless",
        "--path",
        dir,
        "--script",
        "res://verify.gd",
      ]),
      scene = await run(["--headless", "--path", dir, "--quit-after", "30"]);
    const passed =
      imports.code === 0 &&
      verify.code === 0 &&
      scene.code === 0 &&
      verify.log.includes("WORKSHOP_VERIFIED") &&
      !/ERROR:|SCRIPT ERROR:/.test(imports.log + verify.log + scene.log);
    results.push({ version, project, passed, imports, verify, scene });
    console.log(version, project, passed ? "PASS" : "FAIL");
    if (!passed) console.log(imports.log, verify.log, scene.log);
  }
await fs.writeFile(
  "docs/godot-validation.json",
  JSON.stringify({ date: new Date().toISOString(), results }, null, 2),
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
