import { spawn } from "node:child_process";
const child = spawn(
  process.execPath,
  ["scripts/test.mjs", "benchmark.test.ts"],
  { stdio: "inherit", env: { ...process.env, WORKSHOP_BENCHMARK: "1" } },
);
child.on("exit", (code) => (process.exitCode = code ?? 1));
