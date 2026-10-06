import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Layers, Check, Download } from "lucide-react";
import type {
  Asset,
  AssetGroup,
  AssetGroupPage,
  AssetQuery,
  AggregationMode,
  Project,
} from "../../shared/types";
import { entityCategories, gameplayTags } from "../../shared/entities";
import { canRequestThumbnail } from "../../shared/fbx";
import { call, report, useStore } from "./store";
import { Modal, Empty, Loading, Field } from "./components";

const PAGE_SIZE = 60;
const countLabels = {
  model: "模型",
  image: "图片",
  animation: "动画",
  material: "材质",
  other: "其他",
};
function composition(g: AssetGroup) {
  return Object.entries(g.counts)
    .filter(([, n]) => n)
    .map(([k, n]) => `${n} ${countLabels[k as keyof typeof countLabels]}`)
    .join(" · ");
}
export function AggregatedGrid({
  query,
  mode,
  projects,
  onOpen,
  onExport,
}: {
  query: AssetQuery;
  mode: AggregationMode;
  projects: Project[];
  onOpen: (a: Asset) => void;
  onExport: (ids: string[]) => void;
}) {
  const epoch = useStore((s) => s.epoch),
    selected = useStore((s) => s.selected);
  const parent = useRef<HTMLDivElement>(null),
    generation = useRef(0),
    requested = useRef(new Set<number>()),
    thumbnails = useRef(new Map<string, string>()),
    thumbnailRequested = useRef(new Set<string>()),
    [items, setItems] = useState<Record<number, AssetGroup>>({}),
    [total, setTotal] = useState(0),
    [assetTotal, setAssetTotal] = useState(0),
    [width, setWidth] = useState(800),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [detail, setDetail] = useState<AssetGroup | null>(null);
  const columns = Math.max(1, Math.floor((width - 32) / 240)),
    rowHeight = 285;
  const virtual = useVirtualizer({
    count: Math.ceil(total / columns),
    getScrollElement: () => parent.current,
    estimateSize: () => rowHeight,
    overscan: 2,
  });
  async function load(offset: number, gen: number) {
    if (gen !== generation.current || requested.current.has(offset)) return;
    requested.current.add(offset);
    try {
      const page = await call<AssetGroupPage>("assets.groups", {
        query: { ...query, offset, limit: PAGE_SIZE },
        mode,
      });
      if (gen !== generation.current) return;
      setTotal(page.total);
      setAssetTotal(page.assetTotal);
      setError(false);
      setItems((old) => {
        const next = { ...old };
        page.items.forEach((g, i) => {
          const url = thumbnails.current.get(g.primary.id);
          next[offset + i] = url
            ? { ...g, primary: { ...g.primary, thumbnailUrl: url } }
            : g;
        });
        for (const key of Object.keys(next))
          if (+key >= page.total) delete next[+key];
        return next;
      });
    } catch (e) {
      if (gen === generation.current) {
        requested.current.delete(offset);
        setError(true);
        report(e);
      }
    } finally {
      if (gen === generation.current && offset === 0) setLoading(false);
    }
  }
  const queryKey = JSON.stringify([query, mode]),
    lastKey = useRef("");
  useEffect(() => {
    const gen = ++generation.current;
    requested.current.clear();
    thumbnailRequested.current.clear();
    if (lastKey.current !== queryKey) {
      lastKey.current = queryKey;
      setItems({});
      setTotal(0);
      setLoading(true);
      setDetail(null);
      thumbnails.current.clear();
      parent.current?.scrollTo(0, 0);
    }
    void load(0, gen);
    for (const row of virtual.getVirtualItems())
      void load(Math.floor((row.index * columns) / PAGE_SIZE) * PAGE_SIZE, gen);
  }, [queryKey, epoch]);
  useEffect(() => {
    const observer = new ResizeObserver(([r]) => setWidth(r.contentRect.width));
    if (parent.current) observer.observe(parent.current);
    return () => observer.disconnect();
  }, []);
  useEffect(
    () =>
      window.workshop.onEvent((e) => {
        if (e.type !== "thumbnail.ready") return;
        thumbnails.current.set(e.data.id, e.data.thumbnailUrl);
        setItems((old) =>
          Object.fromEntries(
            Object.entries(old).map(([i, g]) => [
              i,
              g.primary.id === e.data.id
                ? {
                    ...g,
                    primary: {
                      ...g.primary,
                      thumbnailUrl: e.data.thumbnailUrl,
                    },
                  }
                : g,
            ]),
          ),
        );
      }),
    [],
  );
  const rows = virtual.getVirtualItems(),
    range = rows.map((r) => r.index).join(",");
  useEffect(() => {
    if (!rows.length) return;
    const start = rows[0].index * columns,
      end = Math.min(total - 1, (rows.at(-1)!.index + 1) * columns + PAGE_SIZE);
    for (
      let offset = Math.floor(start / PAGE_SIZE) * PAGE_SIZE;
      offset <= end;
      offset += PAGE_SIZE
    )
      void load(offset, generation.current);
    for (const row of rows)
      for (let c = 0; c < columns; c++) {
        const a = items[row.index * columns + c]?.primary;
        if (
          a &&
          !a.thumbnailUrl &&
          ["model", "material", "environment"].includes(
            a.capabilities.preview,
          ) &&
          canRequestThumbnail(a.extension, a.metadata) &&
          !thumbnailRequested.current.has(a.id)
        ) {
          thumbnailRequested.current.add(a.id);
          void call("previews.request", { assetId: a.id }).catch(() => {});
        }
      }
  }, [range, columns, total, items]);
  function select(
    g: AssetGroup,
    event: { ctrlKey: boolean; metaKey: boolean },
  ) {
    const store = useStore.getState(),
      ids = new Set(store.selected),
      full = g.assetIds.every((id) => ids.has(id));
    if (event.ctrlKey || event.metaKey) {
      for (const id of g.assetIds) full ? ids.delete(id) : ids.add(id);
    } else {
      ids.clear();
      g.assetIds.forEach((id) => ids.add(id));
    }
    store.setSelection([...ids], g.primary.id);
  }
  const selectedIds = new Set(selected);
  return (
    <section className="asset-browser aggregation-browser">
      <div className="browser-toolbar">
        <span>
          <b>{total.toLocaleString()}</b> 个聚合组 ·{" "}
          {assetTotal.toLocaleString()} 个关联素材
        </span>
        <div>
          <select
            aria-label="聚合方式"
            value={mode}
            onChange={(e) =>
              useStore
                .getState()
                .setAggregationMode(e.target.value as AggregationMode)
            }
          >
            <option value="entity">按实体智能聚合</option>
            <option value="package">按素材包聚合</option>
          </select>
          <button
            onClick={async () => {
              try {
                const s = await call<{ ids: string[] }>(
                  "assets.groupSelection",
                  { query, mode },
                );
                useStore.getState().setSelection(s.ids, s.ids[0] ?? null);
              } catch (e) {
                report(e);
              }
            }}
          >
            选择全部组
          </button>
        </div>
      </div>
      <p className="aggregation-hint">
        点击缩略图放大预览，点击名称选择整组；“查看成员”可浏览关联素材。
      </p>
      <div ref={parent} className="asset-scroll">
        {loading ? (
          <Loading text="整理关联素材…" />
        ) : error ? (
          <Empty
            icon={<Layers />}
            heading="聚合读取失败"
            action={
              <button onClick={() => void load(0, generation.current)}>
                重试
              </button>
            }
          />
        ) : !total ? (
          <Empty icon={<Layers />} heading="没有匹配的聚合组">
            调整实体分类、玩法标签或搜索条件。
          </Empty>
        ) : (
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {rows.map((row) => (
              <div
                className="asset-row"
                key={row.key}
                style={{
                  position: "absolute",
                  top: row.start,
                  left: 16,
                  right: 16,
                  height: rowHeight,
                  gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
                }}
              >
                {Array.from({ length: columns }, (_, c) => {
                  const i = row.index * columns + c,
                    g = items[i];
                  if (i >= total) return null;
                  if (!g)
                    return (
                      <div className="group-card asset-placeholder" key={i} />
                    );
                  const full = g.assetIds.every((id) => selectedIds.has(id)),
                    partial =
                      !full && g.assetIds.some((id) => selectedIds.has(id));
                  return (
                    <article
                      className={`group-card ${full ? "selected" : ""} ${partial ? "partial" : ""}`}
                      key={g.id}
                    >
                      <button
                        className="group-preview"
                        onClick={(e) => select(g, e)}
                        onDoubleClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey && !e.shiftKey)
                            onOpen(g.primary);
                        }}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.ctrlKey &&
                            !e.metaKey &&
                            !e.shiftKey
                          ) {
                            e.preventDefault();
                            select(g, e);
                            onOpen(g.primary);
                          }
                        }}
                        aria-label={`选择聚合组 ${g.title}`}
                      >
                        <div
                          className="group-thumb"
                          title="点击放大预览"
                          onClick={(e) => {
                            if (!e.ctrlKey && !e.metaKey && !e.shiftKey)
                              onOpen(g.primary);
                          }}
                        >
                          {g.primary.thumbnailUrl ? (
                            <img
                              src={g.primary.thumbnailUrl}
                              alt=""
                              loading="lazy"
                            />
                          ) : (
                            <Layers size={35} />
                          )}
                          <span className="format-badge">
                            {g.assetIds.length} 个素材
                          </span>
                          {full && (
                            <span className="selected-check">
                              <Check size={13} />
                            </span>
                          )}
                        </div>
                        <strong>{g.title}</strong>
                        <small>{composition(g)}</small>
                      </button>
                      <div className="group-labels">
                        {g.entityCategories.slice(0, 2).map((k) => (
                          <span key={k}>{entityCategories[k]}</span>
                        ))}
                        {g.missing > 0 && (
                          <span className="group-warning">
                            缺少 {g.missing} 项依赖
                          </span>
                        )}
                      </div>
                      <div className="group-actions">
                        <button onClick={() => setDetail(g)}>查看成员</button>
                        <button onClick={() => onExport(g.assetIds)}>
                          <Download size={13} />
                          整组导入
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      {detail && (
        <GroupDetail
          group={detail}
          projects={projects}
          onClose={() => setDetail(null)}
          onOpen={onOpen}
          onExport={onExport}
        />
      )}
    </section>
  );
}
function GroupDetail({
  group,
  projects,
  onClose,
  onOpen,
  onExport,
}: {
  group: AssetGroup;
  projects: Project[];
  onClose: () => void;
  onOpen: (a: Asset) => void;
  onExport: (ids: string[]) => void;
}) {
  const [members, setMembers] = useState<Asset[]>([]),
    [offset, setOffset] = useState(0),
    [project, setProject] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setMembers([]);
    void call<Asset[]>("assets.selectedPage", { ids: group.assetIds, offset })
      .then(setMembers)
      .catch(report);
  }, [group.id, offset]);
  return (
    <Modal title={`聚合组 · ${group.title}`} onClose={onClose} wide>
      <p>
        {group.assetIds.length} 个素材 · {composition(group)}
      </p>
      <p className="muted">聚合依据：{group.reasons.join("；")}</p>
      <div className="tag-list">
        {group.gameplayTags.map((t) => (
          <span key={t}>{gameplayTags[t]}</span>
        ))}
      </div>
      {group.missing > 0 && (
        <div className="warning">
          缺少 {group.missing} 项依赖，请在导入游戏工程前检查。
        </div>
      )}
      {!members.length ? (
        <Loading />
      ) : (
        <div className="group-members">
          {members.map((a) => (
            <button key={a.id} onClick={() => onOpen(a)}>
              <span>
                {a.title}
                <small>{a.path}</small>
              </span>
              <em>{a.extension}</em>
            </button>
          ))}
        </div>
      )}
      {group.assetIds.length > 100 && (
        <div className="button-row">
          <button disabled={!offset} onClick={() => setOffset(offset - 100)}>
            上一页
          </button>
          <span>
            {Math.floor(offset / 100) + 1} /{" "}
            {Math.ceil(group.assetIds.length / 100)}
          </span>
          <button
            disabled={offset + 100 >= group.assetIds.length}
            onClick={() => setOffset(offset + 100)}
          >
            下一页
          </button>
        </div>
      )}
      <Field label="整组加入项目">
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">选择工坊中的游戏项目</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      <div className="modal-actions">
        <button onClick={onClose}>关闭</button>
        <button
          disabled={!project || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await call("projects.attach", {
                projectId: project,
                assetIds: group.assetIds,
              });
              useStore
                .getState()
                .notify(`已将 ${group.assetIds.length} 个素材加入项目`);
              onClose();
            } catch (e) {
              report(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          加入项目
        </button>
        <button
          className="primary"
          onClick={() => {
            onClose();
            onExport(group.assetIds);
          }}
        >
          导入游戏工程…
        </button>
      </div>
    </Modal>
  );
}
