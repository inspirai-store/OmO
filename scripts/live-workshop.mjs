// Drive the packaged client so live production shares the same scheduler and UI as normal use.
import { _electron as electron } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
export async function liveWorkshop(root) {
  const app = await electron.launch({
    executablePath: path.resolve(
      "release/family-client/win-unpacked/素材工坊.exe",
    ),
    env: { ...process.env, WORKSHOP_LIBRARY: root },
  });
  app.process().stderr?.on("data", (data) => process.stderr.write(data));
  console.log(
    "LIVE USER DATA:",
    await app.evaluate(({ app }) => app.getPath("userData")),
  );
  const page = await app.firstWindow();
  await page.waitForSelector(".asset-browser");
  const call = async (method, input = {}) => {
    if (method === "generation.files.resolve") {
      const db = new DatabaseSync(path.join(root, "catalog.sqlite"), {
        readOnly: true,
      });
      try {
        const table =
          input.kind === "candidate"
            ? "generation_candidates"
            : "generation_inputs";
        const row = db
          .prepare(`SELECT data FROM ${table} WHERE id=?`)
          .get(input.id);
        if (!row) throw new Error("Missing generation file");
        const file = path.resolve(root, JSON.parse(row.data).relativePath),
          rel = path.relative(root, file);
        if (rel.startsWith("..") || path.isAbsolute(rel))
          throw new Error("Invalid file path");
        return file;
      } finally {
        db.close();
      }
    }
    return page.evaluate(
      ({ method, input }) => window.workshop.call(method, input),
      { method, input },
    );
  };
  await page.getByRole("button", { name: "同类素材", exact: true }).click();
  return { call, close: () => app.close(), page };
}
