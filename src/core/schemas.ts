import { z } from "zod";
import { entityCategories, gameplayTags } from "../shared/entities";
export const entityCategorySchema = z.enum(
  Object.keys(entityCategories) as [
    keyof typeof entityCategories,
    ...(keyof typeof entityCategories)[],
  ],
);
export const gameplayTagSchema = z.enum(
  Object.keys(gameplayTags) as [
    keyof typeof gameplayTags,
    ...(keyof typeof gameplayTags)[],
  ],
);
const id = z.string().min(1).max(100);
export const categorySchema = z.enum([
  "concept",
  "ui",
  "controls",
  "skin",
  "sprite",
  "texture",
  "model",
  "animation",
  "environment",
  "other",
]);
export const querySchema = z.object({
  search: z.string().max(500).optional(),
  category: z.union([categorySchema, z.literal("")]).optional(),
  entityCategory: z.union([entityCategorySchema, z.literal("")]).optional(),
  gameplayTag: z.union([gameplayTagSchema, z.literal("")]).optional(),
  projectId: id.optional(),
  collectionId: id.optional(),
  favorite: z.boolean().optional(),
  trash: z.boolean().optional(),
  recent: z.boolean().optional(),
  unsorted: z.boolean().optional(),
  showRelated: z.boolean().optional(),
  includeAuxiliary: z.boolean().optional(),
  imageOnly: z.boolean().optional(),
  modelOnly: z.boolean().optional(),
  extension: z.string().max(20).optional(),
  license: z.string().max(100).optional(),
  minWidth: z.number().int().positive().optional(),
  maxTriangles: z.number().int().nonnegative().optional(),
  hasAnimation: z.boolean().optional(),
  missing: z.boolean().optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  sort: z.enum(["newest", "title", "viewed", "size"]).optional(),
});
export const organizeSchema = z.object({
  ids: z.array(id).min(1).max(100000),
  category: categorySchema.optional(),
  entityCategory: entityCategorySchema.nullable().optional(),
  gameplayTags: z.array(gameplayTagSchema).max(20).optional(),
  group: z
    .object({ name: z.string().trim().min(1).max(100) })
    .nullable()
    .optional(),
  tags: z.array(z.string().min(1).max(100)).max(200).optional(),
  replaceTags: z.boolean().optional(),
  title: z
    .object({
      value: z.string().min(1).max(200).optional(),
      prefix: z.string().max(100).optional(),
      suffix: z.string().max(100).optional(),
      find: z.string().max(200).optional(),
      replace: z.string().max(200).optional(),
      numbering: z.boolean().optional(),
      start: z.number().int().min(0).max(1000000).optional(),
    })
    .optional(),
  projectId: id.optional(),
  collectionId: id.optional(),
  auxiliaryRole: z.enum(["preview"]).nullable().optional(),
});
const binding = z.object({
  assetId: id,
  revisionId: id,
  channel: z.enum(["r", "g", "b", "a", "rgb"]),
  uv: z.union([z.literal(0), z.literal(1)]),
});
export const variantSchema = z.object({
  id: z.string().regex(/^$|^[a-z0-9-]{1,100}$/i),
  name: z.string().min(1).max(200),
  assetId: id,
  revisionId: id,
  materialIndex: z.number().int().min(0),
  bindings: z.partialRecord(
    z.enum(["baseColor", "normal", "roughness", "metallic", "ao", "emission"]),
    binding,
  ),
  textureFilter: z.enum(["linear", "nearest"]).default("linear"),
  baseColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  roughness: z.number().min(0).max(1),
  metallic: z.number().min(0).max(1),
  normalScale: z.number().min(0).max(5),
  normalConvention: z.enum(["gl", "dx"]),
  aoStrength: z.number().min(0).max(1),
  emission: z.string().regex(/^#[0-9a-f]{6}$/i),
  emissionStrength: z.number().min(0).max(20),
  alphaMode: z.enum(["OPAQUE", "MASK", "BLEND"]),
  alphaCutoff: z.number().min(0).max(1),
  doubleSided: z.boolean(),
  repeat: z.tuple([
    z.number().positive().max(100),
    z.number().positive().max(100),
  ]),
  offset: z.tuple([z.number(), z.number()]),
  rotation: z.number(),
  createdAt: z.string(),
});
