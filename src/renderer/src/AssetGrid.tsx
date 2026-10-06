import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Box, Image, Star, File, Check, SlidersHorizontal } from "lucide-react";
import type { Asset, AssetPage, AssetQuery } from "../../shared/types";
import { categories } from "../../shared/types";
import { canRequestThumbnail } from "../../shared/fbx";
import { call, report, useStore, bytes } from "./store";
import { Empty, Loading } from "./components";
import { MoreButton, menuBindings } from "./ContextMenu";
import { blankCommands, openAssets } from "./WorkshopMenus";
const PAGE_SIZE = 200;
export function AssetGrid({
  query,
  onOpen,
}: {
  query: AssetQuery;
  onOpen: (a: Asset) => void;
}) {
  const epoch = useStore((s) => s.epoch),
    selected = useStore((s) => s.selected),
    setSelection = useStore((s) => s.setSelection);
  const parent = useRef<HTMLDivElement>(null),
    generation = useRef(0),
    lastQuery = useRef<string | null>(null),
    requested = useRef(new Set<number>()),
    requestedThumbnails = useRef(new Set<string>()),
    thumbnailUpdates = useRef(new Map<string, string>()),
    [items, setItems] = useState<Record<number, Asset>>({}),
    [total, setTotal] = useState(0),
    [auxiliaryTotal, setAuxiliaryTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [width, setWidth] = useState(800),
    [size, setSize] = useState(160),
    [list, setList] = useState(false);
  const columns = list
      ? 1
      : Math.max(1, Math.floor((width - 32) / (size + 16))),
    rowHeight = list ? 72 : size + 82;
  const selectedSet = new Set(selected);
  useEffect(() => {
    const handler = (e: Event) => {
      const { type, data } = (e as CustomEvent).detail;
      if (type === "grid-view") setList(data.list);
      if (type === "grid-size-value") setSize(data.size);
    };
    window.addEventListener("workshop:action", handler);
    return () => window.removeEventListener("workshop:action", handler);
  }, []);
  const virtual = useVirtualizer({
    count: Math.ceil(total / columns),
    getScrollElement: () => parent.current,
    estimateSize: () => rowHeight,
    overscan: 3,
  });
  async function load(offset: number, gen: number) {
    if (gen !== generation.current || requested.current.has(offset)) return;
    requested.current.add(offset);
    try {
      const page = await call<AssetPage>("assets.query", {
        ...query,
        offset,
        limit: PAGE_SIZE,
      });
      if (gen !== generation.current) return;
      setTotal(page.total);
      setAuxiliaryTotal(page.auxiliaryTotal ?? 0);
      setItems((old) => {
        const next = { ...old };
        page.items.forEach((a, i) => {
          const thumbnailUrl = thumbnailUpdates.current.get(a.id);
          next[offset + i] = thumbnailUrl ? { ...a, thumbnailUrl } : a;
        });
        if (page.total < total)
          for (const index of Object.keys(next))
            if (Number(index) >= page.total) delete next[Number(index)];
        return next;
      });
      if (offset === 0) setLoading(false);
    } catch (e) {
      if (gen === generation.current) {
        requested.current.delete(offset);
        report(e);
        if (offset === 0) setLoading(false);
      }
    }
  }
  function loadRange(rows: { index: number }[], gen: number) {
    if (!rows.length || !total) return;
    const start = rows[0].index * columns;
    // Load one page beyond the rendered overscan, before it enters the viewport.
    const end = Math.min(
      total - 1,
      (rows[rows.length - 1].index + 1) * columns - 1 + PAGE_SIZE,
    );
    for (
      let offset = Math.floor(start / PAGE_SIZE) * PAGE_SIZE;
      offset <= end;
      offset += PAGE_SIZE
    )
      void load(offset, gen);
  }
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    const gen = ++generation.current;
    requested.current = new Set();
    thumbnailUpdates.current.clear();
    if (lastQuery.current !== queryKey) {
      lastQuery.current = queryKey;
      requestedThumbnails.current.clear();
      setItems({});
      setTotal(0);
      setLoading(true);
      parent.current?.scrollTo(0, 0);
    } else {
      // Refresh catalog changes in place; keep the current cards and scroll anchor.
      requestedThumbnails.current.clear();
      loadRange(virtual.getVirtualItems(), gen);
    }
    void load(0, gen);
  }, [queryKey, epoch]);
  useEffect(
    () =>
      window.workshop.onEvent((event) => {
        if (event.type !== "thumbnail.ready") return;
        const { id, thumbnailUrl } = event.data;
        if (!id || !thumbnailUrl) return;
        thumbnailUpdates.current.set(id, thumbnailUrl);
        setItems((old) => {
          const entry = Object.entries(old).find(([, a]) => a.id === id);
          if (!entry || entry[1].thumbnailUrl === thumbnailUrl) return old;
          return { ...old, [entry[0]]: { ...entry[1], thumbnailUrl } };
        });
      }),
    [],
  );
  useEffect(() => {
    const observer = new ResizeObserver(([r]) => setWidth(r.contentRect.width));
    if (parent.current) observer.observe(parent.current);
    return () => observer.disconnect();
  }, []);
  const rows = virtual.getVirtualItems(),
    range = rows.map((r) => r.index).join(",");
  useEffect(() => {
    loadRange(rows, generation.current);
  }, [range, columns, total]);
  useEffect(() => {
    for (const r of rows)
      for (let c = 0; c < columns; c++) {
        const a = items[r.index * columns + c];
        if (
          a &&
          ["model", "environment", "material"].includes(
            a.capabilities.preview,
          ) &&
          !a.thumbnailUrl &&
          canRequestThumbnail(a.extension, a.metadata) &&
          !requestedThumbnails.current.has(a.id)
        ) {
          requestedThumbnails.current.add(a.id);
          void call("previews.request", { assetId: a.id }).catch(() => {});
        }
      }
  }, [range, items]);
  function select(a: Asset, index: number, event: React.MouseEvent) {
    if (event.ctrlKey || event.metaKey)
      setSelection(
        selected.includes(a.id)
          ? selected.filter((id) => id !== a.id)
          : [...selected, a.id],
        a.id,
      );
    else if (event.shiftKey && selected.length) {
      const anchor = Object.entries(items).find(
        ([, v]) => v.id === selected[0],
      );
      const start = anchor ? Number(anchor[0]) : index;
      setSelection(
        Object.entries(items)
          .filter(
            ([k]) =>
              Number(k) >= Math.min(start, index) &&
              Number(k) <= Math.max(start, index),
          )
          .map(([, v]) => v.id),
        a.id,
      );
    } else setSelection([a.id], a.id);
  }
  return (
    <section className="asset-browser">
      <div
        className="browser-toolbar"
        {...menuBindings(() => blankCommands(query))}
      >
        <span>
          <b>{total.toLocaleString()}</b> 个素材
          {auxiliaryTotal > 0 && <em> · 辅助预览图 {auxiliaryTotal}</em>}
          {selected.length > 0 && <em> · 已选择 {selected.length}</em>}
        </span>
        <div>
          <SlidersHorizontal size={14} />
          {!list && (
            <input
              aria-label="缩略图大小"
              type="range"
              min="120"
              max="240"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
            />
          )}
          <MoreButton
            items={() => blankCommands(query)}
            label="素材视图更多操作"
          />
        </div>
      </div>
      <div
        ref={parent}
        className="asset-scroll"
        tabIndex={0}
        {...menuBindings(() => blankCommands(query))}
      >
        {loading ? (
          <Loading />
        ) : !total ? (
          <Empty
            icon={<Box size={30} />}
            heading={query.search ? "没有匹配的素材" : "这里等待你的第一份素材"}
          >
            导入文件或安装免费示例，素材会复制到本地库。
          </Empty>
        ) : (
          <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
            {rows.map((row) => (
              <div
                key={row.key}
                className={`asset-row ${list ? "list" : ""}`}
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
                    a = items[i];
                  if (i >= total) return null;
                  if (!a)
                    return (
                      <div key={i} className="asset-card asset-placeholder" />
                    );
                  return (
                    <button
                      key={a.id}
                      className={`asset-card ${selectedSet.has(a.id) ? "selected" : ""}`}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const ids = selectedSet.has(a.id)
                          ? selected.slice()
                          : [a.id];
                        if (!selectedSet.has(a.id)) setSelection(ids, a.id);
                        openAssets(ids, e.clientX, e.clientY, e.currentTarget, {
                          ...query,
                        });
                      }}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.ctrlKey &&
                          !e.metaKey &&
                          !e.shiftKey
                        ) {
                          e.preventDefault();
                          setSelection([a.id], a.id);
                          onOpen(a);
                          return;
                        }
                        if (
                          (e.shiftKey && e.key === "F10") ||
                          e.key === "ContextMenu"
                        ) {
                          e.preventDefault();
                          e.stopPropagation();
                          const ids = selectedSet.has(a.id)
                            ? selected.slice()
                            : [a.id];
                          if (!selectedSet.has(a.id)) setSelection(ids, a.id);
                          const r = e.currentTarget.getBoundingClientRect();
                          openAssets(
                            ids,
                            r.left + 12,
                            r.top + 12,
                            e.currentTarget,
                            { ...query },
                          );
                        }
                      }}
                      onClick={(e) => select(a, i, e)}
                      onDoubleClick={(e) => {
                        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) onOpen(a);
                      }}
                      title={`${a.title}\n${a.path}`}
                      draggable
                      onDragStart={(e) =>
                        e.dataTransfer.setData(
                          "application/workshop-asset",
                          a.id,
                        )
                      }
                    >
                      <div
                        className="asset-thumb"
                        title="点击放大预览"
                        onClick={(e) => {
                          if (!e.ctrlKey && !e.metaKey && !e.shiftKey)
                            onOpen(a);
                        }}
                      >
                        {a.thumbnailUrl ? (
                          <img src={a.thumbnailUrl} alt="" loading="lazy" />
                        ) : a.capabilities.preview === "model" ? (
                          <Box size={34} />
                        ) : a.capabilities.preview === "image" ? (
                          <Image size={34} />
                        ) : (
                          <File size={34} />
                        )}
                        <span className="format-badge">
                          {a.capabilities.preview === "skin" ? "SKIN" : a.extension.slice(1).toUpperCase()}
                        </span>
                        {a.metadata.auxiliaryRole === "preview" && (
                          <span className="auxiliary-badge">辅助预览</span>
                        )}
                        {a.favorite && (
                          <Star
                            className="favorite-star"
                            size={14}
                            fill="currentColor"
                          />
                        )}
                        {selectedSet.has(a.id) && (
                          <span className="selected-check">
                            <Check size={13} />
                          </span>
                        )}
                      </div>
                      <div className="asset-caption">
                        <strong>{a.title}</strong>
                        <span>
                          {categories[a.category]}
                          <small>
                            {a.metadata.width
                              ? `${a.metadata.width} × ${a.metadata.height}`
                              : a.metadata.triangles
                                ? `${a.metadata.triangles.toLocaleString()} △`
                                : bytes(a.bytes)}
                          </small>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
