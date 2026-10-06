import { z } from "zod";

export const SKIN_PROTOCOL_VERSION = 1;
export const SKIN_EXPORT_PADDING = 24;
export const skinStates = [
  "default",
  "hover",
  "pressed",
  "focus",
  "selected",
  "partial",
  "disabled",
  "loading",
  "error",
  "warning",
  "success",
  "open",
  "empty",
  "complete",
  "working",
  "removable",
  "long",
  "paper",
] as const;
export type SkinState = (typeof skinStates)[number];
export type SkinPreset = "comic" | "fresh" | "paper";
export type SkinSlot = "background" | "border" | "mark" | "icon" | "decoration";
const interactive: SkinState[] = [
  "default",
  "hover",
  "pressed",
  "focus",
  "selected",
  "disabled",
  "loading",
  "error",
];
const statesByComponent: Record<string, SkinState[]> = {
  "text-field": ["default", "hover", "focus", "disabled", "error"],
  "search-field": ["default", "hover", "focus", "disabled", "error"],
  "select-field": ["default", "hover", "focus", "disabled", "error"],
  "text-area": ["default", "hover", "focus", "disabled", "error"],
  checkbox: [
    "default",
    "hover",
    "focus",
    "selected",
    "partial",
    "disabled",
    "error",
  ],
  radio: ["default", "hover", "focus", "selected", "disabled", "error"],
  range: ["default", "hover", "pressed", "focus", "disabled"],
  badge: ["default"],
  tag: ["default", "removable"],
  "status-stamp": ["default", "working", "warning", "error", "success"],
  progress: ["default", "empty", "complete", "loading"],
  hint: ["default", "success", "warning", "error"],
  "stat-card": ["default"],
  "section-title": ["default", "long"],
  panel: ["default", "paper"],
  toolbar: ["default"],
  "asset-card": [...interactive, "long"],
  "group-card": [
    "default",
    "hover",
    "focus",
    "selected",
    "partial",
    "disabled",
    "long",
  ],
  "texture-slot": [
    "default",
    "hover",
    "selected",
    "empty",
    "disabled",
    "error",
  ],
  menu: ["default", "open", "hover", "focus", "disabled"],
  tooltip: ["default", "open"],
  dialog: ["default", "open"],
  toast: ["default", "success", "warning", "error"],
  "loading-state": ["default"],
  "empty-state": ["default"],
};
const definitions = [
  ["primary-button", "主按钮", ".aw-button--primary", 210, 36],
  [
    "secondary-button",
    "次按钮",
    ".aw-button--secondary:not(.aw-nav-item):not(.aw-icon-button)",
    210,
    36,
  ],
  ["danger-button", "危险按钮", ".aw-button--danger", 210, 36],
  ["icon-button", "图标按钮", ".aw-icon-button", 36, 36],
  ["nav-item", "导航项", ".aw-nav-item", 220, 36],
  ["tabs", "页签", ".aw-tabs", 290, 36],
  ["segmented", "分段选择", ".aw-segmented", 260, 36],
  [
    "text-field",
    "输入框",
    ".aw-field:not(:has(.aw-search,.aw-select,textarea)) .aw-input,.field input:not([type=checkbox],[type=radio],[type=range],[type=color])",
    290,
    36,
  ],
  ["search-field", "搜索框", ".aw-search,.search-box", 290, 36],
  ["select-field", "下拉选择", ".aw-select,select", 290, 36],
  ["text-area", "文本域", "textarea.aw-input,textarea", 290, 96],
  ["checkbox", "复选框", ".aw-choice:not(.aw-radio) .aw-choice-mark", 20, 20],
  ["radio", "单选框", ".aw-radio .aw-choice-mark", 20, 20],
  ["range", "滑块", ".aw-range input[type=range]", 290, 20],
  ["badge", "格式徽章", ".aw-badge,.format-badge", 64, 24],
  ["tag", "标签", ".aw-tag", 100, 28],
  ["status-stamp", "状态印章", ".aw-stamp", 150, 28],
  ["progress", "进度条", ".aw-progress-track", 290, 10],
  [
    "hint",
    "提示条",
    ".aw-hint,.license-banner,.warning,.success-note",
    310,
    64,
  ],
  ["stat-card", "统计卡", ".aw-stat,.stat-card", 260, 130],
  [
    "section-title",
    "标题底板",
    ".aw-section-title h1,.aw-section-title h2,.aw-section-title h3",
    330,
    44,
  ],
  [
    "panel",
    "面板",
    ".aw-panel,.settings-section,.inspector-section,.workbench-panel",
    310,
    180,
  ],
  ["toolbar", "工具栏", ".aw-toolbar,.toolbar,.material-actions", 330, 48],
  ["asset-card", "素材卡", ".aw-asset-card,.asset-card", 220, 210],
  ["group-card", "聚合卡", ".aw-group-card,.group-card", 240, 220],
  ["texture-slot", "贴图槽位", ".aw-texture-slot,.texture-slot", 310, 72],
  ["menu", "操作菜单", ".aw-menu,.context-menu", 240, 160],
  ["tooltip", "提示浮层", ".aw-tooltip", 240, 42],
  ["dialog", "弹窗", ".aw-dialog-box", 480, 300],
  ["toast", "通知", ".aw-toast", 310, 56],
  ["loading-state", "加载状态", ".aw-loading", 300, 60],
  ["empty-state", "空状态", ".aw-empty", 310, 180],
] as const;
export const skinSlotRegistry = definitions.map(
  ([id, label, selector, width, height]) => ({
    id,
    label,
    selector,
    width,
    height,
    slots: [
      "background",
      "border",
      "mark",
      "decoration",
      ...([
        "primary-button",
        "secondary-button",
        "danger-button",
        "icon-button",
        "nav-item",
        "search-field",
      ].includes(id)
        ? ["icon"]
        : []),
    ] as SkinSlot[],
    states: statesByComponent[id] ?? [...interactive],
    contentInsets: {
      top: Math.min(4, Math.floor(height / 4)),
      right: Math.min(12, Math.floor(width / 4)),
      bottom: Math.min(4, Math.floor(height / 4)),
      left: Math.min(12, Math.floor(width / 4)),
    },
    decorationBleed: 8,
    densities: { regular: height, compact: height === 36 ? 28 : height },
  }),
);
export const skinTokenNames = [
  "canvas",
  "surface",
  "raised",
  "text",
  "muted",
  "border",
  "accent",
  "cyan",
  "violet",
  "onAccent",
  "success",
  "warning",
  "error",
  "focus",
  "shadow",
] as const;
export type SkinTokens = Record<(typeof skinTokenNames)[number], string>;
const inset = z
  .object({
    top: z.number().min(0).max(8192),
    right: z.number().min(0).max(8192),
    bottom: z.number().min(0).max(8192),
    left: z.number().min(0).max(8192),
  })
  .strict();
const safePath = z
  .string()
  .min(1)
  .max(240)
  .refine(
    (v) =>
      !v.includes("\\") &&
      !v.includes(":") &&
      !v.startsWith("/") &&
      !v
        .split("/")
        .some(
          (p) => !p || p === "." || p === ".." || /[<>|?*\x00-\x1f]/.test(p),
        ),
    "资源必须使用安全相对路径",
  );
const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}$/);
export const skinManifestSchema = z
  .object({
    kind: z.literal("asset-workshop-skin"),
    schemaVersion: z.literal(1),
    id: identifier,
    name: z.string().trim().min(1).max(120),
    version: z.string().min(1).max(40),
    author: z.string().max(200),
    license: z.string().min(1).max(500),
    basePreset: z.enum(["comic", "fresh", "paper"]),
    tokens: z
      .partialRecord(
        z.enum(skinTokenNames),
        z.string().regex(/^#[0-9a-f]{6}$/i),
      )
      .default({}),
    resources: z
      .array(
        z
          .object({
            id: identifier,
            path: safePath.refine(
              (v) => /\.(png|webp|svg)$/i.test(v),
              "仅支持 PNG、WebP、SVG",
            ),
            width: z.number().int().min(1).max(8192),
            height: z.number().int().min(1).max(8192),
            scale: z.union([z.literal(1), z.literal(2)]).default(1),
            atlasRegion: z
              .object({
                name: z.string().max(200).optional(),
                x: z.number().int().min(0),
                y: z.number().int().min(0),
                width: z.number().int().min(1),
                height: z.number().int().min(1),
                sourceWidth: z.number().int().min(1),
                sourceHeight: z.number().int().min(1),
              })
              .strict()
              .refine(
                (r) =>
                  r.x + r.width <= r.sourceWidth &&
                  r.y + r.height <= r.sourceHeight,
                "图集区域超出来源图片",
              )
              .optional(),
            source: z
              .object({
                author: z.string().max(200),
                license: z.string().max(500),
                pageUrl: z.string().max(2000).optional(),
                assetId: z.string().max(100).optional(),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .max(512)
      .default([]),
    bindings: z
      .array(
        z
          .object({
            component: z.enum(
              definitions.map((d) => d[0]) as [string, ...string[]],
            ),
            slot: z.enum([
              "background",
              "border",
              "mark",
              "icon",
              "decoration",
            ]),
            state: z.enum(skinStates),
            resource: identifier,
            fit: z.enum(["nine-slice", "stretch", "contain", "tile"]),
            slices: inset.optional(),
            contentInsets: inset.optional(),
            bleed: z.number().min(0).max(8).default(0),
          })
          .strict(),
      )
      .max(2304)
      .default([]),
  })
  .strict();
export type SkinManifest = z.infer<typeof skinManifestSchema>;
export type SkinResource = SkinManifest["resources"][number];
export type SkinBinding = SkinManifest["bindings"][number];
export interface SkinDefinition {
  key: string;
  builtin: boolean;
  manifest: SkinManifest;
  urls: Record<string, string>;
}
export const appearanceSchema = z
  .object({
    skinKey: z.string().regex(/^(builtin:(comic|fresh|paper)|[a-f0-9]{64})$/),
    density: z.enum(["regular", "compact"]),
    motion: z.enum(["system", "reduced", "none"]),
  })
  .strict();
export type AppearancePreferences = z.infer<typeof appearanceSchema>;
export const defaultAppearance: AppearancePreferences = {
  skinKey: "builtin:comic",
  density: "regular",
  motion: "system",
};
export const builtinTokens: Record<SkinPreset, SkinTokens> = {
  comic: {
    canvas: "#090909",
    surface: "#191919",
    raised: "#252525",
    text: "#F5F2EB",
    muted: "#AAA8A2",
    border: "#65625C",
    accent: "#EF1024",
    cyan: "#05D5DA",
    violet: "#B643FF",
    onAccent: "#FFFFFF",
    success: "#05D5DA",
    warning: "#F5BD4F",
    error: "#EF1024",
    focus: "#05D5DA",
    shadow: "#090909",
  },
  fresh: {
    canvas: "#F2F6FA",
    surface: "#FFFFFF",
    raised: "#E9F1F8",
    text: "#203347",
    muted: "#586B7D",
    border: "#BCCDDD",
    accent: "#1265C8",
    cyan: "#007C85",
    violet: "#7953B8",
    onAccent: "#FFFFFF",
    success: "#147A61",
    warning: "#986313",
    error: "#C43448",
    focus: "#007C85",
    shadow: "#CCD7E3",
  },
  paper: {
    canvas: "#E9E0CF",
    surface: "#FBF5E8",
    raised: "#F1E7D3",
    text: "#382E24",
    muted: "#73614B",
    border: "#BBA88C",
    accent: "#91502C",
    cyan: "#326E68",
    violet: "#76577B",
    onAccent: "#FFFAEF",
    success: "#496C42",
    warning: "#906312",
    error: "#AC3737",
    focus: "#326E68",
    shadow: "#C8B89E",
  },
};
export const builtinSkins: SkinDefinition[] = (
  ["comic", "fresh", "paper"] as SkinPreset[]
).map((preset, i) => ({
  key: `builtin:${preset}`,
  builtin: true,
  urls: {},
  manifest: {
    kind: "asset-workshop-skin",
    schemaVersion: 1,
    id: `aw-${preset}`,
    name: ["漫画", "清爽", "纸感"][i],
    version: "1.0.0",
    author: "素材工坊",
    license: "MIT",
    basePreset: preset,
    tokens: { ...builtinTokens[preset] },
    resources: [],
    bindings: [],
  },
}));
export function validateSkin(value: unknown): SkinManifest {
  const m = skinManifestSchema.parse(value);
  const resources = new Map(m.resources.map((r) => [r.id, r]));
  if (
    resources.size !== m.resources.length ||
    new Set(m.resources.map((r) => r.path.toLowerCase())).size !==
      m.resources.length
  )
    throw new Error("皮肤资源 ID 或路径重复");
  for (const r of m.resources)
    if (r.width * r.scale > 8192 || r.height * r.scale > 8192)
      throw new Error(`资源像素尺寸超过 8192：${r.path}`);
  const keys = new Set<string>();
  for (const b of m.bindings) {
    const r = resources.get(b.resource),
      key = `${b.component}.${b.slot}.${b.state}`;
    if (!r) throw new Error(`${key}：找不到资源 ${b.resource}`);
    if (
      !skinSlotRegistry
        .find((d) => d.id === b.component)!
        .slots.includes(b.slot)
    )
      throw new Error(`${key}：该组件不支持此槽位`);
    if (
      !skinSlotRegistry
        .find((d) => d.id === b.component)!
        .states.includes(b.state)
    )
      throw new Error(`${key}：该组件不支持此状态`);
    if (keys.has(key)) throw new Error(`${key}：槽位重复绑定`);
    keys.add(key);
    if (b.fit === "nine-slice" && !b.slices)
      throw new Error(`${key}：九宫格必须提供切片`);
    for (const [name, insets] of [
      ["切片", b.slices],
      ["文字安全区", b.contentInsets],
    ] as const) {
      if (
        insets &&
        (insets.left + insets.right >= r.width ||
          insets.top + insets.bottom >= r.height)
      )
        throw new Error(`${key}：${name}超出图片范围`);
    }
  }
  return m;
}
export const resolvedSkinTokens = (skin: SkinManifest): SkinTokens => ({
  ...builtinTokens[skin.basePreset],
  ...skin.tokens,
});
