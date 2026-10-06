import type { Category, JobStatus } from "./types";

export type GenerationProviderKind = "codex" | "openai" | "runninghub";
export type WorkflowRole =
  | "prompt"
  | "negativePrompt"
  | "reference"
  | "mask"
  | "width"
  | "height"
  | "seed"
  | "steps"
  | "cfg"
  | "custom";
export interface WorkflowBinding {
  nodeId: string;
  fieldName: string;
  role: WorkflowRole;
  label?: string;
}
export interface GenerationCapabilities {
  references: boolean;
  maxReferences: number;
  mask: boolean;
  seed: boolean;
  negativePrompt: boolean;
  transparent: boolean;
  quality: boolean;
  cancelRemote: boolean;
}
export interface GenerationProviderConfig {
  id: string;
  name: string;
  kind: GenerationProviderKind;
  enabled: boolean;
  purposes?: import("./processing").ProcessingPurpose[];
  endpoint?: string;
  models: string[];
  executable?: string;
  workflowId?: string;
  workflowJSON?: Record<
    string,
    {
      class_type: string;
      inputs: Record<string, unknown>;
      _meta?: { title?: string };
    }
  >;
  bindings: WorkflowBinding[];
  capabilities: GenerationCapabilities;
  hasKey?: boolean;
  keyError?: string;
  unitPrice?: number;
  currency?: "CNY" | "USD";
}
export interface GenerationReference {
  id: string;
  name: string;
  sha256: string;
  width: number;
  height: number;
  previewUrl: string;
  role: "reference" | "mask";
  sourceAssetId?: string;
  sourceCandidateId?: string;
}
export interface GenerationRequest {
  providerId: string;
  model: string;
  prompt: string;
  negativePrompt?: string;
  referenceIds: string[];
  maskId?: string;
  width: number;
  height: number;
  count: number;
  seed?: number;
  quality?: "auto" | "low" | "medium" | "high";
  transparent?: boolean;
  steps?: number;
  cfg?: number;
  workflowValues?: Record<string, string | number | boolean>;
  category: Category;
  tags: string[];
  projectId?: string;
  parentCandidateId?: string;
}
export interface GenerationPlan {
  id: string;
  items: GenerationRequest[];
  totalCalls: number;
  estimatedCost?: number;
  warnings: string[];
  createdAt: string;
  currency?: "CNY" | "USD";
}
export interface GenerationCandidate {
  id: string;
  runId: string;
  itemIndex: number;
  title: string;
  width: number;
  height: number;
  sha256: string;
  bytes: number;
  previewUrl: string;
  createdAt: string;
  importedAssetIds?: string[];
  importJobId?: string;
  parentCandidateId?: string;
}
export interface GenerationItem {
  request: GenerationRequest;
  provider: GenerationProviderConfig;
  state:
    | "prepared"
    | "submitting"
    | "submitted"
    | "retrieved"
    | "completed"
    | "failed"
    | "uncertain"
    | "cancelled";
  remoteTaskId?: string;
  outputUrls?: string[];
  candidateIds: string[];
  error?: string;
  remoteCancellation?: "cancelled" | "unconfirmed" | "unsupported";
  outputCount?: number;
}
export interface GenerationRun {
  id: string;
  jobId: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  items: GenerationItem[];
}
export interface GenerationProvenance {
  schemaVersion: 1;
  runId: string;
  candidateId: string;
  provider: string;
  model: string;
  workflowId?: string;
  workflowHash?: string;
  prompt: string;
  negativePrompt?: string;
  parameters: Record<string, unknown>;
  references: { sha256: string; role: string }[];
  parentCandidateId?: string;
  createdAt: string;
}
export interface GenerationTemplate {
  id: string;
  name: string;
  request: GenerationRequest;
}
export const capabilitiesFor = (
  kind: GenerationProviderKind,
): GenerationCapabilities => ({
  references: kind !== "runninghub",
  maxReferences: kind === "codex" ? 5 : 16,
  mask: kind === "openai",
  seed: false,
  negativePrompt: false,
  transparent: kind !== "runninghub",
  quality: kind === "openai",
  cancelRemote: kind === "runninghub",
});
export const generationPresets = [
  {
    name: "原画",
    category: "concept",
    prompt: "游戏原画，清晰的主体和构图，统一光照与色彩，不含文字、水印。",
  },
  {
    name: "图标",
    category: "ui",
    prompt:
      "游戏物品图标，单一主体，居中构图，清晰轮廓，小尺寸下仍能辨识，不含文字。",
  },
  {
    name: "UI",
    category: "ui",
    prompt:
      "游戏 UI 素材，边缘清晰，保持统一视觉风格，便于后续排版与切片，不含文字。",
  },
  {
    name: "贴图",
    category: "texture",
    prompt: "游戏材质基础色贴图，均匀光照，无投射阴影，适合平铺，不含文字。",
  },
  {
    name: "精灵",
    category: "sprite",
    prompt:
      "2D 游戏精灵，完整主体，一致视角，清晰轮廓，周围留出空白，不含文字。",
  },
] as const;
