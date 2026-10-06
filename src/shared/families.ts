import type { GenerationRequest, GenerationCandidate } from "./generation";
import type { Category } from "./types";
import type { ImageOperation } from "./processing";

export interface AssetFamilyTemplate {
  id: string;
  familyId: string;
  version: number;
  name: string;
  style: string;
  base: GenerationRequest;
  operations: ImageOperation[];
  createdAt: string;
}
export interface AssetFamilyRow {
  key: string;
  name: string;
  subject: string;
  accent: string;
  motif: string;
  count: number;
  category: Category;
}
export interface AssetFamilyItem extends AssetFamilyRow {
  selectedCandidateId?: string;
  processingRunId?: string;
  inputId?: string;
  proposalId?: string;
  importJobId?: string;
  outputs?: { size: number; artifactId: string; assetIds: string[] }[];
  error?: string;
}
export interface FamilySegment {
  id: string;
  keys: string[];
  requests: GenerationRequest[];
  runId?: string;
  jobId?: string;
}
export interface AssetFamilyBatch {
  id: string;
  template: AssetFamilyTemplate;
  projectId?: string;
  items: AssetFamilyItem[];
  segments: FamilySegment[];
  jobId?: string;
  createdAt: string;
  updatedAt: string;
}
export interface FamilyProvenance {
  schemaVersion: 1;
  familyId: string;
  templateId: string;
  templateVersion: number;
  batchId: string;
  key: string;
  size: number;
  candidateId: string;
}
export interface FamilyDetail {
  batch: AssetFamilyBatch;
  candidates: Record<string, GenerationCandidate[]>;
  progress: Record<
    string,
    {
      completed: number;
      pending: number;
      running: number;
      failed: number;
      errors: string[];
    }
  >;
}
export interface FamilyPlan {
  id: string;
  batchId: string;
  totalCalls: number;
  estimatedCost?: number;
  currency?: "CNY" | "USD";
  warnings: string[];
  segments: FamilySegment[];
  createdAt: string;
}
export const familyIconOperations: ImageOperation[] = [
  { type: "trim", threshold: 8 },
  {
    type: "resize",
    width: 384,
    height: 384,
    fit: "contain",
    kernel: "lanczos3",
  },
  {
    type: "pad",
    left: 64,
    right: 64,
    top: 64,
    bottom: 64,
    color: "transparent",
  },
  {
    type: "resize",
    width: 128,
    height: 128,
    fit: "contain",
    kernel: "lanczos3",
  },
  { type: "resize", width: 64, height: 64, fit: "contain", kernel: "lanczos3" },
];
export const zizhenIconStyle =
  "青绿玉漆、旧铜金、少量朱砂的立体游戏物件。固定三分之四视角、左上柔和光照、统一材质与清晰轮廓，物件完整居中，真实透明背景。64像素仍易辨识。仅绘制条目主体，不画汉字身体、人物、文字、边框、水印、按钮或棋盘底。参考图仅用于材质、色彩与视角，不能把参考图的角色身体复制到物件。";
const row = (
  key: string,
  name: string,
  subject: string,
  motif = "",
  accent = "青绿、铜金",
): AssetFamilyRow => ({
  key,
  name,
  subject,
  motif,
  accent,
  count: 2,
  category: "ui",
});
export const zizhenIconRows: AssetFamilyRow[] = [
  row("gear.blade", "破阵刀", "一柄厚背弯刃战刀", "破阵的锐利刀锋"),
  row("gear.pike", "拒马枪", "一柄带短缨的拒马长枪", "坚固枪尖"),
  row("gear.arrow", "火羽箭", "一支有羽翼与小火焰的箭", "燃烧", "铜金、朱砂"),
  row("gear.hoof", "铁蹄", "一个坚实锻铁马蹄铁", "冲击与骑兵"),
  row("gear.dragon", "青龙刀穗", "青龙纹铜环与青绿丝绳刀穗", "青龙纹"),
  row("gear.bow", "定军弓弦", "一束带铜扣的弓弦", "弓弦轮廓，不画整把弓"),
  row(
    "gear.fan",
    "卧龙羽扇",
    "一把白羽与玉柄的羽扇",
    "羽毛扇面",
    "青绿、象牙白、铜金",
  ),
  row("gear.ribbon", "仁德绶带", "一条优雅盘绕的丝质绶带", "仁德礼饰"),
  row("skill.fire", "火攻", "带铜色底座的一簇朱砂火焰", "火攻", "朱砂、铜金"),
  row("skill.recruit", "招贤", "卷起的招贤令卷轴与铜印", "卷轴不含文字"),
  row("skill.bounty", "犒赏", "装有米粮和铜钱的小犒赏袋", "犒赏军士"),
  row("skill.formation", "军阵", "一组以阵形排列的微型军旗", "统一阵列"),
  row("skill.craft", "工匠", "一把铜柄锻造锤与小铁砧", "锻造工具"),
  row("skill.laststand", "坚守", "一面带铜边的青绿盾牌", "坚固防御"),
];
export function openFamily(source?: {
  assetId?: string;
  candidateId?: string;
}) {
  window.dispatchEvent(
    new CustomEvent("workshop:family", { detail: source ?? {} }),
  );
}
