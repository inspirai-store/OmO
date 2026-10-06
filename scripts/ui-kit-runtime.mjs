import { preview } from "vite";
import { chromium } from "@playwright/test";
import path from "node:path";
import { workspace } from "./ui-art.mjs";

export async function openKit({
  viewport = { width: 1510, height: 950 },
  deviceScaleFactor = 1,
} = {}) {
  const server = await preview({
    configFile: false,
    root: path.join(workspace, "src/renderer"),
    build: { outDir: path.join(workspace, "out/renderer") },
    preview: { host: "127.0.0.1", port: 0, open: false },
  });
  const port = server.httpServer.address().port;
  let browser;
  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      browser = await chromium.launch({ headless: true, channel: "msedge" });
    }
    const page = await browser.newPage({ viewport, deviceScaleFactor });
    return {
      browser,
      page,
      server,
      url: `http://127.0.0.1:${port}/ui-kit.html`,
      close: async () => {
        await browser.close();
        await new Promise((resolve, reject) =>
          server.httpServer.close((e) => (e ? reject(e) : resolve())),
        );
      },
    };
  } catch (error) {
    await browser?.close();
    await new Promise((resolve) => server.httpServer.close(resolve));
    throw error;
  }
}
