import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const child = spawn(
  require("electron"),
  ["out/main/recover.cjs", ...process.argv.slice(2)],
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    stdio: "inherit",
    windowsHide: true,
  },
);
child.on("exit", (code) => (process.exitCode = code ?? 1));
