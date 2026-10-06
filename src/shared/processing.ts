import type {
  GenerationProviderConfig,
  GenerationProvenance,
} from "./generation";
import type { Category, JobStatus, SourceInfo } from "./types";
import type { EntityCategory, GameplayTag } from "./entities";

export type ImageRef = {
  kind: "asset" | "candidate" | "artifact" | "input";
  id: string;
};
export type ProcessingPurpose =
  "edit" | "recolor" | "removeBackground" | "restore" | "upscale";
export type ImageOperation =
  | {
      type: "resize";
      width: number;
      height: number;
      fit: "contain" | "cover" | "fill";
      kernel: "nearest" | "lanczos3";
    }
  | { type: "crop"; x: number; y: number; width: number; height: number }
  | { type: "rotate"; angle: 90 | 180 | 270 }
  | { type: "flip"; axis: "horizontal" | "vertical" }
  | { type: "trim"; threshold: number }
  | {
      type: "pad";
      top: number;
      right: number;
      bottom: number;
      left: number;
      color: string;
    }
  | {
      type: "adjust";
      brightness: number;
      contrast: number;
      saturation: number;
      hue: number;
      tint?: string;
    }
  | { type: "sharpen"; sigma: number }
  | { type: "denoise"; size: number }
  | {
      type: "ai";
      purpose: ProcessingPurpose;
      providerId: string;
      model: string;
      prompt: string;
      width: number;
      height: number;
      maskId?: string;
      maskInputHash?: string;
      workflowValues?: Record<string, string | number | boolean>;
    };
export interface ProcessingRecipe {
  id: string;
  name: string;
  operations: ImageOperation[];
  createdAt: string;
}
export interface ProcessingInput {
  id: string;
  title: string;
  width: number;
  height: number;
  sha256: string;
  bytes: number;
  previewUrl: string;
  source?: ImageRef;
  sourceInfo?: SourceInfo;
  category?: Category;
  entityCategory?: EntityCategory | null;
  gameplayTags?: GameplayTag[];
  tags?: string[];
  generation?: GenerationProvenance;
  processing?: ProcessingProvenance;
  role?: "image" | "mask";
  maskInputHash?: string;
}
export interface ProcessingProvenance {
  schemaVersion: 1;
  source: ImageRef;
  sourceHash: string;
  runId: string;
  artifactId: string;
  steps: {
    operation: ImageOperation;
    inputHash: string;
    outputHash: string;
    toolVersion: string;
    generation?: GenerationProvenance;
  }[];
}
export interface ProcessingArtifact extends ProcessingInput {
  runId: string;
  parent: ImageRef;
  operation: ImageOperation;
  toolVersion: string;
  createdAt: string;
  importedAssetIds?: string[];
  importJobId?: string;
  rawCandidateId?: string;
}
export interface ProcessingPlan {
  id: string;
  inputIds: string[];
  operations: ImageOperation[];
  createdAt: string;
  totalCalls: number;
  maxCalls: number;
  extraCalls: number;
  warnings: string[];
  providers: GenerationProviderConfig[];
  estimatedCost?: number;
  currency?: "CNY" | "USD";
  sessionId?: string;
}
export interface ProcessingRun {
  id: string;
  jobId: string;
  plan: ProcessingPlan;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  calls: number;
  items: {
    inputId: string;
    cursor: number;
    artifactIds: string[];
    childJobId?: string;
    generationRunId?: string;
    state:
      | "pending"
      | "running"
      | "completed"
      | "failed"
      | "uncertain"
      | "cancelled";
    error?: string;
    corrections: number;
    reviewDone?: boolean;
    repairOperation?: ImageOperation;
    reviewJobId?: string;
  }[];
}
export interface AgentSession {
  id: string;
  brief: string;
  providerId: string;
  model: string;
  rounds: number;
  threadId?: string;
  state:
    | "planning"
    | "awaitingApproval"
    | "executing"
    | "reviewing"
    | "completed"
    | "needsInput";
  history: { role: string; text: string; createdAt: string }[];
  plan?: ProcessingPlan;
  createdAt: string;
}
export interface ProcessingSaveContext {
  projectId?: string;
  collectionId?: string;
}
export interface ProcessingDestinationRecommendation {
  kind: "project" | "collection" | "smartCollection";
  id: string;
  name: string;
  reason: string;
}
export interface ProcessingAcceptItem {
  artifactId: string;
  title: string;
  filename: string;
  category: Category;
  entityCategory: EntityCategory | null;
  gameplayTags: GameplayTag[];
  tags: string[];
  projectIds: string[];
  collectionIds: string[];
}
export interface ProcessingSaveItem extends ProcessingAcceptItem {
  submitted?: boolean;
  previewUrl: string;
  width: number;
  height: number;
  importedAssetIds: string[];
  analysis: "local" | "cached" | "ai" | "failed";
  confidence: "high" | "medium" | "low";
  reason: string;
  classificationSuggestion?: {
    category: Category;
    entityCategory: EntityCategory | null;
    gameplayTags: GameplayTag[];
    reason: string;
  };
  recommendations: ProcessingDestinationRecommendation[];
}
export interface ProcessingSaveProposal {
  id: string;
  context: ProcessingSaveContext;
  brief: string;
  providerId?: string;
  model: string;
  ruleVersion: string;
  state:
    "draft" | "queued" | "analyzing" | "ready" | "interrupted" | "cancelled";
  jobId?: string;
  estimatedCalls: number;
  calls: number;
  warnings: string[];
  items: ProcessingSaveItem[];
  batches: {
    artifactIds: string[];
    state: "pending" | "started" | "completed" | "failed";
    sessionId?: string;
    error?: string;
  }[];
  edits: Record<string, Partial<ProcessingAcceptItem>>;
  createdAt: string;
  updatedAt: string;
}
export interface ProcessingSaveRecord {
  id: string;
  item: ProcessingAcceptItem;
  filename: string;
  proposalId?: string;
  ruleVersion: string;
  analysis: ProcessingSaveItem["analysis"];
  providerId?: string;
  model: string;
  confidence: ProcessingSaveItem["confidence"];
  reason: string;
  createdAt: string;
  importedAssetIds: string[];
  completedProjectIds: string[];
  completedCollectionIds: string[];
  error?: string;
}
export const operationLabels: Record<ImageOperation["type"], string> = {
  resize: "尺寸缩放",
  crop: "裁剪",
  rotate: "旋转",
  flip: "翻转",
  trim: "裁切透明边缘",
  pad: "画布补边",
  adjust: "调色",
  sharpen: "锐化",
  denoise: "基础降噪",
  ai: "AI 加工",
};
export const purposeLabels: Record<ProcessingPurpose, string> = {
  edit: "局部修改",
  recolor: "语义改色",
  removeBackground: "去背景",
  restore: "修复与增强",
  upscale: "超分",
};
export const openProcessing = (
  sources: ImageRef[],
  context?: ProcessingSaveContext,
) =>
  window.dispatchEvent(
    new CustomEvent("workshop:processing", {
      detail: context ? { sources, context } : sources,
    }),
  );
