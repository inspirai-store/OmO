import { ClientButton } from "./client-ui";
import { useEffect, useState } from "react";
import {
  Upload,
  FolderOpen,
  AlertTriangle,
  FileCheck2,
  Plus,
  Download,
} from "lucide-react";
import {
  categories,
  type Project,
  type ImportPlan,
  type ExportPlan,
} from "../../shared/types";
import { Modal, Field, Loading } from "./components";
import { entityCategories, gameplayTags } from "../../shared/entities";
import { call, report, useStore, bytes } from "./store";
export function ImportFlow({
  paths,
  projects,
  parentAssetId,
  projectId,
  onClose,
}: {
  paths: string[];
  parentAssetId?: string;
  projectId?: string;
  projects: Project[];
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<ImportPlan | null>(null),
    [project, setProject] = useState(projectId ?? ""),
    [category, setCategory] = useState(""),
    [entity, setEntity] = useState(""),
    [gameplay, setGameplay] = useState<string[]>([]),
    [tags, setTags] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    void call<ImportPlan>("imports.inspect", { paths })
      .then(setPlan)
      .catch((e) => {
        report(e);
        onClose();
      });
  }, []);
  return (
    <Modal
      title={parentAssetId ? "导入新的素材版本" : "导入素材到本地库"}
      onClose={onClose}
      wide
    >
      {!plan ? (
        <Loading text="检查文件和目录…" />
      ) : (
        <>
          <div className="summary-cards">
            <div>
              <span>文件数量</span>
              <strong>{plan.fileCount.toLocaleString()}</strong>
            </div>
            <div>
              <span>复制空间</span>
              <strong>{bytes(plan.bytes)}</strong>
            </div>
            <div>
              <span>存储方式</span>
              <strong>完整副本</strong>
            </div>
          </div>
          {plan.counts && (
            <p className="muted">
              图片 {plan.counts.images} · 模型 {plan.counts.models} · 材质套组{" "}
              {plan.counts.materialSets}
              {plan.availableBytes !== undefined
                ? ` · 磁盘可用 ${bytes(plan.availableBytes)}`
                : ""}
            </p>
          )}
          <div className="import-roots">
            {plan.roots.map((r) => (
              <div key={r.path}>
                <FolderOpen size={18} />
                <span>
                  {r.label}
                  <small>{r.path}</small>
                </span>
                <em>{r.archive ? "ZIP 包" : "本地文件"}</em>
              </div>
            ))}
          </div>
          {plan.issues.map((s, i) => (
            <div className="warning" key={i}>
              <AlertTriangle size={15} />
              {s}
            </div>
          ))}
          <div className="two-fields">
            <Field label="目标项目">
              <select
                value={project}
                onChange={(e) => setProject(e.target.value)}
              >
                <option value="">公共素材库</option>
                {projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="素材分类">
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">按格式与名称自动识别</option>
                {Object.entries(categories).map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="批量标签">
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="例如：地牢, dungeon, 像素"
            />
          </Field>
          <p className="muted">
            复制、依赖解析、哈希校验在后台进行。ZIP
            展开后的容量和缺失依赖会记录在任务及素材详情中。
          </p>
          <Field label="实体分类">
            <select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">按文件名与素材用途自动识别</option>
              <option value="none">不属于游戏实体</option>
              {Object.entries(entityCategories).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <p className="muted">玩法标签（可选；未选择时自动识别）</p>
          <div className="gameplay-options">
            {Object.entries(gameplayTags).map(([key, label]) => (
              <label key={key} className="check-label">
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
          <div className="modal-actions">
            <ClientButton onClick={onClose}>取消</ClientButton>
            <ClientButton
              className="primary"
              disabled={
                busy ||
                (plan.availableBytes !== undefined &&
                  plan.bytes > plan.availableBytes)
              }
              onClick={async () => {
                setBusy(true);
                try {
                  await call("imports.start", {
                    planId: plan.id,
                    parentAssetId,
                    projectId: project,
                    category,
                    entityCategory:
                      entity === "none" ? null : entity || undefined,
                    gameplayTags: gameplay.length ? gameplay : undefined,
                    tags: tags
                      .split(/[,，]/)
                      .map((t) => t.trim())
                      .filter(Boolean),
                  });
                  useStore.getState().notify("导入任务已加入队列");
                  onClose();
                } catch (e) {
                  report(e);
                  setBusy(false);
                }
              }}
            >
              <Upload size={16} />
              开始导入
            </ClientButton>
          </div>
        </>
      )}
    </Modal>
  );
}
export function ProjectFlow({
  project,
  onClose,
}: {
  project?: Project;
  onClose: () => void;
}) {
  const [name, setName] = useState(project?.name ?? ""),
    [description, setDescription] = useState(project?.description ?? ""),
    [color, setColor] = useState(project?.color ?? "#c2a777"),
    [godotPath, setGodotPath] = useState(project?.godotPath ?? "");
  return (
    <Modal title={project ? "编辑项目" : "创建游戏项目"} onClose={onClose}>
      <Field label="项目名称">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="你的下一个游戏"
        />
      </Field>
      <Field label="项目说明">
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field label="项目颜色">
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
        />
      </Field>
      <Field label="Godot 工程目录（可选）">
        <div className="input-action">
          <input
            value={godotPath}
            readOnly
            placeholder="选择含 project.godot 的目录"
          />
          <ClientButton
            aria-label="选择 Godot 工程"
            onClick={async () => {
              const p = await window.workshop.choose({ kind: "folder" });
              if (p[0]) setGodotPath(p[0]);
            }}
          >
            <FolderOpen size={17} />
          </ClientButton>
        </div>
      </Field>
      <div className="modal-actions">
        {project && (
          <ClientButton
            className="danger"
            onClick={() =>
              void call("projects.delete", { id: project.id })
                .then(() => {
                  useStore.getState().setQuery({});
                  onClose();
                })
                .catch(report)
            }
          >
            删除项目组织
          </ClientButton>
        )}
        <ClientButton onClick={onClose}>取消</ClientButton>
        <ClientButton
          className="primary"
          disabled={!name.trim()}
          onClick={async () => {
            try {
              const p = await call<Project>("projects.save", {
                id: project?.id,
                name,
                description,
                color,
                godotPath,
              });
              useStore.getState().setQuery({ projectId: p.id });
              onClose();
            } catch (e) {
              report(e);
            }
          }}
        >
          <Plus size={16} />
          {project ? "保存项目" : "创建项目"}
        </ClientButton>
      </div>
    </Modal>
  );
}
export function CollectionFlow({
  ids,
  initialSmart = false,
  onClose,
}: {
  ids: string[];
  initialSmart?: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(""),
    [smart, setSmart] = useState(initialSmart),
    [existing, setExisting] = useState(""),
    [collections, setCollections] = useState<
      { id: string; name: string; query?: any }[]
    >([]),
    query = useStore((s) => s.query);
  useEffect(() => {
    void call<any[]>("collections.list").then(setCollections).catch(report);
  }, []);
  return (
    <Modal title="整理收藏集" onClose={onClose}>
      {!!ids.length && (
        <Field label="添加到现有收藏集">
          <select
            value={existing}
            onChange={(e) => setExisting(e.target.value)}
          >
            <option value="">新建收藏集</option>
            {collections
              .filter((c) => !c.query)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      <Field label="收藏集名称">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
      <label className="check-label">
        <input
          type="checkbox"
          checked={smart}
          onChange={(e) => setSmart(e.target.checked)}
        />
        智能收藏集 · 保存当前筛选条件
      </label>
      <p className="muted">
        {smart
          ? "新导入的匹配素材会自动出现在这里。"
          : `将选中的 ${ids.length} 个素材添加到收藏集。`}
      </p>
      <div className="modal-actions">
        <ClientButton
          className="primary"
          disabled={!existing && !name.trim()}
          onClick={async () => {
            try {
              const id =
                existing ||
                (await call<string>("collections.save", {
                  name,
                  query: smart ? query : undefined,
                }));
              if (!smart && ids.length)
                await call("collections.attach", {
                  collectionId: id,
                  assetIds: ids,
                });
              useStore.getState().setQuery({ collectionId: id });
              onClose();
            } catch (e) {
              report(e);
            }
          }}
        >
          创建收藏集
        </ClientButton>
      </div>
    </Modal>
  );
}
export function OrganizeFlow({
  ids,
  states = false,
  onClose,
  onSaved,
}: {
  ids: string[];
  states?: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [tags, setTags] = useState(""),
    [replace, setReplace] = useState(false),
    [assets, setAssets] = useState<
      { id: string; title: string; capabilities: { preview: string } }[]
    >([]),
    [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    if (states)
      void Promise.all(
        ids.map((id) =>
          call<any>("assets.detail", { id }).then((d) => d.asset),
        ),
      )
        .then((rows) => {
          setAssets(rows);
          setLabels(
            Object.fromEntries(
              rows.map((a) => [
                a.id,
                a.title.match(
                  /normal|hover|pressed|disabled|focused|active/i,
                )?.[0] ?? a.title,
              ]),
            ),
          );
        })
        .catch(report);
  }, []);
  const valid =
    !states ||
    (assets.length > 1 &&
      assets.length <= 12 &&
      assets.every((a) => a.capabilities.preview === "image"));
  return (
    <Modal title={states ? "组成控件状态组" : "批量编辑标签"} onClose={onClose}>
      {states ? (
        <>
          {assets.map((a) => (
            <Field label={a.title} key={a.id}>
              <input
                value={labels[a.id] ?? ""}
                onChange={(e) =>
                  setLabels({ ...labels, [a.id]: e.target.value })
                }
              />
            </Field>
          ))}
          <p className="muted">
            选取 2–12 张图片，填写 normal、hover、pressed、disabled
            等状态。图片查看器可以并排查看，原件与状态元数据一并导出。
          </p>
        </>
      ) : (
        <>
          <Field label="标签 · 逗号分隔">
            <input
              autoFocus
              value={tags}
              onChange={(e) => setTags(e.target.value)}
            />
          </Field>
          <label className="check-label">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            替换已有标签
          </label>
        </>
      )}
      <div className="modal-actions">
        <ClientButton onClick={onClose}>取消</ClientButton>
        <ClientButton
          className="primary"
          disabled={!valid}
          onClick={async () => {
            try {
              if (states)
                await call("assets.update", {
                  ids,
                  change: {
                    metadata: {
                      stateGroup: assets.map((a) => ({
                        id: a.id,
                        label: labels[a.id] || a.title,
                      })),
                    },
                  },
                });
              else
                await call("assets.tags", {
                  ids,
                  tags: tags
                    .split(/[,，]/)
                    .map((t) => t.trim())
                    .filter(Boolean),
                  replace,
                });
              onSaved?.();
              onClose();
            } catch (e) {
              report(e);
            }
          }}
        >
          保存
        </ClientButton>
      </div>
    </Modal>
  );
}
export function ExportFlow({
  ids,
  variantIds = [],
  projects,
  onClose,
  initialMode = "godot",
  initialZip = false,
  initialAggregate = false,
  initialPlan,
}: {
  ids: string[];
  variantIds?: string[];
  projects: Project[];
  onClose: () => void;
  initialMode?: "godot" | "generic";
  initialZip?: boolean;
  initialAggregate?: boolean;
  initialPlan?: ExportPlan;
}) {
  const [mode, setMode] = useState<"godot" | "generic">(
      initialPlan?.request.mode ?? initialMode,
    ),
    [target, setTarget] = useState(initialPlan?.request.target ?? ""),
    [zip, setZip] = useState(initialZip),
    [aggregate, setAggregate] = useState(
      initialPlan?.request.aggregate ?? initialAggregate,
    ),
    [preferGLTF, setPreferGLTF] = useState(
      initialPlan?.request.preferGLTF ?? true,
    ),
    [plan, setPlan] = useState<ExportPlan | null>(initialPlan ?? null),
    [busy, setBusy] = useState(false),
    [variants, setVariants] = useState<any[]>([]),
    [chosen, setChosen] = useState(variantIds);
  useEffect(() => {
    void call<any[]>("materials.forAssets", { ids })
      .then(setVariants)
      .catch(report);
  }, []);
  const [initialKey] = useState(
    JSON.stringify([target, mode, zip, chosen, aggregate, preferGLTF]),
  );
  useEffect(() => {
    if (
      JSON.stringify([target, mode, zip, chosen, aggregate, preferGLTF]) !==
      initialKey
    )
      setPlan(null);
  }, [target, mode, zip, JSON.stringify(chosen), aggregate, preferGLTF]);
  return (
    <Modal title="导出游戏素材" onClose={onClose} wide>
      <div className="segmented">
        <ClientButton
          className={mode === "godot" ? "active" : ""}
          onClick={() => setMode("godot")}
        >
          Godot 工程
        </ClientButton>
        <ClientButton
          className={mode === "generic" ? "active" : ""}
          onClick={() => setMode("generic")}
        >
          通用资源包
        </ClientButton>
      </div>
      <Field label="输出目录">
        <div className="input-action">
          <input
            readOnly
            value={target}
            placeholder={
              mode === "godot"
                ? "选择 Godot 工程或新的导出目录"
                : "选择资源包存放目录"
            }
          />
          <ClientButton
            onClick={async () => {
              const paths = await window.workshop.choose({
                kind: "folder",
                title: "选择导出目标",
              });
              if (paths[0]) setTarget(paths[0]);
            }}
          >
            <FolderOpen size={17} />
            选择
          </ClientButton>
        </div>
      </Field>
      {mode === "godot" && projects.some((p) => p.godotPath) && (
        <Field label="已绑定的工程">
          <select value="" onChange={(e) => setTarget(e.target.value)}>
            <option value="">选择工程</option>
            {projects
              .filter((p) => p.godotPath)
              .map((p) => (
                <option value={p.godotPath} key={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </Field>
      )}
      {variants.length > 0 && (
        <>
          <h3>同时导出材质变体</h3>
          {variants.map((v) => (
            <label key={v.id} className="check-label">
              <input
                type="checkbox"
                checked={chosen.includes(v.id)}
                onChange={(e) =>
                  setChosen(
                    e.target.checked
                      ? [...chosen, v.id]
                      : chosen.filter((id) => id !== v.id),
                  )
                }
              />
              {v.name}
            </label>
          ))}
        </>
      )}
      {mode === "generic" && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={zip}
            onChange={(e) => setZip(e.target.checked)}
          />
          生成标准 ZIP 素材包
        </label>
      )}
      <label className="check-label">
        <input
          type="checkbox"
          checked={aggregate}
          onChange={(e) => setAggregate(e.target.checked)}
        />
        聚合交付：同包成员共用目录，保留相对路径
      </label>
      {aggregate && mode === "godot" && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={preferGLTF}
            onChange={(e) => setPreferGLTF(e.target.checked)}
          />
          同一对象有多种模型格式时优先采用 GLB/glTF
        </label>
      )}
      {plan && (
        <>
          <div className="summary-cards">
            <div>
              <span>素材</span>
              <strong>{plan.assets.length}</strong>
            </div>
            <div>
              <span>原始资源</span>
              <strong>{bytes(plan.bytes)}</strong>
            </div>
            <div>
              <span>变体</span>
              <strong>{plan.variants.length}</strong>
            </div>
          </div>
          {plan.issues.length ? (
            plan.issues.map((s, i) => (
              <div className="warning" key={i}>
                <AlertTriangle size={16} />
                {s}
              </div>
            ))
          ) : (
            <div className="success-note">
              <FileCheck2 size={17} />
              依赖和格式检查通过
            </div>
          )}
        </>
      )}
      <p className="muted">
        资源和许可证一并交付。不同版本进入独立目录；检测到人工修改的文件时停止覆盖。
      </p>
      <div className="modal-actions">
        <ClientButton onClick={onClose}>取消</ClientButton>
        <ClientButton
          className="primary"
          disabled={!target || busy || !!plan?.issues.length}
          onClick={async () => {
            setBusy(true);
            try {
              if (!plan)
                setPlan(
                  await call("exports.inspect", {
                    assetIds: ids,
                    target,
                    mode,
                    variantIds: chosen,
                    zip,
                    aggregate,
                    preferGLTF:
                      aggregate && mode === "godot" ? preferGLTF : false,
                  }),
                );
              else {
                await call("exports.start", { planId: plan.id });
                useStore.getState().notify("导出已加入后台任务");
                onClose();
              }
            } catch (e) {
              report(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Download size={16} />
          {plan ? "开始导出" : "检查导出"}
        </ClientButton>
      </div>
    </Modal>
  );
}
