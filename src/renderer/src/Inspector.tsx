import { Tabs } from "./ui-kit";
import { ClientButton } from "./client-ui";
import { useEffect, useState } from "react";
import {
  Box,
  Star,
  ExternalLink,
  FolderOpen,
  ArrowUpRight,
  Trash2,
  FileCheck2,
  X,
  Palette,
  Save,
} from "lucide-react";
import {
  categories,
  type Asset,
  type Project,
  type MaterialVariant,
  type PackageManifest,
} from "../../shared/types";
import { call, report, useStore, bytes } from "./store";
import { entityCategories, gameplayTags } from "../../shared/entities";
import { ImageViewer } from "./viewers/ImageViewer";
import { ModelViewer } from "./viewers/ModelViewer";
import { SkinViewer } from "./SkinViewer";
import { Empty, Loading } from "./components";
import { menuBindings, MoreButton } from "./ContextMenu";
import { singleSelection, assetCommands } from "./WorkshopMenus";
export function Preview({
  asset,
  compact = false,
}: {
  asset: Asset;
  compact?: boolean;
}) {
  return asset.capabilities.preview === "skin" ? <SkinViewer key={asset.id} asset={asset} compact={compact}/> : asset.capabilities.preview === "image" ? (
    <ImageViewer key={asset.id} asset={asset} compact={compact} />
  ) : ["model", "environment", "material"].includes(
      asset.capabilities.preview,
    ) ? (
    <ModelViewer key={asset.id} asset={asset} compact={compact} />
  ) : (
    <Empty icon={<FileCheck2 size={28} />} heading="原件已托管">
      {asset.capabilities.reason}
    </Empty>
  );
}
export function Inspector({
  id,
  projects,
  onExpand,
  onMaterial,
  onExport,
  onNewVersion,
}: {
  id: string | null;
  projects: Project[];
  onExpand: (a: Asset) => void;
  onMaterial: (a: Asset) => void;
  onExport: (ids: string[]) => void;
  onNewVersion: (a: Asset) => void;
}) {
  const epoch = useStore((s) => s.epoch),
    [detail, setDetail] = useState<{
      asset: Asset;
      manifest: PackageManifest;
      variants: MaterialVariant[];
      projects: Project[];
    } | null>(null),
    [versions, setVersions] = useState<Asset[]>([]),
    [tab, setTab] = useState("info"),
    [tags, setTags] = useState(""),
    [notes, setNotes] = useState(""),
    [title, setTitle] = useState("");
  useEffect(() => {
    if (detail?.asset.id !== id) setDetail(null);
    if (id)
      void call<any>("assets.detail", { id })
        .then((d) => {
          setDetail(d);
          setTags(d.asset.tags.join(", "));
          setNotes(d.asset.notes);
          setTitle(d.asset.title);
        })
        .catch(report);
  }, [id, epoch]);
  const a = detail?.asset;
  useEffect(() => {
    if (id)
      void call<Asset[]>("assets.versions", { id })
        .then(setVersions)
        .catch(report);
  }, [id, epoch]);
  async function patch(change: any) {
    if (a)
      try {
        await call("assets.update", { ids: [a.id], change });
      } catch (e) {
        report(e);
      }
  }
  return (
    <aside
      className="inspector"
      tabIndex={0}
      {...menuBindings(() => (a ? assetCommands(singleSelection(a)) : []))}
    >
      {!id ? (
        <Empty icon={<Box size={30} />} heading="查看素材">
          点击缩略图放大查看；点击名称选择素材，查看属性和来源。
        </Empty>
      ) : !a ? (
        <Loading />
      ) : (
        <>
          <div className="inspector-top">
            <span>{categories[a.category]}</span>
            <ClientButton
              className="icon-button"
              aria-label="展开预览"
              onClick={() => onExpand(a)}
            >
              <ArrowUpRight size={19} />
            </ClientButton>
          </div>
          <div className="inspector-preview">
            <Preview asset={a} compact />
          </div>
          <div className="inspector-heading">
            <h2>{a.title}</h2>
            <p title={a.path}>{a.path}</p>
          </div>
          <div className="inspector-tabs">
            <Tabs
              label="素材详情"
              value={tab}
              onChange={setTab}
              options={[
                { value: "info", label: "属性" },
                { value: "files", label: "依赖" },
                { value: "source", label: "来源" },
                { value: "versions", label: "版本" },
              ]}
            />
          </div>
          <div className="inspector-content">
            {tab === "info" ? (
              <>
                <dl className="properties">
                  <dt>格式</dt>
                  <dd>
                    {a.extension.toUpperCase()} · {bytes(a.bytes)}
                  </dd>
                  {a.metadata.width && (
                    <>
                      <dt>尺寸</dt>
                      <dd>
                        {a.metadata.width} × {a.metadata.height}
                      </dd>
                    </>
                  )}
                  {a.metadata.triangles !== undefined && (
                    <>
                      <dt>几何</dt>
                      <dd>{a.metadata.triangles.toLocaleString()} 三角形</dd>
                      <dt>UV 通道</dt>
                      <dd>
                        {a.metadata.uvChannels
                          ?.map((v: number) => `UV${v}`)
                          .join(" / ") || "缺少 UV"}
                      </dd>
                    </>
                  )}
                  {a.metadata.animations && (
                    <>
                      <dt>动画</dt>
                      <dd>{a.metadata.animations.length} 个</dd>
                    </>
                  )}
                  <dt>导入时间</dt>
                  <dd>{new Date(a.createdAt).toLocaleDateString("zh-CN")}</dd>
                </dl>
                <label className="field">
                  <span>素材标题</span>
                  <input
                    aria-label="素材标题"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={() => {
                      if (title !== a.title && title.trim())
                        void patch({ title });
                    }}
                  />
                </label>
                <label className="field">
                  <span>分类</span>
                  <select
                    value={a.category}
                    onChange={(e) => void patch({ category: e.target.value })}
                  >
                    {Object.entries(categories).map(([v, t]) => (
                      <option key={v} value={v}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>标签 · 用逗号分隔</span>
                  <input
                    aria-label="素材标签"
                    value={tags}
                    onChange={(e) => setTags(e.target.value)}
                    onBlur={() => {
                      const values = tags
                        .split(/[,，]/)
                        .map((t) => t.trim())
                        .filter(Boolean);
                      if (JSON.stringify(values) !== JSON.stringify(a.tags))
                        void patch({ tags: values });
                    }}
                  />
                </label>
                <label className="field">
                  <span>实体分类</span>
                  <select
                    aria-label="实体分类"
                    value={a.metadata.entityCategory ?? ""}
                    onChange={(e) =>
                      void call("assets.organize", {
                        ids: [a.id],
                        entityCategory: e.target.value || null,
                      }).catch(report)
                    }
                  >
                    <option value="">不属于游戏实体</option>
                    {Object.entries(entityCategories).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="gameplay-options inspector-gameplay">
                  {Object.entries(gameplayTags).map(([key, label]) => (
                    <label className="check-label" key={key}>
                      <input
                        type="checkbox"
                        checked={(a.metadata.gameplayTags ?? []).includes(key)}
                        onChange={(e) =>
                          void call("assets.organize", {
                            ids: [a.id],
                            gameplayTags: e.target.checked
                              ? [...(a.metadata.gameplayTags ?? []), key]
                              : (a.metadata.gameplayTags ?? []).filter(
                                  (t: string) => t !== key,
                                ),
                          }).catch(report)
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <label className="field">
                  <span>备注</span>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() => {
                      if (notes !== a.notes) void patch({ notes });
                    }}
                  />
                </label>
                <h3>所在项目</h3>
                <div className="tag-list">
                  {detail!.projects.map((p) => (
                    <span key={p.id}>
                      {p.name}
                      <ClientButton
                        className="icon-button"
                        aria-label={`移出 ${p.name}`}
                        onClick={() =>
                          void call("projects.detach", {
                            projectId: p.id,
                            assetIds: [a.id],
                          }).catch(report)
                        }
                      >
                        <X size={12} />
                      </ClientButton>
                    </span>
                  ))}
                </div>
                <select
                  aria-label="加入项目"
                  value=""
                  onChange={(e) =>
                    void call("projects.attach", {
                      projectId: e.target.value,
                      assetIds: [a.id],
                    }).catch(report)
                  }
                >
                  <option value="">+ 加入项目</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </>
            ) : tab === "files" ? (
              <>
                <h3>资源依赖</h3>
                {detail!.manifest.dependencies
                  .filter(
                    (d) => d.from === a.path || a.dependencies.includes(d.from),
                  )
                  .map((d, i) => (
                    <div className={`dependency ${d.status}`} key={i}>
                      <FileCheck2 size={15} />
                      <span>{d.target}</span>
                      <small>
                        {d.status === "resolved"
                          ? "完整"
                          : d.status === "remote"
                            ? "已阻止联网"
                            : "缺失"}
                      </small>
                    </div>
                  ))}
                {!a.dependencies.length && (
                  <p className="muted">此入口没有外部依赖。</p>
                )}
                <h3>包内文件 · {detail!.manifest.files.length}</h3>
                <div className="file-list">
                  {detail!.manifest.files.slice(0, 250).map((f) => (
                    <div key={f.id}>
                      <span>{f.path}</span>
                      <small>{bytes(f.bytes)}</small>
                    </div>
                  ))}
                </div>
              </>
            ) : tab === "source" ? (
              <>
                {a.source ? (
                  <>
                    <div className="license-banner">
                      <FileCheck2 size={21} />
                      <div>
                        <strong>{a.source.license}</strong>
                        <span>{a.source.author}</span>
                      </div>
                    </div>
                    <dl className="properties">
                      <dt>来源</dt>
                      <dd>{a.source.provider}</dd>
                      <dt>来源 ID</dt>
                      <dd>{a.source.assetId}</dd>
                      <dt>核实时间</dt>
                      <dd>{a.source.checkedAt?.slice(0, 10) || "未核实"}</dd>
                    </dl>
                    <ClientButton
                      onClick={() =>
                        void call("system.openSource", {
                          url: a.source!.pageUrl,
                        }).catch(report)
                      }
                    >
                      <ExternalLink size={15} />
                      打开来源页
                    </ClientButton>
                    <p className="muted source-evidence">{a.source.evidence}</p>
                  </>
                ) : (
                  <p className="muted">
                    本地导入。可以在备注中补充作者和授权信息。
                  </p>
                )}
              </>
            ) : (
              <>
                <dl className="properties">
                  <dt>包 ID</dt>
                  <dd>
                    <code>{a.packageId}</code>
                  </dd>
                  <dt>版本</dt>
                  <dd>
                    <code>{a.revisionId}</code>
                  </dd>
                  <dt>SHA-256</dt>
                  <dd>
                    <code>{a.sha256}</code>
                  </dd>
                </dl>
                <h3>材质变体 · {detail!.variants.length}</h3>
                <ClientButton onClick={() => onNewVersion(a)}>
                  导入新版本
                </ClientButton>
                <h3>素材版本 · {versions.length}</h3>
                {versions.map((version) => (
                  <div className="version-entry" key={version.id}>
                    <ClientButton
                      className="text-button"
                      onClick={() =>
                        useStore
                          .getState()
                          .setSelection([version.id], version.id)
                      }
                    >
                      {version.revisionId.slice(0, 8)} ·{" "}
                      {new Date(version.createdAt).toLocaleDateString("zh-CN")}
                      {version.id === a.id ? " · 当前查看" : ""}
                    </ClientButton>
                    {version.id !== a.id &&
                      detail!.projects.map((p) => (
                        <ClientButton
                          key={p.id}
                          onClick={() =>
                            void call("projects.upgrade", {
                              projectId: p.id,
                              fromAssetId: a.id,
                              toAssetId: version.id,
                            }).catch(report)
                          }
                        >
                          将 {p.name} 切换到此版本
                        </ClientButton>
                      ))}
                  </div>
                ))}
                {detail!.variants.map((v) => (
                  <div className="variant-item" key={v.id}>
                    <Palette size={16} />
                    {v.name}
                    <ClientButton
                      className="icon-button"
                      onClick={() => onExport([a.id])}
                    >
                      <ArrowUpRight size={14} />
                    </ClientButton>
                  </div>
                ))}
                <p className="muted">
                  项目固定当前版本。外部修改请另存副本后重新导入。
                </p>
              </>
            )}
          </div>
          <footer className="inspector-actions">
            {["model", "material"].includes(a.capabilities.preview) && (
              <ClientButton onClick={() => onMaterial(a)}>
                <Palette size={16} />
                材质工作台
              </ClientButton>
            )}
            <ClientButton className="primary" onClick={() => onExport([a.id])}>
              <ArrowUpRight size={16} />
              导出资源
            </ClientButton>
            <MoreButton
              items={() => assetCommands(singleSelection(a))}
              label="详情更多操作"
            />
          </footer>
        </>
      )}
    </aside>
  );
}
