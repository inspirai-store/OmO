import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5175 },
  build: {
    outDir: resolve("out/ui-kit"),
    emptyOutDir: true,
    rollupOptions: { input: resolve("src/renderer/ui-kit.html") },
  },
});
