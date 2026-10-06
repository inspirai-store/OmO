import { useEffect, useRef, useState } from "react";
import { ClientButton } from "./client-ui";
import { Field, Modal } from "./components";
import { call, useStore } from "./store";
import { categories, type Project, type Collection } from "../../shared/types";
import { entityCategories, gameplayTags } from "../../shared/entities";
import type {
  ProcessingAcceptItem,
  ProcessingSaveContext,
  ProcessingSaveItem,
  ProcessingSaveProposal,
} from "../../shared/processing";

const splitTags = (text: string) =>
  [
    ...new Set(
      text
        .split(/[,，、\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].slice(0, 40);
const fields: Array<keyof ProcessingAcceptItem> = [
  "title",
  "filename",
  "category",
  "entityCategory",
  "gameplayTags",
  "tags",
  "projectIds",
  "collectionIds",
];

function TagsField({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string[];
  label: string;
  disabled: boolean;
  onChange: (tags: string[]) => void;
}) {
  const [text, setText] = useState(value.join(", ")),
    [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value.join(", "));
  }, [JSON.stringify(value), focused]);
  return (
    <input
      aria-label={label}
      disabled={disabled}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(splitTags(e.target.value));
      }}
    />
  );
}

export function ProcessingSaveDialog({
  artifactIds,
  context,
  brief,
  providerId,
  model,
  onClose,
  onNavigate,
}: {
  artifactIds: string[];
  context: ProcessingSaveContext;
  brief: string;
  providerId?: string;
  model?: string;
  onClose: () => void;
  onNavigate: () => void;
}) {
  const [proposal, setProposal] = useState<ProcessingSaveProposal | null>(null);
  const [projects, setProjects] = useState<Project[]>([]),
    [collections, setCollections] = useState<Collection[]>([]);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saveJobId, setSaveJobId] = useState("");
  const [result, setResult] = useState<{
    assets: string[];
    projectIds: string[];
    collectionIds: string[];
    failures?: string[];
  } | null>(null);
  const [bulkCategory, setBulkCategory] = useState(""),
    [bulkTags, setBulkTags] = useState(""),
    [bulkPrefix, setBulkPrefix] = useState("");
  const [bulkProject, setBulkProject] = useState(""),
    [bulkCollection, setBulkCollection] = useState("");
  const [expanded, setExpanded] = useState<string[]>([]);
  const [editEpoch, setEditEpoch] = useState(0);
  const dirty = useRef<Record<string, Set<keyof ProcessingAcceptItem>>>({});
  const latest = useRef<ProcessingSaveProposal | null>(null),
    alive = useRef(true),
    serial = useRef(0),
    saved = useRef(false);
  const jobs = useStore((s) => s.jobs),
    epoch = useStore((s) => s.epoch);
  const job = jobs.find((j) => j.id === saveJobId),
    analysisJob = jobs.find((j) => j.id === proposal?.jobId);
  function receive(next: ProcessingSaveProposal) {
    if (!alive.current) return;
    const current = latest.current;
    for (const item of next.items) {
      const old = current?.items.find((i) => i.artifactId === item.artifactId);
      if (!old) continue;
      for (const key of dirty.current[item.artifactId] ?? []) {
        if (
          (item.submitted || saved.current) &&
          key !== "projectIds" &&
          key !== "collectionIds"
        )
          continue;
        (item as any)[key] = old[key];
      }
    }
    latest.current = next;
    setProposal(next);
  }
  async function refresh(id: string) {
    receive(
      await call<ProcessingSaveProposal>("processing.organize.detail", { id }),
    );
  }
  function pendingEdits(p: ProcessingSaveProposal) {
    return p.items
      .map((item) => {
        const edit: any = { artifactId: item.artifactId };
        for (const key of dirty.current[item.artifactId] ?? [])
          if (
            !item.submitted ||
            key === "projectIds" ||
            key === "collectionIds"
          )
            edit[key] = item[key];
        return edit;
      })
      .filter(
        (item) =>
          Object.keys(item).length > 1 &&
          (item.title === undefined || item.title.trim()) &&
          (item.filename === undefined || item.filename.trim()),
      );
  }
  useEffect(() => {
    alive.current = true;
    void (async () => {
      try {
        const [p, projects, collections] = await Promise.all([
          call<ProcessingSaveProposal>("processing.organize.preview", {
            artifactIds,
            context,
            brief,
            providerId,
            model,
          }),
          call<Project[]>("projects.list"),
          call<Collection[]>("collections.list"),
        ]);
        if (!alive.current) return;
        setProjects(projects);
        setCollections(collections);
        receive(p);
        if (p.estimatedCalls) {
          await call("processing.organize.start", { id: p.id });
          await refresh(p.id);
        }
      } catch (e: any) {
        if (alive.current) setError(e.message);
      }
    })();
    return () => {
      alive.current = false;
      const p = latest.current;
      if (p && !saved.current) {
        const items = pendingEdits(p);
        if (items.length)
          void call("processing.organize.update", { id: p.id, items }).catch(
            () => {},
          );
      }
    };
  }, []);
  useEffect(
    () =>
      window.workshop.onEvent((e) => {
        if (
          e.type === "processing.organize.updated" &&
          latest.current?.id === e.data?.proposalId
        )
          void refresh(e.data.proposalId).catch((e) => {
            if (alive.current) setError(e.message);
          });
      }),
    [],
  );
  useEffect(() => {
    if (proposal)
      void Promise.all([
        refresh(proposal.id),
        call<Project[]>("projects.list"),
        call<Collection[]>("collections.list"),
      ])
        .then(([, p, c]) => {
          if (alive.current) {
            setProjects(p);
            setCollections(c);
          }
        })
        .catch((e) => {
          if (alive.current) setError(e.message);
        });
  }, [epoch]);
  useEffect(() => {
    if (
      !job ||
      !["completed", "failed", "cancelled", "interrupted"].includes(job.status)
    )
      return;
    setBusy(false);
    if (job.result?.assets) setResult(job.result);
    if (job.status !== "completed")
      setError(job.error ?? "保存已停止，已完成内容保留");
    if (latest.current)
      void refresh(latest.current.id).catch((e) => setError(e.message));
  }, [job?.status, job?.updatedAt]);
  function patch(
    ids: string[],
    change:
      | Partial<ProcessingAcceptItem>
      | ((item: ProcessingSaveItem) => Partial<ProcessingAcceptItem>),
  ) {
    const current = latest.current;
    if (!current) return;
    const next = {
      ...current,
      items: current.items.map((item) => {
        if (!ids.includes(item.artifactId)) return item;
        const changes = typeof change === "function" ? change(item) : change;
        const keys = (dirty.current[item.artifactId] ??= new Set());
        for (const key of Object.keys(changes) as Array<
          keyof ProcessingAcceptItem
        >)
          keys.add(key);
        return { ...item, ...changes };
      }),
    };
    latest.current = next;
    setProposal(next);
    setEditEpoch((n) => n + 1);
  }
  useEffect(() => {
    if (!proposal || saved.current) return;
    const token = ++serial.current;
    const timer = setTimeout(() => {
      const p = latest.current;
      if (!p || saved.current) return;
      const items = pendingEdits(p);
      if (!items.length) return;
      void call<ProcessingSaveProposal>("processing.organize.update", {
        id: p.id,
        items,
      })
        .then((next) => {
          if (token === serial.current && alive.current) receive(next);
        })
        .catch((e) => {
          if (alive.current && !saved.current) setError(e.message);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [editEpoch]);
  const editableIds =
    proposal?.items
      .filter((i) => !i.importedAssetIds.length && !i.submitted)
      .map((i) => i.artifactId) ?? [];
  async function accept() {
    const p = latest.current;
    if (!p) return;
    setBusy(true);
    setError("");
    saved.current = true;
    try {
      const items = p.items.map((item) =>
        Object.fromEntries(
          ["artifactId", ...fields].map((key) => [key, (item as any)[key]]),
        ),
      );
      const result = await call<any>("processing.accept", {
        proposalId: p.id,
        items,
      });
      if (result.jobId) setSaveJobId(result.jobId);
      else {
        setResult(result);
        setBusy(false);
        await refresh(p.id);
      }
    } catch (e: any) {
      setError(e.message);
      setBusy(false);
      saved.current = false;
    }
  }
  function toggle(
    item: ProcessingSaveItem,
    kind: "projectIds" | "collectionIds",
    id: string,
  ) {
    patch([item.artifactId], {
      [kind]: item[kind].includes(id)
        ? item[kind].filter((v) => v !== id)
        : [...item[kind], id],
    });
  }
  function navigate(kind: "assets" | "project" | "collection", id?: string) {
    onClose();
    onNavigate();
    const store = useStore.getState();
    store.setQuery(
      kind === "project"
        ? { projectId: id }
        : kind === "collection"
          ? { collectionId: id }
          : { sort: "newest" },
    );
    if (kind === "assets")
      store.setSelection(result?.assets ?? [], result?.assets[0] ?? null);
  }
  return (
    <Modal title="保存与整理" onClose={onClose} wide dismissOnBackdrop={false}>
      <div className="processing-save">
        {!proposal && <p role="status">正在检查结果并准备整理建议…</p>}
        {proposal && (
          <>
            <div className="processing-save-summary">
              <p>
                {proposal.items.length} 张结果 · 自动识别预计{" "}
                {proposal.estimatedCalls} 次 Codex 分析 · 已调用{" "}
                {proposal.calls} 次 · 费用未知
              </p>
              <p role="status">
                {["queued", "analyzing"].includes(proposal.state)
                  ? "正在识图，可先修改字段或直接保存；你的修改会保留。"
                  : "整理建议已保留，请检查名称、分类和归属。"}
              </p>
              {proposal.jobId &&
                ["queued", "analyzing"].includes(proposal.state) && (
                  <ClientButton
                    onClick={() =>
                      void call("jobs.control", {
                        id: proposal.jobId,
                        action: "cancel",
                      })
                        .then(() => refresh(proposal.id))
                        .catch((e) => setError(e.message))
                    }
                  >
                    停止识别
                  </ClientButton>
                )}
              {analysisJob?.stage &&
                ["queued", "analyzing"].includes(proposal.state) && (
                  <small>{analysisJob.stage}</small>
                )}
              {proposal.warnings.map((w, i) => (
                <p className="processing-error" key={i}>
                  {w}
                </p>
              ))}
            </div>
            {!result && (
              <details className="processing-save-bulk">
                <summary>批量设置</summary>
                <div className="processing-save-grid">
                  <Field label="统一标题前缀">
                    <input
                      value={bulkPrefix}
                      onChange={(e) => setBulkPrefix(e.target.value)}
                    />
                  </Field>
                  <ClientButton
                    disabled={busy || !bulkPrefix.trim()}
                    onClick={() =>
                      patch(editableIds, (item) => ({
                        title: `${bulkPrefix.trim()}${item.title}`.slice(
                          0,
                          200,
                        ),
                      }))
                    }
                  >
                    应用标题前缀
                  </ClientButton>
                  <Field label="统一素材分类">
                    <select
                      value={bulkCategory}
                      onChange={(e) => setBulkCategory(e.target.value)}
                    >
                      <option value="">选择分类</option>
                      {Object.entries(categories).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <ClientButton
                    disabled={busy || !bulkCategory}
                    onClick={() =>
                      patch(editableIds, {
                        category:
                          bulkCategory as ProcessingAcceptItem["category"],
                      })
                    }
                  >
                    应用分类
                  </ClientButton>
                  <Field label="追加标签">
                    <input
                      value={bulkTags}
                      onChange={(e) => setBulkTags(e.target.value)}
                      placeholder="用逗号分隔"
                    />
                  </Field>
                  <ClientButton
                    disabled={busy || !bulkTags.trim()}
                    onClick={() =>
                      patch(editableIds, (item) => ({
                        tags: [
                          ...new Set([...item.tags, ...splitTags(bulkTags)]),
                        ].slice(0, 40),
                      }))
                    }
                  >
                    追加标签
                  </ClientButton>
                  <Field label="批量项目">
                    <select
                      value={bulkProject}
                      onChange={(e) => setBulkProject(e.target.value)}
                    >
                      <option value="">选择项目</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <ClientButton
                    disabled={busy || !bulkProject}
                    onClick={() =>
                      patch(
                        proposal.items.map((i) => i.artifactId),
                        (item) => ({
                          projectIds: [
                            ...new Set([...item.projectIds, bulkProject]),
                          ],
                        }),
                      )
                    }
                  >
                    批量加入项目
                  </ClientButton>
                  <Field label="批量收藏集">
                    <select
                      value={bulkCollection}
                      onChange={(e) => setBulkCollection(e.target.value)}
                    >
                      <option value="">选择手动收藏集</option>
                      {collections
                        .filter((c) => !c.query)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <ClientButton
                    disabled={busy || !bulkCollection}
                    onClick={() =>
                      patch(
                        proposal.items.map((i) => i.artifactId),
                        (item) => ({
                          collectionIds: [
                            ...new Set([...item.collectionIds, bulkCollection]),
                          ],
                        }),
                      )
                    }
                  >
                    批量加入收藏集
                  </ClientButton>
                </div>
              </details>
            )}
            <div className="processing-save-items">
              {proposal.items.map((item, index) => {
                const immutable =
                  busy || !!item.importedAssetIds.length || !!item.submitted;
                const allPlaces = expanded.includes(item.artifactId);
                const projectChoices = allPlaces
                  ? projects
                  : projects.filter(
                      (p) =>
                        item.projectIds.includes(p.id) ||
                        item.recommendations.some(
                          (r) => r.kind === "project" && r.id === p.id,
                        ),
                    );
                const collectionChoices = (
                  allPlaces
                    ? collections
                    : collections.filter(
                        (c) =>
                          item.collectionIds.includes(c.id) ||
                          item.recommendations.some(
                            (r) => r.kind === "collection" && r.id === c.id,
                          ),
                      )
                ).filter((c) => !c.query);
                return (
                  <article
                    className="processing-save-item"
                    key={item.artifactId}
                  >
                    <div className="processing-save-thumb">
                      <img src={item.previewUrl} alt={item.title} />
                      <small>
                        {item.width}×{item.height} ·{" "}
                        {item.importedAssetIds.length
                          ? "已入库"
                          : item.analysis === "ai"
                            ? "AI 建议"
                            : item.analysis === "cached"
                              ? "已缓存的 AI 建议"
                              : "本地建议"}
                      </small>
                      <small>
                        {item.confidence === "low"
                          ? "内容待确认"
                          : item.confidence === "medium"
                            ? "建议检查"
                            : ""}
                      </small>
                    </div>
                    <div className="processing-save-fields">
                      <div className="processing-save-grid">
                        <Field label="中文标题">
                          <input
                            aria-label={`标题 ${index + 1}`}
                            disabled={immutable}
                            maxLength={200}
                            value={item.title}
                            onChange={(e) =>
                              patch([item.artifactId], {
                                title: e.target.value,
                              })
                            }
                          />
                        </Field>
                        <Field label="英文文件名">
                          <input
                            aria-label={`英文文件名 ${index + 1}`}
                            disabled={immutable}
                            maxLength={150}
                            value={item.filename}
                            onChange={(e) =>
                              patch([item.artifactId], {
                                filename: e.target.value,
                              })
                            }
                          />
                          <small>
                            {item.submitted
                              ? "已确定的入库文件名"
                              : `保存时自动追加 ${item.width}x${item.height} 与版本编号，重名时顺延。`}
                          </small>
                        </Field>
                        <Field label="素材分类">
                          <select
                            aria-label={`素材分类 ${index + 1}`}
                            disabled={immutable}
                            value={item.category}
                            onChange={(e) =>
                              patch([item.artifactId], {
                                category: e.target
                                  .value as ProcessingAcceptItem["category"],
                              })
                            }
                          >
                            {Object.entries(categories).map(([id, name]) => (
                              <option key={id} value={id}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="实体分类">
                          <select
                            aria-label={`实体分类 ${index + 1}`}
                            disabled={immutable}
                            value={item.entityCategory ?? ""}
                            onChange={(e) =>
                              patch([item.artifactId], {
                                entityCategory: (e.target.value ||
                                  null) as ProcessingAcceptItem["entityCategory"],
                              })
                            }
                          >
                            <option value="">不适用 / 未确定</option>
                            {Object.entries(entityCategories).map(
                              ([id, name]) => (
                                <option key={id} value={id}>
                                  {name}
                                </option>
                              ),
                            )}
                          </select>
                        </Field>
                      </div>
                      <Field label="标签">
                        <TagsField
                          label={`标签 ${index + 1}`}
                          disabled={immutable}
                          value={item.tags}
                          onChange={(tags) =>
                            patch([item.artifactId], { tags })
                          }
                        />
                      </Field>
                      <div
                        className="processing-save-gameplay"
                        role="group"
                        aria-label={`玩法标签 ${index + 1}`}
                      >
                        {Object.entries(gameplayTags).map(([id, label]) => (
                          <label key={id}>
                            <input
                              type="checkbox"
                              disabled={immutable}
                              checked={item.gameplayTags.includes(id as any)}
                              onChange={(e) =>
                                patch([item.artifactId], {
                                  gameplayTags: e.target.checked
                                    ? [...item.gameplayTags, id as any]
                                    : item.gameplayTags.filter((t) => t !== id),
                                })
                              }
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                      <p className="processing-save-reason">{item.reason}</p>
                      {item.classificationSuggestion &&
                        !item.importedAssetIds.length && (
                          <div className="processing-save-suggestion">
                            <p>
                              保留来源分类。AI 建议：
                              {
                                categories[
                                  item.classificationSuggestion.category
                                ]
                              }
                              {item.classificationSuggestion.entityCategory
                                ? ` · ${entityCategories[item.classificationSuggestion.entityCategory]}`
                                : ""}
                              。{item.classificationSuggestion.reason}
                            </p>
                            <ClientButton
                              disabled={immutable}
                              onClick={() =>
                                patch([item.artifactId], {
                                  category:
                                    item.classificationSuggestion!.category,
                                  entityCategory:
                                    item.classificationSuggestion!
                                      .entityCategory,
                                  gameplayTags:
                                    item.classificationSuggestion!.gameplayTags,
                                })
                              }
                            >
                              采用 AI 分类
                            </ClientButton>
                          </div>
                        )}
                      <div className="processing-save-destinations">
                        <strong>加入位置</strong>
                        {item.projectIds
                          .filter((id) => !projects.some((p) => p.id === id))
                          .map((id) => (
                            <label key={id}>
                              <input
                                type="checkbox"
                                checked
                                disabled={busy}
                                onChange={() => toggle(item, "projectIds", id)}
                              />
                              已删除的项目，请取消选择：{id}
                            </label>
                          ))}
                        {item.collectionIds
                          .filter(
                            (id) =>
                              !collections.some((c) => c.id === id && !c.query),
                          )
                          .map((id) => (
                            <label key={id}>
                              <input
                                type="checkbox"
                                checked
                                disabled={busy}
                                onChange={() =>
                                  toggle(item, "collectionIds", id)
                                }
                              />
                              收藏集已删除或改为智能规则，请取消选择：{id}
                            </label>
                          ))}
                        {!projectChoices.length &&
                          !collectionChoices.length && (
                            <small>没有明确匹配，可仅保存到素材库。</small>
                          )}
                        {projectChoices.map((p) => (
                          <label key={p.id}>
                            <input
                              type="checkbox"
                              aria-label={`加入项目 ${index + 1} ${p.name}`}
                              disabled={busy}
                              checked={item.projectIds.includes(p.id)}
                              onChange={() => toggle(item, "projectIds", p.id)}
                            />
                            <span>
                              项目：{p.name}
                              <small>
                                {
                                  item.recommendations.find(
                                    (r) =>
                                      r.kind === "project" && r.id === p.id,
                                  )?.reason
                                }
                              </small>
                            </span>
                          </label>
                        ))}
                        {collectionChoices.map((c) => (
                          <label key={c.id}>
                            <input
                              type="checkbox"
                              aria-label={`加入收藏集 ${index + 1} ${c.name}`}
                              disabled={busy}
                              checked={item.collectionIds.includes(c.id)}
                              onChange={() =>
                                toggle(item, "collectionIds", c.id)
                              }
                            />
                            <span>
                              收藏集：{c.name}
                              <small>
                                {
                                  item.recommendations.find(
                                    (r) =>
                                      r.kind === "collection" && r.id === c.id,
                                  )?.reason
                                }
                              </small>
                            </span>
                          </label>
                        ))}
                        {item.recommendations
                          .filter((r) => r.kind === "smartCollection")
                          .map((r) => (
                            <p className="processing-save-smart" key={r.id}>
                              智能收藏集：{r.name} · 将自动收录
                            </p>
                          ))}
                        <ClientButton
                          disabled={busy}
                          onClick={() =>
                            setExpanded((old) =>
                              old.includes(item.artifactId)
                                ? old.filter((id) => id !== item.artifactId)
                                : [...old, item.artifactId],
                            )
                          }
                        >
                          {allPlaces ? "收起位置" : "选择其他位置"}
                        </ClientButton>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
            {job && (
              <p role="status">
                {job.title} · {job.stage} · {Math.round(job.progress * 100)}%
              </p>
            )}
            {result && (
              <div className="processing-save-complete">
                <p>
                  {result.assets.length} 个素材已保存
                  {result.failures?.length
                    ? "，部分归属待补齐"
                    : "，可继续使用"}
                  。
                </p>
                <ClientButton
                  disabled={!result.assets.length}
                  onClick={() => navigate("assets")}
                >
                  查看入库素材
                </ClientButton>
                {result.projectIds
                  .filter((id) => projects.some((p) => p.id === id))
                  .map((id) => (
                    <ClientButton
                      key={id}
                      onClick={() => navigate("project", id)}
                    >
                      打开项目：{projects.find((p) => p.id === id)!.name}
                    </ClientButton>
                  ))}
                {result.collectionIds
                  .filter((id) => collections.some((c) => c.id === id))
                  .map((id) => (
                    <ClientButton
                      key={id}
                      onClick={() => navigate("collection", id)}
                    >
                      打开收藏集：{collections.find((c) => c.id === id)!.name}
                    </ClientButton>
                  ))}
              </div>
            )}
            <div className="modal-actions">
              <ClientButton onClick={onClose}>返回加工</ClientButton>
              {job && ["running", "queued", "paused"].includes(job.status) && (
                <ClientButton
                  onClick={() =>
                    void call("jobs.control", {
                      id: job.id,
                      action: "cancel",
                    }).catch((e) => setError(e.message))
                  }
                >
                  停止保存
                </ClientButton>
              )}
              <ClientButton
                className="primary"
                disabled={busy || !proposal.items.length}
                onClick={() => void accept()}
              >
                {busy
                  ? "正在保存…"
                  : result && !result.failures?.length
                    ? "补充所选归属"
                    : "确认保存并加入"}
              </ClientButton>
            </div>
          </>
        )}
        {error && (
          <p className="processing-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
