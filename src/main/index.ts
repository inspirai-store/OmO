import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  utilityProcess,
  clipboard,
  Menu,
  safeStorage,
} from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { atomicJSON, inside, readJSON, safeRelative, uid } from "../core/files";
import type { Asset } from "../shared/types";
import { GenerationProviderStore } from "../core/generation-provider-store";
import { generationId, assertNoSecrets } from "../core/generation-schemas";
import { SkinStore } from "../core/skins";
import { skinSlotRegistry, validateSkin } from "../shared/skins";
import { exportSkin } from "./skin-export";
import { z } from "zod";
import { skinManifestSchema, resolvedSkinTokens } from "../shared/skins";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "workshop",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
let window: BrowserWindow,
  service: Electron.UtilityProcess,
  root: string,
  quitting = false,
  thumbWindow: BrowserWindow | undefined;
const pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: any) => void }
  >(),
  thumbnailQueue: Asset[] = [];
let thumbnailBusy = false;
let thumbnailTimer: ReturnType<typeof setTimeout> | undefined,
  serviceReady = false,
  restarts = 0;
const grants = new Set<string>();
let generationProviders: GenerationProviderStore;
let skins: SkinStore;
const skinBuilds=new Map<string,string>();
const configFile = () =>
  path.join(app.getPath("userData"), "workshop-settings.json");
function rpc(method: string, input: any = {}) {
  return new Promise<any>((resolve, reject) => {
    if (!serviceReady) {
      reject(new Error("后台服务正在恢复，请稍后重试"));
      return;
    }
    const id = uid();
    pending.set(id, { resolve, reject });
    service.postMessage({ type: "request", id, method, input });
  });
}
async function startService() {
  serviceReady = false;
  return new Promise<void>((resolve, reject) => {
    service = utilityProcess.fork(path.join(__dirname, "service.cjs"), [], {
      stdio: "pipe",
      serviceName: "素材工坊目录服务",
    });
    service.stdout?.on("data", (d) => process.stdout.write(d));
    service.stderr?.on("data", (d) => process.stderr.write(d));
    service.on("message", async (message: any) => {
      if (message.type === "ready") {
        serviceReady = true;
        resolve();
      } else if (message.type === "init-error")
        reject(new Error(message.error.message));
      else if (message.type === "response") {
        const p = pending.get(message.id);
        pending.delete(message.id);
        if (message.error)
          p?.reject(
            Object.assign(new Error(message.error.message), message.error),
          );
        else p?.resolve(message.result);
      } else if (message.type === "event") {
        window?.webContents.send("workshop:event", message.event);
        if(message.event.type === "job.updated" && ["completed","cancelled"].includes(message.event.data.status)) {
          const build=skinBuilds.get(message.event.data.id);
          if(build && skins && build.startsWith(path.join(skins.directory,"builds")+path.sep)) {skinBuilds.delete(message.event.data.id);void fs.rm(build,{recursive:true,force:true}).catch(console.error);}
        }
        if (message.event.type === "thumbnail.request") {
          thumbnailQueue.push(message.event.data);
          void nextThumbnail();
        }
      }
    });
    service.on("exit", (code) => {
      serviceReady = false;
      reject(new Error(`后台服务退出 (${code})`));
      for (const p of pending.values())
        p.reject(new Error("后台服务已退出，请重新打开工坊"));
      pending.clear();
      if (!quitting) {
        window?.webContents.send("workshop:event", {
          type: "service.error",
          data: { message: `后台服务退出 (${code})` },
        });
        if (restarts++ < 3)
          setTimeout(
            () =>
              void startService()
                .then(() =>
                  window?.webContents.send("workshop:event", {
                    type: "catalog.changed",
                    data: {},
                  }),
                )
                .catch(console.error),
            500,
          );
      }
    });
    service.postMessage({
      type: "init",
      root,
      generationAccess: generationProviders.access(),
    });
  });
}
const rendererPath = path.join(__dirname, "../renderer/index.html");
async function loadRenderer(w: BrowserWindow, fragment = "") {
  if (process.env.ELECTRON_RENDERER_URL)
    await w.loadURL(`${process.env.ELECTRON_RENDERER_URL}${fragment}`);
  else
    await w.loadFile(
      rendererPath,
      fragment ? { hash: fragment.slice(1) } : undefined,
    );
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1510,
    height: 950,
    minWidth: 1050,
    minHeight: 700,
    title: "素材工坊",
    icon: app.isPackaged
      ? path.join(process.resourcesPath, "resources", "icon.png")
      : path.resolve(__dirname, "../../resources/icon.png"),
    backgroundColor: resolvedSkinTokens((await skins.appearance()).skin.manifest).canvas,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e, url) => {
    if (!isUIURL(url)) e.preventDefault();
  });
  window.webContents.on("context-menu", (_event, params) => {
    if (!params.isEditable) return;
    Menu.buildFromTemplate([
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { type: "separator" },
      { role: "selectAll" },
    ]).popup({ window });
  });
  window.on("closed", () => {
    thumbWindow?.destroy();
    thumbWindow = undefined;
    if (!quitting && process.platform !== "darwin") app.quit();
  });
  await loadRenderer(window);
  window.show();
}
async function nextThumbnail() {
  if (thumbnailBusy || !thumbnailQueue.length || quitting) return;
  thumbnailBusy = true;
  const asset = thumbnailQueue.shift()!;
  try {
    if (!thumbWindow || thumbWindow.isDestroyed()) {
      thumbWindow = new BrowserWindow({
        show: false,
        width: 512,
        height: 512,
        webPreferences: {
          preload: path.join(__dirname, "../preload/index.cjs"),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      });
      await loadRenderer(thumbWindow, "#thumbnail");
      await thumbWindow.webContents.executeJavaScript(
        "new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{if(window.thumbnailReady){clearInterval(timer);resolve(true)}else if(++tries>100){clearInterval(timer);reject(new Error('缩略图窗口启动超时'))}},20)})",
      );
    }
    clearTimeout(thumbnailTimer);
    thumbnailTimer = setTimeout(() => {
      void rpc("previews.thumbnailFailed", {
        assetId: asset.id,
        token: asset.metadata.thumbnailToken,
      }).catch(console.error);
      thumbWindow?.destroy();
      thumbWindow = undefined;
      thumbnailBusy = false;
      void nextThumbnail();
    }, 45000);
    await thumbWindow.webContents.executeJavaScript(
      `window.dispatchEvent(new CustomEvent('thumbnail-asset',{detail:${JSON.stringify(asset)}}))`,
    );
    await new Promise((r) => setTimeout(r, 50));
  } catch (e) {
    console.error("缩略图", e);
    thumbnailBusy = false;
    clearTimeout(thumbnailTimer);
    void rpc("previews.thumbnailFailed", {
      assetId: asset.id,
      token: asset.metadata.thumbnailToken,
    }).catch(console.error);
    void nextThumbnail();
  }
}
function isUIURL(value: string) {
  const expected = process.env.ELECTRON_RENDERER_URL
    ? new URL(process.env.ELECTRON_RENDERER_URL).href
    : pathToFileURL(rendererPath).href;
  return value.split("#")[0] === expected.split("#")[0];
}
function trusted(event: Electron.IpcMainInvokeEvent) {
  return (
    (event.sender === window?.webContents ||
      event.sender === thumbWindow?.webContents) &&
    event.senderFrame === event.sender.mainFrame &&
    isUIURL(event.senderFrame.url)
  );
}
app.on("second-instance", () => {
  window?.restore();
  window?.focus();
});
app
  .whenReady()
  .then(async () => {
    generationProviders = await new GenerationProviderStore(
      app.getPath("userData"),
      (value) => {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error("系统密钥加密不可用，未保存密钥");
        return safeStorage.encryptString(value).toString("base64");
      },
      (value) => safeStorage.decryptString(Buffer.from(value, "base64")),
    ).init();
    skins = await new SkinStore(app.getPath("userData")).init();
    const config = await readJSON<any>(configFile(), {});
    root = path.resolve(
      process.env.WORKSHOP_LIBRARY ??
        config.root ??
        path.join(app.getPath("userData"), "Library"),
    );
    grants.add(root);
    await startService();
    protocol.handle("workshop", async (request) => {
      try {
        const url = new URL(request.url);
        let filename: string;
        if (url.hostname === "skins") {
          const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
          filename = await skins.resolve(parts[0], parts.slice(1).join("/"));
        } else if (url.hostname === "assets") {
          const parts = url.pathname
            .split("/")
            .filter(Boolean)
            .map(decodeURIComponent);
          if (parts.length < 4 || parts[2] !== "source")
            return new Response("Invalid resource", { status: 400 });
          const [packageId, revisionId] = parts;
          const manifest = await readJSON<any>(
            inside(
              root,
              `packages/${safeRelative(packageId)}/${safeRelative(revisionId)}/manifest.json`,
            ),
          );
          const rel = safeRelative(parts.slice(3).join("/"));
          if (!manifest.files.some((f: any) => f.path === rel))
            return new Response("Resource not listed", { status: 403 });
          filename = inside(
            root,
            `packages/${packageId}/${revisionId}/source/${rel}`,
          );
          if (path.extname(filename).toLowerCase() === ".svg")
            return new Response("SVG must be rasterized", { status: 403 });
        } else if (url.hostname === "generations") {
          const parts = url.pathname
            .split("/")
            .filter(Boolean)
            .map(decodeURIComponent);
          if (parts.length !== 2 || !["input", "candidate"].includes(parts[0]))
            return new Response("Invalid generation resource", { status: 400 });
          filename = await rpc("generation.files.resolve", {
            kind: parts[0],
            id: generationId.parse(parts[1]),
          });
        } else if (url.hostname === "processing") {
          const parts = url.pathname
            .split("/")
            .filter(Boolean)
            .map(decodeURIComponent);
          if (parts.length !== 2 || !["input", "artifact"].includes(parts[0]))
            return new Response("Invalid processing resource", { status: 400 });
          filename = await rpc("processing.files.resolve", {
            kind: parts[0],
            id: generationId.parse(parts[1]),
          });
        } else if (url.hostname === "cache") {
          const rel = safeRelative(decodeURIComponent(url.pathname.slice(1)));
          if (
            !/^[a-f0-9-]+(?:image|model|preview)-v\d+\.(?:png|webp)$/.test(rel)
          )
            return new Response("Invalid cache key", { status: 403 });
          filename = inside(path.join(root, "cache"), rel);
        } else return new Response("Not found", { status: 404 });
        if (url.hostname === "cache")
          void fs.utimes(filename, new Date(), new Date()).catch(() => {});
        const response = await net.fetch(pathToFileURL(filename).href);
        return response;
      } catch {
        return new Response("Resource unavailable", { status: 404 });
      }
    });
    ipcMain.on("workshop:drop", (event, paths) => {
      if (event.sender !== window?.webContents || !Array.isArray(paths)) return;
      paths
        .filter((p) => typeof p === "string")
        .forEach((p) => grants.add(path.resolve(p)));
    });
    ipcMain.handle("workshop:choose", async (event, options) => {
      if (!trusted(event)) throw new Error("非法窗口");
      if (options.kind === "save") {
        const result = await dialog.showSaveDialog(window, {
          title: options.title,
          defaultPath: options.defaultPath,
          filters: options.filters,
        });
        if (result.filePath) {
          grants.add(path.resolve(result.filePath));
          return [result.filePath];
        }
        return [];
      }
      const result = await dialog.showOpenDialog(window, {
        title: options.title ?? "选择文件",
        properties:
          options.kind === "folder"
            ? ["openDirectory", "createDirectory"]
            : options.kind === "executable"
              ? ["openFile"]
              : ["openFile", "openDirectory", "multiSelections"],
      });
      result.filePaths.forEach((p) => grants.add(path.resolve(p)));
      return result.filePaths;
    });
    ipcMain.handle("workshop:call", async (event, method, input = {}) => {
      if (!trusted(event)) throw new Error("非法窗口");
      if (typeof method !== "string" || method.length > 100)
        throw new Error("非法操作");
      if (method === "appearance.get") return skins.appearance();
      if (method === "appearance.update") {
        const result = await skins.update(input);
        window.setBackgroundColor(resolvedSkinTokens(result.skin.manifest).canvas);
        window.webContents.send("workshop:event", { type: "appearance.changed", data: result });
        return result;
      }
      if (method === "skins.protocol") return { version: 1, slots: skinSlotRegistry, manifestSchema:z.toJSONSchema(skinManifestSchema) };
      if (method === "skins.list") return skins.list();
      if (method === "skins.get") return skins.get(input.key);
      if (method === "skins.remove") {
        const result = await skins.remove(input.key);
        window.webContents.send("workshop:event", { type: "appearance.changed", data: result });
        return result;
      }
      if (["skins.inspect", "skins.preview", "skins.install"].includes(method)) {
        if (method === "skins.install" && input.key) return skins.install(await skins.get(input.key));
        let filename: string;
        if (input.assetId) {
          const detail = await rpc("assets.detail", { id: input.assetId });
          if (!detail.asset.metadata.skin) throw new Error("素材不是皮肤包");
          filename = await rpc("files.resolve", { assetId: input.assetId });
        } else {
          filename = path.resolve(input.path);
          if (!grants.has(filename)) throw new Error("请通过选择器指定皮肤包");
        }
        const skin = await skins.prepare(filename);
        return method === "skins.install" ? skins.install(skin) : skin;
      }
      if (method === "skins.create") {
        const manifest = validateSkin(input.manifest);
        const selections = [];
        for (const selected of input.selections ?? []) {
          const detail = await rpc("assets.detail", { id: selected.assetId });
          if (detail.asset.capabilities.preview !== "image") throw new Error("槽位只能绑定图片素材");
          const filename = await rpc("files.resolve", { assetId: selected.assetId });
          selections.push({ resourceId: selected.resourceId, filename, crop: selected.crop });
          const r = manifest.resources.find(r => r.id === selected.resourceId);
          if (r) {
            r.source = { assetId: detail.asset.id, author: detail.asset.source?.author ?? "未知", license: detail.asset.source?.license ?? "未知", pageUrl: detail.asset.source?.pageUrl ?? "" };
            r.atlasRegion = selected.crop ? { ...selected.crop, sourceWidth: detail.asset.metadata.width, sourceHeight: detail.asset.metadata.height, name: r.atlasRegion?.name } : undefined;
          }
        }
        const result = await skins.create(manifest, selections);
        const packageFile=path.join(result.directory,"skin.awskin");
        try {
          await exportSkin(skins,result.skin.key,packageFile,"package",loadRenderer);
          const plan = await rpc("imports.inspect", { paths: [packageFile] });
          const jobId = await rpc("imports.start", { planId: plan.id });
          skinBuilds.set(jobId,result.directory);
          return { skin: result.skin, jobId };
        } catch (error) {
          await fs.rm(result.directory, { recursive:true, force:true });
          throw error;
        }
      }
      if (method === "skins.saveAsset") {
        const folder = inside(skins.directory, `builds/${uid()}`);
        await fs.mkdir(folder, { recursive:true });
        const filename = path.join(folder, "skin.awskin");
        await exportSkin(skins,input.key,filename,"package",loadRenderer);
        const plan = await rpc("imports.inspect", { paths:[filename] });
        const jobId = await rpc("imports.start", { planId:plan.id });
        skinBuilds.set(jobId,folder);
        return { jobId };
      }
      if (method === "skins.export") {
        const target = path.resolve(input.target);
        if (!grants.has(target)) throw new Error("请通过选择器指定导出位置");
        const mode = input.mode === "resources" ? "resources" : "package";
        const output = /\.(awskin|zip)$/i.test(target) ? target : target + (mode === "resources" ? ".zip" : ".awskin");
        return exportSkin(skins, input.key, output, mode, loadRenderer);
      }
      if (
        method === "processing.files.resolve" ||
        method === "generation.files.resolve"
      )
        throw new Error("文件路径只允许受控资源协议访问");
      if (method === "generation.providers.list")
        return generationProviders.list();
      if (
        method === "generation.providers.save" ||
        method === "generation.providers.delete"
      ) {
        const providerId = generationId.parse(input.config?.id ?? input.id);
        const busy = await rpc("generation.providers.busy", { id: providerId });
        if (busy) throw new Error("连接正在生成，请等待任务完成后修改");
        if (method.endsWith("save")) {
          const existing = generationProviders
            .list()
            .find((p) => p.id === providerId);
          if (
            input.config.executable &&
            existing?.executable !== input.config.executable &&
            !grants.has(path.resolve(input.config.executable))
          )
            throw new Error("请通过选择器指定 Codex 程序");
          if (
            input.key !== undefined &&
            (typeof input.key !== "string" || input.key.length > 4000)
          )
            throw new Error("密钥格式无效");
          await generationProviders.save(input.config, input.key);
        } else await generationProviders.remove(providerId);
        service.postMessage({
          type: "generation.config",
          access: generationProviders.access(),
        });
        return generationProviders.list();
      }
      if (method === "generation.workflow.read") {
        const filename = path.resolve(input.filePath);
        if (!grants.has(filename))
          throw new Error("请通过选择器导入工作流 JSON");
        const stat = await fs.lstat(filename);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.size > 2 * 1024 * 1024
        )
          throw new Error("工作流 JSON 须小于 2 MiB");
        const graph = await readJSON<any>(filename);
        assertNoSecrets(graph);
        return graph;
      }
      if (
        [
          "generation.inputs.add",
          "processing.inputs",
          "processing.inputs.add",
        ].includes(method) &&
        (input.filePath || input.path) &&
        !grants.has(path.resolve(input.filePath || input.path))
      )
        throw new Error("请通过选择器添加参考图");
      if (method === "system.copy") {
        let text: string;
        if (input.assetIds) {
          text = await rpc("assets.copyValues", input);
        } else if (input.jobId) {
          const job = (await rpc("jobs.list")).find(
            (j: any) => j.id === input.jobId,
          );
          if (!job) throw new Error("任务不存在");
          text = job.error ?? job.stage;
        } else if (
          input.sourceUrl &&
          new URL(input.sourceUrl).protocol === "https:"
        )
          text = input.sourceUrl;
        else throw new Error("缺少复制对象");
        clipboard.writeText(text);
        return true;
      }
      if (method === "system.jobOutput") {
        const job = (await rpc("jobs.list")).find(
          (j: any) => j.id === input.jobId,
        );
        if (!job?.result?.target) throw new Error("该任务没有输出目录");
        await shell.openPath(job.result.target);
        return true;
      }
      if (method === "exports.quick") return rpc(method, input);
      if (method === "projects.save" && input.godotPath) {
        const existing = (await rpc("projects.list")).find(
          (p: any) => p.id === input.id,
        );
        if (
          existing?.godotPath !== input.godotPath &&
          !grants.has(path.resolve(input.godotPath))
        )
          throw new Error("请通过选择器绑定工程");
      }
      if (method === "system.reveal") {
        const filename = await rpc("files.resolve", input);
        shell.showItemInFolder(filename);
        return true;
      }
      if (method === "system.openSource") {
        const url = input.assetId
          ? (await rpc("assets.detail", { id: input.assetId })).asset.source
              ?.pageUrl
          : input.url;
        if (url && new URL(url).protocol === "https:")
          await shell.openExternal(url);
        return true;
      }
      if (method === "system.openFolder") {
        const target = path.resolve(input.path);
        if (
          ![...grants].some(
            (g) => target === g || target.startsWith(g + path.sep),
          ) &&
          !target.startsWith(root + path.sep)
        )
          throw new Error("目录未授权");
        await shell.openPath(target);
        return true;
      }
      if (method === "system.screenshot") {
        const target = (
          await dialog.showSaveDialog(window, {
            title: "保存预览截图",
            defaultPath: "素材预览.png",
            filters: [{ name: "PNG", extensions: ["png"] }],
          })
        ).filePath;
        if (target)
          await fs.writeFile(target, Buffer.from(input.base64, "base64"));
        return target;
      }
      if (method === "library.open") {
        if (
          (await rpc("jobs.list")).some((j: any) =>
            ["running", "queued", "paused"].includes(j.status),
          )
        )
          throw new Error("请完成或取消当前任务再切换素材库");
        const target = path.resolve(input.root);
        if (!grants.has(target)) throw new Error("请通过文件选择器选择目录");
        quitting = true;
        clearTimeout(thumbnailTimer);
        thumbnailQueue.length = 0;
        thumbnailBusy = false;
        thumbWindow?.destroy();
        thumbWindow = undefined;
        service.postMessage({ type: "shutdown" });
        await new Promise<void>((resolve) =>
          service.once("exit", () => resolve()),
        );
        root = target;
        quitting = false;
        await atomicJSON(configFile(), { root });
        await startService();
        window.webContents.reload();
        return true;
      }
      if (method === "previews.thumbnail") {
        clearTimeout(thumbnailTimer);
        const result = await rpc(method, input);
        thumbnailBusy = false;
        void nextThumbnail();
        return result;
      }
      if (method === "previews.thumbnailFailed") {
        clearTimeout(thumbnailTimer);
        await rpc(method, input);
        thumbnailBusy = false;
        void nextThumbnail();
        return true;
      }
      if (method === "generation.start" && input.processingLink)
        throw new Error("内部加工关联不能从窗口设置");
      if (
        ["generation.start", "processing.start"].includes(method) &&
        input.familyLink
      )
        throw new Error("内部同类关联不能从窗口设置");
      // Only native selections and verified drops can authorize arbitrary import/export roots.
      if (method === "imports.inspect") {
        for (const p of input.paths ?? [])
          if (!grants.has(path.resolve(p)))
            throw new Error("请通过选择器导入文件");
      }
      if (
        [
          "exports.inspect",
          "families.export.inspect",
          "backups.create",
          "backups.restore",
          "backups.rebuild",
        ].includes(method)
      ) {
        for (const p of [input.target, input.backup].filter(Boolean)) {
          const resolved = path.resolve(p);
          if (
            !grants.has(resolved) &&
            !resolved.startsWith(path.join(root, "exports") + path.sep) &&
            resolved !== path.join(root, "exports") &&
            !(
              ["exports.inspect", "families.export.inspect"].includes(method) &&
              (await rpc("projects.list")).some(
                (project: any) =>
                  project.godotPath &&
                  path.resolve(project.godotPath) === resolved,
              )
            )
          )
            throw new Error("请通过选择器指定操作目录");
        }
      }
      return rpc(method, input);
    });
    await createWindow();
  })
  .catch((error) => {
    console.error("素材工坊启动失败：", error.message);
    dialog.showErrorBox("素材工坊启动失败", error.message);
    quitting = true;
    app.quit();
  });
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (
    BrowserWindow.getAllWindows().filter((w) => w !== thumbWindow).length === 0
  )
    void createWindow();
});
app.on("before-quit", (event) => {
  if (!quitting && service) {
    event.preventDefault();
    quitting = true;
    BrowserWindow.getAllWindows().forEach((w) =>
      w.webContents.send("workshop:event", { type: "app.shutdown", data: {} }),
    );
    service.once("exit", () => {
      BrowserWindow.getAllWindows().forEach((w) => w.destroy());
      app.exit(0);
    });
    setTimeout(() => service.postMessage({ type: "shutdown" }), 200);
    setTimeout(() => {
      service.kill();
      app.exit(0);
    }, 10000).unref();
  }
});
