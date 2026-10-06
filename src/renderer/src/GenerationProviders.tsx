import { useState } from "react";
import { Plus, Save, Trash2, Upload, Link, Check } from "lucide-react";
import { ClientButton } from "./client-ui";
import { Field, Modal } from "./components";
import { call, report, useStore } from "./store";
import {
  capabilitiesFor,
  type GenerationProviderConfig,
  type GenerationProviderKind,
  type WorkflowBinding,
  type WorkflowRole,
} from "../../shared/generation";

const roleNames: Record<WorkflowRole, string> = {
  prompt: "主提示词",
  negativePrompt: "反向提示词",
  reference: "参考图片",
  mask: "蒙版",
  width: "宽度",
  height: "高度",
  seed: "种子",
  steps: "步数",
  cfg: "CFG",
  custom: "自定义参数",
};
export function suggestBindings(
  graph: NonNullable<GenerationProviderConfig["workflowJSON"]>,
) {
  let textCount = 0;
  const bindings: WorkflowBinding[] = [];
  for (const [nodeId, node] of Object.entries(graph))
    for (const [fieldName, value] of Object.entries(node.inputs ?? {})) {
      if (!["string", "number", "boolean"].includes(typeof value)) continue;
      let role: WorkflowRole = "custom";
      if (fieldName === "text" && /textencode/i.test(node.class_type))
        role =
          /negative|反向/i.test(node._meta?.title ?? "") || textCount++ > 0
            ? "negativePrompt"
            : "prompt";
      else if (["width", "height", "seed", "steps", "cfg"].includes(fieldName))
        role = fieldName as WorkflowRole;
      else if (fieldName === "image" && /loadimage/i.test(node.class_type))
        role = "reference";
      else if (fieldName === "mask") role = "mask";
      bindings.push({
        nodeId,
        fieldName,
        role,
        label: `${node._meta?.title ?? node.class_type} · ${fieldName}`,
      });
    }
  return bindings;
}
function fresh(
  kind: GenerationProviderKind = "openai",
): GenerationProviderConfig {
  return {
    id: crypto.randomUUID(),
    name:
      kind === "openai"
        ? "云端图像 API"
        : kind === "runninghub"
          ? "RunningHub 工作流"
          : "Codex",
    kind,
    enabled: true,
    endpoint:
      kind === "openai"
        ? "https://api.openai.com/v1"
        : kind === "runninghub"
          ? "https://www.runninghub.cn"
          : undefined,
    models: kind === "openai" ? ["gpt-image-2.5-sunburst"] : [],
    bindings: [],
    capabilities: capabilitiesFor(kind),
  };
}
export function GenerationProviders({
  providers,
  onChange,
  onClose,
}: {
  providers: GenerationProviderConfig[];
  onChange: (rows: GenerationProviderConfig[]) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<GenerationProviderConfig>(
      providers[0] ?? fresh(),
    ),
    [key, setKey] = useState(""),
    [modelText, setModelText] = useState(
      (providers[0]?.models ?? []).join("\n"),
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const update = (patch: Partial<GenerationProviderConfig>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setMessage("");
  };
  function choose(p: GenerationProviderConfig) {
    setDraft(structuredClone(p));
    setModelText(p.models.join("\n"));
    setKey("");
    setMessage("");
  }
  async function save() {
    const rows = await call<GenerationProviderConfig[]>(
      "generation.providers.save",
      {
        config: {
          ...draft,
          models: modelText
            .split(/[\n,]/)
            .map((v) => v.trim())
            .filter(Boolean),
          workflowId: draft.workflowId || undefined,
          endpoint: draft.endpoint || undefined,
          executable: draft.executable || undefined,
        },
        key,
      },
    );
    onChange(rows);
    const p = rows.find((p) => p.id === draft.id)!;
    choose(p);
    return p;
  }
  async function perform(fn: () => Promise<void>) {
    try {
      setBusy(true);
      await fn();
    } catch (e) {
      setMessage((e as Error).message);
      report(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="模型与工作流连接" onClose={onClose} wide>
      <div className="gen-provider-layout">
        <aside className="gen-provider-list">
          {providers.map((p) => (
            <button
              key={p.id}
              className={draft.id === p.id ? "active" : ""}
              onClick={() => choose(p)}
            >
              <b>{p.name}</b>
              <small>
                {p.kind === "codex"
                  ? "本机 Codex · 云端推理"
                  : p.kind === "runninghub"
                    ? "RunningHub 云端工作流"
                    : "图像 API"}
                {!p.enabled ? " · 已停用" : ""}
              </small>
            </button>
          ))}
          <ClientButton onClick={() => choose(fresh())}>
            <Plus size={16} />
            添加连接
          </ClientButton>
        </aside>
        <div className="gen-provider-form">
          <div className="form-grid">
            <Field label="连接名称">
              <input
                value={draft.name}
                onChange={(e) => update({ name: e.target.value })}
              />
            </Field>
            <Field label="连接类型">
              <select
                value={draft.kind}
                onChange={(e) => {
                  const kind = e.target.value as GenerationProviderKind;
                  const next = { ...fresh(kind), id: draft.id };
                  choose(next);
                }}
              >
                <option value="codex">Codex</option>
                <option value="openai">OpenAI / 兼容图像 API</option>
                <option value="runninghub">RunningHub 工作流</option>
              </select>
            </Field>
          </div>
          <label className="gen-check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => update({ enabled: e.target.checked })}
            />
            启用此连接
          </label>
          {draft.kind === "runninghub" && (
            <Field label="工作流加工用途">
              <div className="gen-options">
                {(
                  [
                    ["edit", "局部修改"],
                    ["recolor", "语义改色"],
                    ["removeBackground", "去背景"],
                    ["restore", "修复与增强"],
                    ["upscale", "超分"],
                  ] as const
                ).map(([purpose, label]) => (
                  <label className="gen-check" key={purpose}>
                    <input
                      type="checkbox"
                      checked={draft.purposes?.includes(purpose) ?? false}
                      onChange={(e) =>
                        update({
                          purposes: e.target.checked
                            ? [...new Set([...(draft.purposes ?? []), purpose])]
                            : draft.purposes?.filter((p) => p !== purpose),
                        })
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </Field>
          )}
          {draft.kind === "codex" ? (
            <>
              <p>
                使用本机 Codex
                已保存的登录。制作助手只编写方案；直接生图使用内置图片工具。
              </p>
              <Field label="Codex 程序">
                <div className="gen-inline">
                  <input
                    value={draft.executable ?? ""}
                    readOnly
                    placeholder="自动查找 codex"
                  />
                  <ClientButton
                    onClick={() =>
                      void perform(async () => {
                        const files = await window.workshop.choose({
                          kind: "executable",
                          title: "选择 codex.exe",
                        });
                        if (files[0]) update({ executable: files[0] });
                      })
                    }
                  >
                    选择程序
                  </ClientButton>
                </div>
              </Field>
            </>
          ) : (
            <>
              <Field label="服务地址">
                <input
                  value={draft.endpoint ?? ""}
                  onChange={(e) => update({ endpoint: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </Field>
              <Field label="API 密钥">
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    draft.hasKey
                      ? "已加密保存；同一服务留空保留"
                      : "密钥仅在本机加密保存"
                  }
                />
              </Field>
              {draft.keyError && (
                <p role="alert" className="gen-help">
                  {draft.keyError}
                </p>
              )}
            </>
          )}
          {draft.kind !== "runninghub" && (
            <Field
              label={
                draft.kind === "codex"
                  ? "Codex 模型 ID（留空使用默认）"
                  : "图像模型 ID（每行一个）"
              }
            >
              <textarea
                rows={2}
                value={modelText}
                onChange={(e) => setModelText(e.target.value)}
              />
            </Field>
          )}
          {draft.kind === "openai" && (
            <>
              <p className="gen-help">
                兼容服务请按文档勾选能力。连接检查只验证认证与模型列表，具体图像参数在实际调用时验证。
              </p>
              <div className="gen-capabilities">
                {(
                  [
                    "references",
                    "mask",
                    "transparent",
                    "quality",
                    "seed",
                    "negativePrompt",
                  ] as const
                ).map((k) => (
                  <label className="gen-check" key={k}>
                    <input
                      type="checkbox"
                      checked={draft.capabilities[k]}
                      onChange={(e) =>
                        update({
                          capabilities: {
                            ...draft.capabilities,
                            [k]: e.target.checked,
                          },
                        })
                      }
                    />
                    {
                      {
                        references: "参考图",
                        mask: "蒙版编辑",
                        transparent: "透明背景",
                        quality: "质量参数",
                        seed: "种子",
                        negativePrompt: "独立反向提示词",
                      }[k]
                    }
                  </label>
                ))}
              </div>
            </>
          )}
          {draft.kind === "runninghub" && (
            <>
              <Field label="工作流 ID 或链接">
                <input
                  value={draft.workflowId ?? ""}
                  onChange={(e) => update({ workflowId: e.target.value })}
                  placeholder="粘贴 RunningHub 工作流链接或 ID"
                />
              </Field>
              <div className="gen-inline">
                <ClientButton
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      await save();
                      const graph = await call<
                        NonNullable<GenerationProviderConfig["workflowJSON"]>
                      >("generation.providers.workflow", { id: draft.id });
                      update({
                        workflowJSON: graph,
                        bindings: suggestBindings(graph),
                      });
                      setMessage("工作流已读取，请检查映射后保存");
                    })
                  }
                >
                  <Link size={16} />
                  从平台读取
                </ClientButton>
                <ClientButton
                  disabled={busy}
                  onClick={() =>
                    void perform(async () => {
                      const files = await window.workshop.choose({
                        kind: "files",
                        title: "选择导出的工作流 API JSON",
                      });
                      if (files[0]) {
                        const graph = await call<
                          NonNullable<GenerationProviderConfig["workflowJSON"]>
                        >("generation.workflow.read", { filePath: files[0] });
                        update({
                          workflowJSON: graph,
                          bindings: suggestBindings(graph),
                        });
                        setMessage("已导入 API JSON，请检查映射后保存");
                      }
                    })
                  }
                >
                  <Upload size={16} />
                  导入 API JSON
                </ClientButton>
              </div>
              <p className="gen-help">
                选择工作流中对应的主提示词、参考图和蒙版字段。建议映射种子以便保存实际参数。每次调用可能返回多张图片。
              </p>
              {!!draft.bindings.length && (
                <div className="gen-mappings">
                  {draft.bindings.map((b, i) => (
                    <div key={`${b.nodeId}.${b.fieldName}`}>
                      <span title={b.label}>
                        {b.nodeId} · {b.fieldName}
                        <small>{b.label}</small>
                      </span>
                      <select
                        aria-label={`映射 ${b.nodeId}.${b.fieldName}`}
                        value={b.role}
                        onChange={(e) =>
                          update({
                            bindings: draft.bindings.map((item, n) =>
                              n === i
                                ? {
                                    ...item,
                                    role: e.target.value as WorkflowRole,
                                  }
                                : item,
                            ),
                          })
                        }
                      >
                        {Object.entries(roleNames).map(([role, name]) => (
                          <option key={role} value={role}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          <div className="form-grid">
            <Field label="每次调用估算费用（可选）">
              <input
                type="number"
                min="0"
                step="0.01"
                value={draft.unitPrice ?? ""}
                onChange={(e) =>
                  update({
                    unitPrice:
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                  })
                }
              />
            </Field>
            <Field label="估算币种">
              <select
                value={draft.currency ?? ""}
                onChange={(e) =>
                  update({
                    currency: (e.target.value ||
                      undefined) as GenerationProviderConfig["currency"],
                  })
                }
              >
                <option value="">未配置</option>
                <option value="CNY">人民币 CNY</option>
                <option value="USD">美元 USD</option>
              </select>
            </Field>
          </div>
          {message && (
            <p className="gen-connection-message" role="status">
              {message}
            </p>
          )}
          <div className="modal-actions">
            <ClientButton
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await save();
                  setMessage("连接配置已保存，密钥已加密");
                })
              }
            >
              <Save size={16} />
              保存连接
            </ClientButton>
            <ClientButton
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const p = await save();
                  const check = await call<{ message: string }>(
                    "generation.providers.test",
                    { id: p.id },
                  );
                  setMessage(check.message);
                })
              }
            >
              <Check size={16} />
              检查连接
            </ClientButton>
            {providers.some((p) => p.id === draft.id) && (
              <ClientButton
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const rows = await call<GenerationProviderConfig[]>(
                      "generation.providers.delete",
                      { id: draft.id },
                    );
                    onChange(rows);
                    choose(rows[0] ?? fresh());
                    useStore.getState().notify("连接已移除");
                  })
                }
              >
                <Trash2 size={16} />
                移除连接
              </ClientButton>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
