import { spawn } from "node:child_process";
const child = spawn(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);
child.on("exit", (code) => (process.exitCode = code ?? 1));
