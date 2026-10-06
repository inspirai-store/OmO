import { BrowserWindow } from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import sharp from "sharp";
import { atomicJSON, inside, uid } from "../core/files";
import { zipSkin, type SkinStore } from "../core/skins";
import {
  skinSlotRegistry,
  resolvedSkinTokens,
  SKIN_EXPORT_PADDING,
  type SkinBinding,
} from "../shared/skins";
let queue: Promise<unknown> = Promise.resolve();
export function exportSkin(
  skins: SkinStore,
  key: string,
  target: string,
  mode: "resources" | "package",
  load: (window: BrowserWindow, fragment: string) => Promise<void>,
) {
  const work = queue.then(() => renderExport(skins, key, target, mode, load));
  queue = work.catch(() => {});
  return work;
}
async function renderExport(
  skins: SkinStore,
  key: string,
  target: string,
  mode: "resources" | "package",
  load: (window: BrowserWindow, fragment: string) => Promise<void>,
) {
  const skin = await skins.get(key),
    output = inside(skins.directory, `staging/render-${uid()}`);
  const renderer = new BrowserWindow({
    show: false,
    frame: false,
    autoHideMenuBar: true,
    width: 800,
    height: 600,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  renderer.removeMenu();
  await fs.mkdir(output, { recursive: true });
  try {
    await load(renderer, "#skin-render");
    await renderer.webContents.executeJavaScript(
      "new Promise((resolve,reject)=>{let tries=0;const t=setInterval(()=>{if(window.skinRenderReady){clearInterval(t);resolve(true)}else if(++tries>200){clearInterval(t);reject(new Error('皮肤渲染器启动超时'))}},20)})",
    );
    const capture = async (
      filename: string,
      width: number,
      height: number,
      binding?: SkinBinding,
      preview = false,
      density = "regular",
    ) => {
      renderer.setContentSize(width * 2, height * 2);
      await renderer.webContents.executeJavaScript(
        `window.renderSkin(${JSON.stringify({ skin, binding, width, height, scale: 2, preview, density })})`,
      );
      let png: Buffer = Buffer.alloc(0);
      for (let attempt = 0; attempt < 3; attempt++) {
        await new Promise((r) => setTimeout(r, attempt ? 60 : 20));
        const bitmap = await renderer.webContents.capturePage(
          { x: 0, y: 0, width: width * 2, height: height * 2 },
          { stayHidden: true, stayAwake: true },
        );
        png = bitmap.toPNG();
        if (!preview || (await sharp(png).stats()).channels.at(-1)!.max > 0)
          break;
        if (attempt === 2) throw new Error("皮肤预览尚未绘制完成，请重试导出");
      }
      await fs.mkdir(path.dirname(filename), { recursive: true });
      await sharp(png)
        .resize(width, height)
        .png()
        .toFile(filename + "@1x.png");
      await sharp(png)
        .resize(width * 2, height * 2)
        .png()
        .toFile(filename + "@2x.png");
    };
    const index: any[] = [];
    const entries: SkinBinding[] = skinSlotRegistry.flatMap((d) =>
      d.states.map((state) => ({
        component: d.id,
        slot: "background",
        state,
        resource: "",
        fit: "stretch",
        bleed: 0,
      })),
    );
    for (const custom of skin.manifest.bindings) {
      const at = entries.findIndex(
        (b) =>
          b.component === custom.component &&
          b.state === custom.state &&
          b.slot === custom.slot,
      );
      if (at >= 0) entries[at] = custom;
      else entries.push(custom);
    }
    for (const binding of entries) {
      const d = skinSlotRegistry.find((d) => d.id === binding.component)!;
      const source = skin.manifest.resources.find(
        (r) => r.id === binding.resource,
      )?.source ?? {
        author: skin.manifest.author,
        license: skin.manifest.license,
      };
      for (const density of d.height === 36
        ? ["regular", "compact"]
        : ["regular"]) {
        const height = density === "compact" ? 28 : d.height,
          width =
            density === "compact" && binding.component === "icon-button"
              ? 28
              : d.width,
          name = `${binding.component}--${binding.slot}--${binding.state}--${density}`;
        await capture(
          path.join(output, "exports", name),
          width + SKIN_EXPORT_PADDING * 2,
          height + SKIN_EXPORT_PADDING * 2,
          binding,
          false,
          density,
        );
        index.push({
          name,
          component: binding.component,
          slot: binding.slot,
          state: binding.state,
          density,
          width,
          height,
          fileWidth: width + SKIN_EXPORT_PADDING * 2,
          fileHeight: height + SKIN_EXPORT_PADDING * 2,
          padding: SKIN_EXPORT_PADDING,
          slices: binding.slices
            ? Object.fromEntries(
                Object.entries(binding.slices).map(([side, value]) => [
                  side,
                  value + SKIN_EXPORT_PADDING,
                ]),
              )
            : undefined,
          sourceSlices: binding.slices,
          contentInsets: Object.fromEntries(
            Object.entries(binding.contentInsets ?? d.contentInsets).map(
              ([side, value]) => [side, value + SKIN_EXPORT_PADDING],
            ),
          ),
          controlContentInsets: binding.contentInsets ?? d.contentInsets,
          atlasRegion: skin.manifest.resources.find(
            (r) => r.id === binding.resource,
          )?.atlasRegion,
          source,
          png1x: `${name}@1x.png`,
          png2x: `${name}@2x.png`,
        });
      }
    }
    for (const r of skin.manifest.resources) {
      const filename = inside(skins.directory, `skins/${key}/${r.path}`),
        dest = inside(output, r.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(filename, dest);
      const base = path.join(output, "exports", "resources", r.id);
      await fs.mkdir(path.dirname(base), { recursive: true });
      await sharp(filename)
        .resize(r.width, r.height)
        .ensureAlpha()
        .png()
        .toFile(base + "@1x.png");
      await sharp(filename)
        .resize(r.width * 2, r.height * 2)
        .ensureAlpha()
        .png()
        .toFile(base + "@2x.png");
    }
    const palette = resolvedSkinTokens(skin.manifest),
      svgDirectory = path.join(output, "exports", "svg");
    await fs.mkdir(svgDirectory, { recursive: true });
    const artwork = {
      "selection-arrow": `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="${palette.accent}" d="M4 7h13V2l13 14-13 14v-6H4l4-8z"/></svg>`,
      "selected-mark": `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><path fill="none" stroke="${palette.accent}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" d="m6 16 7 7L27 8"/></svg>`,
      "paper-grain": `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g stroke="${palette.muted}" opacity=".12" stroke-width=".5"><path d="m3 5 2 1m12 3 1-2m19 15 2 1m16-16 1 3M8 31l2-1m9 17 1 2m26-8 2 1m8 16-1 2M3 57l1-2m28 3 2 1m-6-36 1 2"/></g></svg>`,
    };
    for (const [name, svg] of Object.entries(artwork)) {
      await fs.writeFile(path.join(svgDirectory, name + ".svg"), svg);
      await sharp(Buffer.from(svg))
        .png()
        .toFile(path.join(svgDirectory, name + "@1x.png"));
      await sharp(Buffer.from(svg))
        .resize(name === "paper-grain" ? 128 : 64)
        .png()
        .toFile(path.join(svgDirectory, name + "@2x.png"));
    }
    await atomicJSON(path.join(output, "skin.json"), skin.manifest);
    await atomicJSON(path.join(output, "exports", "index.json"), {
      schemaVersion: 1,
      skin: skin.manifest.id,
      visualOnly: true,
      items: index,
    });
    await capture(
      path.join(output, "preview", "cover"),
      520,
      520,
      undefined,
      true,
    );
    await zipSkin(output, target);
    return target;
  } finally {
    if (!renderer.isDestroyed()) renderer.destroy();
    await fs.rm(output, { recursive: true, force: true });
  }
}
