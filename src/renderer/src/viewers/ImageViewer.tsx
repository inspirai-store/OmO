import { useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize, Play, Pause, Grid2X2 } from "lucide-react";
import { openProcessing } from "../../../shared/processing";
import type { Asset } from "../../../shared/types";
import { call, report } from "../store";
import {
  command as c,
  group as g,
  menuBindings,
  MoreButton,
} from "../ContextMenu";
export function ImageViewer({
  asset,
  compact = false,
}: {
  asset: Asset;
  compact?: boolean;
}) {
  const [zoom, setZoom] = useState(1),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [channel, setChannel] = useState(
      asset.metadata.imageView?.channel ?? "rgba",
    ),
    [background, setBackground] = useState(
      asset.metadata.imageView?.background ?? "checker",
    ),
    [pixel, setPixel] = useState(
      asset.metadata.imageView?.pixel ?? asset.category === "sprite",
    ),
    [grid, setGrid] = useState(asset.metadata.imageView?.grid ?? false),
    [mode, setMode] = useState(asset.metadata.viewMode ?? "image"),
    [states, setStates] = useState<(Asset & { label: string })[]>([]),
    [loaded, setLoaded] = useState(0),
    [frame, setFrame] = useState(0),
    [playing, setPlaying] = useState(false),
    [fps, setFPS] = useState(asset.metadata.fps ?? 8),
    [cell, setCell] = useState({
      width: asset.metadata.grid?.width ?? 16,
      height: asset.metadata.grid?.height ?? 16,
    }),
    [nine, setNine] = useState(
      asset.metadata.nineSlice ?? { top: 8, right: 8, bottom: 8, left: 8 },
    ),
    [position, setPosition] = useState({ x: 0, y: 0 }),
    [error, setError] = useState(""),
    [page, setPage] = useState(0),
    [pageURL, setPageURL] = useState<string | undefined>();
  const previewURL = pageURL ?? asset.previewUrl;
  const host = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    spriteCanvas = useRef<HTMLCanvasElement>(null),
    image = useRef<HTMLImageElement | null>(null),
    drag = useRef<{
      x: number;
      y: number;
      pan: { x: number; y: number };
    } | null>(null);
  const width = asset.metadata.width ?? 1,
    height = asset.metadata.height ?? 1;
  function fit() {
    if (!host.current || !image.current) return;
    setZoom(
      Math.min(
        (host.current.clientWidth - 40) / image.current.width,
        (host.current.clientHeight - 40) / image.current.height,
        1,
      ),
    );
    setPan({ x: 0, y: 0 });
  }
  function imageCommands() {
    return [
      c("processing", "加工图片…", () =>
        openProcessing([{ kind: "asset", id: asset.id }]),
      ),
      c("fit", "适应窗口", fit),
      c("actual", "100%", () => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }),
      g(
        "background",
        "背景",
        [
          ["checker", "透明棋盘"],
          ["dark", "深色"],
          ["light", "浅色"],
          ["custom", "自定义颜色"],
        ].map(([value, label]) =>
          c(value, label, () => setBackground(value), {
            checked: background === value,
          }),
        ),
      ),
      g(
        "channels",
        "RGBA 通道",
        ["rgba", "r", "g", "b", "a"].map((value) =>
          c(value, value.toUpperCase(), () => setChannel(value), {
            checked: channel === value,
          }),
        ),
      ),
      c("pixel", "像素显示", () => setPixel(!pixel), { checked: pixel }),
      c("grid", "像素网格", () => setGrid(!grid), { checked: grid }),
      g(
        "mode",
        "查看模式",
        [
          ["image", "图片"],
          ["atlas", "图集区域"],
          ["sprite", "帧序列"],
          ["nine", "九宫格"],
          ...(asset.metadata.stateGroup ? [["states", "状态对照"]] : []),
        ].map(([value, label]) =>
          c(value, label, () => setMode(value), { checked: mode === value }),
        ),
      ),
      c("save", "保存当前查看参数", () =>
        call("assets.update", {
          ids: [asset.id],
          change: {
            metadata: {
              grid: cell,
              fps,
              viewMode: mode,
              nineSlice: nine,
              imageView: { channel, background, pixel, grid },
            },
          },
        }),
      ),
    ];
  }
  useEffect(() => {
    const img = new Image();
    image.current = img;
    img.onload = () => {
      setError("");
      setLoaded((v) => v + 1);
      fit();
    };
    img.onerror = () => setError("预览文件暂不可用，可重建缓存或使用外部工具");
    img.src = previewURL!;
    const observer = new ResizeObserver(() => fit());
    if (host.current) observer.observe(host.current);
    return () => {
      observer.disconnect();
      image.current = null;
    };
  }, [asset.id, previewURL]);
  useEffect(() => {
    if (mode === "states" && asset.metadata.stateGroup)
      void Promise.all(
        asset.metadata.stateGroup
          .slice(0, 12)
          .map(async (s: { id: string; label: string }) => ({
            ...(await call<any>("assets.detail", { id: s.id })).asset,
            label: s.label,
          })),
      )
        .then(setStates)
        .catch(report);
  }, [mode, asset.id]);
  useEffect(() => {
    if (channel === "rgba" || !canvas.current || !image.current) return;
    const img = image.current,
      c = canvas.current,
      ratio = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
    c.width = Math.max(1, Math.round(img.naturalWidth * ratio));
    c.height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const context = c.getContext("2d", { willReadFrequently: true })!;
    const draw = () => {
      try {
        context.drawImage(img, 0, 0, c.width, c.height);
        const data = context.getImageData(0, 0, c.width, c.height),
          index = { r: 0, g: 1, b: 2, a: 3 }[channel as "r"];
        for (let i = 0; i < data.data.length; i += 4) {
          const value = data.data[i + index];
          data.data[i] = data.data[i + 1] = data.data[i + 2] = value;
          data.data[i + 3] = 255;
        }
        context.putImageData(data, 0, 0);
      } catch (e) {
        report(e);
      }
    };
    if (img.complete) draw();
    else img.addEventListener("load", draw, { once: true });
  }, [channel, asset.id]);
  const atlas = asset.metadata.atlas as
    | { name: string; x: number; y: number; width: number; height: number }[]
    | undefined;
  const count =
    atlas?.length ??
    Math.max(
      1,
      Math.floor(width / cell.width) * Math.floor(height / cell.height),
    );
  useEffect(() => {
    if (!playing || mode !== "sprite") return;
    const timer = setInterval(
      () => setFrame((f) => (f + 1) % count),
      1000 / fps,
    );
    return () => clearInterval(timer);
  }, [playing, fps, count, mode]);
  useEffect(() => {
    if (
      !["sprite", "atlas"].includes(mode) ||
      !spriteCanvas.current ||
      !image.current
    )
      return;
    const c = spriteCanvas.current,
      img = image.current,
      index = frame % count,
      rect = atlas?.[index] ?? {
        x: (index % Math.max(1, Math.floor(width / cell.width))) * cell.width,
        y:
          Math.floor(index / Math.max(1, Math.floor(width / cell.width))) *
          cell.height,
        width: cell.width,
        height: cell.height,
      };
    c.width = rect.width;
    c.height = rect.height;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = !pixel;
    if (!img.complete || !img.naturalWidth) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(
      img,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
      0,
      0,
      c.width,
      c.height,
    );
  }, [mode, frame, cell, asset.id, pixel, count, loaded]);
  return (
    <div
      className={`image-viewer ${compact ? "compact" : ""}`}
      tabIndex={0}
      {...menuBindings(imageCommands)}
    >
      {!compact && (
        <div className="image-tools">
          <span>{Math.round(zoom * 100)}%</span>
          <MoreButton items={imageCommands} label="图片更多操作" />
          {background === "custom" && (
            <input
              type="color"
              aria-label="自定义背景色"
              defaultValue="#303f42"
              onChange={(e) =>
                host.current?.style.setProperty("--custom-bg", e.target.value)
              }
            />
          )}
          {[".tif", ".tiff"].includes(asset.extension) &&
            (asset.metadata.pages ?? 1) > 1 && (
              <select
                aria-label="TIFF 页面"
                value={page}
                onChange={async (e) => {
                  const v = Number(e.target.value);
                  try {
                    setPageURL(
                      await call("previews.imagePage", {
                        assetId: asset.id,
                        page: v,
                      }),
                    );
                    setPage(v);
                  } catch (e) {
                    report(e);
                  }
                }}
              >
                {Array.from(
                  { length: Math.min(asset.metadata.pages, 1000) },
                  (_, i) => (
                    <option key={i} value={i}>
                      第 {i + 1} 页
                    </option>
                  ),
                )}
              </select>
            )}
        </div>
      )}
      <div
        ref={host}
        className={`image-stage bg-${background}`}
        onWheel={(e) => {
          if (!compact) {
            setZoom((z) =>
              Math.max(0.01, Math.min(64, z * (e.deltaY < 0 ? 1.12 : 0.89))),
            );
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 || mode !== "image") return;
          drag.current = { x: e.clientX, y: e.clientY, pan };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current)
            setPan({
              x: drag.current.pan.x + e.clientX - drag.current.x,
              y: drag.current.pan.y + e.clientY - drag.current.y,
            });
          const rect = e.currentTarget.getBoundingClientRect();
          setPosition({
            x: Math.round(
              (e.clientX - rect.left - rect.width / 2 - pan.x) / zoom +
                width / 2,
            ),
            y: Math.round(
              (e.clientY - rect.top - rect.height / 2 - pan.y) / zoom +
                height / 2,
            ),
          });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {error ? (
          <div className="viewer-message error">{error}</div>
        ) : mode === "states" ? (
          <div className="state-preview">
            {states.map((s) => (
              <figure key={s.id}>
                <img src={s.previewUrl} alt={s.label} />
                <figcaption>{s.label}</figcaption>
              </figure>
            ))}
          </div>
        ) : mode === "nine" ? (
          <div
            className="nine-preview"
            style={{
              borderImageSource: `url("${previewURL}")`,
              borderImageSlice: `${nine.top} ${nine.right} ${nine.bottom} ${nine.left} fill`,
              borderImageWidth: `${nine.top}px ${nine.right}px ${nine.bottom}px ${nine.left}px`,
              borderStyle: "solid",
              borderWidth: "16px",
              resize: "both",
              overflow: "auto",
            }}
          >
            <span>拖动右下角，查看拉伸效果</span>
          </div>
        ) : ["sprite", "atlas"].includes(mode) ? (
          <canvas
            ref={spriteCanvas}
            className="sprite-canvas"
            style={{ imageRendering: pixel ? "pixelated" : "auto" }}
          />
        ) : (
          <div
            className="image-transform"
            style={{
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            }}
          >
            {channel === "rgba" ? (
              <img
                src={previewURL}
                alt={asset.title}
                draggable={false}
                style={{ imageRendering: pixel ? "pixelated" : "auto" }}
              />
            ) : (
              <canvas ref={canvas} />
            )}{" "}
            {grid && (
              <div
                className="pixel-grid"
                style={{
                  backgroundSize: `${Math.max(1, cell.width)}px ${Math.max(1, cell.height)}px`,
                }}
              />
            )}
          </div>
        )}
      </div>
      {!compact && (
        <>
          <div className="image-footer">
            <span>
              {width} × {height}
            </span>
            <span>{Math.round(zoom * 100)}%</span>
            <span>{asset.metadata.hasAlpha ? "RGBA" : "RGB"}</span>
            <span className="muted">
              X {position.x} · Y {position.y}
            </span>
          </div>
          {["sprite", "atlas"].includes(mode) && (
            <div className="image-config">
              <label>
                帧宽{" "}
                <input
                  aria-label="帧宽"
                  type="number"
                  min="1"
                  value={cell.width}
                  onChange={(e) =>
                    setCell({
                      ...cell,
                      width: Math.max(1, Number(e.target.value)),
                    })
                  }
                />
              </label>
              <label>
                帧高{" "}
                <input
                  aria-label="帧高"
                  type="number"
                  min="1"
                  value={cell.height}
                  onChange={(e) =>
                    setCell({
                      ...cell,
                      height: Math.max(1, Number(e.target.value)),
                    })
                  }
                />
              </label>
              <button
                aria-label={playing ? "暂停帧动画" : "播放帧动画"}
                onClick={() => setPlaying(!playing)}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <input
                aria-label="帧序列位置"
                type="range"
                min="0"
                max={Math.min(count - 1, 10000)}
                value={frame}
                onChange={(e) => setFrame(Number(e.target.value))}
              />
              <span>
                {frame + 1} / {count}
              </span>
              <label>
                FPS{" "}
                <input
                  type="number"
                  min="1"
                  max="60"
                  value={fps}
                  onChange={(e) =>
                    setFPS(Math.min(60, Math.max(1, Number(e.target.value))))
                  }
                />
              </label>
              <button
                onClick={() =>
                  void call("assets.update", {
                    ids: [asset.id],
                    change: { metadata: { grid: cell, fps, viewMode: mode } },
                  }).catch(report)
                }
              >
                保存参数
              </button>
            </div>
          )}
          {mode === "nine" && (
            <div className="image-config">
              {(["top", "right", "bottom", "left"] as const).map((key, i) => (
                <label key={key}>
                  {["上", "右", "下", "左"][i]}
                  <input
                    type="number"
                    min="0"
                    max="1000"
                    value={nine[key]}
                    onChange={(e) =>
                      setNine({
                        ...nine,
                        [key]: Math.max(0, Number(e.target.value)),
                      })
                    }
                  />
                </label>
              ))}
              <button
                onClick={() =>
                  void call("assets.update", {
                    ids: [asset.id],
                    change: { metadata: { nineSlice: nine, viewMode: mode } },
                  }).catch(report)
                }
              >
                保存边距
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
