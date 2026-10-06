import { MoreHorizontal } from "lucide-react";
import type {
  Asset,
  AssetQuery,
  AssetSelection,
  Collection,
  Project,
} from "../../shared/types";
import { call, useStore } from "./store";
import { openFamily } from "../../shared/families";
import {
  command as c,
  group as g,
  openMenu,
  openAsyncMenu,
  menuBindings,
} from "./ContextMenu";
export interface Action {
  type: string;
  ids?: string[];
  project?: Project;
  collection?: Collection;
  data?: any;
  query?: AssetQuery;
}
let menuCollections: Collection[] = [];
export function setMenuCollections(collections: Collection[]) {
  menuCollections = collections.map((c) => ({ ...c }));
}
export function act(type: string, fields: Omit<Action, "type"> = {}) {
  window.dispatchEvent(
    new CustomEvent<Action>("workshop:action", {
      detail: { type, ...fields, ids: fields.ids?.slice() },
    }),
  );
}
export function singleSelection(a: Asset): AssetSelection {
  return {
    ids: [a.id],
    count: 1,
    sample: [a],
    allImages: a.capabilities.preview === "image",
    allPreviewable: a.capabilities.preview !== "archive",
    allFavorite: a.favorite,
    allAuxiliary: a.metadata.auxiliaryRole === "preview",
    allTrashed: a.trashed,
  };
}
export function assetCommands(
  s: AssetSelection,
  query: AssetQuery = useStore.getState().query,
) {
  const ids = s.ids.slice(),
    a = s.count === 1 ? s.sample[0] : undefined,
    fire = (type: string, data?: any) => () =>
      act(type, { ids, query: { ...query }, data });
  if (s.allTrashed)
    return [
      c("restore", "恢复素材", () =>
        call("assets.update", { ids, change: { trashed: false } }),
      ),
      c("detail", "查看所选清单", fire("selection")),
      c(
        "purge",
        "永久清理…",
        fire("confirm", {
          method: "assets.purge",
          input: { ids },
          message: `永久清理 ${ids.length} 个素材？仍被项目或变体引用的素材会保留。`,
        }),
        { danger: true },
      ),
    ];
  const tools = [
    ...(s.allImages && a
      ? [c("family", "制作同类素材", () => openFamily({ assetId: a.id }))]
      : []),
    ...(s.allImages ? [c("processing", "加工图片…", fire("processing"))] : []),
    c("dependencies", "检查依赖", fire("dependencies")),
    c("thumbnails", "重建所选缩略图", () => call("previews.rebuild", { ids })),
  ];
  if (a && ["model", "material"].includes(a.capabilities.preview))
    tools.push(c("material", "材质工作台", fire("material")));
  if ((s.allImages && s.count >= 1) || a?.metadata.materialSet)
    tools.push(c("match", "匹配贴图到模型…", fire("match")));
  if (s.allImages && s.count >= 2 && s.count <= 12)
    tools.push(c("states", "控件状态分组…", fire("states")));
  if (s.allPreviewable && s.count === 2)
    tools.push(c("compare", "并排对照", fire("compare")));
  if (a && [".obj", ".fbx", ".blend"].includes(a.extension))
    tools.push(c("convert", "生成 GLB 副本", fire("convert")));
  const association = [
    c("attach-project", "加入项目…", fire("attach-project")),
    c("attach-collection", "加入普通收藏集…", fire("attach-collection")),
  ];
  if (query.projectId)
    association.push(
      c("detach-project", "移出当前项目", () =>
        call("projects.detach", { projectId: query.projectId, assetIds: ids }),
      ),
    );
  if (
    query.collectionId &&
    !menuCollections.find((c) => c.id === query.collectionId)?.query
  )
    association.push(
      c("detach-collection", "移出当前收藏集", fire("detach-collection")),
    );
  const fileMenu = [
    c("copy-title", "复制标题", () =>
      call("system.copy", { assetIds: ids, field: "title" }),
    ),
    c("copy-id", "复制素材 ID", () =>
      call("system.copy", { assetIds: ids, field: "id" }),
    ),
    c("copy-original", "复制原件路径", () =>
      call("system.copy", { assetIds: ids, field: "original" }),
    ),
    c("copy-relative", "复制库内相对路径", () =>
      call("system.copy", { assetIds: ids, field: "path" }),
    ),
  ];
  if (a)
    fileMenu.unshift(
      c("reveal", "在文件管理器中定位原件", () =>
        call("system.reveal", { assetId: a.id }),
      ),
    );
  if (a?.source?.pageUrl)
    fileMenu.push(
      c("source", "打开来源页", () =>
        call("system.openSource", { assetId: a.id }),
      ),
      c("copy-source", "复制来源链接", () =>
        call("system.copy", { assetIds: ids, field: "source" }),
      ),
    );
  return [
    c(
      "preview",
      a ? "展开预览／查看详情" : "查看所选清单",
      fire(a ? "preview" : "selection"),
    ),
    c("favorite", s.allFavorite ? "取消收藏" : "收藏所选素材", () =>
      call("assets.update", { ids, change: { favorite: !s.allFavorite } }),
    ),
    c("organize", a ? "整理…" : "批量整理…", fire("organize")),
    g("association", "关联", association),
    g("tools", "素材工具", tools),
    g("export", "导出", [
      c("quick-export", "导出到当前绑定工程", fire("quick-export"), {
        disabled: !query.projectId,
        reason: query.projectId ? undefined : "先进入绑定工程的项目",
      }),
      c(
        "godot-export",
        "选择 Godot 工程导出…",
        fire("export", { mode: "godot" }),
      ),
      c(
        "zip-export",
        "标准 ZIP…",
        fire("export", { mode: "generic", zip: true }),
      ),
      c(
        "folder-export",
        "资源包目录…",
        fire("export", { mode: "generic", zip: false }),
      ),
    ]),
    g("files", "文件与来源", fileMenu),
    c(
      "trash",
      "移入回收站",
      () => call("assets.update", { ids, change: { trashed: true } }),
      { danger: true },
    ),
  ];
}
export function openAssets(
  ids: string[],
  x: number,
  y: number,
  focus: HTMLElement | null,
  query = { ...useStore.getState().query },
) {
  void openAsyncMenu(
    () =>
      call<AssetSelection>("assets.selection", { ids }).then((s) =>
        assetCommands(s, query),
      ),
    x,
    y,
    focus,
  );
}
export function AssetMoreButton({ ids }: { ids: string[] }) {
  return (
    <button
      aria-label="素材更多操作"
      className="icon-button"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        openAssets(ids.slice(), r.left, r.bottom, e.currentTarget);
      }}
      onKeyDown={(e) => {
        if (e.shiftKey && e.key === "F10") {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          openAssets(ids.slice(), r.left, r.bottom, e.currentTarget);
        }
      }}
    >
      <MoreHorizontal size={18} />
    </button>
  );
}
export function blankCommands(query: AssetQuery) {
  const q = { ...query };
  const set = (change: Partial<AssetQuery>) => () =>
    useStore.getState().setQuery({ ...q, ...change });
  return [
    g("import", "导入", [
      c("files", "文件…", () =>
        act("import", { data: { folder: false }, query: q }),
      ),
      c("folder", "文件夹…", () =>
        act("import", { data: { folder: true }, query: q }),
      ),
      c("zip", "ZIP 素材包…", () =>
        act("import", { data: { folder: false }, query: q }),
      ),
    ]),
    g("new", "新建", [
      c("project", "游戏项目…", () => act("new-project")),
      c("collection", "普通收藏集…", () => act("new-collection")),
      c("smart", "智能收藏集…", () =>
        act("new-collection", { data: { smart: true }, query: q }),
      ),
    ]),
    g("view", "视图", [
      c("grid", "网格", () => act("grid-view", { data: { list: false } })),
      c("list", "列表", () => act("grid-view", { data: { list: true } })),
      c("size", "缩略图尺寸…", () => act("grid-size")),
      c(
        "auxiliary",
        "显示辅助预览图",
        set({ includeAuxiliary: !q.includeAuxiliary }),
        { checked: q.includeAuxiliary ?? !!q.showRelated },
      ),
      c(
        "related",
        "所有文件",
        set({ showRelated: !q.showRelated, includeAuxiliary: !q.showRelated }),
        { checked: !!q.showRelated },
      ),
    ]),
    g(
      "sort",
      "排序",
      (
        [
          ["newest", "最近导入"],
          ["title", "名称"],
          ["size", "文件大小"],
          ["viewed", "最近查看"],
        ] as const
      ).map(([sort, label]) =>
        c(sort, label, set({ sort }), {
          checked: (q.sort ?? "newest") === sort,
        }),
      ),
    ),
    c("select-all", "全选当前筛选结果", () => act("select-all", { query: q })),
    c("invert", "反选", () => act("invert", { query: q })),
    c("clear", "清除选择", () => useStore.getState().setSelection([], null)),
  ];
}
export function projectCommands(project: Project) {
  const p = { ...project };
  return [
    c("open", "打开项目", () =>
      useStore.getState().setQuery({ projectId: p.id }),
    ),
    c("edit", "编辑名称与工程绑定…", () => act("edit-project", { project: p })),
    c("import", "导入到项目…", () =>
      act("import", { query: { projectId: p.id }, data: { folder: false } }),
    ),
    c("organize", "整理项目素材…", () =>
      act("project-organize", { project: p }),
    ),
    c("dependencies", "检查依赖", () =>
      act("project-dependencies", { project: p }),
    ),
    c("export", "导出整个项目", () => act("project-export", { project: p })),
    c(
      "delete",
      "删除项目…",
      () =>
        act("confirm", {
          data: {
            message: `删除项目「${p.name}」的组织信息？库内素材会保留。`,
            method: "projects.delete",
            input: { id: p.id },
            reset: true,
          },
        }),
      { danger: true },
    ),
  ];
}
export function collectionCommands(collection: Collection) {
  const v = { ...collection };
  return [
    c("open", "打开收藏集", () =>
      useStore.getState().setQuery({ collectionId: v.id }),
    ),
    c("rename", "重命名…", () => act("edit-collection", { collection: v })),
    ...(v.query
      ? [
          c("rules", "编辑筛选条件…", () =>
            act("edit-collection", { collection: v, data: { rules: true } }),
          ),
        ]
      : []),
    c("export", "导出收藏集…", () =>
      act("collection-export", { collection: v }),
    ),
    c(
      "delete",
      "删除收藏集…",
      () =>
        act("confirm", {
          data: {
            message: `删除收藏集「${v.name}」？库内素材会保留。`,
            method: "collections.delete",
            input: { id: v.id },
            reset: true,
          },
        }),
      { danger: true },
    ),
  ];
}
export const projectBindings = (p: Project) =>
  menuBindings(() => projectCommands(p));
export const collectionBindings = (v: Collection) =>
  menuBindings(() => collectionCommands(v));
