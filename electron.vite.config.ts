import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
const dependencies = Object.keys(
  JSON.parse(readFileSync("package.json", "utf8")).dependencies,
);
const external = (id: string) =>
  id === "electron" ||
  id.startsWith("node:") ||
  dependencies.some((d) => id === d || id.startsWith(d + "/"));

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external,
        input: {
          index: resolve("src/main/index.ts"),
          service: resolve("src/main/service.ts"),
          "media-worker": resolve("src/main/media-worker.ts"),
          recover: resolve("src/main/recover.ts"),
        },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external,
        input: resolve("src/preload/index.ts"),
        output: { format: "cjs", entryFileNames: "index.cjs" },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    build: {
      rollupOptions: {
        input: {
          app: resolve("src/renderer/index.html"),
          uiKit: resolve("src/renderer/ui-kit.html"),
        },
      },
    },
  },
});
