import { Theme, Reveal, SectionTitle } from "./ui-kit";
import { ClientButton, ClientNav, ClientNotice } from "./client-ui";
import { useEffect, useState } from "react";
import {
  Box,
  Search,
  Plus,
  Upload,
  Download,
  LayoutDashboard,
  Library,
  Star,
  Clock,
  Tags,
  Trash2,
  Folder,
  Layers,
  Settings,
  ListTodo,
  ChevronDown,
  X,
  ArrowLeft,
  GitCompare,
  Palette,
  MoreHorizontal,
  Sparkles,
} from "lucide-react";
import type { Asset, Collection, Project, Category } from "../../shared/types";
import { categories } from "../../shared/types";
import { entityCategories, gameplayTags } from "../../shared/entities";
import { call, report, useStore } from "./store";
import { Modal } from "./components";
import { AssetGrid } from "./AssetGrid";
import { AggregatedGrid } from "./AggregatedGrid";
import { Inspector, Preview } from "./Inspector";
import {
  ImportFlow,
  ExportFlow,
  ProjectFlow,
  CollectionFlow,
  OrganizeFlow,
} from "./Flows";
import { Dashboard, Sources, Tasks, SettingsPage } from "./Pages";
import { MaterialWorkbench } from "./MaterialWorkbench";
import { ContextMenuHost, MoreButton, openMenu, command } from "./ContextMenu";
import {
  AssetMoreButton,
  projectBindings,
  collectionBindings,
  projectCommands,
  collectionCommands,
  blankCommands,
  setMenuCollections,
} from "./WorkshopMenus";
import { WorkshopActions } from "./WorkshopActions";
import { GenerationPage } from "./GenerationPage";
import { FamilyPage } from "./FamilyPage";
import { openFamily } from "../../shared/families";
import { ProcessingEditorHost } from "./ProcessingEditor";
import { openProcessing } from "../../shared/processing";
export function App() {
  const [familySource, setFamilySource] = useState<{
    assetId?: string;
    candidateId?: string;
  }>({});
  useEffect(() => {
    const listener = (event: Event) => {
      setFamilySource((event as CustomEvent).detail);
      useStore.getState().setPage("families");
    };
    window.addEventListener("workshop:family", listener);
    return () => window.removeEventListener("workshop:family", listener);
  }, []);
  const state = useStore(),
    [projects, setProjects] = useState<Project[]>([]),
    [collections, setCollections] = useState<Collection[]>([]),
    [search, setSearch] = useState(""),
    [importPaths, setImportPaths] = useState<string[] | null>(null),
    [importParent, setImportParent] = useState<string | undefined>(),
    [projectModal, setProjectModal] = useState<Project | "new" | null>(null),
    [collectionModal, setCollectionModal] = useState(false),
    [organize, setOrganize] = useState<"tags" | "states" | null>(null),
    [exportState, setExportState] = useState<{
      ids: string[];
      variants?: string[];
    } | null>(null),
    [expanded, setExpanded] = useState<Asset | null>(null),
    [material, setMaterial] = useState<Asset | null>(null),
    [compare, setCompare] = useState<Asset[] | null>(null),
    [dragging, setDragging] = useState(false),
    [filters, setFilters] = useState(false);
  useEffect(() => {
    void call<Project[]>("projects.list").then(setProjects).catch(report);
    void call<Collection[]>("collections.list")
      .then(setCollections)
      .catch(report);
  }, [state.epoch]);
  useEffect(() => setMenuCollections(collections), [collections]);
  useEffect(() => {
    void call<any[]>("jobs.list")
      .then((jobs) => jobs.forEach((j) => useStore.getState().updateJob(j)))
      .catch(report);
    return window.workshop.onEvent((e) => {
      if (e.type === "job.updated") useStore.getState().updateJob(e.data);
      if (e.type === "catalog.changed") useStore.getState().refresh();
    });
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== (state.query.search ?? ""))
        state.setQuery({ ...state.query, search });
    }, 220);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setSearch(state.query.search ?? ""), [state.query.search]);
  async function chooseImport(folder = false) {
    const paths = await window.workshop.choose({
      kind: folder ? "folder" : "files",
      title: "选择要托管的素材",
    });
    if (paths.length) setImportPaths(paths);
  }
  async function bulk(change: any) {
    try {
      await call("assets.update", { ids: state.selected, change });
    } catch (e) {
      report(e);
    }
  }
  function openMaterial(a: Asset) {
    setExpanded(null);
    setMaterial(a);
    state.setPage("material");
  }
  const currentProject = projects.find((p) => p.id === state.query.projectId),
    currentCollection = collections.find(
      (c) => c.id === state.query.collectionId,
    ),
    title =
      currentProject?.name ??
      currentCollection?.name ??
      (state.query.entityCategory
        ? entityCategories[state.query.entityCategory]
        : state.query.category
          ? categories[state.query.category]
          : state.query.trash
            ? "回收站"
            : state.query.favorite
              ? "我的收藏"
              : state.query.recent
                ? "最近查看"
                : state.query.unsorted
                  ? "待整理"
                  : "全部素材"),
    activeJobs = state.jobs.filter((j) =>
      ["queued", "running", "paused"].includes(j.status),
    );
  function nav(query: any) {
    state.setQuery(query);
  }
  return (
    <Theme
      className="app-shell client-theme"
      data-page={state.page}
      accent={
        state.page === "sources"
          ? "cyan"
          : state.page === "material"
            ? "violet"
            : "red"
      }
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node))
          setDragging(false);
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          setDragging(false);
          const paths = window.workshop.dropPaths(
            Array.from(e.dataTransfer.files),
          );
          if (paths.length) setImportPaths(paths);
        }
      }}
    >
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <img src="./ui-art/cube-burst-red.svg" alt="" />
          </span>
          <div>
            <strong>素材工坊</strong>
            <small>OmO</small>
          </div>
          <span className="version-dot" />
        </div>
        <div className="sidebar-scroll">
          <nav>
            <ClientNav
              className={state.page === "dashboard" ? "active" : ""}
              onClick={() => state.setPage("dashboard")}
            >
              <LayoutDashboard size={18} />
              工作台
            </ClientNav>
            <ClientNav
              className={state.page === "generation" ? "active" : ""}
              onClick={() => state.setPage("generation")}
            >
              <Sparkles size={18} />
              AI 生成
            </ClientNav>
            <ClientNav
              className={state.page === "families" ? "active" : ""}
              onClick={() => openFamily()}
            >
              <Layers size={18} />
              同类素材
            </ClientNav>
            <ClientNav onClick={() => openProcessing([])}>
              <Palette size={18} />
              图像加工
            </ClientNav>
            <ClientNav
              className={
                state.page === "library" &&
                !Object.keys(state.query).some(
                  (k) =>
                    ![
                      "search",
                      "sort",
                      "showRelated",
                      "extension",
                      "license",
                      "minWidth",
                      "maxTriangles",
                      "hasAnimation",
                      "missing",
                    ].includes(k),
                )
                  ? "active"
                  : ""
              }
              onClick={() => nav({})}
            >
              <Library size={18} />
              全部素材
            </ClientNav>
            <ClientNav
              className={
                state.query.favorite && state.page === "library" ? "active" : ""
              }
              onClick={() => nav({ favorite: true })}
            >
              <Star size={18} />
              我的收藏
            </ClientNav>
            <ClientNav
              className={
                state.query.recent && state.page === "library" ? "active" : ""
              }
              onClick={() => nav({ recent: true, sort: "viewed" })}
            >
              <Clock size={18} />
              最近查看
            </ClientNav>
            <ClientNav
              className={
                state.query.unsorted && state.page === "library" ? "active" : ""
              }
              onClick={() => nav({ unsorted: true })}
            >
              <Tags size={18} />
              待整理
            </ClientNav>
          </nav>
          <div className="sidebar-label">
            <span>游戏项目</span>
            <ClientButton
              aria-label="创建项目"
              onClick={() => setProjectModal("new")}
            >
              <Plus size={15} />
            </ClientButton>
          </div>
          <nav>
            {projects.map((p) => (
              <ClientNav
                key={p.id}
                {...projectBindings(p)}
                className={
                  state.query.projectId === p.id && state.page === "library"
                    ? "active"
                    : ""
                }
                onClick={() => nav({ projectId: p.id })}
              >
                <span className="project-dot" style={{ background: p.color }} />
                <span>{p.name}</span>
                <small>{p.assetCount}</small>
              </ClientNav>
            ))}
            {!projects.length && (
              <ClientNav
                className="muted"
                onClick={() => setProjectModal("new")}
              >
                <Plus size={16} />
                创建第一个项目
              </ClientNav>
            )}
          </nav>
          <div className="sidebar-label">
            <span>游戏实体</span>
            <Box size={14} />
          </div>
          <nav className="entity-nav">
            {Object.entries(entityCategories).map(([key, label]) => (
              <ClientNav
                key={key}
                className={
                  state.query.entityCategory === key && state.page === "library"
                    ? "active"
                    : ""
                }
                onClick={() => nav({ entityCategory: key })}
              >
                <span className="category-dot model" />
                {label}
              </ClientNav>
            ))}
          </nav>
          <div className="sidebar-label">
            <span>素材分类</span>
            <Layers size={14} />
          </div>
          <nav className="category-nav">
            {Object.entries(categories).map(([key, label]) => (
              <ClientNav
                key={key}
                className={
                  state.query.category === key && state.page === "library"
                    ? "active"
                    : ""
                }
                onClick={() => nav({ category: key })}
              >
                <span className={`category-dot ${key}`} />
                {label}
              </ClientNav>
            ))}
          </nav>
          <div className="sidebar-label">
            <span>收藏集</span>
            <ClientButton
              aria-label="新建收藏集"
              onClick={() => setCollectionModal(true)}
            >
              <Plus size={15} />
            </ClientButton>
          </div>
          <nav>
            {collections.map((c) => (
              <ClientNav
                key={c.id}
                {...collectionBindings(c)}
                className={
                  state.query.collectionId === c.id && state.page === "library"
                    ? "active"
                    : ""
                }
                onClick={() => nav({ collectionId: c.id })}
              >
                <Folder size={16} />
                <span>{c.name}</span>
                {c.query && <small>智能</small>}
              </ClientNav>
            ))}
          </nav>
          <nav className="sidebar-secondary">
            <ClientNav
              className={
                state.query.trash && state.page === "library" ? "active" : ""
              }
              onClick={() => nav({ trash: true, showRelated: true })}
            >
              <Trash2 size={17} />
              回收站
            </ClientNav>
          </nav>
        </div>
        <footer className="sidebar-bottom">
          <ClientButton
            onClick={() => state.setPage("settings")}
            className={state.page === "settings" ? "active" : ""}
          >
            <Settings size={18} />
            设置
          </ClientButton>
          <div>
            <span className="online-dot" />
            本地素材库 <small>0.1.0</small>
          </div>
        </footer>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="global-search">
            <Search size={17} />
            <input
              aria-label="搜索素材"
              placeholder="搜索素材、标签、来源…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <ClientButton aria-label="清除搜索" onClick={() => setSearch("")}>
                <X size={14} />
              </ClientButton>
            )}
            <kbd>本地搜索</kbd>
          </div>
          <div className="top-actions">
            <div className="import-dropdown">
              <ClientButton
                className="primary"
                onClick={() => void chooseImport()}
              >
                <Upload size={16} />
                导入素材
              </ClientButton>
              <ClientButton
                className="primary dropdown-toggle"
                aria-label="更多导入方式"
                aria-haspopup="menu"
                onClick={(event) => {
                  const r = event.currentTarget.getBoundingClientRect();
                  openMenu(
                    [
                      command("import-folder", "导入文件夹", () =>
                        chooseImport(true),
                      ),
                      command("import-files", "导入文件 / ZIP", () =>
                        chooseImport(),
                      ),
                    ],
                    r.left,
                    r.bottom + 8,
                    event.currentTarget,
                  );
                }}
              >
                <ChevronDown size={13} />
              </ClientButton>
            </div>
            <ClientButton
              className={state.page === "sources" ? "active" : ""}
              onClick={() => state.setPage("sources")}
            >
              <Download size={16} />
              免费素材
            </ClientButton>
            <ClientButton
              aria-label="任务中心"
              className={state.page === "tasks" ? "active" : ""}
              onClick={() => state.setPage("tasks")}
            >
              <ListTodo size={17} />
              <span className="task-count">{activeJobs.length || ""}</span>
            </ClientButton>
          </div>
        </header>
        <Reveal
          preset="panel"
          replayKey={state.page}
          className="client-route-reveal"
        >
          {state.page === "library" ? (
            <div className="library-layout">
              <div className="library-center">
                <header className="library-heading">
                  <div>
                    <span className="eyebrow">
                      {currentProject
                        ? "PROJECT LIBRARY"
                        : currentCollection
                          ? "COLLECTION"
                          : "YOUR ASSET LIBRARY"}
                    </span>
                    <SectionTitle as="h1" title={title} />
                    <p>
                      {currentProject?.description ||
                        "让分散的创作资源，成为触手可及的灵感。"}
                    </p>
                  </div>
                  <div className="button-row">
                    {!state.query.trash && (
                      <ClientButton
                        className={state.aggregationMode ? "active" : ""}
                        onClick={() =>
                          state.setAggregationMode(
                            state.aggregationMode ? "" : "entity",
                          )
                        }
                      >
                        <Layers size={15} />
                        {state.aggregationMode ? "普通浏览" : "智能聚合"}
                      </ClientButton>
                    )}
                    <MoreButton
                      items={() =>
                        currentProject
                          ? projectCommands(currentProject)
                          : currentCollection
                            ? collectionCommands(currentCollection)
                            : blankCommands(state.query)
                      }
                      label="当前区域更多操作"
                    />
                    <ClientButton
                      onClick={() => setFilters(!filters)}
                      className={filters ? "active" : ""}
                    >
                      筛选 <ChevronDown size={13} />
                    </ClientButton>
                    <select
                      aria-label="素材排序"
                      value={state.query.sort ?? "newest"}
                      onChange={(e) =>
                        state.setQuery({
                          ...state.query,
                          sort: e.target.value as any,
                        })
                      }
                    >
                      <option value="newest">最近导入</option>
                      <option value="title">名称排序</option>
                      <option value="size">文件大小</option>
                    </select>
                  </div>
                </header>
                {filters && (
                  <div className="filter-bar">
                    <select
                      aria-label="实体分类筛选"
                      value={state.query.entityCategory ?? ""}
                      onChange={(e) =>
                        state.setQuery({
                          ...state.query,
                          entityCategory: e.target.value as any,
                        })
                      }
                    >
                      <option value="">全部实体分类</option>
                      {Object.entries(entityCategories).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="玩法标签筛选"
                      value={state.query.gameplayTag ?? ""}
                      onChange={(e) =>
                        state.setQuery({
                          ...state.query,
                          gameplayTag: e.target.value as any,
                        })
                      }
                    >
                      <option value="">全部玩法用途</option>
                      {Object.entries(gameplayTags).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="格式筛选"
                      value={state.query.extension ?? ""}
                      onChange={(e) =>
                        state.setQuery({
                          ...state.query,
                          extension: e.target.value,
                        })
                      }
                    >
                      <option value="">全部格式</option>
                      {[
                        "png",
                        "jpg",
                        "webp",
                        "glb",
                        "gltf",
                        "obj",
                        "fbx",
                        "hdr",
                        "psd",
                        "kra",
                        "tga",
                        "blend",
                      ].map((f) => (
                        <option key={f} value={f}>
                          {f.toUpperCase()}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="许可筛选"
                      value={state.query.license ?? ""}
                      onChange={(e) =>
                        state.setQuery({
                          ...state.query,
                          license: e.target.value,
                        })
                      }
                    >
                      <option value="">全部许可</option>
                      <option value="CC0-1.0">CC0</option>
                    </select>
                    {[
                      ["hasAnimation", "含动画"],
                      ["missing", "缺失依赖"],
                      ["showRelated", "所有文件"],
                      ["includeAuxiliary", "显示辅助预览图"],
                    ].map(([key, label]) => (
                      <label key={key} className="check-label">
                        <input
                          type="checkbox"
                          checked={!!(state.query as any)[key]}
                          onChange={(e) =>
                            state.setQuery({
                              ...state.query,
                              [key]: e.target.checked,
                            })
                          }
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                )}
                {state.selected.length > 0 && (
                  <div className="selection-bar">
                    <span>{state.selected.length} 个已选择</span>
                    {!state.query.trash && (
                      <ClientButton
                        onClick={() =>
                          setExportState({ ids: state.selected.slice() })
                        }
                      >
                        <Download size={14} />
                        导出
                      </ClientButton>
                    )}
                    <AssetMoreButton ids={state.selected} />
                    <ClientButton
                      className="icon-button"
                      aria-label="清除选择"
                      onClick={() => state.setSelection([], null)}
                    >
                      <X size={14} />
                    </ClientButton>
                  </div>
                )}
                {state.aggregationMode && !state.query.trash ? (
                  <AggregatedGrid
                    query={state.query}
                    mode={state.aggregationMode}
                    projects={projects}
                    onOpen={setExpanded}
                    onExport={(ids) => setExportState({ ids })}
                  />
                ) : (
                  <AssetGrid
                    query={state.query}
                    onOpen={(a) => setExpanded(a)}
                  />
                )}
                <footer className="library-footer">
                  <span>
                    <span className="online-dot" />
                    原件托管 · 离线可用
                  </span>
                  <span>点击缩略图放大 · Ctrl 多选 · Shift 连选</span>
                </footer>
              </div>
              <Inspector
                onNewVersion={async (a) => {
                  const paths = await window.workshop.choose({
                    kind: "files",
                    title: "选择已修改的文件或完整资源目录",
                  });
                  if (paths.length) {
                    setImportParent(a.id);
                    setImportPaths(paths);
                  }
                }}
                id={state.activeId}
                projects={projects}
                onExpand={setExpanded}
                onMaterial={openMaterial}
                onExport={(ids) => setExportState({ ids })}
              />
            </div>
          ) : state.page === "dashboard" ? (
            <Dashboard
              projects={projects}
              onImport={() => void chooseImport()}
            />
          ) : state.page === "sources" ? (
            <Sources />
          ) : state.page === "generation" ? (
            <GenerationPage projects={projects} />
          ) : state.page === "families" ? (
            <FamilyPage projects={projects} source={familySource} />
          ) : state.page === "tasks" ? (
            <Tasks />
          ) : state.page === "settings" ? (
            <SettingsPage />
          ) : material ? (
            <MaterialWorkbench
              asset={material}
              onBack={() => state.setPage("library")}
              onExport={(variants) =>
                setExportState({ ids: [material.id], variants })
              }
            />
          ) : null}
        </Reveal>
      </div>
      {importPaths && (
        <ImportFlow
          parentAssetId={importParent}
          paths={importPaths}
          projects={projects}
          onClose={() => {
            setImportPaths(null);
            setImportParent(undefined);
          }}
        />
      )}{" "}
      {projectModal && (
        <ProjectFlow
          project={projectModal === "new" ? undefined : projectModal}
          onClose={() => setProjectModal(null)}
        />
      )}{" "}
      {organize && (
        <OrganizeFlow
          ids={state.selected}
          states={organize === "states"}
          onClose={() => setOrganize(null)}
        />
      )}
      {collectionModal && (
        <CollectionFlow
          ids={state.selected}
          onClose={() => setCollectionModal(false)}
        />
      )}{" "}
      {exportState && (
        <ExportFlow
          ids={exportState.ids}
          variantIds={exportState.variants}
          projects={projects}
          initialAggregate={!!state.aggregationMode}
          onClose={() => setExportState(null)}
        />
      )}{" "}
      {expanded && (
        <Modal key={expanded.id} title={expanded.title} onClose={() => setExpanded(null)} wide>
          <div className="expanded-preview">
            <Preview asset={expanded} />
          </div>
          <div className="modal-actions">
            {["model", "material"].includes(expanded.capabilities.preview) && (
              <ClientButton onClick={() => openMaterial(expanded)}>
                <Palette size={16} />
                材质工作台
              </ClientButton>
            )}
            <ClientButton
              className="primary"
              onClick={() => setExportState({ ids: [expanded.id] })}
            >
              导出资源
            </ClientButton>
          </div>
        </Modal>
      )}{" "}
      {compare && (
        <Modal title="素材并排对照" onClose={() => setCompare(null)} wide>
          <div className="compare-grid">
            {compare.map((a) => (
              <div key={a.id}>
                <h3>{a.title}</h3>
                <Preview asset={a} />
              </div>
            ))}
          </div>
        </Modal>
      )}{" "}
      <WorkshopActions
        projects={projects}
        collections={collections}
        onPreview={setExpanded}
        onCompare={setCompare}
        onMaterial={openMaterial}
        onProject={setProjectModal}
      />
      <ProcessingEditorHost />
      <ContextMenuHost />
      <ClientNotice notice={state.notice} />{" "}
      {dragging && (
        <div className="drop-overlay">
          <Upload size={46} />
          <h2>将素材放入工坊</h2>
          <p>原件会复制到本地库，接下来检查导入设置。</p>
        </div>
      )}
    </Theme>
  );
}
