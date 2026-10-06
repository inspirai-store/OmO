import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
try {
  const root = path.resolve(path.dirname(require.resolve("three")), "..");
  await mkdir("src/renderer/public/decoders", { recursive: true });
  for (const name of ["draco", "basis"])
    await cp(
      path.join(root, "examples/jsm/libs", name),
      path.join("src/renderer/public/decoders", name),
      { recursive: true },
    );
} catch (e) {
  // The script also runs on the initial, dependency-free bootstrap.
  if (e.code !== "MODULE_NOT_FOUND") throw e;
}
