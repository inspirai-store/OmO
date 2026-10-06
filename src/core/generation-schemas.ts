import { z } from "zod";
import { capabilitiesFor } from "../shared/generation";

export const generationId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const capabilitiesSchema = z.object({
  references: z.boolean(),
  maxReferences: z.number().int().min(0).max(16),
  mask: z.boolean(),
  seed: z.boolean(),
  negativePrompt: z.boolean(),
  transparent: z.boolean(),
  quality: z.boolean(),
  cancelRemote: z.boolean(),
});
export function assertNoSecrets(value: unknown) {
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value)) {
    if (
      /(?:^|[_-])(?:api[_-]?key|authorization|access[_-]?token|secret|password)(?:$|[_-])/i.test(
        key,
      ) &&
      entry
    )
      throw new Error("工作流或参数包含密钥字段，请先移除密钥，再导入");
    assertNoSecrets(entry);
  }
}
export function normalizeWorkflowId(value: string) {
  const match = value
    .trim()
    .match(
      /^(\d{1,30})$|^https:\/\/(?:www\.)?runninghub\.(?:cn|ai)\/(?:workflow|workflow-detail|ai-detail)\/(\d{1,30})(?:[/?#].*)?$/,
    );
  if (!match) throw new Error("请填写 RunningHub 工作流 ID 或工作流链接");
  return match[1] ?? match[2];
}
export function validateEndpoint(value: string) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error(
      "服务地址须使用 HTTPS；本机代理可使用 HTTP，地址中不能包含密钥",
    );
  return value.replace(/\/+$/, "");
}
export const providerSchema = z
  .object({
    id: generationId,
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["codex", "openai", "runninghub"]),
    enabled: z.boolean().default(true),
    purposes: z
      .array(
        z.enum(["edit", "recolor", "removeBackground", "restore", "upscale"]),
      )
      .max(5)
      .optional(),
    endpoint: z.string().transform(validateEndpoint).optional(),
    models: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    executable: z.string().max(2000).optional(),
    workflowId: z.string().transform(normalizeWorkflowId).optional(),
    workflowJSON: z
      .record(
        z.string(),
        z.object({
          class_type: z.string(),
          inputs: z.record(z.string(), z.unknown()),
          _meta: z.object({ title: z.string().optional() }).optional(),
        }),
      )
      .optional(),
    bindings: z
      .array(
        z.object({
          nodeId: z.string().max(100),
          fieldName: z.string().max(100),
          role: z.enum([
            "prompt",
            "negativePrompt",
            "reference",
            "mask",
            "width",
            "height",
            "seed",
            "steps",
            "cfg",
            "custom",
          ]),
          label: z.string().max(100).optional(),
        }),
      )
      .max(300)
      .default([]),
    capabilities: capabilitiesSchema.optional(),
    unitPrice: z.number().min(0).max(100000).optional(),
    currency: z.enum(["CNY", "USD"]).optional(),
  })
  .transform((p) => {
    assertNoSecrets(p.workflowJSON);
    if (
      p.workflowJSON &&
      JSON.stringify(p.workflowJSON).length > 2 * 1024 * 1024
    )
      throw new Error("工作流 API JSON 不得超过 2 MiB");
    if (p.kind !== "codex" && !p.endpoint) throw new Error("请填写服务地址");
    if (p.kind === "runninghub") {
      const roles = new Set(p.bindings.map((b) => b.role));
      p.capabilities = {
        ...capabilitiesFor(p.kind),
        references: roles.has("reference"),
        maxReferences: Math.min(
          16,
          p.bindings.filter((b) => b.role === "reference").length,
        ),
        mask: roles.has("mask") && roles.has("reference"),
        seed: roles.has("seed"),
        negativePrompt: roles.has("negativePrompt"),
      };
      for (const binding of p.bindings) {
        if (
          p.workflowJSON &&
          !(binding.fieldName in (p.workflowJSON[binding.nodeId]?.inputs ?? {}))
        )
          throw new Error("参数映射没有对应的工作流字段");
      }
    }
    if (p.kind === "codex") p.capabilities = capabilitiesFor(p.kind);
    if (p.kind === "openai" && p.capabilities)
      p.capabilities.cancelRemote = false;
    return { ...p, capabilities: p.capabilities ?? capabilitiesFor(p.kind) };
  });
export const generationRequestSchema = z.object({
  providerId: generationId,
  model: z.string().max(200).default(""),
  prompt: z.string().trim().min(1).max(32000),
  negativePrompt: z.string().max(16000).optional(),
  referenceIds: z.array(generationId).max(16).default([]),
  maskId: generationId.optional(),
  width: z.number().int().min(128).max(4096),
  height: z.number().int().min(128).max(4096),
  count: z.number().int().min(1).max(20),
  seed: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER - 20)
    .optional(),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  transparent: z.boolean().optional(),
  steps: z.number().int().min(1).max(200).optional(),
  cfg: z.number().min(0).max(100).optional(),
  workflowValues: z
    .record(
      z.string().max(250),
      z.union([z.string().max(32000), z.number().finite(), z.boolean()]),
    )
    .optional(),
  category: z
    .enum([
      "concept",
      "ui",
      "controls",
      "sprite",
      "texture",
      "model",
      "animation",
      "environment",
      "other",
    ])
    .default("concept"),
  tags: z.array(z.string().max(100)).max(100).default([]),
  projectId: generationId.optional(),
  parentCandidateId: generationId.optional(),
});
