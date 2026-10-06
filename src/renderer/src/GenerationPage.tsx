import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Settings2,
  Plus,
  ImagePlus,
  History,
  Save,
  ArrowRight,
  Trash2,
  Check,
  GitCompare,
  WandSparkles,
  StopCircle,
  RotateCcw,
} from "lucide-react";
import { ClientButton } from "./client-ui";
import { SectionTitle } from "./ui-kit";
import { Field, Modal, Empty } from "./components";
import { call, report, useStore } from "./store";
import type { AssetPage, Project } from "../../shared/types";
import { categories } from "../../shared/types";
import {
  generationPresets,
  type GenerationCandidate,
  type GenerationPlan,
  type GenerationProviderConfig,
  type GenerationReference,
  type GenerationRequest,
  type GenerationRun,
  type GenerationTemplate,
} from "../../shared/generation";
import { GenerationProviders } from "./GenerationProviders";
import { GenerationMask } from "./GenerationMask";
import "./generation.css";
import { openProcessing } from "../../shared/processing";
import { openFamily } from "../../shared/families";

const statusNames: Record<string, string> = {
  queued: "排队",
  running: "生成中",
  paused: "已暂停",
  completed: "完成",
  failed: "部分失败",
  cancelled: "已停止",
  interrupted: "需检查",
};
const initialRequest: GenerationRequest = {
  providerId: "codex-default",
  model: "",
  prompt: "",
  referenceIds: [],
  width: 1024,
  height: 1024,
  count: 1,
  quality: "auto",
  category: "concept",
  tags: [],
};
function forProvider(
  request: GenerationRequest,
  p: GenerationProviderConfig,
): GenerationRequest {
  return {
    ...request,
    providerId: p.id,
    model: p.models[0] ?? "",
    referenceIds: p.capabilities.references
      ? request.referenceIds.slice(0, p.capabilities.maxReferences)
      : [],
    maskId: p.capabilities.mask ? request.maskId : undefined,
    seed: p.capabilities.seed ? request.seed : undefined,
    negativePrompt: p.capabilities.negativePrompt
      ? request.negativePrompt
      : undefined,
    transparent: p.capabilities.transparent ? request.transparent : false,
    workflowValues: undefined,
  };
}
export function GenerationPage({ projects }: { projects: Project[] }) {
  const [providers, setProviders] = useState<GenerationProviderConfig[]>([]),
    [request, setRequest] = useState<GenerationRequest>(initialRequest),
    [references, setReferences] = useState<GenerationReference[]>([]),
    [runs, setRuns] = useState<GenerationRun[]>([]),
    [activeId, setActiveId] = useState<string>(),
    [candidates, setCandidates] = useState<GenerationCandidate[]>([]),
    [selected, setSelected] = useState<string[]>([]),
    [templates, setTemplates] = useState<GenerationTemplate[]>([]);
  const [connections, setConnections] = useState(false),
    [maskEditor, setMaskEditor] = useState(false),
    [plan, setPlan] = useState<GenerationPlan | null>(null),
    [compare, setCompare] = useState<GenerationCandidate[] | null>(null),
    [picker, setPicker] = useState(false),
    [assetPage, setAssetPage] = useState<AssetPage | null>(null),
    [assetSearch, setAssetSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [brief, setBrief] = useState(""),
    [assistantJob, setAssistantJob] = useState<string>(),
    [templateName, setTemplateName] = useState(""),
    [targetProject, setTargetProject] = useState("");
  const jobs = useStore((s) => s.jobs),
    activeRef = useRef<string | undefined>(activeId),
    assistantShown = useRef<string | undefined>(undefined);
  activeRef.current = activeId;
  const enabled = providers.filter((p) => p.enabled),
    provider = enabled.find((p) => p.id === request.providerId),
    cap = provider?.capabilities,
    activeRun = runs.find((r) => r.id === activeId),
    activeJob = jobs.find((j) => j.id === activeRun?.jobId),
    currentReferences = request.referenceIds
      .map((id) => references.find((r) => r.id === id))
      .filter((r): r is GenerationReference => !!r);
  const update = (patch: Partial<GenerationRequest>) =>
    setRequest((r) => ({ ...r, ...patch }));
  async function refresh() {
    const [history, refs, saved] = await Promise.all([
      call<GenerationRun[]>("generation.list"),
      call<GenerationReference[]>("generation.inputs.list"),
      call<GenerationTemplate[]>("generation.templates.list"),
    ]);
    setRuns(history);
    setReferences((old) => [...refs, ...old.filter((r) => r.role === "mask")]);
    setTemplates(saved);
    if (activeRef.current) {
      const detail = await call<{
        run: GenerationRun;
        candidates: GenerationCandidate[];
        references: GenerationReference[];
      }>("generation.detail", { id: activeRef.current });
      setCandidates(detail.candidates);
      setReferences((old) => [
        ...old.filter((r) => !detail.references.some((n) => n.id === r.id)),
        ...detail.references,
      ]);
    }
  }
  useEffect(() => {
    void call<GenerationProviderConfig[]>("generation.providers.list")
      .then((rows) => {
        setProviders(rows);
        const p = rows.find((p) => p.enabled);
        if (p) setRequest((r) => forProvider(r, p));
      })
      .catch(report);
    void refresh().catch(report);
    let timer: ReturnType<typeof setTimeout>;
    const stop = window.workshop.onEvent((e) => {
      if (e.type === "generation.updated" || e.type === "catalog.changed") {
        clearTimeout(timer);
        timer = setTimeout(() => void refresh().catch(report), 180);
      }
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    setSelected([]);
    setCandidates([]);
    if (activeId)
      void call<{
        candidates: GenerationCandidate[];
        references: GenerationReference[];
      }>("generation.detail", { id: activeId })
        .then((d) => {
          setCandidates(d.candidates);
          setReferences((old) => [
            ...old.filter((r) => !d.references.some((n) => n.id === r.id)),
            ...d.references,
          ]);
        })
        .catch(report);
  }, [activeId]);
  useEffect(() => {
    const job = jobs.find((j) => j.id === assistantJob);
    if (
      job?.status === "completed" &&
      job.result?.plan &&
      assistantShown.current !== job.id
    ) {
      assistantShown.current = job.id;
      setPlan(job.result.plan);
      setAssistantJob(undefined);
    }
    if (job && ["failed", "cancelled"].includes(job.status)) {
      setAssistantJob(undefined);
      if (job.error) report(new Error(job.error));
    }
  }, [jobs, assistantJob]);
  useEffect(() => {
    if (!picker) return;
    const timer = setTimeout(
      () =>
        void call<AssetPage>("assets.query", {
          imageOnly: true,
          search: assetSearch,
          limit: 60,
        })
          .then(setAssetPage)
          .catch(report),
      180,
    );
    return () => clearTimeout(timer);
  }, [picker, assetSearch]);
  async function perform(fn: () => Promise<void>) {
    try {
      setBusy(true);
      await fn();
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function addReference(input: Record<string, string>) {
    const ref = await call<GenerationReference>("generation.inputs.add", input);
    setReferences((old) => [...old.filter((r) => r.id !== ref.id), ref]);
    setRequest((r) => ({
      ...r,
      referenceIds: [...r.referenceIds, ref.id],
      maskId: undefined,
    }));
  }
  async function reuse(r: GenerationRequest) {
    const p = enabled.find((p) => p.id === r.providerId);
    if (!p) {
      report(new Error("此历史记录的连接已移除或停用，请重新配置"));
      return;
    }
    const refs = await call<GenerationReference[]>("generation.inputs.get", {
      ids: [...r.referenceIds, ...(r.maskId ? [r.maskId] : [])],
    });
    setReferences((old) => [
      ...old.filter((ref) => !refs.some((n) => n.id === ref.id)),
      ...refs,
    ]);
    setRequest({ ...r, count: r.count ?? 1 });
    useStore.getState().notify("已恢复生成参数与参考图");
  }
  async function revise(c: GenerationCandidate) {
    const detail = await call<{ run: GenerationRun }>("generation.detail", {
      id: c.runId,
    });
    const base = detail.run.items[c.itemIndex].request;
    const ref = await call<GenerationReference>("generation.inputs.add", {
      candidateId: c.id,
    });
    setReferences((old) => [...old, ref]);
    setRequest({
      ...base,
      count: 1,
      referenceIds: [ref.id],
      maskId: undefined,
      parentCandidateId: c.id,
      prompt: `${base.prompt}\n修改要求：`,
    });
  }
  const picked = candidates.filter((c) => selected.includes(c.id));
  const planPrices = plan?.items.map((i) =>
    enabled.find((p) => p.id === i.providerId),
  );
  const planCurrency = planPrices?.[0]?.currency;
  const planCost =
    plan &&
    planPrices?.every(
      (p) =>
        p?.unitPrice !== undefined && p.currency && p.currency === planCurrency,
    )
      ? plan.items.reduce(
          (sum, i, n) => sum + i.count * planPrices[n]!.unitPrice!,
          0,
        )
      : undefined;
  function editPlan(index: number, patch: Partial<GenerationRequest>) {
    setPlan((p) =>
      p
        ? {
            ...p,
            items: p.items.map((i, n) =>
              n === index ? { ...i, ...patch } : i,
            ),
          }
        : p,
    );
  }
  return (
    <div className="full-page generation-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">AI ASSET STUDIO</span>
          <SectionTitle as="h1" title="可控生成工作台" />
          <p>从参考到成品，保留每一次选择与修改。</p>
        </div>
        <ClientButton onClick={() => setConnections(true)}>
          <Settings2 size={16} />
          模型与工作流连接
        </ClientButton>
      </header>
      <div className="gen-layout">
        <section className="gen-panel gen-form" aria-label="生成参数">
          <fieldset className="gen-fields" disabled={busy}>
            <div className="gen-panel-heading">
              <Sparkles size={18} />
              <h2>创作参数</h2>
              <span>IMAGE / CLOUD</span>
            </div>
            <Field label="生成连接">
              <select
                value={provider?.id ?? ""}
                onChange={(e) => {
                  const p = enabled.find((p) => p.id === e.target.value);
                  if (p) setRequest((r) => forProvider(r, p));
                }}
              >
                {!enabled.length && <option value="">请添加连接</option>}
                {enabled.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            {provider?.kind !== "runninghub" && (
              <Field label="模型">
                <select
                  value={request.model}
                  onChange={(e) => update({ model: e.target.value })}
                >
                  {provider?.kind === "codex" && !provider.models.length && (
                    <option value="">当前 Codex 默认模型</option>
                  )}
                  {provider?.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {provider?.kind === "runninghub" && (
              <p className="gen-help">
                工作流 {provider.workflowId ?? "尚未配置"} ·
                能力来自已保存的字段映射
              </p>
            )}
            <div className="gen-presets">
              {provider?.kind === "codex" && (
                <p className="gen-help">
                  尺寸作为生成指导，实际尺寸会显示在候选图下方。
                </p>
              )}
              {generationPresets.map((p) => (
                <button
                  key={p.name}
                  onClick={() =>
                    update({ prompt: p.prompt, category: p.category })
                  }
                >
                  {p.name}
                </button>
              ))}
            </div>
            <Field label="提示词">
              <textarea
                rows={6}
                value={request.prompt}
                placeholder="描述主体、风格、构图，以及需要保持的部分…"
                onChange={(e) => update({ prompt: e.target.value })}
              />
            </Field>
            {cap?.negativePrompt && (
              <Field label="反向提示词">
                <textarea
                  rows={2}
                  value={request.negativePrompt ?? ""}
                  onChange={(e) => update({ negativePrompt: e.target.value })}
                />
              </Field>
            )}
            <div className="form-grid">
              <Field label="宽度">
                <input
                  type="number"
                  min="128"
                  max="4096"
                  step="16"
                  value={request.width}
                  onChange={(e) => update({ width: Number(e.target.value) })}
                />
              </Field>
              <Field label="高度">
                <input
                  type="number"
                  min="128"
                  max="4096"
                  step="16"
                  value={request.height}
                  onChange={(e) => update({ height: Number(e.target.value) })}
                />
              </Field>
              <Field label="生成数量">
                <input
                  type="number"
                  min="1"
                  max="20"
                  value={request.count}
                  onChange={(e) => update({ count: Number(e.target.value) })}
                />
              </Field>
              {cap?.seed && (
                <Field label="种子（留空随机）">
                  <input
                    type="number"
                    min="0"
                    value={request.seed ?? ""}
                    onChange={(e) =>
                      update({
                        seed:
                          e.target.value === ""
                            ? undefined
                            : Number(e.target.value),
                      })
                    }
                  />
                </Field>
              )}
              {cap?.quality && (
                <Field label="质量">
                  <select
                    value={request.quality ?? "auto"}
                    onChange={(e) =>
                      update({
                        quality: e.target.value as GenerationRequest["quality"],
                      })
                    }
                  >
                    <option value="auto">自动</option>
                    <option value="low">草稿</option>
                    <option value="medium">标准</option>
                    <option value="high">高质量</option>
                  </select>
                </Field>
              )}
            </div>
            {cap?.transparent && (
              <label className="gen-check">
                <input
                  type="checkbox"
                  checked={request.transparent ?? false}
                  onChange={(e) => update({ transparent: e.target.checked })}
                />
                透明背景
              </label>
            )}
            {cap?.references && (
              <div className="gen-reference-section">
                <div className="gen-panel-heading">
                  <ImagePlus size={17} />
                  <h3>参考图</h3>
                  <small>
                    {request.referenceIds.length} / {cap.maxReferences}
                  </small>
                </div>
                <div className="gen-references">
                  {currentReferences.map((ref, i) => (
                    <div key={ref.id}>
                      <img
                        src={ref.previewUrl}
                        alt={`参考图 ${i + 1}：${ref.name}`}
                      />
                      <button
                        aria-label={`移除参考图 ${i + 1}`}
                        onClick={() =>
                          update({
                            referenceIds: request.referenceIds.filter(
                              (id) => id !== ref.id,
                            ),
                            maskId: undefined,
                          })
                        }
                      >
                        ×
                      </button>
                      <small>
                        {i === 0 ? "主图" : "参考"} · {ref.width}×{ref.height}
                      </small>
                    </div>
                  ))}
                </div>
                <div className="gen-inline">
                  <ClientButton
                    disabled={
                      busy || request.referenceIds.length >= cap.maxReferences
                    }
                    onClick={() =>
                      void perform(async () => {
                        const files = await window.workshop.choose({
                          kind: "files",
                          title: "选择参考图片",
                        });
                        for (const file of files.slice(
                          0,
                          cap.maxReferences - request.referenceIds.length,
                        ))
                          await addReference({ filePath: file });
                      })
                    }
                  >
                    <Plus size={15} />
                    本地图片
                  </ClientButton>
                  <ClientButton
                    disabled={request.referenceIds.length >= cap.maxReferences}
                    onClick={() => setPicker(true)}
                  >
                    素材库
                  </ClientButton>
                </div>
                {cap.mask && !!currentReferences.length && (
                  <ClientButton onClick={() => setMaskEditor(true)}>
                    <WandSparkles size={15} />
                    {request.maskId ? "重新编辑蒙版" : "绘制局部修改区域"}
                  </ClientButton>
                )}
                {request.maskId && (
                  <p className="gen-help">
                    已保存与主图同尺寸的蒙版{" "}
                    <button onClick={() => update({ maskId: undefined })}>
                      移除
                    </button>
                  </p>
                )}
              </div>
            )}
            {provider?.bindings.some((b) =>
              ["steps", "cfg", "custom"].includes(b.role),
            ) && (
              <details className="gen-advanced">
                <summary>工作流附加参数</summary>
                {provider.bindings
                  .filter((b) => ["steps", "cfg", "custom"].includes(b.role))
                  .map((b) => {
                    const key = `${b.nodeId}.${b.fieldName}`,
                      original =
                        provider.workflowJSON?.[b.nodeId]?.inputs[b.fieldName],
                      value =
                        b.role === "steps"
                          ? request.steps
                          : b.role === "cfg"
                            ? request.cfg
                            : request.workflowValues?.[key];
                    return (
                      <Field key={key} label={b.label ?? key}>
                        <input
                          type={
                            typeof original === "number" || b.role !== "custom"
                              ? "number"
                              : "text"
                          }
                          value={value === undefined ? "" : String(value)}
                          placeholder={`工作流默认：${String(original ?? "")}`}
                          onChange={(e) => {
                            const v = e.target.value;
                            if (b.role === "steps")
                              update({
                                steps: v === "" ? undefined : Number(v),
                              });
                            else if (b.role === "cfg")
                              update({ cfg: v === "" ? undefined : Number(v) });
                            else {
                              const values = { ...request.workflowValues };
                              if (v === "") delete values[key];
                              else
                                values[key] =
                                  typeof original === "number"
                                    ? Number(v)
                                    : typeof original === "boolean"
                                      ? v === "true"
                                      : v;
                              update({ workflowValues: values });
                            }
                          }}
                        />
                      </Field>
                    );
                  })}
              </details>
            )}
            <div className="form-grid">
              <Field label="入库分类">
                <select
                  value={request.category}
                  onChange={(e) =>
                    update({
                      category: e.target.value as GenerationRequest["category"],
                    })
                  }
                >
                  {Object.entries(categories).map(([id, title]) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="默认项目">
                <select
                  value={request.projectId ?? ""}
                  onChange={(e) =>
                    update({ projectId: e.target.value || undefined })
                  }
                >
                  <option value="">公共素材库</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="标签（逗号分隔）">
              <input
                value={request.tags.join(", ")}
                onChange={(e) =>
                  update({
                    tags: e.target.value
                      .split(/[,，]/)
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
              />
            </Field>
            <ClientButton
              className="primary gen-submit"
              disabled={busy || !provider || !request.prompt.trim()}
              onClick={() =>
                void perform(async () =>
                  setPlan(
                    await call<GenerationPlan>("generation.preview", {
                      items: [request],
                    }),
                  ),
                )
              }
            >
              <Sparkles size={17} />
              预览生成方案
              <ArrowRight size={16} />
            </ClientButton>
            <details className="gen-assistant">
              <summary>
                <WandSparkles size={16} />
                Codex 制作助手
              </summary>
              <Field label="制作需求">
                <textarea
                  rows={3}
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="例如：同一风格的三种药水图标，保持瓶子形状和光照一致…"
                />
              </Field>
              <ClientButton
                disabled={busy || !!assistantJob || !brief.trim() || !provider}
                onClick={() =>
                  void perform(async () => {
                    const result = await call<{ jobId: string }>(
                      "generation.assistant.plan",
                      {
                        base: { ...request, prompt: request.prompt || brief },
                        brief,
                      },
                    );
                    setAssistantJob(result.jobId);
                  })
                }
              >
                {assistantJob ? "正在编写方案…" : "请助手制定方案"}
              </ClientButton>
              <p className="gen-help">
                助手只提出方案，你检查后再开始生成。方案条数不超过当前生成数量。
              </p>
            </details>
            <details className="gen-templates">
              <summary>
                <Save size={16} />
                我的风格预设
              </summary>
              <div className="gen-inline">
                <input
                  aria-label="预设名称"
                  placeholder="给当前参数和参考图命名"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                />
                <ClientButton
                  disabled={
                    busy || !templateName.trim() || !request.prompt.trim()
                  }
                  onClick={() =>
                    void perform(async () => {
                      await call("generation.templates.save", {
                        name: templateName,
                        request,
                      });
                      setTemplateName("");
                      await refresh();
                    })
                  }
                >
                  保存
                </ClientButton>
              </div>
              {templates.map((t) => (
                <div className="gen-template-row" key={t.id}>
                  <button onClick={() => void perform(() => reuse(t.request))}>
                    {t.name}
                  </button>
                  <button
                    aria-label={`删除预设 ${t.name}`}
                    onClick={() =>
                      void perform(async () => {
                        await call("generation.templates.delete", { id: t.id });
                        await refresh();
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </details>
          </fieldset>
        </section>
        <section className="gen-panel gen-results" aria-label="生成候选">
          <div className="gen-panel-heading">
            <ImagePlus size={19} />
            <h2>候选画廊</h2>
            <span>{candidates.length} RESULTS</span>
          </div>
          {activeRun && (
            <div
              className={`gen-run-status ${activeJob?.status ?? activeRun.status}`}
            >
              <b>{statusNames[activeJob?.status ?? activeRun.status]}</b>
              <span>
                {activeJob?.stage ??
                  activeRun.items[0]?.request.prompt.slice(0, 70)}
              </span>
              {activeJob &&
                ["queued", "running"].includes(activeJob.status) && (
                  <ClientButton
                    onClick={() =>
                      void perform(async () => {
                        await call("jobs.control", {
                          id: activeJob.id,
                          action: "cancel",
                        });
                        await refresh();
                      })
                    }
                  >
                    <StopCircle size={15} />
                    停止
                  </ClientButton>
                )}
              {activeJob &&
                ["failed", "cancelled", "interrupted"].includes(
                  activeJob.status,
                ) && (
                  <ClientButton
                    onClick={() =>
                      void perform(async () => {
                        const unknown = activeRun.items.some(
                          (i) => i.state === "uncertain",
                        );
                        if (
                          unknown &&
                          !window.confirm(
                            "提交结果不明。请先检查提供方任务记录。你已确认这些项目未成功，并愿意重新提交吗？",
                          )
                        )
                          return;
                        await call("jobs.control", {
                          id: activeJob.id,
                          action: "retry",
                          confirmUnknown: unknown,
                        });
                        await refresh();
                      })
                    }
                  >
                    <RotateCcw size={15} />
                    {activeJob.status === "interrupted"
                      ? "检查后重新提交"
                      : "重试未完成项"}
                  </ClientButton>
                )}
            </div>
          )}
          {activeJob?.cancellation?.message && (
            <p className="gen-help">{activeJob.cancellation.message}</p>
          )}
          {activeRun?.items.some((i) => i.error) && (
            <details className="gen-errors">
              <summary>查看未完成项目</summary>
              {activeRun.items
                .filter((i) => i.error)
                .map((i, n) => (
                  <p key={n}>{i.error}</p>
                ))}
            </details>
          )}
          {!candidates.length ? (
            <Empty
              icon={<Sparkles size={34} />}
              heading={
                activeRun && ["running", "queued"].includes(activeRun.status)
                  ? "图片正在创作中"
                  : "等待你的下一份灵感"
              }
            >
              <p>选择连接，填写需求，生成后在这里比较和继续修改。</p>
              <small>候选先保存在生成历史中，挑选后再进入素材库。</small>
            </Empty>
          ) : (
            <>
              <div className="gen-selection">
                <span>{selected.length} 张已选择</span>
                <ClientButton
                  onClick={() => setSelected(candidates.map((c) => c.id))}
                >
                  全选
                </ClientButton>
                <ClientButton
                  disabled={picked.length < 2}
                  onClick={() => setCompare(picked.slice(0, 4))}
                >
                  <GitCompare size={15} />
                  并排比较
                </ClientButton>
                <ClientButton
                  disabled={!picked.length || busy}
                  onClick={() =>
                    void perform(async () => {
                      await call("generation.delete", {
                        candidateIds: selected,
                      });
                      setSelected([]);
                      await refresh();
                    })
                  }
                >
                  <Trash2 size={15} />
                  删除候选
                </ClientButton>
              </div>
              <div className="gen-candidate-grid">
                {candidates.map((c) => (
                  <article
                    className={`gen-candidate ${selected.includes(c.id) ? "selected" : ""}`}
                    key={c.id}
                  >
                    <ClientButton
                      onClick={() => openFamily({ candidateId: c.id })}
                    >
                      制作同类素材
                    </ClientButton>
                    <div className="gen-candidate-image">
                      <button
                        onClick={() => setCompare([c])}
                        aria-label={`放大 ${c.title}`}
                      >
                        <img src={c.previewUrl} alt={c.title} />
                      </button>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.includes(c.id)}
                          onChange={(e) =>
                            setSelected((ids) =>
                              e.target.checked
                                ? [...ids, c.id]
                                : ids.filter((id) => id !== c.id),
                            )
                          }
                          aria-label={`选择候选 ${c.id}`}
                        />
                      </label>
                      {c.importedAssetIds?.length && (
                        <span className="gen-imported">
                          <Check size={12} />
                          已入库
                        </span>
                      )}
                    </div>
                    <div className="gen-candidate-caption">
                      <b title={c.title}>{c.title}</b>
                      <small>
                        {c.width} × {c.height}
                        {c.parentCandidateId ? " · 修改版本" : ""}
                      </small>
                      <ClientButton
                        disabled={busy}
                        onClick={() => void perform(() => revise(c))}
                      >
                        继续修改
                      </ClientButton>
                      <ClientButton
                        onClick={() =>
                          openProcessing([{ kind: "candidate", id: c.id }])
                        }
                      >
                        加工
                      </ClientButton>
                    </div>
                  </article>
                ))}
              </div>
              <div className="gen-accept-bar">
                <Field label="加入项目">
                  <select
                    value={targetProject}
                    onChange={(e) => setTargetProject(e.target.value)}
                  >
                    <option value="">使用生成时的项目设置</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <ClientButton
                  className="primary"
                  disabled={!picked.length || busy}
                  onClick={() =>
                    void perform(async () => {
                      await call("generation.accept", {
                        candidateIds: selected,
                        projectId: targetProject || undefined,
                      });
                      useStore
                        .getState()
                        .notify("已创建入库任务，完成后可在素材库查看");
                    })
                  }
                >
                  <Check size={16} />
                  将选中候选入库
                </ClientButton>
              </div>
            </>
          )}
        </section>
        <aside className="gen-panel gen-history">
          <div className="gen-panel-heading">
            <History size={17} />
            <h2>生成历史</h2>
          </div>
          {!runs.length && (
            <p className="gen-help">首次生成后，这里会保留完整参数和候选。</p>
          )}
          {runs.map((run) => (
            <div
              className={`gen-history-row ${activeId === run.id ? "active" : ""}`}
              key={run.id}
            >
              <button onClick={() => setActiveId(run.id)}>
                <span>
                  {
                    statusNames[
                      jobs.find((j) => j.id === run.jobId)?.status ?? run.status
                    ]
                  }
                </span>
                <b>{run.items[0]?.request.prompt.slice(0, 55)}</b>
                <small>
                  {new Date(run.createdAt).toLocaleString("zh-CN")}
                  <br />
                  {run.items.length} 次调用 ·{" "}
                  {run.items.reduce((n, i) => n + i.candidateIds.length, 0)}{" "}
                  张结果
                </small>
              </button>
              <button
                className="gen-reuse"
                onClick={() => void perform(() => reuse(run.items[0].request))}
              >
                复用参数
              </button>
            </div>
          ))}
        </aside>
      </div>
      {connections && (
        <GenerationProviders
          providers={providers}
          onChange={(rows) => {
            setProviders(rows);
            const p =
              rows.find((p) => p.id === request.providerId && p.enabled) ??
              rows.find((p) => p.enabled);
            if (p) setRequest((r) => forProvider(r, p));
          }}
          onClose={() => setConnections(false)}
        />
      )}
      {maskEditor && currentReferences[0] && (
        <GenerationMask
          reference={currentReferences[0]}
          onSave={(ref) => {
            setReferences((old) => [...old, ref]);
            update({ maskId: ref.id });
          }}
          onClose={() => setMaskEditor(false)}
        />
      )}
      {picker && (
        <Modal title="从素材库选择参考图" onClose={() => setPicker(false)} wide>
          <input
            aria-label="搜索参考素材"
            placeholder="搜索素材名称或标签"
            value={assetSearch}
            onChange={(e) => setAssetSearch(e.target.value)}
          />
          <div className="gen-asset-picker">
            {assetPage?.items.map((a) => (
              <button
                key={a.id}
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await addReference({ assetId: a.id });
                    setPicker(false);
                  })
                }
              >
                <img src={a.thumbnailUrl ?? a.previewUrl} alt="" />
                <span>{a.title}</span>
              </button>
            ))}
          </div>
          {assetPage && !assetPage.items.length && <p>没有匹配的图片。</p>}
        </Modal>
      )}
      {compare && (
        <Modal
          title={compare.length > 1 ? "候选图对照" : "候选图预览"}
          onClose={() => setCompare(null)}
          wide
        >
          <div
            className={`gen-compare ${compare.length === 1 ? "single" : ""}`}
          >
            {compare.map((c) => (
              <figure key={c.id}>
                <img src={c.previewUrl} alt={c.title} />
                <figcaption>
                  {c.title}
                  <small>
                    {c.width} × {c.height}
                  </small>
                </figcaption>
              </figure>
            ))}
          </div>
        </Modal>
      )}
      {plan && (
        <Modal title="检查生成方案" onClose={() => setPlan(null)} wide>
          <div className="gen-plan-summary">
            <b>{plan.items.reduce((n, i) => n + i.count, 0)} 次生成调用</b>
            <span>
              {planCost === undefined
                ? "费用未知"
                : `估算费用 ${planCost.toFixed(2)} ${planCurrency}`}
            </span>
          </div>
          <div className="gen-plan-items">
            {plan.items.map((item, i) => (
              <article key={i}>
                <div className="form-grid">
                  <Field label={`项目 ${i + 1} 连接`}>
                    <select
                      value={item.providerId}
                      onChange={(e) => {
                        const p = enabled.find((p) => p.id === e.target.value);
                        if (p)
                          setPlan({
                            ...plan,
                            items: plan.items.map((it, n) =>
                              n === i ? forProvider(it, p) : it,
                            ),
                          });
                      }}
                    >
                      {enabled.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={`项目 ${i + 1} 数量`}>
                    <input
                      type="number"
                      min="1"
                      max="20"
                      value={item.count}
                      onChange={(e) =>
                        setPlan({
                          ...plan,
                          items: plan.items.map((it, n) =>
                            n === i
                              ? { ...it, count: Number(e.target.value) }
                              : it,
                          ),
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="form-grid">
                  {enabled.find((p) => p.id === item.providerId)?.kind !==
                    "runninghub" && (
                    <Field label={`项目 ${i + 1} 模型`}>
                      <select
                        value={item.model}
                        onChange={(e) => editPlan(i, { model: e.target.value })}
                      >
                        <option value="">默认模型</option>
                        {enabled
                          .find((p) => p.id === item.providerId)
                          ?.models.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                      </select>
                    </Field>
                  )}
                  <Field label={`项目 ${i + 1} 宽度`}>
                    <input
                      type="number"
                      min="128"
                      max="4096"
                      value={item.width}
                      onChange={(e) =>
                        editPlan(i, { width: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label={`项目 ${i + 1} 高度`}>
                    <input
                      type="number"
                      min="128"
                      max="4096"
                      value={item.height}
                      onChange={(e) =>
                        editPlan(i, { height: Number(e.target.value) })
                      }
                    />
                  </Field>
                  {enabled.find((p) => p.id === item.providerId)?.capabilities
                    .seed && (
                    <Field label={`项目 ${i + 1} 种子`}>
                      <input
                        type="number"
                        min="0"
                        value={item.seed ?? ""}
                        onChange={(e) =>
                          editPlan(i, {
                            seed:
                              e.target.value === ""
                                ? undefined
                                : Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                  )}
                  {enabled.find((p) => p.id === item.providerId)?.capabilities
                    .quality && (
                    <Field label={`项目 ${i + 1} 质量`}>
                      <select
                        value={item.quality ?? "auto"}
                        onChange={(e) =>
                          editPlan(i, {
                            quality: e.target
                              .value as GenerationRequest["quality"],
                          })
                        }
                      >
                        <option value="auto">自动</option>
                        <option value="low">草稿</option>
                        <option value="medium">标准</option>
                        <option value="high">高质量</option>
                      </select>
                    </Field>
                  )}
                </div>
                {enabled.find((p) => p.id === item.providerId)?.capabilities
                  .transparent && (
                  <label className="gen-check">
                    <input
                      type="checkbox"
                      checked={item.transparent ?? false}
                      onChange={(e) =>
                        editPlan(i, { transparent: e.target.checked })
                      }
                    />
                    透明背景
                  </label>
                )}
                <Field label={`项目 ${i + 1} 提示词`}>
                  <textarea
                    rows={3}
                    value={item.prompt}
                    onChange={(e) =>
                      setPlan({
                        ...plan,
                        items: plan.items.map((it, n) =>
                          n === i ? { ...it, prompt: e.target.value } : it,
                        ),
                      })
                    }
                  />
                </Field>
                {enabled.find((p) => p.id === item.providerId)?.capabilities
                  .negativePrompt && (
                  <Field label={`项目 ${i + 1} 反向提示词`}>
                    <textarea
                      rows={2}
                      value={item.negativePrompt ?? ""}
                      onChange={(e) =>
                        editPlan(i, { negativePrompt: e.target.value })
                      }
                    />
                  </Field>
                )}
                <p>
                  {item.model || "默认模型 / 工作流"} · {item.width} ×{" "}
                  {item.height} · {item.referenceIds.length} 张参考图
                  {item.maskId ? " · 已附蒙版" : ""}
                  {item.seed !== undefined ? ` · 种子 ${item.seed}` : ""}
                </p>
                {!!item.referenceIds.length && (
                  <div className="gen-plan-references">
                    {item.referenceIds.map((id) => {
                      const ref = references.find((r) => r.id === id);
                      return ref ? (
                        <img key={id} src={ref.previewUrl} alt={ref.name} />
                      ) : null;
                    })}
                  </div>
                )}
              </article>
            ))}
          </div>
          {plan.warnings.map((w) => (
            <p className="gen-help" key={w}>
              {w}
            </p>
          ))}
          <div className="modal-actions">
            <ClientButton onClick={() => setPlan(null)}>返回调整</ClientButton>
            <ClientButton
              className="primary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const verified = await call<GenerationPlan>(
                    "generation.preview",
                    { items: plan.items },
                  );
                  const result = await call<{ runId: string }>(
                    "generation.start",
                    { planId: verified.id },
                  );
                  setPlan(null);
                  setActiveId(result.runId);
                  activeRef.current = result.runId;
                  await refresh();
                })
              }
            >
              <Sparkles size={16} />
              开始生成
            </ClientButton>
          </div>
        </Modal>
      )}
    </div>
  );
}
