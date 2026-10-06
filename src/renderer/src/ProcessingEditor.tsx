import { useEffect, useRef, useState } from "react";
import ReactCrop, { type PercentCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import { ClientButton } from "./client-ui";
import { Field, Modal } from "./components";
import { call, report, useStore } from "./store";
import { GenerationMask } from "./GenerationMask";
import { GenerationProviders } from "./GenerationProviders";
import { ProcessingSaveDialog } from "./ProcessingSaveDialog";
import type {
  GenerationProviderConfig,
  GenerationReference,
} from "../../shared/generation";
import type { Job, Project } from "../../shared/types";
import {
  openProcessing,
  operationLabels,
  purposeLabels,
  type AgentSession,
  type ImageOperation,
  type ImageRef,
  type ProcessingArtifact,
  type ProcessingInput,
  type ProcessingPlan,
  type ProcessingRecipe,
  type ProcessingRun,
  type ProcessingSaveContext,
} from "../../shared/processing";
import "./processing.css";

function ProcessingNumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value)),
    [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);
  return (
    <Field label={label}>
      <input
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={draft}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          if (text !== "" && Number.isFinite(Number(text)))
            onChange(Number(text));
        }}
      />
    </Field>
  );
}

function defaultOperation(
  type: ImageOperation["type"],
  image?: ProcessingInput,
  provider?: GenerationProviderConfig,
): ImageOperation {
  switch (type) {
    case "resize":
      return {
        type,
        width: 512,
        height: 512,
        fit: "contain",
        kernel: "lanczos3",
      };
    case "crop":
      return {
        type,
        x: 0,
        y: 0,
        width: image?.width ?? 512,
        height: image?.height ?? 512,
      };
    case "rotate":
      return { type, angle: 90 };
    case "flip":
      return { type, axis: "horizontal" };
    case "trim":
      return { type, threshold: 10 };
    case "pad":
      return {
        type,
        top: 16,
        right: 16,
        bottom: 16,
        left: 16,
        color: "transparent",
      };
    case "adjust":
      return { type, brightness: 1, contrast: 1, saturation: 1, hue: 0 };
    case "sharpen":
      return { type, sigma: 1 };
    case "denoise":
      return { type, size: 3 };
    case "ai":
      return {
        type,
        purpose: "edit",
        providerId: provider?.id ?? "",
        model: provider?.models[0] ?? "",
        prompt: "保留主体与构图，修复选区中的细节",
        width: Math.max(128, Math.min(4096, image?.width ?? 1024)),
        height: Math.max(128, Math.min(4096, image?.height ?? 1024)),
      };
  }
}
export function ProcessingEditorHost() {
  const [sources, setSources] = useState<ImageRef[] | null>(null);
  const [context, setContext] = useState<ProcessingSaveContext>({});
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (
        event as CustomEvent<
          ImageRef[] | { sources: ImageRef[]; context: ProcessingSaveContext }
        >
      ).detail;
      const store = useStore.getState();
      setContext(
        Array.isArray(detail)
          ? store.page === "library"
            ? {
                projectId: store.query.projectId,
                collectionId: store.query.collectionId,
              }
            : {}
          : detail.context,
      );
      setSources(Array.isArray(detail) ? detail : detail.sources);
    };
    window.addEventListener("workshop:processing", listener);
    return () => window.removeEventListener("workshop:processing", listener);
  }, []);
  return sources ? (
    <ProcessingEditor
      sources={sources}
      context={context}
      onClose={() => setSources(null)}
    />
  ) : null;
}
function ProcessingEditor({
  sources,
  context,
  onClose,
}: {
  sources: ImageRef[];
  context: ProcessingSaveContext;
  onClose: () => void;
}) {
  const jobs = useStore((s) => s.jobs);
  const [inputs, setInputs] = useState<ProcessingInput[]>([]),
    [index, setIndex] = useState(0),
    [preview, setPreview] = useState<ProcessingInput | null>(null),
    [previewError, setPreviewError] = useState("");
  const [operations, setOperations] = useState<ImageOperation[]>([]),
    [past, setPast] = useState<ImageOperation[][]>([]),
    [future, setFuture] = useState<ImageOperation[][]>([]);
  const [form, setForm] = useState<ImageOperation>(defaultOperation("resize")),
    [editIndex, setEditIndex] = useState(-1),
    [crop, setCrop] = useState<PercentCrop>({
      unit: "%",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    }),
    [cropAspect, setCropAspect] = useState<number | undefined>();
  const [providers, setProviders] = useState<GenerationProviderConfig[]>([]),
    [showProviders, setShowProviders] = useState(false),
    [recipes, setRecipes] = useState<ProcessingRecipe[]>([]),
    [recipeName, setRecipeName] = useState("");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [compare, setCompare] = useState<"after" | "side" | "slider">("side"),
    [divider, setDivider] = useState(50),
    [maskOpen, setMaskOpen] = useState(false);
  const [plan, setPlan] = useState<ProcessingPlan | null>(null),
    [runId, setRunId] = useState(""),
    [runs, setRuns] = useState<ProcessingRun[]>([]),
    [detail, setDetail] = useState<{
      run: ProcessingRun;
      inputs: ProcessingInput[];
      artifacts: ProcessingArtifact[];
      session?: AgentSession;
    } | null>(null),
    [selected, setSelected] = useState<string[]>([]);
  const [brief, setBrief] = useState(""),
    [assistantJob, setAssistantJob] = useState(""),
    [sessionId, setSessionId] = useState(""),
    [selectedProviderId, setSelectedProviderId] = useState(""),
    [selectedModel, setSelectedModel] = useState("");
  const [projects, setProjects] = useState<Project[]>([]),
    [projectId, setProjectId] = useState(context.projectId ?? ""),
    [saveOpen, setSaveOpen] = useState(false),
    [pageRequest, setPageRequest] = useState<any | null>(null),
    [pageNumber, setPageNumber] = useState(0);
  const previewSerial = useRef(0),
    alive = useRef(true),
    receivedJob = useRef("");
  const defaultSelectedRun = useRef("");
  const input = inputs[index],
    available = providers.filter((p) => p.enabled && p.capabilities.references),
    provider =
      form.type === "ai"
        ? providers.find((p) => p.id === form.providerId)
        : undefined;
  const localPrefix = operations.slice(
    0,
    editIndex >= 0
      ? editIndex
      : operations.findIndex((op) => op.type === "ai") < 0
        ? operations.length
        : operations.findIndex((op) => op.type === "ai"),
  );
  const working = preview ?? input;
  async function perform(action: () => Promise<any>) {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error: any) {
      setMessage(error.message);
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const [r, t, p] = await Promise.all([
      call<ProcessingRun[]>("processing.list"),
      call<ProcessingRecipe[]>("processing.recipes.list"),
      call<Project[]>("projects.list"),
    ]);
    if (alive.current) {
      setRuns(r);
      setRecipes(t);
      setProjects(p);
    }
  }
  async function add(raw: any) {
    try {
      const result = await call<ProcessingInput>("processing.inputs.add", raw);
      if (alive.current) setInputs((list) => [...list, result]);
    } catch (error: any) {
      if (error.message.includes("页或帧")) {
        setPageRequest(raw);
        setPageNumber(0);
        setMessage(error.message);
      } else throw error;
    }
  }
  useEffect(() => {
    alive.current = true;
    void perform(async () => {
      const [p, projects] = await Promise.all([
        call<GenerationProviderConfig[]>("generation.providers.list"),
        call<Project[]>("projects.list"),
      ]);
      setProviders(p);
      setProjects(projects);
      const selected = p.find((p) => p.enabled && p.capabilities.references);
      setSelectedProviderId(selected?.id ?? "");
      setSelectedModel(selected?.models[0] ?? "");
      for (const source of sources) await add({ source });
      await refresh();
    });
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const serial = ++previewSerial.current;
    setPreview(null);
    setPreviewError("");
    if (!input) return;
    const timer = setTimeout(() => {
      void call<ProcessingInput>("processing.previewImage", {
        source: { kind: "input", id: input.id },
        operations: localPrefix,
      })
        .then((p) => {
          if (alive.current && serial === previewSerial.current) setPreview(p);
        })
        .catch((e) => {
          if (alive.current && serial === previewSerial.current)
            setPreviewError(e.message);
        });
    }, 350);
    return () => clearTimeout(timer);
  }, [input?.id, JSON.stringify(localPrefix)]);
  useEffect(
    () =>
      window.workshop.onEvent((e) => {
        if (e.type === "processing.updated" || e.type === "catalog.changed") {
          void refresh().catch(report);
          if (runId)
            void call<any>("processing.detail", { id: runId })
              .then(setDetail)
              .catch(report);
        }
      }),
    [runId],
  );
  useEffect(() => {
    if (runId)
      void call<any>("processing.detail", { id: runId })
        .then(setDetail)
        .catch(report);
  }, [runId]);
  useEffect(() => {
    if (
      !detail ||
      !["completed", "failed", "cancelled", "interrupted"].includes(
        detail.run.status,
      ) ||
      defaultSelectedRun.current === detail.run.id
    )
      return;
    defaultSelectedRun.current = detail.run.id;
    setSelected(
      detail.run.items
        .map((i) => i.artifactIds.at(-1))
        .filter(
          (id): id is string =>
            !!id && detail.artifacts.some((a) => a.id === id),
        ),
    );
  }, [detail]);
  useEffect(() => {
    const job = jobs.find((j) => j.id === assistantJob);
    if (
      !job ||
      !["completed", "failed", "interrupted", "cancelled"].includes(
        job.status,
      ) ||
      receivedJob.current === job.id
    )
      return;
    receivedJob.current = job.id;
    if (job.result?.plan) {
      commit(job.result.plan.operations, false);
      setPlan(job.result.plan);
    } else setMessage(job.error ?? "助手任务未完成");
  }, [jobs, assistantJob]);
  function commit(next: ImageOperation[], history = true) {
    if (history) {
      setPast((p) => [...p.slice(-39), operations]);
      setFuture([]);
    }
    setOperations(next);
    setPlan(null);
    setEditIndex(-1);
    setSelected([]);
  }
  function update(patch: any) {
    setForm((old) => ({ ...old, ...patch }) as ImageOperation);
  }
  useEffect(() => {
    if (form.type === "crop" && working)
      setCrop({
        unit: "%",
        x: (form.x / working.width) * 100,
        y: (form.y / working.height) * 100,
        width: (form.width / working.width) * 100,
        height: (form.height / working.height) * 100,
      });
  }, [JSON.stringify(form), working?.id]);
  function changeGeometry(next: ImageOperation[], changed: number) {
    let removed = false;
    next = next.map((op, i) => {
      if (i > changed && op.type === "ai" && op.maskId) {
        removed = true;
        const { maskId: _, maskInputHash: __, ...clean } = op;
        return clean;
      }
      return op;
    });
    if (removed) setMessage("前置步骤已改变，后续蒙版已清除，请重新绘制");
    commit(next);
  }
  function saveStep() {
    const next = operations.slice();
    if (editIndex < 0) next.push(structuredClone(form));
    else next[editIndex] = structuredClone(form);
    changeGeometry(next, editIndex < 0 ? next.length - 1 : editIndex);
  }
  function numberField(
    key: string,
    label: string,
    min: number,
    max: number,
    step = 1,
  ) {
    return (
      <ProcessingNumberField
        key={`${input?.id}:${form.type}:${editIndex}:${key}`}
        label={label}
        value={(form as any)[key] ?? 0}
        min={min}
        max={max}
        step={step}
        onChange={(value) => update({ [key]: value })}
      />
    );
  }
  async function chooseFiles() {
    const paths = await window.workshop.choose({
      kind: "files",
      title: "选择加工图片",
    });
    for (const path of paths) await add({ path });
  }
  async function checkPlan() {
    if (!operations.length) throw new Error("请先添加加工步骤");
    const checked = await call<ProcessingPlan>("processing.preview", {
      inputIds: inputs.map((i) => i.id),
      operations,
      ...(sessionId ? { sessionId } : {}),
    });
    setPlan(checked);
  }
  const displayed =
    detail?.artifacts.filter((a) => selected.includes(a.id)) ?? [];
  function describe(op: ImageOperation): string {
    switch (op.type) {
      case "resize":
        return `${op.width} × ${op.height} · ${op.kernel === "nearest" ? "最近邻" : "平滑"}`;
      case "crop":
        return `${op.width} × ${op.height} · 坐标 ${op.x}, ${op.y}`;
      case "ai":
        return `${op.width} × ${op.height} · ${op.model || "当前 Codex 模型"} · ${op.prompt.slice(0, 60)}`;
      case "rotate":
        return `${op.angle}°`;
      case "flip":
        return op.axis === "horizontal" ? "水平" : "垂直";
      case "pad":
        return `上 ${op.top} · 右 ${op.right} · 下 ${op.bottom} · 左 ${op.left}`;
      case "trim":
        return `透明阈值 ${op.threshold}`;
      case "adjust":
        return `亮度 ${op.brightness} · 对比 ${op.contrast} · 饱和 ${op.saturation} · 色相 ${op.hue}°${op.tint ? ` · ${op.tint}` : ""}`;
      case "sharpen":
        return `强度 ${op.sigma}`;
      case "denoise":
        return `${op.size} × ${op.size}`;
    }
  }
  return (
    <Modal title="图像加工" wide dismissOnBackdrop={false} onClose={onClose}>
      <div className="processing-shell">
        <aside className="processing-tools">
          <ClientButton
            disabled={busy}
            onClick={() => void perform(chooseFiles)}
          >
            添加图片
          </ClientButton>
          <div className="processing-inputs">
            {inputs.map((item, i) => (
              <button
                key={item.id}
                className={index === i ? "selected" : ""}
                onClick={() => {
                  setIndex(i);
                  setSelected([]);
                }}
              >
                <img src={item.previewUrl} />
                <span>
                  {item.title}
                  <small>
                    {item.width} × {item.height}
                  </small>
                </span>
                <span
                  role="button"
                  aria-label={`移除 ${item.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setInputs((list) => list.filter((x) => x.id !== item.id));
                    setIndex(0);
                  }}
                >
                  ×
                </span>
              </button>
            ))}
          </div>
          <Field label="加工工具">
            <select
              aria-label="加工工具"
              value={form.type}
              onChange={(e) => {
                setForm(
                  defaultOperation(
                    e.target.value as ImageOperation["type"],
                    working,
                    available[0],
                  ),
                );
                setEditIndex(-1);
              }}
            >
              {Object.entries(operationLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          {["resize", "crop", "ai"].includes(form.type) && (
            <div className="form-grid">
              {numberField("width", "宽度", 1, 16384)}
              {numberField("height", "高度", 1, 16384)}
            </div>
          )}
          {form.type === "resize" && (
            <>
              <Field label="尺寸适配">
                <select
                  value={form.fit}
                  onChange={(e) => update({ fit: e.target.value })}
                >
                  <option value="contain">等比缩放并补透明边</option>
                  <option value="cover">等比填满并裁切</option>
                  <option value="fill">拉伸</option>
                </select>
              </Field>
              <Field label="采样">
                <select
                  value={form.kernel}
                  onChange={(e) => update({ kernel: e.target.value })}
                >
                  <option value="lanczos3">平滑缩放</option>
                  <option value="nearest">最近邻 · 像素图</option>
                </select>
              </Field>
            </>
          )}
          {form.type === "crop" && (
            <>
              <div className="form-grid">
                {numberField("x", "左坐标", 0, 16384)}
                {numberField("y", "上坐标", 0, 16384)}
              </div>
              <Field label="裁剪比例">
                <select
                  onChange={(e) => {
                    const ratio = Number(e.target.value);
                    setCropAspect(ratio || undefined);
                    const w = working?.width ?? 512,
                      h = working?.height ?? 512;
                    const width = ratio ? Math.min(w, h * ratio) : w,
                      height = ratio ? width / ratio : h;
                    update({
                      x: 0,
                      y: 0,
                      width: Math.floor(width),
                      height: Math.floor(height),
                    });
                    setCrop({
                      unit: "%",
                      x: 0,
                      y: 0,
                      width: (width / w) * 100,
                      height: (height / h) * 100,
                    });
                  }}
                >
                  <option value="0">自由</option>
                  <option value="1">1:1</option>
                  <option value="1.7777777778">16:9</option>
                  <option value="0.75">3:4</option>
                </select>
              </Field>
              <small>在预览中拖动选区，坐标按工作图原尺寸计算。</small>
            </>
          )}
          {form.type === "rotate" && (
            <Field label="角度">
              <select
                value={form.angle}
                onChange={(e) => update({ angle: Number(e.target.value) })}
              >
                <option value="90">90°</option>
                <option value="180">180°</option>
                <option value="270">270°</option>
              </select>
            </Field>
          )}
          {form.type === "flip" && (
            <Field label="方向">
              <select
                value={form.axis}
                onChange={(e) => update({ axis: e.target.value })}
              >
                <option value="horizontal">水平</option>
                <option value="vertical">垂直</option>
              </select>
            </Field>
          )}
          {form.type === "trim" && numberField("threshold", "裁切阈值", 0, 255)}
          {form.type === "pad" && (
            <>
              <div className="form-grid">
                {["top", "right", "bottom", "left"].map((key, i) =>
                  numberField(
                    key,
                    ["上边", "右边", "下边", "左边"][i],
                    0,
                    8192,
                  ),
                )}
              </div>
              <Field label="填充颜色">
                <input
                  value={form.color}
                  onChange={(e) => update({ color: e.target.value })}
                  placeholder="transparent 或 #ffffff"
                />
              </Field>
            </>
          )}
          {form.type === "adjust" && (
            <>
              {numberField("brightness", "亮度", 0, 4, 0.05)}
              {numberField("contrast", "对比度", 0, 4, 0.05)}
              {numberField("saturation", "饱和度", 0, 4, 0.05)}
              {numberField("hue", "色相", -360, 360)}
              <Field label="着色（可选）">
                <input
                  value={form.tint ?? ""}
                  placeholder="#3366ff"
                  onChange={(e) =>
                    update({ tint: e.target.value || undefined })
                  }
                />
              </Field>
            </>
          )}
          {form.type === "sharpen" &&
            numberField("sigma", "锐化强度", 0.3, 10, 0.1)}
          {form.type === "denoise" &&
            numberField("size", "降噪窗口（奇数）", 1, 9, 2)}
          {form.type === "ai" && (
            <>
              <Field label="AI 用途">
                <select
                  value={form.purpose}
                  onChange={(e) =>
                    update({
                      purpose: e.target.value,
                      prompt: (
                        {
                          edit: "保留主体与构图，修复选区中的细节",
                          recolor: "仅改变主体的颜色，保留造型、纹理与光照",
                          removeBackground:
                            "移除背景，保留完整主体与自然边缘，输出透明背景",
                          restore: "修复噪点和损坏细节，保持原有内容与风格",
                          upscale: "提升分辨率和细节，保持原有内容与风格",
                        } as Record<string, string>
                      )[e.target.value],
                    })
                  }
                >
                  {Object.entries(purposeLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="加工连接">
                <select
                  value={form.providerId}
                  onChange={(e) => {
                    const p = available.find((p) => p.id === e.target.value);
                    update({
                      providerId: p?.id ?? "",
                      model: p?.models[0] ?? "",
                      maskId: undefined,
                      maskInputHash: undefined,
                    });
                  }}
                >
                  <option value="">选择连接</option>
                  {available.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="图像模型">
                <input
                  list="processing-models"
                  value={form.model}
                  onChange={(e) => update({ model: e.target.value })}
                />
                <datalist id="processing-models">
                  {provider?.models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </datalist>
              </Field>
              <Field label="加工要求">
                <textarea
                  rows={4}
                  value={form.prompt}
                  onChange={(e) => update({ prompt: e.target.value })}
                />
              </Field>
              {provider?.kind === "runninghub" &&
                provider.bindings
                  .filter((b) => b.role === "custom")
                  .map((b) => {
                    const key = `${b.nodeId}.${b.fieldName}`,
                      original =
                        provider.workflowJSON?.[b.nodeId]?.inputs[b.fieldName];
                    return (
                      <Field key={key} label={b.label || key}>
                        <input
                          type={
                            typeof original === "number" ? "number" : "text"
                          }
                          value={
                            form.workflowValues?.[key] === undefined
                              ? ""
                              : String(form.workflowValues[key])
                          }
                          placeholder={`工作流默认：${String(original ?? "")}`}
                          onChange={(e) => {
                            const values = { ...form.workflowValues };
                            if (e.target.value === "") delete values[key];
                            else
                              values[key] =
                                typeof original === "number"
                                  ? Number(e.target.value)
                                  : typeof original === "boolean"
                                    ? e.target.value === "true"
                                    : e.target.value;
                            update({ workflowValues: values });
                          }}
                        />
                      </Field>
                    );
                  })}
              <ClientButton
                disabled={
                  !provider?.capabilities.mask ||
                  !working ||
                  inputs.length !== 1 ||
                  !preview
                }
                onClick={() => setMaskOpen(true)}
              >
                {form.maskId ? "重画局部蒙版" : "绘制局部蒙版"}
              </ClientButton>
              {form.maskId && (
                <ClientButton
                  onClick={() =>
                    update({ maskId: undefined, maskInputHash: undefined })
                  }
                >
                  清除蒙版
                </ClientButton>
              )}
              {provider?.kind === "runninghub" &&
                !provider.purposes?.includes(form.purpose) && (
                  <p className="processing-error">
                    请在连接设置中标记工作流用途。
                  </p>
                )}
            </>
          )}
          <ClientButton
            className="primary"
            disabled={!input || busy}
            onClick={saveStep}
          >
            {editIndex < 0 ? "添加步骤" : "更新步骤"}
          </ClientButton>
          <ClientButton onClick={() => setShowProviders(true)}>
            连接与工作流设置
          </ClientButton>
        </aside>
        <main className="processing-preview">
          <div className="processing-toolbar">
            <ClientButton
              disabled={!past.length}
              onClick={() => {
                const old = past.at(-1)!;
                setPast((p) => p.slice(0, -1));
                setFuture((f) => [operations, ...f]);
                setOperations(old);
                setPlan(null);
                setSelected([]);
              }}
            >
              撤销
            </ClientButton>
            <ClientButton
              disabled={!future.length}
              onClick={() => {
                setPast((p) => [...p, operations]);
                setOperations(future[0]);
                setFuture((f) => f.slice(1));
                setPlan(null);
                setSelected([]);
              }}
            >
              重做
            </ClientButton>
            <ClientButton onClick={() => commit([])}>恢复原图</ClientButton>
            <select
              aria-label="对比方式"
              value={compare}
              onChange={(e) => setCompare(e.target.value as typeof compare)}
            >
              <option value="side">并排比较</option>
              <option value="slider">拖动对比</option>
              <option value="after">加工预览</option>
            </select>
          </div>
          {working ? (
            form.type === "crop" ? (
              <div className="processing-crop">
                <ReactCrop
                  aspect={cropAspect}
                  crop={crop}
                  onChange={(_, percent) => setCrop(percent)}
                  onComplete={(_, percent) =>
                    update({
                      x: Math.max(
                        0,
                        Math.round((percent.x / 100) * working.width),
                      ),
                      y: Math.max(
                        0,
                        Math.round((percent.y / 100) * working.height),
                      ),
                      width: Math.max(
                        1,
                        Math.floor((percent.width / 100) * working.width),
                      ),
                      height: Math.max(
                        1,
                        Math.floor((percent.height / 100) * working.height),
                      ),
                    })
                  }
                >
                  <img src={working.previewUrl} alt="工作图裁剪" />
                </ReactCrop>
              </div>
            ) : (
              <div className={`processing-images ${compare}`}>
                {compare === "side" && (
                  <figure>
                    <img
                      src={
                        displayed.length > 1
                          ? displayed[0].previewUrl
                          : input?.previewUrl
                      }
                      alt="原始输入"
                    />
                    <figcaption>
                      {displayed.length > 1 ? "选中结果 1" : "原图"}
                    </figcaption>
                  </figure>
                )}
                <figure className="processing-after">
                  <img
                    src={displayed.at(-1)?.previewUrl ?? working.previewUrl}
                    alt="加工预览"
                  />
                  {compare === "slider" && (
                    <img
                      className="processing-before"
                      style={{ clipPath: `inset(0 ${100 - divider}% 0 0)` }}
                      src={input?.previewUrl}
                      alt="原图对比"
                    />
                  )}
                  <figcaption>
                    {displayed.at(-1)?.width ?? working.width} ×{" "}
                    {displayed.at(-1)?.height ?? working.height} · 无损预览
                  </figcaption>
                </figure>
              </div>
            )
          ) : (
            <div className="processing-empty">添加素材或图片，开始加工</div>
          )}
          {compare === "slider" && (
            <input
              aria-label="对比位置"
              type="range"
              min="0"
              max="100"
              value={divider}
              onChange={(e) => setDivider(Number(e.target.value))}
            />
          )}
          {!displayed.length && operations.some((op) => op.type === "ai") && (
            <small>
              当前预览显示 AI 步骤之前的本地加工；云端结果在启动后显示。
            </small>
          )}
          {(message || previewError) && (
            <p role="status" className="processing-error">
              {message || previewError}
            </p>
          )}
          {!!detail?.artifacts.length && (
            <div className="processing-artifacts">
              {detail.artifacts.map((a) => (
                <article
                  key={a.id}
                  className={selected.includes(a.id) ? "selected" : ""}
                >
                  <label>
                    <input
                      type="checkbox"
                      aria-label={`选择加工结果 ${a.id}`}
                      checked={selected.includes(a.id)}
                      onChange={(e) =>
                        setSelected((s) =>
                          e.target.checked
                            ? [...s, a.id]
                            : s.filter((id) => id !== a.id),
                        )
                      }
                    />
                    <img src={a.previewUrl} />
                    <small>
                      {operationLabels[a.operation.type]} · {a.width}×{a.height}
                      {a.importedAssetIds?.length ? " · 已入库" : ""}
                    </small>
                  </label>
                  <ClientButton
                    onClick={() =>
                      void perform(async () => {
                        const next = await call<ProcessingInput>(
                          "processing.inputs.add",
                          { source: { kind: "artifact", id: a.id } },
                        );
                        setInputs([next]);
                        setIndex(0);
                        commit([], false);
                        setPast([]);
                        setFuture([]);
                        setSelected([]);
                        setDetail(null);
                        setRunId("");
                        setSessionId("");
                        setAssistantJob("");
                      })
                    }
                  >
                    从此结果继续
                  </ClientButton>
                  <ClientButton
                    onClick={() =>
                      void perform(async () => {
                        await call("processing.delete", { id: a.id });
                        setSelected((s) => s.filter((id) => id !== a.id));
                        setDetail(
                          await call("processing.detail", { id: runId }),
                        );
                      })
                    }
                  >
                    删除
                  </ClientButton>
                </article>
              ))}
            </div>
          )}
          {!!detail && (
            <div className="processing-toolbar">
              <select
                aria-label="加工结果加入项目"
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
              >
                <option value="">仅加入素材库</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ClientButton
                className="primary"
                disabled={!selected.length || busy}
                onClick={() =>
                  void perform(async () => {
                    setSaveOpen(true);
                  })
                }
              >
                保存与整理
              </ClientButton>
            </div>
          )}
        </main>
        <aside className="processing-steps">
          <h3>加工步骤 · {inputs.length} 张输入</h3>
          <ol>
            {operations.map((op, i) => (
              <li key={i}>
                <button
                  onClick={() => {
                    setEditIndex(i);
                    setForm(structuredClone(op));
                    setSelected([]);
                  }}
                >
                  {i + 1}. {operationLabels[op.type]}
                  {op.type === "ai" ? ` · ${purposeLabels[op.purpose]}` : ""}
                  <small>{describe(op)}</small>
                </button>
                <ClientButton
                  onClick={() => {
                    const next = operations.filter((_, index) => i !== index);
                    changeGeometry(next, i - 1);
                  }}
                >
                  移除
                </ClientButton>
              </li>
            ))}
          </ol>
          <ClientButton
            className="primary"
            disabled={busy || !operations.length || !inputs.length}
            onClick={() => void perform(checkPlan)}
          >
            检查整套方案
          </ClientButton>
          {plan && (
            <div className="processing-plan">
              <b>方案确认</b>
              <p>
                {plan.inputIds.length} 张输入 · {plan.operations.length} 步
              </p>
              <p>
                输出：{plan.inputIds.length} 项最终结果 · 无损 PNG ·
                保留透明通道
              </p>
              <p>
                图像调用 {plan.totalCalls} 次 · 上限 {plan.maxCalls} 次
                {plan.sessionId ? "（含最多一次修正）" : ""}
              </p>
              <p>
                费用：
                {plan.estimatedCost !== undefined
                  ? `${plan.estimatedCost.toFixed(2)} ${plan.currency}`
                  : "未知"}
                {plan.sessionId ? " · 助手最多八个分析回合" : ""}
              </p>
              {plan.providers.map((p) => (
                <small key={p.id}>
                  {p.name} ·{" "}
                  {plan.operations
                    .filter((op) => op.type === "ai" && op.providerId === p.id)
                    .map((op) =>
                      op.type === "ai" ? op.model || "当前 Codex 模型" : "",
                    )
                    .join("、")}
                </small>
              ))}
              {plan.warnings.map((w, i) => (
                <small key={i}>{w}</small>
              ))}
              <ClientButton
                className="primary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    const result = await call<{ runId: string }>(
                      "processing.start",
                      { planId: plan.id },
                    );
                    setRunId(result.runId);
                    setSelected([]);
                    setPlan(null);
                    setMessage("加工已启动，可在后台任务中停止或重试");
                  })
                }
              >
                启动整套方案
              </ClientButton>
            </div>
          )}
          <h3>加工配方</h3>
          <Field label="配方名称">
            <input
              value={recipeName}
              onChange={(e) => setRecipeName(e.target.value)}
            />
          </Field>
          <ClientButton
            disabled={!recipeName.trim() || !operations.length}
            onClick={() =>
              void perform(async () => {
                await call("processing.recipes.save", {
                  name: recipeName,
                  operations,
                });
                await refresh();
              })
            }
          >
            保存配方
          </ClientButton>
          {recipes.map((r) => (
            <div className="processing-recipe" key={r.id}>
              <button onClick={() => commit(structuredClone(r.operations))}>
                {r.name}
              </button>
              <button
                aria-label={`删除配方 ${r.name}`}
                onClick={() =>
                  void perform(async () => {
                    await call("processing.recipes.delete", { id: r.id });
                    await refresh();
                  })
                }
              >
                ×
              </button>
            </div>
          ))}
          <h3>制作助手</h3>
          <Field label="需求">
            <textarea
              rows={3}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="例如：裁成方形、改为蓝色调，输出 512×512 图标"
            />
          </Field>
          <Field label="助手可使用的图像连接">
            <select
              value={selectedProviderId}
              onChange={(e) => {
                const p = available.find((p) => p.id === e.target.value);
                setSelectedProviderId(p?.id ?? "");
                setSelectedModel(p?.models[0] ?? "");
              }}
            >
              <option value="">只用本地工具</option>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          {selectedProviderId && (
            <Field label="助手可使用的图像模型">
              <input
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              />
            </Field>
          )}
          <ClientButton
            disabled={
              busy ||
              !brief.trim() ||
              !inputs.length ||
              (!!assistantJob &&
                !["completed", "failed", "interrupted", "cancelled"].includes(
                  jobs.find((j) => j.id === assistantJob)?.status ?? "queued",
                ))
            }
            onClick={() =>
              void perform(async () => {
                const result = await call<{ jobId: string; sessionId: string }>(
                  sessionId
                    ? "processing.assistant.continue"
                    : "processing.assistant.plan",
                  {
                    inputIds: inputs.map((i) => i.id),
                    brief,
                    operations,
                    selectedProviderId: selectedProviderId || undefined,
                    selectedModel,
                    sessionId: sessionId || undefined,
                  },
                );
                setAssistantJob(result.jobId);
                setSessionId(result.sessionId);
                setMessage("助手正在编写方案；完成后请检查并启动");
              })
            }
          >
            让助手提出方案
          </ClientButton>
          {detail?.session?.history.slice(-2).map((h, i) => (
            <small className="processing-agent-note" key={i}>
              {(() => {
                try {
                  return JSON.parse(h.text).note || h.text;
                } catch {
                  return h.text;
                }
              })()}
            </small>
          ))}
          <h3>加工历史</h3>
          {runs.map((r) => (
            <button
              className="processing-history"
              key={r.id}
              onClick={() =>
                void perform(async () => {
                  const history = await call<any>("processing.detail", {
                    id: r.id,
                  });
                  setInputs(history.inputs);
                  setIndex(0);
                  commit(structuredClone(history.run.plan.operations));
                  setSessionId(history.session?.id ?? "");
                  setBrief(history.session?.brief ?? "");
                  setAssistantJob("");
                  setDetail(history);
                  setRunId(r.id);
                  setSelected([]);
                })
              }
            >
              {new Date(r.createdAt).toLocaleString()}
              <small>
                {(
                  {
                    completed: "完成",
                    failed: "部分失败",
                    interrupted: "需检查",
                    cancelled: "已取消",
                    running: "加工中",
                    queued: "等待中",
                    paused: "已暂停",
                  } as Record<string, string>
                )[r.status] ?? r.status}{" "}
                · {r.items.length} 张 · 调用 {r.calls}/{r.plan.maxCalls}
              </small>
            </button>
          ))}
        </aside>
      </div>
      {showProviders && (
        <GenerationProviders
          providers={providers}
          onChange={setProviders}
          onClose={() => setShowProviders(false)}
        />
      )}
      {saveOpen && (
        <ProcessingSaveDialog
          artifactIds={selected}
          context={{ ...context, projectId: projectId || undefined }}
          brief={brief || detail?.session?.brief || ""}
          providerId={
            detail?.session?.providerId ||
            providers.find((p) => p.enabled && p.kind === "codex")?.id
          }
          model={detail?.session?.model}
          onClose={() => setSaveOpen(false)}
          onNavigate={onClose}
        />
      )}
      {maskOpen && working && form.type === "ai" && (
        <GenerationMask
          reference={{ ...working, name: working.title, role: "reference" }}
          onClose={() => setMaskOpen(false)}
          saveMask={async (base64) => {
            const mask = await call<ProcessingInput>("processing.mask.save", {
              source: { kind: "input", id: working.id },
              base64,
            });
            update({ maskId: mask.id, maskInputHash: mask.maskInputHash });
            return {
              ...mask,
              name: mask.title,
              role: "mask",
            } as GenerationReference;
          }}
          onSave={() => {}}
        />
      )}
      {pageRequest && (
        <Modal title="选择图片页或动画帧" onClose={() => setPageRequest(null)}>
          <Field label="页 / 帧序号（从 0 开始）">
            <input
              type="number"
              min="0"
              value={pageNumber}
              onChange={(e) => setPageNumber(Number(e.target.value))}
            />
          </Field>
          <ClientButton
            onClick={() =>
              void perform(async () => {
                await add({ ...pageRequest, page: pageNumber });
                setPageRequest(null);
              })
            }
          >
            读取所选页
          </ClientButton>
        </Modal>
      )}
    </Modal>
  );
}
