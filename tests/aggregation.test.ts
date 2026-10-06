import { beforeEach, afterEach, test, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { Runtime } from "../src/core/runtime";
import {
  inspectImport,
  runImport,
  type JobContext,
} from "../src/core/importer";
import { inspectExport, runExport } from "../src/core/exporter";
import { uid } from "../src/core/files";
import { inferEntity } from "../src/shared/entities";
import type { AssetGroupPage, Asset } from "../src/shared/types";

let base: string, rt: Runtime;
const ctx = (): JobContext => ({
  job: {
    id: uid(),
    type: "test",
    title: "",
    status: "running",
    stage: "",
    progress: 0,
    done: 0,
    total: 1,
    request: {},
    createdAt: "",
    updatedAt: "",
  },
  check: async () => {},
  progress: () => {},
  event: () => {},
});
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "workshop-aggregation-"));
  rt = await new Runtime(path.join(base, "library")).init();
});
afterEach(async () => {
  await rt.shutdown();
  if (
    !path
      .resolve(base)
      .startsWith(path.join(os.tmpdir(), "workshop-aggregation-"))
  )
    throw new Error("Unexpected test directory");
  await fs.rm(base, { recursive: true, force: true });
});
async function fixture(
  name = "entities",
): Promise<{ source: string; rows: Asset[] }> {
  const source = path.join(base, name);
  await fs.mkdir(source, { recursive: true });
  const png = await sharp({
    create: { width: 8, height: 8, channels: 4, background: "#936b42" },
  })
    .png()
    .toBuffer();
  for (const file of [
    "shared.png",
    "door_closed.png",
    "door_open.png",
    "sword_icon.png",
  ])
    await fs.writeFile(path.join(source, file), png);
  for (const file of ["guard.gltf", "goblin.gltf"])
    await fs.writeFile(
      path.join(source, file),
      JSON.stringify({
        asset: { version: "2.0" },
        images: [{ uri: "shared.png" }],
      }),
    );
  const result = await runImport(
    rt.catalog,
    await inspectImport([source]),
    ctx(),
  );
  await rt.changed();
  return {
    source,
    rows: result.assets.map((id: string) => rt.catalog.get(id)),
  };
}
const groups = (query = {}, mode = "entity") =>
  rt.handle("assets.groups", { query, mode }) as Promise<AssetGroupPage>;

test("Godot grouped delivery prefers matching glTF and retains distinct animations", async () => {
  const { source } = await fixture();
  await fs.writeFile(
    path.join(source, "guard.obj"),
    "o guard\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n",
  );
  await fs.copyFile(
    path.join(source, "guard.gltf"),
    path.join(source, "guard_walk.gltf"),
  );
  const result = await runImport(
    rt.catalog,
    await inspectImport([source]),
    ctx(),
  );
  const rows: Asset[] = result.assets.map((id: string) => rt.catalog.get(id));
  const ids = rows.filter((a) => a.path.startsWith("guard")).map((a) => a.id);
  const request = {
    assetIds: ids,
    target: path.join(base, "game"),
    mode: "godot" as const,
    aggregate: true,
  };
  const preferred = inspectExport(rt.catalog, request);
  expect(preferred.assets.map((a) => a.path)).toEqual(
    expect.arrayContaining(["guard.gltf", "guard_walk.gltf"]),
  );
  expect(preferred.assets.some((a) => a.extension === ".obj")).toBe(false);
  expect(
    inspectExport(rt.catalog, { ...request, preferGLTF: false }).assets,
  ).toHaveLength(3);
  expect(
    inspectExport(rt.catalog, { ...request, mode: "generic" }).assets,
  ).toHaveLength(3);
});
test("entity categories stay independent of file categories and broad pack tags", () => {
  expect(
    inferEntity({
      path: "tree_default.glb",
      category: "model",
      tags: ["farm", "角色"],
    }).category,
  ).toBe("nature");
  expect(
    inferEntity({ path: "swordGold.png", category: "sprite", tags: [] })
      .category,
  ).toBe("equipment");
  expect(
    inferEntity({ path: "button_pressed.png", category: "ui", tags: [] })
      .category,
  ).toBeNull();
  expect(
    inferEntity({ path: "goblin.gltf", category: "model", tags: [] })
      .gameplayTags,
  ).toContain("combat");
});
test("shared dependencies do not merge entities; filtering returns complete groups", async () => {
  const { rows } = await fixture();
  const page = await groups();
  const guard = page.items.find((g) => g.primary.title === "guard")!,
    goblin = page.items.find((g) => g.primary.title === "goblin")!;
  const shared = rows.find((a) => a.path === "shared.png")!;
  expect(guard.id).not.toBe(goblin.id);
  expect(guard.assetIds).toContain(shared.id);
  expect(goblin.assetIds).toContain(shared.id);
  const doors = page.items.filter((g) => g.primary.path.startsWith("door"));
  expect(doors).toHaveLength(1);
  expect(doors[0].assetIds).toHaveLength(2);
  const filtered = await groups({ search: "door_open", extension: "png" });
  expect(filtered.total).toBe(1);
  expect(filtered.items[0].assetIds).toHaveLength(2);
  expect(
    (await rt.handle("assets.query", { entityCategory: "enemy" })).items.some(
      (a: Asset) => a.path === "goblin.gltf",
    ),
  ).toBe(true);
  expect(
    (await rt.handle("assets.query", { gameplayTag: "combat" })).total,
  ).toBeGreaterThan(0);
  expect((await groups({}, "package")).total).toBe(1);
});
test("manual grouping is atomic, survives export/import, and does not join the original library group", async () => {
  const { rows } = await fixture();
  const ids = rows
    .filter((a) => ["guard.gltf", "sword_icon.png"].includes(a.path))
    .map((a) => a.id);
  await expect(
    rt.handle("assets.organize", {
      ids: [...ids, "missing"],
      group: { name: "bad" },
    }),
  ).rejects.toThrow();
  expect(rt.catalog.get(ids[0]).metadata.assetGroup).toBeUndefined();
  await rt.handle("assets.organize", {
    ids,
    entityCategory: "character",
    gameplayTags: ["combat", "equipment"],
    group: { name: "守卫整套" },
  });
  const manual = (await groups()).items.find((g) => g.title === "守卫整套")!;
  expect(manual.assetIds.length).toBeGreaterThanOrEqual(3);
  const plan = inspectExport(rt.catalog, {
    assetIds: manual.assetIds,
    target: path.join(base, "output"),
    mode: "generic",
    aggregate: true,
  });
  expect(plan.issues).toEqual([]);
  const exported = await runExport(rt.catalog, plan, ctx());
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(exported.target, "workshop-manifest.json"),
      "utf8",
    ),
  );
  expect(new Set(manifest.files.map((f: any) => f.path)).size).toBe(
    manifest.files.length,
  );
  expect(
    new Set(manifest.entries.map((e: any) => e.entry.split("/")[0])).size,
  ).toBe(1);
  const imported = await runImport(
    rt.catalog,
    await inspectImport([exported.target]),
    ctx(),
  );
  await rt.changed();
  const copy: Asset[] = imported.assets
    .map((id: string) => rt.catalog.get(id))
    .filter((a: Asset) => a.metadata.assetGroup?.name === "守卫整套");
  expect(copy).toHaveLength(2);
  expect(copy[0].metadata.entityCategory).toBe("character");
  expect(copy[0].metadata.gameplayTags).toContain("combat");
  expect(copy[0].metadata.assetGroup.id).not.toBe(
    rt.catalog.get(ids[0]).metadata.assetGroup.id,
  );
  expect(
    (await groups()).items.filter((g) => g.title === "守卫整套"),
  ).toHaveLength(2);
});
test("state links aggregate arbitrary filenames and whole group selection spans pages", async () => {
  const { rows } = await fixture();
  const pair = rows.filter((a) =>
    ["door_closed.png", "sword_icon.png"].includes(a.path),
  );
  rt.catalog.update(
    pair.map((a) => a.id),
    {
      metadata: { stateGroup: pair.map((a) => ({ id: a.id, label: a.title })) },
    },
  );
  await rt.changed();
  const linked = (await groups()).items.find((g) =>
    g.assetIds.includes(pair[1].id),
  )!;
  expect(linked.assetIds).toContain(pair[0].id);
  const first = await groups({ limit: 1 });
  const second = await groups({ offset: 1, limit: 1 });
  expect(first.items[0].id).not.toBe(second.items[0].id);
  const selected = await rt.handle("assets.groupSelection", {
    query: { limit: 1 },
    mode: "entity",
  });
  expect(selected.count).toBe((await groups()).assetTotal);
  expect(selected.ids).toContain(pair[0].id);
  expect(selected.ids).toContain(pair[1].id);
});
test("versions remain separate and auxiliary images are not independent group members", async () => {
  const { rows, source } = await fixture();
  const old = rows.find((a) => a.path === "guard.gltf")!;
  await fs.writeFile(
    path.join(source, "new_coin.png"),
    await fs.readFile(path.join(source, "shared.png")),
  );
  const plan = await inspectImport([source]);
  plan.parentAssetId = old.id;
  const result = await runImport(rt.catalog, plan, ctx());
  await rt.changed();
  expect(
    (await groups()).items.filter((g) => g.primary.title === "guard"),
  ).toHaveLength(2);
  const icon: Asset = result.assets
    .map((id: string) => rt.catalog.get(id))
    .find((a: Asset) => a.path === "sword_icon.png")!;
  await rt.handle("assets.organize", {
    ids: [icon.id],
    auxiliaryRole: "preview",
  });
  expect(
    (await groups()).items.every((g) => !g.assetIds.includes(icon.id)),
  ).toBe(true);
});
