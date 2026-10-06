import path from "node:path";
import fs from "node:fs/promises";
import { atomicJSON, readJSON } from "./files";
import { providerSchema } from "./generation-schemas";
import {
  capabilitiesFor,
  type GenerationProviderConfig,
} from "../shared/generation";

export interface GenerationAccess {
  providers: GenerationProviderConfig[];
  keys: Record<string, string>;
}
async function detectCodexExecutable() {
  const local = process.env.LOCALAPPDATA;
  if (local) {
    const bundled = path.join(local, "OpenAI", "Codex", "bin");
    const dirs = await fs.readdir(bundled).catch(() => []);
    const candidates = await Promise.all(
      dirs.map(async (d) => {
        const file = path.join(bundled, d, "codex.exe");
        const s = await fs.stat(file).catch(() => null);
        return { file, time: s?.mtimeMs ?? 0 };
      }),
    );
    candidates.sort((a, b) => b.time - a.time);
    if (candidates[0]?.time) return candidates[0].file;
    const standalone = path.join(
      local,
      "Programs",
      "OpenAI",
      "Codex",
      "bin",
      "codex.exe",
    );
    if (await fs.stat(standalone).catch(() => null)) return standalone;
  }
  return undefined;
}
export class GenerationProviderStore {
  private rows: { config: GenerationProviderConfig; encryptedKey?: string }[] =
    [];
  private writes: Promise<void> = Promise.resolve();
  private keyErrors = new Map<string, string>();
  constructor(
    private directory: string,
    private encrypt: (v: string) => string,
    private decrypt: (v: string) => string,
  ) {}
  async init() {
    const data = await readJSON<any>(
      path.join(this.directory, "generation-providers.json"),
      { providers: [] },
    );
    this.rows = data.providers.map((r: any) => ({
      config: providerSchema.parse(r.config),
      encryptedKey: r.encryptedKey,
    }));
    for (const row of this.rows.filter((r) => r.config.kind === "codex")) {
      if (
        row.config.executable &&
        !(await fs.stat(row.config.executable).catch(() => null))
      ) {
        const detected = await detectCodexExecutable();
        if (detected) row.config.executable = detected;
      }
    }
    if (!this.rows.some((r) => r.config.kind === "codex"))
      this.rows.unshift({
        config: {
          id: "codex-default",
          name: "Codex 内置生图",
          kind: "codex",
          enabled: true,
          models: [],
          executable: await detectCodexExecutable(),
          bindings: [],
          capabilities: capabilitiesFor("codex"),
        },
      });
    return this;
  }
  list() {
    return this.rows.map((r) => ({
      ...r.config,
      hasKey: !!r.encryptedKey && !this.keyErrors.has(r.config.id),
      ...(this.keyErrors.has(r.config.id)
        ? { keyError: this.keyErrors.get(r.config.id) }
        : {}),
    }));
  }
  access(): GenerationAccess {
    const keys: Record<string, string> = {};
    for (const row of this.rows.filter((r) => r.encryptedKey)) {
      try {
        keys[row.config.id] = this.decrypt(row.encryptedKey!);
        this.keyErrors.delete(row.config.id);
      } catch {
        this.keyErrors.set(
          row.config.id,
          "保存的密钥无法在当前程序解密，请在连接设置中重新保存密钥。原有加密记录已保留。",
        );
      }
    }
    return {
      providers: this.list(),
      keys,
    };
  }
  async save(input: unknown, key?: string) {
    const config = providerSchema.parse(input);
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        const old = this.rows.find((r) => r.config.id === config.id);
        const sameService =
          old?.config.kind === config.kind &&
          old.config.endpoint === config.endpoint;
        const row = {
          config,
          encryptedKey:
            key === undefined || key === ""
              ? sameService
                ? old?.encryptedKey
                : undefined
              : this.encrypt(key),
        };
        const next = [
          ...this.rows.filter((r) => r.config.id !== config.id),
          row,
        ];
        await atomicJSON(
          path.join(this.directory, "generation-providers.json"),
          { schemaVersion: 1, providers: next },
        );
        this.rows = next;
        if (key) this.keyErrors.delete(config.id);
      });
    await this.writes;
    return this.list().find((p) => p.id === config.id)!;
  }
  async remove(id: string) {
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        const next = this.rows.filter((r) => r.config.id !== id);
        await atomicJSON(
          path.join(this.directory, "generation-providers.json"),
          { schemaVersion: 1, providers: next },
        );
        this.rows = next;
      });
    await this.writes;
  }
}
