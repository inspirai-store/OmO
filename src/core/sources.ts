import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream, createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { pipeline } from "node:stream/promises";
import {
  atomicJSON,
  inside,
  now,
  readJSON,
  WorkshopError,
  safeRelative,
} from "./files";
import { inspectImport, runImport, type JobContext } from "./importer";
import type { Catalog } from "./catalog";
import type { DownloadFile, DownloadPlan, Sample } from "../shared/types";
import { defaultGameplayTags } from "../shared/entities";
const entitySamples: Sample[] = [
  {
    id: "roguelike-characters",
    title: "角色与 NPC · 像素人物",
    entityCategory: "character",
    category: "sprite",
    description: "像素人物素材，补充职业、NPC 与角色外观。",
    tags: ["角色", "NPC", "像素", "character"],
    project: "2d",
  },
  {
    id: "monster-builder-pack",
    title: "敌人与怪物 · 组合部件",
    entityCategory: "enemy",
    category: "sprite",
    description: "怪物形象与组合部件，建立敌人外观素材库。",
    tags: ["怪物", "敌人", "monster"],
    project: "2d",
  },
  {
    id: "cube-pets",
    title: "动物与伙伴 · 动画宠物",
    entityCategory: "animal",
    category: "model",
    description: "带动画的风格化动物模型，用于伙伴与宠物原型。",
    tags: ["动物", "宠物", "pet", "animal"],
    project: "3d",
  },
  {
    id: "blaster-kit",
    title: "武器与装备 · 射击套件",
    entityCategory: "equipment",
    category: "model",
    description: "射击武器、配件与投掷物，提供战斗实体素材。",
    tags: ["武器", "装备", "weapon"],
    project: "3d",
  },
  {
    id: "food-kit",
    title: "拾取物与消耗品 · 食物",
    entityCategory: "pickup",
    category: "model",
    description: "食物与厨房主题模型，可作为消耗品和场景道具。",
    tags: ["食物", "消耗品", "food"],
    project: "3d",
  },
  {
    id: "platformer-kit",
    title: "交互物与机关 · 平台关卡",
    entityCategory: "interactive",
    category: "model",
    description: "平台关卡实体与动画角色，筛选障碍和交互物。",
    tags: ["平台", "关卡", "platformer"],
    project: "3d",
  },
  {
    id: "modular-dungeon-kit",
    title: "建筑与关卡 · 模块化地牢",
    entityCategory: "architecture",
    category: "model",
    description: "模块化地牢构件，用于拼接墙体、地面与关卡空间。",
    tags: ["建筑", "地牢", "dungeon", "modular"],
    project: "3d",
  },
  {
    id: "tiny-town",
    title: "建筑与关卡 · 像素城镇",
    entityCategory: "architecture",
    category: "sprite",
    description: "16px 城镇瓦片，补充二维建筑与地图实体。",
    tags: ["建筑", "城镇", "像素", "town"],
    project: "2d",
  },
  {
    id: "furniture-kit",
    title: "家具与生活道具 · 室内套件",
    entityCategory: "furniture",
    category: "model",
    description: "桌椅、床等家具模型，用于室内布置与生活场景。",
    tags: ["家具", "室内", "furniture"],
    project: "3d",
  },
  {
    id: "tiny-farm",
    title: "农业与生产 · 像素农场",
    entityCategory: "production",
    category: "sprite",
    description: "16px 农场主题素材，用于种植与经营原型。",
    tags: ["农场", "农业", "像素", "farm"],
    project: "2d",
  },
  {
    id: "factory-kit",
    title: "农业与生产 · 工厂设备",
    entityCategory: "production",
    category: "model",
    description: "工业设备与传送带模型，补充生产和运输场景。",
    tags: ["生产", "工厂", "factory", "conveyor"],
    project: "3d",
  },
  {
    id: "car-kit",
    title: "载具与交通 · 汽车套件",
    entityCategory: "vehicle",
    category: "model",
    description: "汽车与交通主题模型，用于驾驶、竞速与城市原型。",
    tags: ["载具", "汽车", "car", "vehicle"],
    project: "3d",
  },
].map((s) => ({
  ...s,
  provider: "kenney",
  upstreamId: s.id,
  pageUrl: `https://kenney.nl/assets/${s.id}`,
  author: "Kenney",
})) as Sample[];

export const samples: Sample[] = [
  ...entitySamples,
  {
    id: "concepts",
    title: "幻想世界 · 原画设定",
    provider: "opengameart",
    upstreamId: "fantasy-concepts-2",
    pageUrl: "https://opengameart.org/content/fantasy-concepts-2",
    author: "Drummyfish",
    category: "concept",
    description: "角色与幻想生物的原画参考，查看原尺寸和细节。",
    tags: ["原画", "角色", "fantasy", "concept"],
    project: "concept",
  },
  {
    id: "ui-pack",
    title: "通用游戏 UI",
    provider: "kenney",
    upstreamId: "ui-pack",
    pageUrl: "https://kenney.nl/assets/ui-pack",
    author: "Kenney",
    category: "ui",
    description: "按钮、面板与界面元素，探索透明背景和九宫格。",
    tags: ["界面", "按钮", "ui", "button"],
    project: "2d",
  },
  {
    id: "input-prompts",
    title: "键鼠与手柄提示",
    provider: "kenney",
    upstreamId: "input-prompts",
    pageUrl: "https://kenney.nl/assets/input-prompts",
    author: "Kenney",
    category: "controls",
    description: "键盘、鼠标、手柄输入图标，统一操作提示。",
    tags: ["控件", "按键", "input", "keyboard"],
    project: "2d",
  },
  {
    id: "tiny-dungeon",
    title: "迷你地牢 · 16px",
    provider: "kenney",
    upstreamId: "tiny-dungeon",
    pageUrl: "https://kenney.nl/assets/tiny-dungeon",
    author: "Kenney",
    category: "sprite",
    description: "16×16 像素角色、道具与瓦片，适合 Godot 2D 原型。",
    tags: ["像素", "地牢", "pixel", "dungeon"],
    project: "2d",
  },
  {
    id: "nature-kit",
    title: "低多边形自然套件",
    provider: "kenney",
    upstreamId: "nature-kit",
    pageUrl: "https://kenney.nl/assets/nature-kit",
    author: "Kenney",
    category: "model",
    description: "树木、岩石与植被，用于搭建风格化自然场景。",
    tags: ["自然", "树木", "石头", "nature", "tree"],
    project: "3d",
  },
  {
    id: "animated-characters",
    title: "动画角色 · 主角",
    provider: "kenney",
    upstreamId: "animated-characters-protagonists",
    pageUrl: "https://kenney.nl/assets/animated-characters-protagonists",
    author: "Kenney",
    category: "model",
    description: "角色模型与动画，检查骨骼和动画播放。",
    tags: ["角色", "动画", "character", "animation"],
    project: "3d",
  },
  {
    id: "wood-floor",
    title: "木地板 · PBR",
    provider: "ambientcg",
    upstreamId: "WoodFloor051",
    pageUrl: "https://ambientcg.com/view?id=WoodFloor051",
    author: "ambientCG",
    category: "texture",
    description: "2K 无缝木地板材质，包含颜色、法线和粗糙度。",
    tags: ["木材", "地板", "wood", "floor", "PBR"],
    project: "3d",
  },
  {
    id: "bricks",
    title: "砖墙 · PBR",
    provider: "ambientcg",
    upstreamId: "Bricks074",
    pageUrl: "https://ambientcg.com/view?id=Bricks074",
    author: "ambientCG",
    category: "texture",
    description: "2K 砖墙材质，查看平铺、凹凸和表面反射。",
    tags: ["砖墙", "石材", "brick", "PBR"],
    project: "3d",
  },
  {
    id: "wooden-crate",
    title: "木箱 · 完整贴图模型",
    provider: "polyhaven",
    upstreamId: "wooden_crate_02",
    pageUrl: "https://polyhaven.com/a/wooden_crate_02",
    author: "James Ray Cock / Jurita Burger",
    category: "model",
    description: "带完整 PBR 贴图和 UV 的模型，用于材质变体练习。",
    tags: ["木箱", "道具", "crate", "wood", "PBR"],
    project: "3d",
  },
  {
    id: "studio",
    title: "柔光摄影棚 · HDRI",
    provider: "polyhaven",
    upstreamId: "studio_small_09",
    pageUrl: "https://polyhaven.com/a/studio_small_09",
    author: "Sergej Majboroda",
    category: "environment",
    description: "2K 摄影棚环境，检查材质的光照和反射。",
    tags: ["环境", "摄影棚", "hdri", "studio"],
    project: "3d",
  },
];
const userAgent = "GameAssetWorkshop/0.1 (local desktop asset library)";
export async function fetchText(url: string) {
  const r = await fetch(url, {
    headers: { "User-Agent": userAgent },
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok)
    throw new WorkshopError(
      "HTTP",
      `来源返回 ${r.status}：${new URL(url).hostname}`,
      r.status >= 500 || r.status === 429,
    );
  return r.text();
}
export async function fetchJSON(url: string) {
  return JSON.parse(await fetchText(url));
}
export async function resolveSample(sample: Sample): Promise<DownloadPlan> {
  let files: DownloadFile[] = [],
    archive = false,
    evidence = "";
  if (sample.provider === "kenney") {
    const html = await fetchText(sample.pageUrl);
    if (
      !/Creative Commons CC0|creativecommons\.org\/publicdomain\/zero/i.test(
        html,
      )
    )
      throw new WorkshopError(
        "LICENSE_CHANGED",
        "来源页面未确认 CC0，请检查许可",
      );
    const links = [
      ...html.matchAll(/href\s*=\s*["']([^"']+\.zip(?:\?[^"']*)?)["']/gi),
    ].map((m) => new URL(m[1], sample.pageUrl).href);
    const url = links.find((u) => new URL(u).hostname === "kenney.nl");
    if (!url)
      throw new WorkshopError("SOURCE_CHANGED", "官方免费 ZIP 入口已变化");
    files = [{ url, path: `${sample.upstreamId}.zip` }];
    archive = true;
    evidence =
      "官方素材页标明 Creative Commons CC0；免费 ZIP 入口由当前页面解析。";
  } else if (sample.provider === "opengameart") {
    const html = await fetchText(sample.pageUrl);
    if (!/creativecommons\.org\/publicdomain\/zero|>\s*CC0\s*</i.test(html))
      throw new WorkshopError("LICENSE_CHANGED", "条目未确认 CC0");
    const links = [
      ...html.matchAll(
        /href=["']([^"']+\/sites\/default\/files\/[^"']+\.png)["']/gi,
      ),
    ].map((m) => m[1]);
    const url =
      links.find((u) => /rpg_concept2_0\.png/.test(u)) ?? links.at(-1);
    if (!url) throw new WorkshopError("SOURCE_CHANGED", "原画附件未找到");
    files = [{ url, path: "rpg_concept2.png" }];
    evidence = "条目 Fantasy Concepts 2，作者 Drummyfish，页面许可证 CC0。";
  } else if (sample.provider === "ambientcg") {
    const data = await fetchJSON(
      `https://ambientcg.com/api/v3/assets?id=${encodeURIComponent(sample.upstreamId)}&include=downloads,title,tags`,
    );
    const asset = data.assets?.[0];
    const d =
      asset?.downloads?.find((d: any) => d.attributes === "2K-PNG") ??
      asset?.downloads?.find((d: any) => d.extension === "zip");
    if (!d) throw new WorkshopError("SOURCE_CHANGED", "未找到所需 2K 素材规格");
    files = [{ url: d.url, path: `${sample.upstreamId}.zip`, bytes: d.size }];
    archive = true;
    evidence =
      "https://docs.ambientcg.com/license/：全部 downloadable assets 采用 CC0 1.0。";
  } else {
    const data = await fetchJSON(
      `https://api.polyhaven.com/files/${encodeURIComponent(sample.upstreamId)}`,
    );
    if (sample.category === "environment") {
      const d = data.hdri?.["2k"]?.hdr;
      if (!d) throw new Error("未找到 2K HDR");
      files = [
        {
          url: d.url,
          path: `${sample.upstreamId}_2k.hdr`,
          bytes: d.size,
          md5: d.md5,
        },
      ];
    } else if (sample.category === "texture") {
      for (const key of ["Diffuse", "nor_gl", "Rough", "Metal", "AO"]) {
        const d = data[key]?.["2k"]?.png ?? data[key]?.["2k"]?.jpg;
        if (d)
          files.push({
            url: d.url,
            path: new URL(d.url).pathname.split("/").at(-1)!,
            bytes: d.size,
            md5: d.md5,
          });
      }
      if (!files.length) throw new Error("未找到 2K 材质贴图");
    } else {
      const d = data.gltf?.["2k"]?.gltf;
      if (!d) throw new Error("未找到 2K glTF");
      files = [
        {
          url: d.url,
          path: `${sample.upstreamId}_2k.gltf`,
          bytes: d.size,
          md5: d.md5,
        },
        ...Object.entries(d.include ?? {}).map(([p, v]: [string, any]) => ({
          url: v.url,
          path: safeRelative(p),
          bytes: v.size,
          md5: v.md5,
        })),
      ];
    }
    evidence =
      "https://polyhaven.com/license：资产采用 CC0；使用 API 时以本应用 User-Agent 标识并显示 Poly Haven 来源。";
  }
  for (const f of files) {
    if (new URL(f.url).protocol !== "https:")
      throw new WorkshopError("URL", "只下载 HTTPS 来源");
    safeRelative(f.path);
  }
  return {
    sample,
    source: {
      provider: sample.provider,
      assetId: sample.upstreamId,
      pageUrl: sample.pageUrl,
      author: sample.author,
      license: "CC0-1.0",
      checkedAt: now(),
      evidence,
      tags: sample.tags,
    },
    files,
    archive,
    bytes: files.reduce((n, f) => n + (f.bytes ?? 0), 0),
  };
}
export async function searchSource(
  provider: "ambientcg" | "polyhaven",
  query: string,
  offset = 0,
): Promise<{ items: Sample[]; total: number }> {
  if (provider === "ambientcg") {
    const data = await fetchJSON(
      `https://ambientcg.com/api/v3/assets?type=material&q=${encodeURIComponent(query)}&limit=30&offset=${offset}&include=title,tags,thumbnails`,
    );
    return {
      total: data.totalResults ?? 0,
      items: (data.assets ?? []).map((a: any) => ({
        id: `ambientcg:${a.id}`,
        title: a.title ?? a.id,
        provider,
        upstreamId: a.id,
        pageUrl: `https://ambientcg.com/view?id=${a.id}`,
        author: "ambientCG",
        category: "texture",
        description: "2K PBR 材质 · CC0",
        tags: a.tags ?? [],
        project: "3d",
        thumbnail: a.thumbnails?.["256-WEBP"] ?? a.thumbnails?.["256-PNG"],
      })),
    };
  }
  const data = await fetchJSON("https://api.polyhaven.com/assets");
  const normalized = query.toLowerCase();
  const list = Object.entries(data).filter(([id, a]: [string, any]) =>
    [id, a.name, ...(a.tags ?? []), ...(a.categories ?? [])]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
  return {
    total: list.length,
    items: list.slice(offset, offset + 30).map(([id, a]: [string, any]) => ({
      id: `polyhaven:${id}`,
      title: a.name ?? id,
      provider,
      upstreamId: id,
      pageUrl: `https://polyhaven.com/a/${id}`,
      author: Object.keys(a.authors ?? {}).join(" / ") || "Poly Haven",
      category:
        a.type === 0 ? "environment" : a.type === 1 ? "texture" : "model",
      description: "Poly Haven · 2K · CC0",
      tags: a.tags ?? [],
      project: "3d",
      thumbnail: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256`,
    })),
  };
}
export async function downloadOne(
  file: DownloadFile,
  root: string,
  ctx: JobContext,
  completed: number,
  total: number,
) {
  const target = inside(root, file.path);
  await fs.mkdir(path.dirname(target), { recursive: true });
  if (await fs.stat(target).catch(() => null)) return;
  const temporary = `${target}.partial`,
    metaPath = `${target}.http.json`;
  let bytes = (await fs.stat(temporary).catch(() => null))?.size ?? 0;
  const previous = await readJSON<any>(metaPath, {});
  const headers: Record<string, string> = { "User-Agent": userAgent };
  if (bytes) {
    headers.Range = `bytes=${bytes}-`;
    if (previous.etag || previous.modified)
      headers["If-Range"] = previous.etag || previous.modified;
  }
  await ctx.check();
  const response = await fetch(file.url, {
    headers,
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok)
    throw new WorkshopError(
      "DOWNLOAD_HTTP",
      `下载返回 ${response.status}：${file.path}`,
      true,
    );
  if (bytes && response.status !== 206) {
    bytes = 0;
    await fs.rm(temporary, { force: true });
  }
  if (response.status === 206) {
    if (
      (previous.etag &&
        response.headers.get("etag") &&
        previous.etag !== response.headers.get("etag")) ||
      (previous.modified &&
        response.headers.get("last-modified") &&
        previous.modified !== response.headers.get("last-modified"))
    ) {
      await fs.rm(temporary, { force: true });
      throw new WorkshopError(
        "UPSTREAM_CHANGED",
        "上游文件已改变，请重新下载",
        true,
      );
    }
    const start = response.headers
      .get("content-range")
      ?.match(/^bytes (\d+)-/)?.[1];
    if (Number(start) !== bytes) throw new Error("服务器断点位置不匹配");
  }
  await atomicJSON(metaPath, {
    url: file.url,
    etag: response.headers.get("etag"),
    modified: response.headers.get("last-modified"),
  });
  const expected =
    file.bytes ?? (Number(response.headers.get("content-length")) + bytes || 0);
  try {
    if (!response.body) throw new Error("下载响应没有内容");
    await pipeline(
      response.body as any,
      async function* (input) {
        for await (const chunk of input) {
          await ctx.check();
          bytes += chunk.length;
          if (bytes > 2 * 1024 ** 3)
            throw new Error("单文件下载超过 2 GB 上限");
          yield chunk;
          ctx.progress(
            `下载 ${file.path}`,
            completed + (expected ? bytes / expected : 0),
            total,
          );
        }
      },
      createWriteStream(temporary, { flags: bytes ? "a" : "w" }),
    );
    if (expected && expected !== bytes)
      throw new WorkshopError(
        "DOWNLOAD_SIZE",
        `文件大小不一致：${file.path}`,
        true,
      );
    if (file.md5) {
      const hash = createHash("md5");
      for await (const chunk of createReadStream(temporary)) hash.update(chunk);
      if (hash.digest("hex") !== file.md5) {
        await fs.rm(temporary, { force: true });
        throw new WorkshopError("CHECKSUM", `上游校验失败：${file.path}`, true);
      }
    }
    await fs.rename(temporary, target);
  } catch (error) {
    throw error;
  }
}
export async function runDownload(
  catalog: Catalog,
  plan: DownloadPlan,
  ctx: JobContext,
) {
  const root = path.join(catalog.root, "staging", `${ctx.job.id}-download`);
  await fs.mkdir(root, { recursive: true });
  for (const [i, f] of plan.files.entries())
    await downloadOne(f, root, ctx, i, plan.files.length);
  await atomicJSON(path.join(root, "download-manifest.json"), {
    ...plan,
    downloadedAt: now(),
  });
  const roots = plan.archive ? [inside(root, plan.files[0].path)] : [root];
  const imported = await inspectImport(roots);
  imported.category = plan.sample.category;
  imported.tags = plan.sample.tags;
  imported.source = plan.source;
  const parent = catalog.db
    .prepare(
      "SELECT id FROM assets WHERE json_extract(source,'$.provider')=? AND json_extract(source,'$.assetId')=? ORDER BY created_at DESC LIMIT 1",
    )
    .get(plan.source.provider, plan.source.assetId);
  if (parent) imported.parentAssetId = parent.id;
  if (plan.sample.project === "2d" || plan.sample.project === "3d") {
    const name =
      plan.sample.project === "2d" ? "2D 地牢素材集" : "3D 场景与材质素材集";
    let project = catalog.projects().find((p) => p.name === name);
    if (!project)
      project = catalog.saveProject({
        name,
        color: plan.sample.project === "2d" ? "#bd9c65" : "#83a79b",
        description: "来自免费开放素材的本地示例项目",
      });
    imported.projectId = project.id;
  }
  const result = await runImport(catalog, imported, ctx);
  if (plan.sample.entityCategory) {
    for (const id of result.assets) {
      const a = catalog.get(id);
      if (
        !a.metadata.entityCategory &&
        ["model", "sprite"].includes(a.category)
      )
        catalog.update([id], {
          metadata: {
            entityCategory: plan.sample.entityCategory,
            gameplayTags: a.metadata.gameplayTags?.length
              ? a.metadata.gameplayTags
              : defaultGameplayTags(plan.sample.entityCategory),
          },
        });
    }
  }
  if (plan.sample.project === "concept") {
    let c = catalog.collections().find((c) => c.name === "原画参考");
    if (!c) {
      const id = catalog.saveCollection("原画参考");
      c = catalog.collections().find((c) => c.id === id);
    }
    catalog.collect(c!.id, result.assets);
  }
  await fs.rm(root, { recursive: true, force: true });
  await catalog.snapshot();
  return { ...result, sampleId: plan.sample.id };
}
