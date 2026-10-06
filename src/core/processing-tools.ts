import sharp from "sharp";
import { z } from "zod";
import type { ImageOperation } from "../shared/processing";
import { generationId, assertNoSecrets } from "./generation-schemas";

export const MAX_PROCESSING_PIXELS = 32 * 1024 * 1024;
const dimension = z.number().int().min(1).max(16384);
const color = z
  .string()
  .regex(/^(?:#[a-fA-F0-9]{6}(?:[a-fA-F0-9]{2})?|transparent)$/);
export const operationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("resize"),
    width: dimension,
    height: dimension,
    fit: z.enum(["contain", "cover", "fill"]).default("contain"),
    kernel: z.enum(["nearest", "lanczos3"]).default("lanczos3"),
  }),
  z.object({
    type: z.literal("crop"),
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    width: dimension,
    height: dimension,
  }),
  z.object({
    type: z.literal("rotate"),
    angle: z.union([z.literal(90), z.literal(180), z.literal(270)]),
  }),
  z.object({
    type: z.literal("flip"),
    axis: z.enum(["horizontal", "vertical"]),
  }),
  z.object({
    type: z.literal("trim"),
    threshold: z.number().min(0).max(255).default(10),
  }),
  z.object({
    type: z.literal("pad"),
    top: z.number().int().min(0).max(8192),
    right: z.number().int().min(0).max(8192),
    bottom: z.number().int().min(0).max(8192),
    left: z.number().int().min(0).max(8192),
    color: color.default("transparent"),
  }),
  z.object({
    type: z.literal("adjust"),
    brightness: z.number().min(0).max(4).default(1),
    contrast: z.number().min(0).max(4).default(1),
    saturation: z.number().min(0).max(4).default(1),
    hue: z.number().min(-360).max(360).default(0),
    tint: color.optional(),
  }),
  z.object({
    type: z.literal("sharpen"),
    sigma: z.number().min(0.3).max(10).default(1),
  }),
  z.object({
    type: z.literal("denoise"),
    size: z
      .number()
      .int()
      .min(1)
      .max(9)
      .refine((n) => n % 2 === 1)
      .default(3),
  }),
  z.object({
    type: z.literal("ai"),
    purpose: z.enum([
      "edit",
      "recolor",
      "removeBackground",
      "restore",
      "upscale",
    ]),
    providerId: generationId,
    model: z.string().max(200).default(""),
    prompt: z.string().trim().min(1).max(32000),
    width: z.number().int().min(128).max(4096),
    height: z.number().int().min(128).max(4096),
    maskId: generationId.optional(),
    maskInputHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    workflowValues: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional(),
  }),
]);
export const imageRefSchema = z.object({
  kind: z.enum(["asset", "candidate", "artifact", "input"]),
  id: generationId,
});
export function parseOperations(raw: unknown): ImageOperation[] {
  assertNoSecrets(raw);
  return z.array(operationSchema).min(1).max(20).parse(raw) as ImageOperation[];
}
export const processingTools = Object.freeze([
  { name: "image.inspect", description: "检查完整图片的尺寸、透明度及来源" },
  { name: "image.preview", description: "预览基础处理配方，不调用云端模型" },
  { name: "image.apply", description: "按已确认配方生成无损加工候选" },
  {
    name: "image.ai_edit",
    description: "在已确认的连接与调用上限内执行 AI 编辑",
  },
  {
    name: "image.compare",
    description: "检查结果尺寸和透明通道，并比较输入与结果",
  },
]);
// Both the editor and structured agent actions enter these same host tools.
// The host resolves IDs before dispatch; AI callbacks require an approved plan.
export async function executeProcessingTool(
  name: (typeof processingTools)[number]["name"],
  input: {
    bytes: Buffer;
    operation?: ImageOperation;
    operations?: ImageOperation[];
    result?: Buffer;
    approvedAI?: () => Promise<Buffer>;
  },
): Promise<any> {
  switch (name) {
    case "image.inspect": {
      const image = sharp(input.bytes, {
        limitInputPixels: MAX_PROCESSING_PIXELS,
      });
      const metadata = await image.metadata(),
        stats = await image.ensureAlpha().stats();
      return {
        width: metadata.width,
        height: metadata.height,
        alpha: { min: stats.channels[3].min, max: stats.channels[3].max },
        bytes: input.bytes.length,
      };
    }
    case "image.preview": {
      let bytes = input.bytes;
      for (const op of input.operations ?? [])
        bytes = await applyImageOperation(bytes, op);
      return bytes;
    }
    case "image.apply":
      return applyImageOperation(input.bytes, input.operation!);
    case "image.ai_edit":
      if (!input.approvedAI) throw new Error("AI 工具需要已确认的方案");
      return input.approvedAI();
    case "image.compare": {
      if (!input.result) throw new Error("缺少比较结果");
      const before = await executeProcessingTool("image.inspect", input);
      const after = await executeProcessingTool("image.inspect", {
        bytes: input.result,
      });
      const sameDimensions =
        before.width === after.width && before.height === after.height;
      let changedPixels: number | undefined;
      if (sameDimensions) {
        const a = await sharp(input.bytes).ensureAlpha().raw().toBuffer();
        const b = await sharp(input.result).ensureAlpha().raw().toBuffer();
        changedPixels = 0;
        for (let i = 0; i < a.length; i += 4)
          if (
            a[i] !== b[i] ||
            a[i + 1] !== b[i + 1] ||
            a[i + 2] !== b[i + 2] ||
            a[i + 3] !== b[i + 3]
          )
            changedPixels++;
      }
      return { before, after, sameDimensions, changedPixels };
    }
    default:
      throw new Error("未知加工工具");
  }
}
export function assertDimensions(width: number, height: number) {
  if (width < 1 || height < 1 || width * height > MAX_PROCESSING_PIXELS)
    throw new Error("处理结果超过 32 MP 或尺寸无效");
}
export async function applyImageOperation(
  input: Buffer,
  operation: ImageOperation,
) {
  const op = operationSchema.parse(operation) as ImageOperation;
  const info = await sharp(input, {
    limitInputPixels: MAX_PROCESSING_PIXELS,
  }).metadata();
  let image = sharp(input, { limitInputPixels: MAX_PROCESSING_PIXELS });
  const width = info.width!,
    height = info.height!;
  switch (op.type) {
    case "crop":
      if (op.x + op.width > width || op.y + op.height > height)
        throw new Error("裁剪区域超出完整图片");
      image = image.extract({
        left: op.x,
        top: op.y,
        width: op.width,
        height: op.height,
      });
      break;
    case "resize":
      assertDimensions(op.width, op.height);
      image = image.resize(op.width, op.height, {
        fit: op.fit,
        kernel: op.kernel,
        background: "transparent",
      });
      break;
    case "rotate":
      image = image.rotate(op.angle);
      break;
    case "flip":
      image = op.axis === "horizontal" ? image.flop() : image.flip();
      break;
    case "trim": {
      const rgba = await image.ensureAlpha().raw().toBuffer();
      let left = width,
        top = height,
        right = -1,
        bottom = -1;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (rgba[(y * width + x) * 4 + 3] > op.threshold) {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
      // Trim transparency only: solid backgrounds and uniform sprites stay intact.
      image =
        right < 0
          ? image.extract({ left: 0, top: 0, width: 1, height: 1 })
          : image.extract({
              left,
              top,
              width: right - left + 1,
              height: bottom - top + 1,
            });
      break;
    }
    case "pad":
      assertDimensions(width + op.left + op.right, height + op.top + op.bottom);
      image = image.extend({ ...op, background: op.color });
      break;
    case "adjust": {
      // Preserve alpha exactly, including partially transparent antialiased edges.
      const rgba = await image.ensureAlpha().raw().toBuffer();
      let rgb = sharp(input)
        .removeAlpha()
        .modulate({
          brightness: op.brightness,
          saturation: op.saturation,
          hue: op.hue,
        })
        .linear(op.contrast, 128 * (1 - op.contrast));
      if (op.tint) rgb = rgb.tint(op.tint);
      const processed = await rgb.raw().toBuffer();
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        rgba[i] = processed[j];
        rgba[i + 1] = processed[j + 1];
        rgba[i + 2] = processed[j + 2];
      }
      return sharp(rgba, { raw: { width, height, channels: 4 } })
        .png()
        .toBuffer();
    }
    case "sharpen":
      image = image.sharpen({ sigma: op.sigma });
      break;
    case "denoise":
      image = image.median(op.size);
      break;
    case "ai":
      throw new Error("AI 操作须通过已确认的后台任务执行");
  }
  const output = await image.png().toBuffer();
  const outInfo = await sharp(output).metadata();
  assertDimensions(outInfo.width!, outInfo.height!);
  return output;
}
export async function compositeMaskedEdit(
  original: Buffer,
  edited: Buffer,
  mask: Buffer,
) {
  const a = await sharp(original)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const b = await sharp(edited)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const m = await sharp(mask)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    [b.info, m.info].some(
      (i) => i.width !== a.info.width || i.height !== a.info.height,
    )
  )
    throw new Error("AI 返回尺寸与蒙版原图不匹配；原始候选已保留，未拉伸合成");
  for (let i = 0; i < a.data.length; i += 4) {
    const keep = m.data[i + 3] / 255;
    if (keep === 1) continue;
    for (let c = 0; c < 4; c++)
      a.data[i + c] = Math.round(
        a.data[i + c] * keep + b.data[i + c] * (1 - keep),
      );
  }
  return sharp(a.data, {
    raw: { width: a.info.width, height: a.info.height, channels: 4 },
  })
    .png()
    .toBuffer();
}
