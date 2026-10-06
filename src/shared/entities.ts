import type { ManifestAsset } from "./types";

export const entityCategories = {
  character: "角色与 NPC",
  enemy: "敌人与怪物",
  animal: "动物与伙伴",
  equipment: "武器与装备",
  pickup: "拾取物与消耗品",
  interactive: "交互物与机关",
  architecture: "建筑与关卡模块",
  furniture: "家具与生活道具",
  production: "采集、农业与生产",
  vehicle: "载具与交通",
  nature: "自然与地貌",
} as const;
export type EntityCategory = keyof typeof entityCategories;
export const gameplayTags = {
  npc: "对话与任务",
  combat: "战斗",
  companion: "伙伴与坐骑",
  equipment: "装备",
  pickup: "拾取与奖励",
  interaction: "交互与解谜",
  traversal: "移动与关卡",
  gathering: "采集",
  production: "种植与制造",
  transport: "驾驶与运输",
  decoration: "场景装饰",
} as const;
export type GameplayTag = keyof typeof gameplayTags;
export interface EntityInfo {
  category: EntityCategory | null;
  gameplayTags: GameplayTag[];
}

// Prefer the object's filename to broad pack tags: a tree in a farm pack stays a tree.
const rules: [EntityCategory, RegExp, GameplayTag[]][] = [
  [
    "interactive",
    /\b(chest|door|lever|switch|trap|spike|checkpoint|portal|gate|button|spring)\b|宝箱|机关|陷阱|传送门/,
    ["interaction"],
  ],
  [
    "enemy",
    /\b(monster|enemy|boss|zombie|skeleton|goblin|orc|slime|demon)\b|怪物|敌人|首领/,
    ["combat"],
  ],
  [
    "animal",
    /\b(animal|pet|dog|cat|horse|cow|pig|sheep|chicken|wolf|fox|deer|bird|fish|rabbit|bear)\b|动物|宠物|坐骑/,
    ["companion"],
  ],
  [
    "equipment",
    /\b(weapon|sword|axe|gun|blaster|rifle|pistol|shield|armor|armour|helmet|bow|arrow|spear|hammer|pickaxe|tool|throwable|silencer)\b|武器|装备|护甲/,
    ["equipment", "combat"],
  ],
  [
    "pickup",
    /\b(coin|gem|key|potion|food|apple|bread|bottle|ammo|fruit|meat|burger|pizza|banana|carrot|egg|cheese|cake)\b|金币|药水|食物|消耗品/,
    ["pickup"],
  ],
  [
    "production",
    /\b(crop|farm|seed|wheat|workbench|machine|conveyor|factory|mine|ore|furnace|planter|tractor)\b|农作物|工作台|生产|矿脉/,
    ["production", "gathering"],
  ],
  [
    "vehicle",
    /\b(car|truck|boat|ship|train|vehicle|kart|aircraft|spaceship|bus|van|scooter|bike)\b|汽车|载具|飞船|列车/,
    ["transport"],
  ],
  [
    "character",
    /\b(character|npc|player|human|villager|merchant|guard|knight|survivor|protagonist|man|woman)\b|角色|村民|商人/,
    ["npc"],
  ],
  [
    "furniture",
    /\b(table|chair|bed|cabinet|lamp|sofa|shelf|book|bench|desk|furniture|crate|barrel|sign|cup|plate)\b|家具|桌|椅|木箱|路牌/,
    ["decoration"],
  ],
  [
    "architecture",
    /\b(wall|floor|roof|stairs|stair|bridge|fence|house|building|castle|tower|pillar|column|road|tile|dungeon)\b|建筑|墙|地板|楼梯|桥/,
    ["traversal"],
  ],
  [
    "nature",
    /\b(tree|bush|rock|stone|grass|plant|flower|cave|stump|log|cliff|terrain|nature|foliage)\b|树|植被|岩石|地貌/,
    ["decoration"],
  ],
];
const words = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[_\-\d./]+/g, " ");
export function defaultGameplayTags(category: EntityCategory): GameplayTag[] {
  return [...(rules.find(([key]) => key === category)?.[2] ?? [])];
}
export function inferEntity(
  a: Pick<ManifestAsset, "path" | "category" | "tags">,
): EntityInfo {
  if (
    ["ui", "controls", "concept", "environment", "other"].includes(a.category)
  )
    return { category: null, gameplayTags: [] };
  const filename = a.path
    .replace(/\\/g, "/")
    .split("/")
    .at(-1)!
    .replace(/\.[^.]+$/, "");
  const match =
    rules.find(([, pattern]) => pattern.test(words(filename))) ??
    rules.find(([, pattern]) => pattern.test(words(a.path))) ??
    rules.find(([, pattern]) => pattern.test(words(a.tags.join(" "))));
  return match
    ? { category: match[0], gameplayTags: match[2] }
    : { category: null, gameplayTags: [] };
}
export function entityMetadata(
  a: Pick<ManifestAsset, "path" | "category" | "tags" | "metadata">,
) {
  const inferred = inferEntity(a);
  return {
    entityCategory:
      a.metadata.entityCategory === undefined
        ? inferred.category
        : a.metadata.entityCategory,
    gameplayTags: a.metadata.gameplayTags ?? inferred.gameplayTags,
  };
}
