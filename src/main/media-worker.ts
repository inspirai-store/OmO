import { inspectMedia } from "../core/media";
process.on("message", async (input: any) => {
  try {
    process.send?.(await inspectMedia(input.filename, input.file, input.cache));
  } catch (error: any) {
    process.send?.({ metadata: { previewError: error.message } });
  }
});
process.on("disconnect", () => process.exit(0));
