import type { OrganizeRequest } from "./types";
export function organizedTitle(
  original: string,
  index: number,
  rule: OrganizeRequest["title"],
) {
  if (!rule) return original;
  let value = rule.value ?? original;
  if (rule.find) value = value.split(rule.find).join(rule.replace ?? "");
  return `${rule.prefix ?? ""}${value}${rule.suffix ?? ""}${rule.numbering ? ` ${index + (rule.start ?? 1)}` : ""}`.trim();
}
