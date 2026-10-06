import { useEffect, useRef, useState } from "react";
import { Layers, Plus, Upload, Check, ImagePlus, Download } from "lucide-react";
import { ClientButton } from "./client-ui";
import { Field, Modal } from "./components";
import { SectionTitle } from "./ui-kit";
import { call, report, useStore } from "./store";
import type { Project, ExportPlan } from "../../shared/types";
import { categories } from "../../shared/types";
import type {
  GenerationCandidate,
  GenerationProviderConfig,
  GenerationReference,
  GenerationRequest,
} from "../../shared/generation";
import { generationPresets } from "../../shared/generation";
import type {
  AssetFamilyBatch,
  AssetFamilyRow,
  AssetFamilyTemplate,
  FamilyDetail,
  FamilyPlan,
} from "../../shared/families";
import {
  familyIconOperations,
  zizhenIconRows,
  zizhenIconStyle,
} from "../../shared/families";
import "./families.css";

const blankRow = (): AssetFamilyRow => ({
  key: `item.asset_${Date.now()}`,
  name: "新素材",
  subject: "",
  accent: "",
  motif: "",
  count: 2,
  category: "ui",
});
const initial: GenerationRequest = {
  providerId: "codex-default",
  model: "",
  prompt: "",
  referenceIds: [],
  width: 1024,
  height: 1024,
  count: 1,
  transparent: true,
  quality: "auto",
  category: "ui",
  tags: [],
};
const labels: Record<string, string> = {
  queued: "等待",
  running: "执行中",
  completed: "已完成",
  failed: "部分失败",
  cancelled: "已停止",
  interrupted: "需续接",
};
export function FamilyPage({
  projects,
  source,
}: {
  projects: Project[];
  source: { assetId?: string; candidateId?: string };
}) {
  const [templates, setTemplates] = useState<AssetFamilyTemplate[]>([]),
    [batches, setBatches] = useState<AssetFamilyBatch[]>([]),
    [providers, setProviders] = useState<GenerationProviderConfig[]>([]);
  const [template, setTemplate] = useState<AssetFamilyTemplate>(),
    [templateParentId, setTemplateParentId] = useState<string>(),
    [name, setName] = useState("字阵山河 · 青绿铜金物件"),
    [style, setStyle] = useState(zizhenIconStyle),
    [base, setBase] = useState(initial),
    [refs, setRefs] = useState<GenerationReference[]>([]);
  const [rows, setRows] = useState<AssetFamilyRow[]>(
      structuredClone(zizhenIconRows),
    ),
    [projectId, setProjectId] = useState(
      useStore.getState().query.projectId ?? "",
    ),
    [detail, setDetail] = useState<FamilyDetail>(),
    [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<FamilyPlan>(),
    [exportPlan, setExportPlan] = useState<ExportPlan>(),
    [preview, setPreview] =
      useState<
        Pick<GenerationCandidate, "title" | "width" | "height" | "previewUrl">
      >(),
    [edit, setEdit] = useState<AssetFamilyRow>(),
    [continueRow, setContinueRow] = useState<string>(),
    [instruction, setInstruction] = useState(""),
    [review, setReview] = useState(false),
    [analysis, setAnalysis] = useState<any>();
  const jobs = useStore((s) => s.jobs),
    batch = detail?.batch,
    activeId = useRef<string | undefined>(undefined),
    pendingActions = useRef(0);
  const job = jobs.find((j) => j.id === batch?.jobId),
    running = !!job && ["queued", "running", "paused"].includes(job.status),
    locked = busy || running;
  async function refresh() {
    const [ts, bs] = await Promise.all([
      call<AssetFamilyTemplate[]>("families.templates.list"),
      call<AssetFamilyBatch[]>("families.batches.list"),
    ]);
    setTemplates(ts);
    setBatches(bs);
    const requested = activeId.current;
    if (requested) {
      const current = await call<FamilyDetail>("families.batches.detail", {
        id: requested,
      });
      if (activeId.current === requested) setDetail(current);
    }
  }
  async function action(fn: () => Promise<void>) {
    pendingActions.current++;
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      report(e);
    } finally {
      pendingActions.current--;
      setBusy(pendingActions.current > 0);
    }
  }
  useEffect(() => {
    void action(async () => {
      const ps = await call<GenerationProviderConfig[]>(
        "generation.providers.list",
      );
      setProviders(ps);
      const p =
        ps.find((p) => p.enabled && p.kind === "codex") ??
        ps.find((p) => p.enabled);
      if (p)
        setBase((b) => ({
          ...b,
          providerId: p.id,
          model: p.models[0] ?? "",
          transparent: p.capabilities.transparent,
        }));
    });
  }, []);
  useEffect(
    () =>
      window.workshop.onEvent((e) => {
        if (
          [
            "family.updated",
            "generation.updated",
            "processing.updated",
          ].includes(e.type)
        )
          void refresh().catch(report);
      }),
    [],
  );
  useEffect(() => {
    if (batch?.id) void refresh().catch(report);
  }, [job?.status]);
  useEffect(() => {
    if (source.assetId || source.candidateId)
      void action(async () => {
        const ref = await call<GenerationReference>(
          "generation.inputs.add",
          source,
        );
        activeId.current = undefined;
        setDetail(undefined);
        setTemplate(undefined);
        setTemplateParentId(undefined);
        setRefs([ref]);
        setBase((b) => ({ ...b, referenceIds: [ref.id] }));
      });
  }, [source]);
  function chooseTemplate(t?: AssetFamilyTemplate) {
    setTemplate(t);
    setTemplateParentId(t?.id);
    if (t) {
      setName(t.name);
      setStyle(t.style);
      setBase(t.base);
      void call<GenerationReference[]>("generation.inputs.list")
        .then((rs) =>
          setRefs(rs.filter((r) => t.base.referenceIds.includes(r.id))),
        )
        .catch(report);
    }
  }
  async function loadBatch(id: string) {
    activeId.current = id;
    const d = await call<FamilyDetail>("families.batches.detail", { id });
    setDetail(d);
    setProjectId(d.batch.projectId ?? "");
  }
  async function create() {
    const t =
      template ??
      (await call<AssetFamilyTemplate>("families.templates.save", {
        id: templateParentId,
        name,
        style,
        base,
        operations: familyIconOperations,
      }));
    const b = await call<AssetFamilyBatch>("families.batches.create", {
      templateId: t.id,
      items: rows,
      projectId: projectId || undefined,
    });
    await loadBatch(b.id);
  }
  async function generate(keys?: string[], continueKey?: string) {
    setPlan(
      await call<FamilyPlan>("families.generate.preview", {
        batchId: batch!.id,
        keys,
        continueKey,
        instruction: continueKey ? instruction : undefined,
      }),
    );
    setContinueRow(undefined);
  }
  async function promote(c: GenerationCandidate) {
    const ref = await call<GenerationReference>("generation.inputs.add", {
      candidateId: c.id,
    });
    const t = await call<AssetFamilyTemplate>("families.templates.save", {
      ...batch!.template,
      base: { ...batch!.template.base, referenceIds: [ref.id] },
    });
    const b = await call<AssetFamilyBatch>("families.batches.create", {
      templateId: t.id,
      projectId: batch!.projectId,
      items: batch!.items,
      sourceBatchId: batch!.id,
    });
    await loadBatch(b.id);
    useStore.getState().notify(`已建立样板 v${t.version}，新批次保留已选候选`);
  }
  const provider = providers.find((p) => p.id === base.providerId);
  return (
    <div className="full-page family-page">
      <SectionTitle
        title="同类素材"
        eyebrow="样板 → 变化清单 → 逐项选定 → 整理交付"
      />
      <div className="family-toolbar">
        <select
          aria-label="恢复批次"
          value={batch?.id ?? ""}
          disabled={locked}
          onChange={(e) =>
            void action(async () => {
              if (e.target.value) await loadBatch(e.target.value);
            })
          }
        >
          <option value="">选择历史批次</option>
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.template.name} v{b.template.version} ·{" "}
              {new Date(b.createdAt).toLocaleString()} · {b.items.length} 项
            </option>
          ))}
        </select>
        <ClientButton
          disabled={locked}
          onClick={() => {
            activeId.current = undefined;
            setDetail(undefined);
            setTemplate(undefined);
            setTemplateParentId(undefined);
          }}
        >
          <Plus size={16} />
          新建批次
        </ClientButton>
      </div>
      {!batch ? (
        <>
          <section className="family-panel">
            <h3>1 · 固定样板</h3>
            <div className="family-form">
              <Field label="复用模板">
                <select
                  value={template?.id ?? ""}
                  onChange={(e) =>
                    chooseTemplate(
                      templates.find((t) => t.id === e.target.value),
                    )
                  }
                >
                  <option value="">首次建立模板</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} · v{t.version}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="模板名称">
                <input
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setTemplate(undefined);
                  }}
                />
              </Field>
              <Field label="生成连接">
                <select
                  value={base.providerId}
                  onChange={(e) => {
                    const p = providers.find((p) => p.id === e.target.value)!;
                    setBase({
                      ...base,
                      providerId: p.id,
                      model: p.models[0] ?? "",
                      transparent: p.capabilities.transparent,
                      referenceIds: p.capabilities.references
                        ? base.referenceIds.slice(
                            0,
                            p.capabilities.maxReferences,
                          )
                        : [],
                    });
                    setTemplate(undefined);
                  }}
                >
                  {providers
                    .filter((p) => p.enabled)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="模型">
                <input
                  value={base.model}
                  placeholder="连接默认模型"
                  onChange={(e) => {
                    setBase({ ...base, model: e.target.value });
                    setTemplate(undefined);
                  }}
                />
              </Field>
              <Field label="风格预设">
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const p = generationPresets.find(
                      (p) => p.name === e.target.value,
                    );
                    if (p) {
                      setStyle(p.prompt);
                      setTemplate(undefined);
                    }
                  }}
                >
                  <option value="">青绿铜金立体物件</option>
                  {generationPresets.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="目标项目">
                <select
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                >
                  <option value="">暂不关联项目</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="固定风格、材质、视角、光照与留白">
              <textarea
                rows={4}
                value={style}
                onChange={(e) => {
                  setStyle(e.target.value);
                  setTemplate(undefined);
                }}
              />
            </Field>
            <div className="family-references">
              {refs.map((r) => (
                <figure key={r.id}>
                  <img src={r.previewUrl} alt={r.name} />
                  <figcaption>{r.name}</figcaption>
                </figure>
              ))}
              <ClientButton
                disabled={locked || !provider?.capabilities.references}
                onClick={() =>
                  void action(async () => {
                    const paths = await window.workshop.choose({
                      kind: "files",
                      title: "选择样板图片",
                    });
                    if (paths[0]) {
                      const r = await call<GenerationReference>(
                        "generation.inputs.add",
                        { filePath: paths[0] },
                      );
                      setRefs([r]);
                      setBase({ ...base, referenceIds: [r.id] });
                      setTemplate(undefined);
                    }
                  })
                }
              >
                <ImagePlus size={16} />
                选择样板
              </ClientButton>
              {!!base.referenceIds.length && (
                <ClientButton
                  onClick={() => {
                    setRefs([]);
                    setBase({ ...base, referenceIds: [] });
                    setTemplate(undefined);
                  }}
                >
                  清除参考
                </ClientButton>
              )}
            </div>
            <p className="family-hint">
              透明 PNG · 主体适配 384×384 并居中补边为 512×512 · 派生
              128×128、64×64。保留原始候选与加工来源。
            </p>
            <div className="family-form">
              <Field label="生成宽度">
                <input
                  type="number"
                  min={64}
                  max={4096}
                  value={base.width}
                  onChange={(e) => {
                    setBase({ ...base, width: Number(e.target.value) });
                    setTemplate(undefined);
                  }}
                />
              </Field>
              <Field label="生成高度">
                <input
                  type="number"
                  min={64}
                  max={4096}
                  value={base.height}
                  onChange={(e) => {
                    setBase({ ...base, height: Number(e.target.value) });
                    setTemplate(undefined);
                  }}
                />
              </Field>
            </div>
            {template && (
              <ClientButton
                disabled={locked}
                onClick={() =>
                  void action(async () => {
                    const t = await call<AssetFamilyTemplate>(
                      "families.templates.save",
                      { ...template, name, style, base },
                    );
                    chooseTemplate(t);
                  })
                }
              >
                保存为新版本
              </ClientButton>
            )}
          </section>
          <section className="family-panel">
            <div className="family-toolbar">
              <h3>2 · 变化清单</h3>
              <ClientButton
                onClick={() => setRows(structuredClone(zizhenIconRows))}
              >
                载入《字阵山河》14 项
              </ClientButton>
              <ClientButton onClick={() => setRows([...rows, blankRow()])}>
                <Plus size={16} />
                添加条目
              </ClientButton>
            </div>
            <div className="family-table">
              <table>
                <thead>
                  <tr>
                    <th>稳定 ID</th>
                    <th>名称</th>
                    <th>主体</th>
                    <th>点缀颜色</th>
                    <th>装饰 / 意象</th>
                    <th>候选数</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, index) => (
                    <tr key={index}>
                      {(
                        ["key", "name", "subject", "accent", "motif"] as const
                      ).map((field) => (
                        <td key={field}>
                          <input
                            aria-label={`${index + 1} ${field}`}
                            value={r[field]}
                            onChange={(e) =>
                              setRows(
                                rows.map((v, n) =>
                                  n === index
                                    ? { ...v, [field]: e.target.value }
                                    : v,
                                ),
                              )
                            }
                          />
                        </td>
                      ))}
                      <td>
                        <input
                          aria-label={`${index + 1} 候选数`}
                          type="number"
                          min={1}
                          max={4}
                          value={r.count}
                          onChange={(e) =>
                            setRows(
                              rows.map((v, n) =>
                                n === index
                                  ? { ...v, count: Number(e.target.value) }
                                  : v,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <ClientButton
                          aria-label={`删除 ${r.name}`}
                          onClick={() =>
                            setRows(rows.filter((_, n) => n !== index))
                          }
                        >
                          ×
                        </ClientButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ClientButton
              className="primary"
              disabled={locked || !rows.length || !provider}
              onClick={() => void action(create)}
            >
              <Layers size={16} />
              建立制作批次
            </ClientButton>
          </section>
        </>
      ) : (
        <>
          <section className="family-panel">
            <h3>
              {batch.template.name} · v{batch.template.version}
            </h3>
            <p className="family-hint">
              {batch.items.filter((i) => i.selectedCandidateId).length}/
              {batch.items.length} 项已选定 ·{" "}
              {
                batch.items.filter((i) =>
                  i.outputs?.every((o) => o.assetIds.length),
                ).length
              }{" "}
              项已入库。此批次固定使用创建时的模板。
            </p>
            <div className="family-toolbar">
              <ClientButton
                disabled={
                  locked || batch.items.every((i) => i.selectedCandidateId)
                }
                onClick={() => void action(() => generate())}
              >
                检查生成未选条目
              </ClientButton>
              <ClientButton
                disabled={
                  locked || !batch.items.some((i) => i.selectedCandidateId)
                }
                onClick={() =>
                  void action(async () => {
                    await call("families.prepare.start", { batchId: batch.id });
                  })
                }
              >
                加工选定结果
              </ClientButton>
              <ClientButton
                disabled={locked || !batch.items.some((i) => i.outputs)}
                onClick={() => setReview(true)}
              >
                <Upload size={16} />
                整理并保存
              </ClientButton>
              <ClientButton
                disabled={
                  locked ||
                  !batch.items.some((i) =>
                    i.outputs?.some((o) => o.assetIds.length),
                  )
                }
                onClick={() =>
                  void action(async () => {
                    const target =
                      projects.find((p) => p.id === batch.projectId)
                        ?.godotPath ||
                      (
                        await window.workshop.choose({
                          kind: "folder",
                          title: "选择交付目录或 Godot 项目",
                        })
                      )[0];
                    if (target)
                      setExportPlan(
                        await call("families.export.inspect", {
                          batchId: batch.id,
                          target,
                          mode: "godot",
                        }),
                      );
                  })
                }
              >
                <Download size={16} />
                交付游戏项目
              </ClientButton>
              {running && (
                <ClientButton
                  onClick={() =>
                    void action(async () => {
                      await call("jobs.control", {
                        id: job!.id,
                        action: "cancel",
                      });
                    })
                  }
                >
                  停止
                </ClientButton>
              )}
              {job &&
                ["failed", "interrupted", "cancelled"].includes(job.status) && (
                  <ClientButton
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        try {
                          await call("jobs.control", {
                            id: job.id,
                            action: "retry",
                          });
                        } catch (e: any) {
                          if (
                            e.message.includes("确认未成功") &&
                            window.confirm(
                              "有提交结果不明的调用。请先检查平台记录；确认未成功后才会重新提交并可能计费。",
                            )
                          )
                            await call("jobs.control", {
                              id: job.id,
                              action: "retry",
                              confirmUnknown: true,
                            });
                          else throw e;
                        }
                      })
                    }
                  >
                    续接未完成任务
                  </ClientButton>
                )}
            </div>
            {job && (
              <p role="status">
                {labels[job.status] ?? job.status} · {job.stage}{" "}
                {job.error && `· ${job.error}`}
              </p>
            )}
          </section>
          <div className="family-items">
            {batch.items.map((item) => (
              <section
                className="family-panel family-item"
                key={item.key}
                data-family-key={item.key}
              >
                <div className="family-toolbar">
                  <h3>{item.name}</h3>
                  <code>{item.key}</code>
                  {item.selectedCandidateId && (
                    <span className="family-selected">
                      <Check size={14} />
                      已选定
                    </span>
                  )}
                  <ClientButton
                    disabled={
                      locked || !!item.outputs?.some((o) => o.assetIds.length)
                    }
                    onClick={() => setEdit({ ...item })}
                  >
                    编辑条目
                  </ClientButton>
                  <ClientButton
                    disabled={
                      locked || !!item.outputs?.some((o) => o.assetIds.length)
                    }
                    onClick={() => void action(() => generate([item.key]))}
                  >
                    重做此项
                  </ClientButton>
                </div>
                <p>
                  {item.subject} · {item.accent} · {item.motif}
                </p>
                {detail.progress?.[item.key] && (
                  <p className="family-hint" role="status">
                    候选完成 {detail.progress[item.key].completed} · 生成中{" "}
                    {detail.progress[item.key].running} · 等待{" "}
                    {detail.progress[item.key].pending} · 未完成{" "}
                    {detail.progress[item.key].failed}
                  </p>
                )}
                {detail.progress?.[item.key]?.errors.map((e) => (
                  <p className="family-error" key={e}>
                    {e}
                  </p>
                ))}
                {item.error && <p className="family-error">{item.error}</p>}
                <div className="family-candidates">
                  {(detail.candidates[item.key] ?? []).map((c) => (
                    <article
                      key={c.id}
                      className={
                        item.selectedCandidateId === c.id ? "selected" : ""
                      }
                    >
                      <button
                        className="family-picture"
                        aria-label={`放大 ${item.name}`}
                        onClick={() => setPreview(c)}
                      >
                        <img src={c.previewUrl} alt={item.name} />
                      </button>
                      <div>
                        <ClientButton
                          disabled={
                            busy ||
                            (running && job?.type !== "family-generate") ||
                            !!item.outputs?.some((o) => o.assetIds.length)
                          }
                          onClick={() =>
                            void action(async () => {
                              await call("families.batches.select", {
                                batchId: batch.id,
                                key: item.key,
                                candidateId: c.id,
                              });
                            })
                          }
                        >
                          {item.selectedCandidateId === c.id
                            ? "已选定"
                            : "选用此图"}
                        </ClientButton>
                        {item.selectedCandidateId === c.id && (
                          <>
                            <ClientButton
                              disabled={
                                locked ||
                                !!item.outputs?.some((o) => o.assetIds.length)
                              }
                              onClick={() => {
                                setInstruction("");
                                setContinueRow(item.key);
                              }}
                            >
                              继续修改
                            </ClientButton>
                            <ClientButton
                              disabled={locked}
                              onClick={() => void action(() => promote(c))}
                            >
                              设为新样板
                            </ClientButton>
                          </>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
                {item.outputs && (
                  <div className="family-outputs">
                    {item.outputs.map((o) => (
                      <figure key={o.artifactId}>
                        <button
                          className="family-output-picture"
                          aria-label={`查看 ${item.name} ${o.size}`}
                          onClick={() =>
                            setPreview({
                              title: item.name,
                              width: o.size,
                              height: o.size,
                              previewUrl: `workshop://processing/artifact/${o.artifactId}`,
                            })
                          }
                        >
                          <img
                            style={{
                              width: Math.min(o.size, 128),
                              height: Math.min(o.size, 128),
                            }}
                            src={`workshop://processing/artifact/${o.artifactId}`}
                            alt={`${item.name} ${o.size}`}
                          />
                        </button>
                        <figcaption>
                          {o.size}×{o.size} ·{" "}
                          {o.assetIds.length ? "已入库" : "待保存"}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
                {item.outputs && (
                  <p className="family-hint">
                    {item.outputs
                      .map(
                        (o) =>
                          `${o.size}×${o.size}${o.assetIds.length ? " 已入库" : " 待保存"}`,
                      )
                      .join(" · ")}
                  </p>
                )}
              </section>
            ))}
          </div>
        </>
      )}
      {plan && (
        <Modal title="检查同类生成方案" onClose={() => setPlan(undefined)}>
          <p>
            {plan.totalCalls} 次调用 · {plan.segments.length} 批 · 每批最多 20
            次
          </p>
          <p>
            {plan.estimatedCost !== undefined
              ? `估算 ${plan.currency} ${plan.estimatedCost.toFixed(3)}`
              : "连接未提供单次价格，费用或额度以当前平台为准。"}
          </p>
          {plan.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <ClientButton
            disabled={busy}
            className="primary"
            onClick={() =>
              void action(async () => {
                await call("families.generate.start", {
                  batchId: plan.batchId,
                  planId: plan.id,
                });
                setPlan(undefined);
              })
            }
          >
            开始生成
          </ClientButton>
        </Modal>
      )}
      {preview && (
        <Modal title="查看候选" wide onClose={() => setPreview(undefined)}>
          <img
            className="family-full-image"
            src={preview.previewUrl}
            alt={preview.title}
          />
          <p>
            {preview.width}×{preview.height} · 原始候选保留于生成历史
          </p>
        </Modal>
      )}
      {continueRow && (
        <Modal
          title="从选定候选继续修改"
          onClose={() => setContinueRow(undefined)}
        >
          <Field label="只填写本次需要改变的内容">
            <textarea
              rows={5}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </Field>
          <ClientButton
            disabled={busy || !instruction.trim()}
            onClick={() =>
              void action(() => generate([continueRow], continueRow))
            }
          >
            检查修改方案
          </ClientButton>
        </Modal>
      )}
      {edit && (
        <Modal title={`编辑 ${edit.name}`} onClose={() => setEdit(undefined)}>
          <p>稳定 ID：{edit.key}</p>
          {(["name", "subject", "accent", "motif"] as const).map((field) => (
            <Field
              key={field}
              label={
                {
                  name: "名称",
                  subject: "主体",
                  accent: "点缀颜色",
                  motif: "装饰 / 意象",
                }[field]
              }
            >
              <input
                value={edit[field]}
                onChange={(e) => setEdit({ ...edit, [field]: e.target.value })}
              />
            </Field>
          ))}
          <Field label="分类">
            <select
              value={edit.category}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  category: e.target.value as AssetFamilyRow["category"],
                })
              }
            >
              {Object.entries(categories).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <ClientButton
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await call("families.batches.update", {
                  batchId: batch!.id,
                  items: [edit],
                });
                setEdit(undefined);
              })
            }
          >
            保存条目
          </ClientButton>
        </Modal>
      )}
      {review && batch && (
        <Modal title="整理并保存选定素材" wide onClose={() => setReview(false)}>
          <p>
            按条目和尺寸聚合。下方名称、分类与项目直接用于入库；无需额外识图调用。
          </p>
          <Field label="目标项目">
            <select
              disabled={batch.items.some((i) =>
                i.outputs?.some((o) => o.assetIds.length),
              )}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">暂不关联项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          {batch.items
            .filter(
              (i) => i.outputs && !i.outputs.some((o) => o.assetIds.length),
            )
            .map((i) => (
              <div className="family-review-row" key={i.key}>
                <strong>{i.name}</strong>
                <code>{i.key}</code>
                <span>{categories[i.category]} · 512 / 128 / 64</span>
                <ClientButton onClick={() => setEdit({ ...i })}>
                  修改名称和分类
                </ClientButton>
              </div>
            ))}
          <ClientButton
            disabled={busy}
            onClick={() =>
              void action(async () => {
                setAnalysis(
                  await call("families.analyze.preview", { batchId: batch.id }),
                );
              })
            }
          >
            识图补充整理建议（可选）
          </ClientButton>
          <ClientButton
            disabled={locked}
            className="primary"
            onClick={() =>
              void action(async () => {
                if (
                  !batch.items.some((i) =>
                    i.outputs?.some((o) => o.assetIds.length),
                  )
                )
                  await call("families.batches.update", {
                    batchId: batch.id,
                    projectId,
                    items: [],
                  });
                await call("families.save.start", { batchId: batch.id });
                setReview(false);
              })
            }
          >
            保存入库
          </ClientButton>
        </Modal>
      )}
      {analysis && (
        <Modal title="补充识图建议" wide onClose={() => setAnalysis(undefined)}>
          <p>
            预计 {analysis.estimatedCalls} 次 Codex
            识图调用，费用或额度以平台为准。模板名称、分类与稳定 ID
            保持为当前填写值。
          </p>
          {analysis.items.map((i: any) => (
            <p key={i.artifactId}>
              {i.title} · {i.reason || i.analysis?.reason || "等待识图建议"}
            </p>
          ))}
          <ClientButton
            disabled={busy || !analysis.estimatedCalls || !!analysis.jobId}
            onClick={() =>
              void action(async () => {
                const result = await call("processing.organize.start", {
                  proposalId: analysis.id,
                });
                useStore.getState().notify("补充识图已启动，可稍后刷新查看");
                setAnalysis({ ...analysis, jobId: result.jobId });
              })
            }
          >
            启动补充识图
          </ClientButton>
          <ClientButton
            onClick={() =>
              void action(async () => {
                setAnalysis(
                  await call("processing.organize.detail", { id: analysis.id }),
                );
              })
            }
          >
            刷新建议
          </ClientButton>
        </Modal>
      )}
      {exportPlan && (
        <Modal title="交付同类素材" onClose={() => setExportPlan(undefined)}>
          <p>
            {exportPlan.assets.length} 个文件 · {exportPlan.request.target}
          </p>
          <p>
            包含 workshop-family-index.json。通过稳定 ID
            读取各尺寸，继续使用版本和覆盖保护。
          </p>
          {exportPlan.issues.map((i) => (
            <p className="family-error" key={i}>
              {i}
            </p>
          ))}
          <ClientButton
            disabled={busy || !!exportPlan.issues.length}
            onClick={() =>
              void action(async () => {
                await call("exports.start", { planId: exportPlan.id });
                setExportPlan(undefined);
                useStore.getState().notify("交付已启动");
              })
            }
          >
            确认交付
          </ClientButton>
        </Modal>
      )}
    </div>
  );
}
