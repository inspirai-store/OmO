import type { EntityCategory, GameplayTag } from "./entities";
export const categories = {
  concept: "原画与参考",
  ui: "UI",
  controls: "控件视觉",
  skin: "界面皮肤",
  sprite: "2D 游戏资源",
  texture: "贴图与材质",
  model: "3D 模型",
  animation: "动画",
  environment: "环境资源",
  other: "其他文件",
} as const;
export type Category = keyof typeof categories;
export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";
export interface SourceInfo {
  provider: string;
  assetId?: string;
  pageUrl: string;
  author: string;
  license: string;
  checkedAt?: string;
  evidence?: string;
  tags?: string[];
}
export interface FileRecord {
  id: string;
  path: string;
  bytes: number;
  sha256: string;
  extension: string;
  metadata: Record<string, any>;
}
export interface Dependency {
  from: string;
  target: string;
  status: "resolved" | "missing" | "remote";
}
export interface PackageManifest {
  schemaVersion: 1;
  packageId: string;
  revisionId: string;
  name: string;
  contentHash: string;
  createdAt: string;
  files: FileRecord[];
  dependencies: Dependency[];
  source?: SourceInfo;
  assets: ManifestAsset[];
}
export interface ManifestAsset {
  id: string;
  path: string;
  title: string;
  category: Category;
  tags: string[];
  metadata: Record<string, any>;
  dependencies: string[];
  relatedPaths?: string[];
}
export interface Asset extends ManifestAsset {
  packageId: string;
  revisionId: string;
  fileId: string;
  extension: string;
  bytes: number;
  sha256: string;
  favorite: boolean;
  trashed: boolean;
  createdAt: string;
  viewedAt?: string;
  notes: string;
  source?: SourceInfo;
  previewUrl?: string;
  thumbnailUrl?: string;
  capabilities: {
    preview: "image" | "model" | "environment" | "material" | "archive" | "skin";
    reason?: string;
  };
}
export interface Project {
  id: string;
  name: string;
  description: string;
  color: string;
  godotPath?: string;
  createdAt: string;
  assetCount: number;
}
export interface AssetQuery {
  imageOnly?: boolean;
  modelOnly?: boolean;
  search?: string;
  category?: Category | "";
  entityCategory?: EntityCategory | "";
  gameplayTag?: GameplayTag | "";
  projectId?: string;
  collectionId?: string;
  favorite?: boolean;
  trash?: boolean;
  recent?: boolean;
  unsorted?: boolean;
  showRelated?: boolean;
  includeAuxiliary?: boolean;
  extension?: string;
  license?: string;
  minWidth?: number;
  maxTriangles?: number;
  hasAnimation?: boolean;
  missing?: boolean;
  offset?: number;
  limit?: number;
  sort?: "newest" | "title" | "viewed" | "size";
}
export interface AssetPage {
  items: Asset[];
  total: number;
  offset: number;
  limit: number;
  auxiliaryTotal?: number;
}
export type AggregationMode = "entity" | "package";
export interface AssetGroup {
  id: string;
  title: string;
  primary: Asset;
  assetIds: string[];
  counts: Record<
    "model" | "image" | "animation" | "material" | "other",
    number
  >;
  entityCategories: EntityCategory[];
  gameplayTags: GameplayTag[];
  reasons: string[];
  missing: number;
}
export interface AssetGroupPage {
  items: AssetGroup[];
  total: number;
  assetTotal: number;
  offset: number;
  limit: number;
}
export interface Job {
  cancellation?: { remoteSupported: boolean; message?: string };
  id: string;
  type: string;
  title: string;
  status: JobStatus;
  stage: string;
  progress: number;
  done: number;
  total: number;
  error?: string;
  request: any;
  result?: any;
  createdAt: string;
  updatedAt: string;
}
export interface ImportPlan {
  title?: string;
  organizing?: Record<string, unknown>;
  generation?: import("./generation").GenerationProvenance;
  processing?: import("./processing").ProcessingProvenance;
  parentAssetId?: string;
  id: string;
  paths: string[];
  roots: { path: string; label: string; archive: boolean }[];
  fileCount: number;
  bytes: number;
  files: string[];
  issues: string[];
  counts?: { images: number; models: number; materialSets: number };
  availableBytes?: number;
  duplicateCandidates?: number;
  projectId?: string;
  category?: Category;
  entityCategory?: EntityCategory | null;
  gameplayTags?: GameplayTag[];
  tags?: string[];
  source?: SourceInfo;
}
export type TextureSlot =
  "baseColor" | "normal" | "roughness" | "metallic" | "ao" | "emission";
export interface TextureBinding {
  assetId: string;
  revisionId: string;
  channel: "r" | "g" | "b" | "a" | "rgb";
  uv: 0 | 1;
}
export interface MaterialVariant {
  textureFilter?: "linear" | "nearest";
  id: string;
  name: string;
  assetId: string;
  revisionId: string;
  materialIndex: number;
  bindings: Partial<Record<TextureSlot, TextureBinding>>;
  baseColor: string;
  roughness: number;
  metallic: number;
  normalScale: number;
  normalConvention: "gl" | "dx";
  aoStrength: number;
  emission: string;
  emissionStrength: number;
  alphaMode: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff: number;
  doubleSided: boolean;
  repeat: [number, number];
  offset: [number, number];
  rotation: number;
  createdAt: string;
}
export const defaultVariant = (
  asset: Pick<Asset, "id" | "revisionId">,
): MaterialVariant => ({
  id: "",
  name: "新材质变体",
  assetId: asset.id,
  revisionId: asset.revisionId,
  materialIndex: 0,
  bindings: {},
  baseColor: "#ffffff",
  roughness: 1,
  metallic: 0,
  normalScale: 1,
  normalConvention: "gl",
  aoStrength: 1,
  emission: "#000000",
  emissionStrength: 1,
  alphaMode: "OPAQUE",
  alphaCutoff: 0.5,
  doubleSided: false,
  repeat: [1, 1],
  offset: [0, 0],
  rotation: 0,
  createdAt: "",
});
export interface Collection {
  id: string;
  name: string;
  query?: AssetQuery;
  count: number;
}
export interface Sample {
  id: string;
  title: string;
  provider: "kenney" | "ambientcg" | "polyhaven" | "opengameart";
  upstreamId: string;
  pageUrl: string;
  author: string;
  category: Category;
  entityCategory?: EntityCategory;
  gameplayTags?: GameplayTag[];
  description: string;
  tags: string[];
  project: "2d" | "3d" | "concept";
  installed?: boolean;
  thumbnail?: string;
}
export interface DownloadFile {
  url: string;
  path: string;
  bytes?: number;
  md5?: string;
}
export interface DownloadPlan {
  sample: Sample;
  source: SourceInfo;
  files: DownloadFile[];
  archive: boolean;
  bytes: number;
}
export interface ExportRequest {
  familyBatchId?: string;
  assetIds: string[];
  target: string;
  mode: "godot" | "generic";
  variantIds?: string[];
  zip?: boolean;
  aggregate?: boolean;
  preferGLTF?: boolean;
}
export interface ExportPlan {
  id: string;
  request: ExportRequest;
  assets: Asset[];
  variants: MaterialVariant[];
  issues: string[];
  bytes: number;
}
export interface Settings {
  root: string;
  cacheGB: number;
  godotPath: string;
  blenderPath: string;
}
export interface Stats {
  assets: number;
  auxiliaryAssets: number;
  files: number;
  packages: number;
  projects: number;
  bytes: number;
  favorites: number;
  categories: Record<string, number>;
  recent: Asset[];
  cacheBytes: number;
}
export interface AssetSelection {
  ids: string[];
  count: number;
  sample: Asset[];
  allImages: boolean;
  allPreviewable: boolean;
  allFavorite: boolean;
  allAuxiliary: boolean;
  allTrashed: boolean;
}
export interface OrganizeRequest {
  ids: string[];
  category?: Category;
  entityCategory?: EntityCategory | null;
  gameplayTags?: GameplayTag[];
  group?: { name: string } | null;
  tags?: string[];
  replaceTags?: boolean;
  title?: {
    value?: string;
    prefix?: string;
    suffix?: string;
    find?: string;
    replace?: string;
    numbering?: boolean;
    start?: number;
  };
  projectId?: string;
  collectionId?: string;
  auxiliaryRole?: "preview" | null;
}
export interface WorkshopAPI {
  call<T = any>(method: string, input?: any): Promise<T>;
  choose(options: {
    kind: "files" | "folder" | "save" | "executable";
    title?: string;
    defaultPath?: string;
    filters?: { name: string; extensions: string[] }[];
  }): Promise<string[]>;
  dropPaths(files: File[]): string[];
  onEvent(callback: (event: { type: string; data: any }) => void): () => void;
}
declare global {
  interface Window {
    workshop: WorkshopAPI;
  }
}
