import { ClientButton } from "./client-ui";
import { useEffect, useState } from "react";
import type {
  Asset,
  AssetQuery,
  AssetSelection,
  Collection,
  ExportPlan,
  OrganizeRequest,
  Project,
  TextureSlot,
} from "../../shared/types";
import { openProcessing } from "../../shared/processing";
import { categories, defaultVariant } from "../../shared/types";
import { organizedTitle } from "../../shared/organize";
import { entityCategories, gameplayTags } from "../../shared/entities";
import { call, report, useStore } from "./store";
import { act, type Action } from "./WorkshopMenus";
import { Modal, Field, Loading } from "./components";
import { ImportFlow, ExportFlow, OrganizeFlow, CollectionFlow } from "./Flows";

export function WorkshopActions({
  projects,
  collections,
  onPreview,
  onCompare,
  onMaterial,
  onProject,
}: {
  projects: Project[];
  collections: Collection[];
  onPreview: (a: Asset) => void;
  onCompare: (a: Asset[]) => void;
  onMaterial: (a: Asset) => void;
  onProject: (p: Project | "new") => void;
}) {
  const [flow, setFlow] = useState<Action | null>(null),
    [exporting, setExporting] = useState<any>(null),
    [importing, setImporting] = useState<{
      paths: string[];
      projectId?: string;
    } | null>(null),
    [selection, setSelection] = useState<AssetSelection | null>(null),
    [details, setDetails] = useState<any>(null);
  async function select(action: Action) {
    const q = action.project
      ? {
          projectId: action.project.id,
          showRelated: true,
          includeAuxiliary: false,
        }
      : action.collection
        ? { collectionId: action.collection.id }
        : action.query;
    const mode = useStore.getState().aggregationMode;
    if (mode && !action.ids && !q?.trash) {
      const grouped = await call<{ ids: string[] }>("assets.groupSelection", {
        query: q ?? {},
        mode,
      });
      if (grouped.ids.length)
        return call<AssetSelection>("assets.selection", { ids: grouped.ids });
    }
    return call<AssetSelection>(
      "assets.selection",
      action.ids ? { ids: action.ids } : { query: q },
    );
  }
  useEffect(() => {
    async function run(a: Action) {
      if (a.type.startsWith("grid-") && a.type !== "grid-size") return;
      if (a.type === "new-project") {
        onProject("new");
        return;
      }
      if (a.type === "edit-project") {
        onProject(a.project!);
        return;
      }
      if (a.type === "import") {
        const paths = await window.workshop.choose({
          kind: a.data?.folder ? "folder" : "files",
          title: "导入素材",
        });
        if (paths.length)
          setImporting({ paths, projectId: a.query?.projectId });
        return;
      }
      if (
        ["confirm", "edit-collection", "new-collection", "grid-size"].includes(
          a.type,
        )
      ) {
        setFlow(a);
        return;
      }
      if (a.type === "export") {
        setExporting({ ids: a.ids, ...a.data });
        return;
      }
      if (a.type === "detach-collection") {
        const collection = collections.find(
          (c) => c.id === a.query?.collectionId,
        );
        if (collection?.query)
          throw new Error("智能收藏集由规则管理，请编辑筛选条件");
        await call("collections.detach", {
          collectionId: collection?.id,
          assetIds: a.ids,
        });
        return;
      }
      if (a.type === "quick-export" || a.type === "project-export") {
        const p =
          a.project ?? projects.find((p) => p.id === a.query?.projectId);
        const s = await select(a);
        if (!s.count) throw new Error("没有可导出的素材");
        if (!p?.godotPath) {
          setExporting({ ids: s.ids });
          return;
        }
        const result = await call<{ jobId?: string; plan: ExportPlan }>(
          "exports.quick",
          {
            projectId: p.id,
            assetIds: a.type === "project-export" ? undefined : s.ids,
            aggregate: !!useStore.getState().aggregationMode,
          },
        );
        if (result.jobId)
          useStore.getState().notify("检查通过，导出已加入后台任务");
        else
          setExporting({
            ids: result.plan.request.assetIds,
            variants: result.plan.request.variantIds,
            plan: result.plan,
          });
        return;
      }
      const s = await select(a);
      if (a.type === "select-all" || a.type === "invert") {
        const previous = new Set(useStore.getState().selected),
          ids =
            a.type === "invert"
              ? s.ids.filter((id) => !previous.has(id))
              : s.ids;
        useStore.getState().setSelection(ids, ids[0] ?? null);
        return;
      }
      if (!s.count) throw new Error("当前范围没有素材");
      if (a.type === "processing") {
        openProcessing(
          s.ids.map((id) => ({ kind: "asset", id })),
          {
            projectId: a.query?.projectId,
            collectionId: a.query?.collectionId,
          },
        );
        return;
      }
      if (a.type === "preview") {
        onPreview(s.sample[0]);
        return;
      }
      if (a.type === "material") {
        onMaterial(s.sample[0]);
        return;
      }
      if (a.type === "compare") {
        onCompare(s.sample);
        return;
      }
      if (a.type === "convert") {
        const model = s.sample[0];
        if (model.extension === ".blend") {
          await call("models.convert", {
            assetId: model.id,
            projectId: a.query?.projectId,
          });
          useStore.getState().notify("GLB 转换已加入任务");
        } else
          onPreview({
            ...model,
            metadata: {
              ...model.metadata,
              convertOnOpen: true,
              conversionProjectId: a.query?.projectId,
            },
          });
        return;
      }
      if (a.type === "collection-export") {
        setExporting({ ids: s.ids, mode: "generic" });
        return;
      }
      if (a.type.includes("dependencies")) {
        setDetails(await call("assets.dependencies", { ids: s.ids }));
        setFlow({ ...a, type: "dependencies" });
        return;
      }
      setSelection(s);
      setFlow({
        ...a,
        ids: s.ids,
        type: a.type === "project-organize" ? "organize" : a.type,
      });
    }
    const handler = (e: Event) => {
      void run((e as CustomEvent<Action>).detail).catch(report);
    };
    window.addEventListener("workshop:action", handler);
    return () => window.removeEventListener("workshop:action", handler);
  }, [projects, collections, onPreview, onCompare, onMaterial, onProject]);
  const close = () => {
    setFlow(null);
    setDetails(null);
  };
  return (
    <>
      {importing && (
        <ImportFlow
          paths={importing.paths}
          projectId={importing.projectId}
          projects={projects}
          onClose={() => setImporting(null)}
        />
      )}
      {exporting && (
        <ExportFlow
          ids={exporting.ids}
          projects={projects}
          variantIds={exporting.variants}
          initialMode={exporting.mode}
          initialZip={exporting.zip}
          initialAggregate={!!useStore.getState().aggregationMode}
          initialPlan={exporting.plan}
          onClose={() => setExporting(null)}
        />
      )}
      {flow?.type === "organize" && selection && (
        <BatchOrganize
          selection={selection}
          projects={projects}
          collections={collections}
          onClose={close}
        />
      )}
      {flow?.type === "states" && (
        <OrganizeFlow
          states
          ids={flow.ids!}
          onClose={close}
          onSaved={async () => {
            const d = await call<any>("assets.detail", { id: flow.ids![0] });
            onPreview({
              ...d.asset,
              metadata: { ...d.asset.metadata, viewMode: "states" },
            });
          }}
        />
      )}
      {flow?.type === "attach-collection" && (
        <CollectionFlow ids={flow.ids!} onClose={close} />
      )}
      {flow?.type === "new-collection" && (
        <CollectionFlow
          ids={[]}
          initialSmart={!!flow.data?.smart}
          onClose={close}
        />
      )}
      {flow?.type === "attach-project" && (
        <Modal title="加入项目" onClose={close}>
          <p>关联 {flow.ids!.length} 个素材的当前版本</p>
          {projects.map((p) => (
            <ClientButton
              key={p.id}
              onClick={() =>
                void call("projects.attach", {
                  projectId: p.id,
                  assetIds: flow.ids,
                })
                  .then(close)
                  .catch(report)
              }
            >
              {p.name}
            </ClientButton>
          ))}
          {!projects.length && (
            <ClientButton
              onClick={() => {
                close();
                onProject("new");
              }}
            >
              创建游戏项目
            </ClientButton>
          )}
        </Modal>
      )}
      {flow?.type === "confirm" && (
        <Modal title="确认操作" onClose={close}>
          <p>{flow.data.message}</p>
          <div className="modal-actions">
            <ClientButton onClick={close}>取消</ClientButton>
            <ClientButton
              className="danger"
              onClick={() =>
                void call(flow.data.method, flow.data.input)
                  .then(() => {
                    if (flow.data.reset) useStore.getState().setQuery({});
                    close();
                  })
                  .catch(report)
              }
            >
              确认
            </ClientButton>
          </div>
        </Modal>
      )}
      {flow?.type === "edit-collection" && (
        <EditCollection
          collection={flow.collection!}
          projects={projects}
          onClose={close}
        />
      )}
      {flow?.type === "selection" && (
        <SelectionList ids={flow.ids!} onClose={close} onPreview={onPreview} />
      )}
      {flow?.type === "dependencies" && details && (
        <Modal title="依赖检查" onClose={close} wide>
          <p>
            检查 {details.count} 个素材 ·{" "}
            {details.issues.length
              ? `${details.issues.length} 项问题`
              : "包内依赖完整"}
          </p>
          <div className="file-list">
            {details.issues.map((issue: string, i: number) => (
              <p className="warning" key={i}>
                {issue}
              </p>
            ))}
          </div>
        </Modal>
      )}
      {flow?.type === "grid-size" && (
        <Modal title="缩略图尺寸" onClose={close}>
          {[120, 160, 200, 240].map((size) => (
            <ClientButton
              key={size}
              onClick={() => {
                act("grid-size-value", { data: { size } });
                close();
              }}
            >
              {size} px
            </ClientButton>
          ))}
        </Modal>
      )}
      {flow?.type === "match" && selection && (
        <MatchTextures
          selection={selection}
          onClose={close}
          onMaterial={onMaterial}
        />
      )}
    </>
  );
}

function BatchOrganize({
  selection: s,
  projects,
  collections,
  onClose,
}: {
  selection: AssetSelection;
  projects: Project[];
  collections: Collection[];
  onClose: () => void;
}) {
  const [category, setCategory] = useState(""),
    [entity, setEntity] = useState("keep"),
    [applyGameplay, setApplyGameplay] = useState(false),
    [gameplay, setGameplay] = useState<string[]>([]),
    [groupMode, setGroupMode] = useState("keep"),
    [groupName, setGroupName] = useState(""),
    [tags, setTags] = useState(""),
    [applyTags, setApplyTags] = useState(false),
    [replaceTags, setReplaceTags] = useState(false),
    [titleMode, setTitleMode] = useState("keep"),
    [value, setValue] = useState(s.sample[0]?.title ?? ""),
    [prefix, setPrefix] = useState(""),
    [suffix, setSuffix] = useState(""),
    [find, setFind] = useState(""),
    [replacement, setReplacement] = useState(""),
    [numbering, setNumbering] = useState(false),
    [start, setStart] = useState(1),
    [project, setProject] = useState(""),
    [collection, setCollection] = useState(""),
    [role, setRole] = useState("keep"),
    [busy, setBusy] = useState(false);
  const title: OrganizeRequest["title"] =
    titleMode === "keep"
      ? undefined
      : titleMode === "value"
        ? { value }
        : { prefix, suffix, find, replace: replacement, numbering, start };
  const titles = s.sample.map((a, i) => organizedTitle(a.title, i, title));
  return (
    <Modal
      title={s.count === 1 ? "整理素材" : "批量整理素材"}
      onClose={onClose}
      wide
    >
      <p>将修改 {s.count.toLocaleString()} 个素材；未设置的字段保持原值。</p>
      <div className="two-fields">
        <Field label="分类">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">保持原分类</option>
            {Object.entries(categories).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="标题规则">
          <select
            value={titleMode}
            onChange={(e) => setTitleMode(e.target.value)}
          >
            <option value="keep">保持原标题</option>
            {s.count === 1 && <option value="value">修改展示标题</option>}
            <option value="rule">前后缀、替换与编号</option>
          </select>
        </Field>
      </div>
      <div className="two-fields">
        <Field label="实体分类">
          <select value={entity} onChange={(e) => setEntity(e.target.value)}>
            <option value="keep">保持实体分类</option>
            <option value="none">不属于游戏实体</option>
            {Object.entries(entityCategories).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="聚合组">
          <select
            value={groupMode}
            onChange={(e) => setGroupMode(e.target.value)}
          >
            <option value="keep">保持自动或手动聚合</option>
            <option value="new">将所选素材合并为一组</option>
            <option value="remove">移除手动组，恢复自动聚合</option>
          </select>
        </Field>
      </div>
      {groupMode === "new" && (
        <Field label="聚合组名称">
          <input
            value={groupName}
            maxLength={100}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="例如：地牢守卫 · 模型、动作与图标"
          />
        </Field>
      )}
      <label className="check-label">
        <input
          type="checkbox"
          checked={applyGameplay}
          onChange={(e) => setApplyGameplay(e.target.checked)}
        />
        设置玩法标签
      </label>
      {applyGameplay && (
        <div className="gameplay-options">
          {Object.entries(gameplayTags).map(([key, label]) => (
            <label className="check-label" key={key}>
              <input
                type="checkbox"
                checked={gameplay.includes(key)}
                onChange={(e) =>
                  setGameplay(
                    e.target.checked
                      ? [...gameplay, key]
                      : gameplay.filter((k) => k !== key),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
      )}
      {titleMode === "value" && (
        <Field label="展示标题">
          <input value={value} onChange={(e) => setValue(e.target.value)} />
        </Field>
      )}
      {titleMode === "rule" && (
        <>
          <div className="two-fields">
            <Field label="前缀">
              <input
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
              />
            </Field>
            <Field label="后缀">
              <input
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
              />
            </Field>
            <Field label="查找文字">
              <input value={find} onChange={(e) => setFind(e.target.value)} />
            </Field>
            <Field label="替换为">
              <input
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
              />
            </Field>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={numbering}
              onChange={(e) => setNumbering(e.target.checked)}
            />
            追加编号
          </label>
          {numbering && (
            <Field label="起始编号">
              <input
                type="number"
                min={0}
                max={1000000}
                value={start}
                onChange={(e) => setStart(Number(e.target.value))}
              />
            </Field>
          )}
        </>
      )}
      <label className="check-label">
        <input
          type="checkbox"
          checked={applyTags}
          onChange={(e) => setApplyTags(e.target.checked)}
        />
        修改标签
      </label>
      {applyTags && (
        <>
          <Field label="标签（逗号分隔）">
            <input value={tags} onChange={(e) => setTags(e.target.value)} />
          </Field>
          <label className="check-label">
            <input
              type="checkbox"
              checked={replaceTags}
              onChange={(e) => setReplaceTags(e.target.checked)}
            />
            替换标签（默认追加）
          </label>
        </>
      )}
      <div className="two-fields">
        <Field label="同时加入项目">
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">保持项目关联</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="同时加入收藏集">
          <select
            value={collection}
            onChange={(e) => setCollection(e.target.value)}
          >
            <option value="">保持收藏集关联</option>
            {collections
              .filter((v) => !v.query)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      {s.allImages && (
        <Field label="图片用途">
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="keep">保持当前用途</option>
            <option value="preview">辅助预览图（默认隐藏）</option>
            <option value="ordinary">恢复为普通素材</option>
          </select>
        </Field>
      )}
      <h3>标题样例</h3>
      <div className="organize-samples">
        {s.sample.map((a, i) => (
          <p key={a.id}>
            {a.title} → {titles[i]}
          </p>
        ))}
      </div>
      <p className="muted">只修改展示标题；库内原始文件名与依赖路径保留。</p>
      <div className="modal-actions">
        <ClientButton onClick={onClose}>取消</ClientButton>
        <ClientButton
          className="primary"
          disabled={
            busy ||
            titles.some((t) => !t || t.length > 200) ||
            (groupMode === "new" && !groupName.trim())
          }
          onClick={async () => {
            setBusy(true);
            try {
              await call("assets.organize", {
                ids: s.ids,
                title,
                category: category || undefined,
                entityCategory:
                  entity === "keep"
                    ? undefined
                    : entity === "none"
                      ? null
                      : entity,
                gameplayTags: applyGameplay ? gameplay : undefined,
                group:
                  groupMode === "keep"
                    ? undefined
                    : groupMode === "remove"
                      ? null
                      : { name: groupName.trim() },
                tags: applyTags
                  ? tags
                      .split(/[,，]/)
                      .map((t) => t.trim())
                      .filter(Boolean)
                  : undefined,
                replaceTags,
                projectId: project || undefined,
                collectionId: collection || undefined,
                auxiliaryRole:
                  role === "keep"
                    ? undefined
                    : role === "preview"
                      ? "preview"
                      : null,
              });
              useStore.getState().notify(`已整理 ${s.count} 个素材`);
              onClose();
            } catch (e) {
              report(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          应用到 {s.count} 个素材
        </ClientButton>
      </div>
    </Modal>
  );
}
function EditCollection({
  collection,
  projects,
  onClose,
}: {
  collection: Collection;
  projects: Project[];
  onClose: () => void;
}) {
  const [name, setName] = useState(collection.name),
    [q, setQuery] = useState<AssetQuery>(collection.query ?? {}),
    [busy, setBusy] = useState(false);
  const patch = (change: Partial<AssetQuery>) => setQuery({ ...q, ...change });
  return (
    <Modal title="编辑收藏集" onClose={onClose}>
      <Field label="收藏集名称">
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {collection.query && (
        <>
          <Field label="搜索文字">
            <input
              value={q.search ?? ""}
              onChange={(e) => patch({ search: e.target.value })}
            />
          </Field>
          <Field label="分类">
            <select
              value={q.category ?? ""}
              onChange={(e) => patch({ category: e.target.value as any })}
            >
              <option value="">全部分类</option>
              {Object.entries(categories).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="项目">
            <select
              value={q.projectId ?? ""}
              onChange={(e) =>
                patch({ projectId: e.target.value || undefined })
              }
            >
              <option value="">全部项目</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="文件格式">
            <input
              value={q.extension ?? ""}
              onChange={(e) => patch({ extension: e.target.value })}
              placeholder="例如 png、glb"
            />
          </Field>
          {(
            [
              ["favorite", "仅收藏"],
              ["hasAnimation", "含动画"],
              ["missing", "缺失依赖"],
              ["showRelated", "所有文件"],
              ["includeAuxiliary", "包含辅助预览图"],
            ] as const
          ).map(([key, label]) => (
            <label className="check-label" key={key}>
              <input
                type="checkbox"
                checked={!!q[key]}
                onChange={(e) => patch({ [key]: e.target.checked })}
              />
              {label}
            </label>
          ))}
        </>
      )}
      <div className="modal-actions">
        <ClientButton onClick={onClose}>取消</ClientButton>
        <ClientButton
          className="primary"
          disabled={busy || !name.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await call("collections.update", {
                id: collection.id,
                name: name.trim(),
                query: collection.query
                  ? {
                      ...q,
                      collectionId: undefined,
                      offset: undefined,
                      limit: undefined,
                    }
                  : undefined,
              });
              onClose();
            } catch (e) {
              report(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          保存
        </ClientButton>
      </div>
    </Modal>
  );
}
function SelectionList({
  ids,
  onClose,
  onPreview,
}: {
  ids: string[];
  onClose: () => void;
  onPreview: (a: Asset) => void;
}) {
  const [offset, setOffset] = useState(0),
    [rows, setRows] = useState<Asset[]>([]);
  useEffect(() => {
    void call<Asset[]>("assets.selectedPage", { ids, offset })
      .then(setRows)
      .catch(report);
  }, [offset]);
  return (
    <Modal title={`所选清单 · ${ids.length} 个素材`} onClose={onClose} wide>
      <div className="file-list">
        {rows.map((a) => (
          <ClientButton key={a.id} onClick={() => onPreview(a)}>
            {a.title} <small>{a.path}</small>
          </ClientButton>
        ))}
      </div>
      <div className="modal-actions">
        <ClientButton
          disabled={!offset}
          onClick={() => setOffset(offset - 100)}
        >
          上一页
        </ClientButton>
        <span>
          {offset + 1}–{Math.min(offset + 100, ids.length)}
        </span>
        <ClientButton
          disabled={offset + 100 >= ids.length}
          onClick={() => setOffset(offset + 100)}
        >
          下一页
        </ClientButton>
      </div>
    </Modal>
  );
}
function MatchTextures({
  selection,
  onClose,
  onMaterial,
}: {
  selection: AssetSelection;
  onClose: () => void;
  onMaterial: (a: Asset) => void;
}) {
  const [textures, setTextures] = useState<Asset[]>([]),
    [models, setModels] = useState<Asset[]>([]),
    [modelId, setModelId] = useState(""),
    [search, setSearch] = useState(""),
    [slot, setSlot] = useState(0),
    [bindings, setBindings] = useState<Record<string, string>>({}),
    [channels, setChannels] = useState<Record<string, string>>({}),
    [uv, setUV] = useState(0),
    [normal, setNormal] = useState<"gl" | "dx">("gl");
  const names: Record<TextureSlot, string> = {
    baseColor: "Base Color",
    normal: "Normal",
    roughness: "Roughness",
    metallic: "Metallic",
    ao: "AO",
    emission: "Emission",
  };
  useEffect(() => {
    void call<Asset[]>("materials.matchCandidates", { ids: selection.ids })
      .then((rows) => {
        setTextures(rows);
        const suggested: Record<string, string> = {};
        for (const [key, re] of Object.entries({
          baseColor: /color|albedo|diffuse/i,
          normal: /normal|nor_/i,
          roughness: /rough/i,
          metallic: /metal/i,
          ao: /\bao\b|ambient.?occlusion/i,
          emission: /emiss/i,
        })) {
          const found = rows.filter((a) => re.test(a.path));
          if (found.length === 1) suggested[key] = found[0].id;
        }
        setBindings(suggested);
      })
      .catch(report);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(
      () =>
        void call<any>("assets.query", {
          modelOnly: true,
          search,
          showRelated: true,
          limit: 200,
        })
          .then((p) => {
            if (!cancelled)
              setModels(
                p.items.filter((a: Asset) =>
                  [".glb", ".gltf"].includes(a.extension),
                ),
              );
          })
          .catch(report),
      150,
    );
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search]);
  const model = models.find((a) => a.id === modelId),
    material = model?.metadata.materials?.[slot],
    reason = !model
      ? "请选择模型"
      : !model.metadata.uvChannels?.includes(uv)
        ? `模型缺少 UV${uv}`
        : !model.metadata.materials?.length
          ? "模型没有可编辑的材质槽"
          : material?.extensions?.length
            ? "该材质扩展为只读"
            : undefined;
  return (
    <Modal title="匹配贴图到模型" onClose={onClose} wide>
      <Field label="查找 GLB／glTF 模型">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="模型名称或标签"
        />
      </Field>
      <Field label="模型">
        <select
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value);
            setSlot(0);
          }}
        >
          <option value="">选择模型</option>
          {models.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </Field>
      <div className="two-fields">
        <Field label="材质槽">
          <select
            value={slot}
            onChange={(e) => setSlot(Number(e.target.value))}
          >
            {(model?.metadata.materials ?? []).map((m: any, i: number) => (
              <option key={i} value={i}>
                {m.name ?? `材质 ${i}`}
                {m.extensions?.length ? " · 只读" : ""}
              </option>
            ))}
          </select>
        </Field>
        <Field label="UV 通道">
          <select value={uv} onChange={(e) => setUV(Number(e.target.value))}>
            <option value={0}>UV0</option>
            <option value={1}>UV1</option>
          </select>
        </Field>
      </div>
      {Object.entries(names).map(([key, label]) => (
        <div className="two-fields" key={key}>
          <Field label={label}>
            <select
              value={bindings[key] ?? ""}
              onChange={(e) =>
                setBindings({ ...bindings, [key]: e.target.value })
              }
            >
              <option value="">不绑定</option>
              {textures.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
          </Field>
          <Field label="读取通道">
            <select
              value={
                channels[key] ??
                (["baseColor", "normal", "emission"].includes(key)
                  ? "rgb"
                  : "r")
              }
              onChange={(e) =>
                setChannels({ ...channels, [key]: e.target.value })
              }
            >
              {["rgb", "r", "g", "b", "a"].map((v) => (
                <option key={v} value={v}>
                  {v.toUpperCase()}
                </option>
              ))}
            </select>
          </Field>
        </div>
      ))}
      <Field label="法线方向">
        <select
          value={normal}
          onChange={(e) => setNormal(e.target.value as any)}
        >
          <option value="gl">OpenGL</option>
          <option value="dx">DirectX</option>
        </select>
      </Field>
      <p className="muted">
        唯一的命名匹配已预填；请检查贴图、通道及法线方向。此处不覆盖原始模型。
      </p>
      {reason && <p className="warning">{reason}</p>}
      <div className="modal-actions">
        <ClientButton onClick={onClose}>取消</ClientButton>
        <ClientButton
          className="primary"
          disabled={!!reason || !Object.values(bindings).some(Boolean)}
          onClick={() => {
            if (!model) return;
            const variant = defaultVariant(model);
            variant.materialIndex = slot;
            variant.normalConvention = normal;
            for (const [key, value] of Object.entries(bindings)) {
              const tex = textures.find((t) => t.id === value);
              if (tex)
                variant.bindings[key as TextureSlot] = {
                  assetId: tex.id,
                  revisionId: tex.revisionId,
                  uv: uv as 0 | 1,
                  channel: (channels[key] ??
                    (["baseColor", "normal", "emission"].includes(key)
                      ? "rgb"
                      : "r")) as any,
                };
            }
            onMaterial({
              ...model,
              metadata: {
                ...model.metadata,
                draftVariant: variant,
                draftTextures: textures,
              },
            });
            onClose();
          }}
        >
          确认匹配并进入工作台
        </ClientButton>
      </div>
    </Modal>
  );
}
