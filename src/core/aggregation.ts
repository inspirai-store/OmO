import type {
  Asset,
  AssetGroup,
  AggregationMode,
  PackageManifest,
} from "../shared/types";
import type { EntityCategory, GameplayTag } from "../shared/entities";

const supportFolder =
  /^(models?|meshes?|textures?|materials?|icons?|sprites?|images?|animations?|states?|2d|3d|png|fbx|obj|gltf|glb|blend)(\s+format)?$/i;
export function formatKey(path: string) {
  return path
    .replace(/\\/g, "/")
    .replace(/\.[^.\/]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .normalize("NFKC")
    .toLowerCase()
    .split("/")
    .filter((p) => !supportFolder.test(p))
    .join("/");
}
export function entityKey(path: string) {
  const parts = path
    .replace(/\\/g, "/")
    .replace(/\.[^.\/]+$/, "")
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .normalize("NFKC")
    .toLowerCase()
    .split("/")
    .filter((p) => !supportFolder.test(p));
  let stem = parts.pop() ?? "";
  stem = stem
    .replace(/^icon[_-]/, "")
    .replace(
      /[_-](icon|basecolor|base_color|color|diffuse|albedo|normal(?:gl|dx)?|roughness|metallic|ao|orm|arm|emission|preview|idle|walk|run|attack|death|hit|open|closed|active|inactive|pressed|hover|disabled)(?:[_-]?\d+)?$/i,
      "",
    );
  // Keep colors, numbered objects and semantic directories distinct.
  return [...parts, stem || "unnamed"].join("/");
}
const score = (a: Asset) =>
  a.metadata.dependent || a.metadata.groupMember
    ? 0
    : a.extension === ".glb"
      ? 6
      : a.extension === ".gltf"
        ? 5
        : a.capabilities.preview === "model"
          ? 4
          : a.metadata.materialSet
            ? 3
            : a.capabilities.preview === "image"
              ? 2
              : 1;

export function aggregateAssets(
  all: Asset[],
  mode: AggregationMode,
  manifests: Map<string, PackageManifest>,
): AssetGroup[] {
  const assets = all.filter(
    (a) => !a.trashed && a.metadata.auxiliaryRole !== "preview",
  );
  const byId = new Map(assets.map((a) => [a.id, a]));
  const byPath = new Map(assets.map((a) => [`${a.revisionId}:${a.path}`, a]));
  const dependencyTargets = new Map<string, string[]>();
  for (const [revisionId, manifest] of manifests)
    for (const dep of manifest.dependencies) {
      if (dep.status !== "resolved") continue;
      const key = `${revisionId}:${dep.from}`;
      if (!dependencyTargets.has(key)) dependencyTargets.set(key, []);
      dependencyTargets.get(key)!.push(dep.target);
    }
  const buckets = new Map<string, Asset[]>();
  const keyFor = (a: Asset) =>
    mode === "package"
      ? `package:${a.revisionId}`
      : a.metadata.assetGroup
        ? `manual:${a.metadata.assetGroup.id}`
        : `entity:${a.revisionId}:${entityKey(a.path)}`;
  for (const a of assets) {
    // Dependencies enter their owners' groups, never join unrelated owners through a shared texture.
    if (
      mode === "entity" &&
      !a.metadata.assetGroup &&
      (a.metadata.dependent || a.metadata.groupMember)
    )
      continue;
    const key = keyFor(a);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(a);
  }
  if (mode === "entity") {
    const parent = new Map<string, string>();
    const find = (key: string): string => {
      let root = key;
      while (parent.has(root)) root = parent.get(root)!;
      while (parent.has(key)) {
        const next = parent.get(key)!;
        parent.set(key, root);
        key = next;
      }
      return root;
    };
    for (const a of assets)
      for (const state of a.metadata.stateGroup ?? []) {
        const b = byId.get(state.id);
        if (
          !b ||
          a.metadata.assetGroup ||
          b.metadata.assetGroup ||
          a.revisionId !== b.revisionId
        )
          continue;
        const first = find(keyFor(a)),
          second = find(keyFor(b));
        if (first !== second) parent.set(second, first);
      }
    const merged = new Map<string, Asset[]>();
    for (const [key, rows] of buckets) {
      const root = find(key);
      if (!merged.has(root)) merged.set(root, []);
      merged.get(root)!.push(...rows);
    }
    buckets.clear();
    for (const [key, rows] of merged) buckets.set(key, rows);
  }
  const groups: AssetGroup[] = [];
  for (const [key, roots] of buckets) {
    const members = new Map(roots.map((a) => [a.id, a]));
    const reasons = new Set<string>([
      mode === "package"
        ? "同一素材包与版本"
        : key.startsWith("manual:")
          ? "手动指定的聚合组"
          : roots.length > 1
            ? "同名实体的格式或状态"
            : "独立实体",
    ]);
    const queue = [...roots];
    for (let i = 0; i < queue.length; i++) {
      const a = queue[i];
      const related = [
        ...(a.dependencies ?? []),
        ...(a.relatedPaths ?? []),
        ...(a.metadata.animationFiles ?? []),
        ...Object.values(a.metadata.materialSet ?? {}).filter(
          (p): p is string => typeof p === "string",
        ),
      ];
      const next = related.map((p) => byPath.get(`${a.revisionId}:${p}`));
      for (const state of a.metadata.stateGroup ?? [])
        next.push(byId.get(state.id));
      // Follow parsed dependency edges even when a catalog row was imported with only direct paths.
      for (const target of dependencyTargets.get(`${a.revisionId}:${a.path}`) ??
        [])
        next.push(byPath.get(`${a.revisionId}:${target}`));
      for (const b of next) {
        if (!b || members.has(b.id)) continue;
        members.set(b.id, b);
        queue.push(b);
        reasons.add("关联贴图、动画与状态依赖");
      }
    }
    const primary = roots.reduce(
      (best, a) => (score(a) > score(best) ? a : best),
      roots[0],
    );
    const rows = [...members.values()];
    const counts: AssetGroup["counts"] = {
      model: 0,
      image: 0,
      animation: 0,
      material: 0,
      other: 0,
    };
    for (const a of rows) {
      if (
        a.category === "animation" ||
        (a.metadata.animationModel && a.path !== a.metadata.animationModel)
      )
        counts.animation++;
      else if (a.metadata.materialSet || a.capabilities.preview === "material")
        counts.material++;
      else if (a.capabilities.preview === "model") counts.model++;
      else if (a.capabilities.preview === "image") counts.image++;
      else counts.other++;
    }
    groups.push({
      id: key,
      title:
        mode === "package"
          ? (manifests.get(primary.revisionId)?.name ??
            primary.source?.assetId ??
            primary.title)
          : (primary.metadata.assetGroup?.name ?? primary.title),
      primary,
      assetIds: [...members.keys()],
      counts,
      entityCategories: [
        ...new Set(rows.map((a) => a.metadata.entityCategory).filter(Boolean)),
      ] as EntityCategory[],
      gameplayTags: [
        ...new Set(rows.flatMap((a) => a.metadata.gameplayTags ?? [])),
      ] as GameplayTag[],
      reasons: [...reasons],
      missing: rows.reduce((n, a) => n + (a.metadata.missing?.length ?? 0), 0),
    });
  }
  // Old libraries can contain dependency markers without a surviving owner. Keep them selectable.
  const owned = new Set(groups.flatMap((g) => g.assetIds));
  for (const a of assets) {
    if (owned.has(a.id)) continue;
    const counts: AssetGroup["counts"] = {
      model: 0,
      image: 0,
      animation: 0,
      material: 0,
      other: 0,
    };
    if (a.category === "animation") counts.animation = 1;
    else if (a.metadata.materialSet || a.capabilities.preview === "material")
      counts.material = 1;
    else if (a.capabilities.preview === "model") counts.model = 1;
    else if (a.capabilities.preview === "image") counts.image = 1;
    else counts.other = 1;
    groups.push({
      id: `orphan:${a.id}`,
      title: a.title,
      primary: a,
      assetIds: [a.id],
      counts,
      entityCategories: a.metadata.entityCategory
        ? [a.metadata.entityCategory]
        : [],
      gameplayTags: a.metadata.gameplayTags ?? [],
      reasons: ["未关联到其他实体的素材"],
      missing: a.metadata.missing?.length ?? 0,
    });
  }
  return groups;
}
