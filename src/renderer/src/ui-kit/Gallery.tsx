import { useRef, useState } from "react";
import {
  ArrowUpRight,
  Box,
  Grid2X2,
  Palette,
  Layers,
  Zap,
  Check,
  ChevronRight,
} from "lucide-react";
import {
  Theme,
  Button,
  Segmented,
  Badge,
  SectionTitle,
  Toast,
  Reveal,
  Presence,
  type Motion,
  type Accent,
  type Density,
} from "./index";
import {
  ComponentSample,
  LibraryScene,
  DownloadScene,
  MaterialScene,
  artworkURL,
  samples,
  componentDefinitions,
  categories,
  stateLabels,
} from "./samples";
import artManifest from "../../public/ui-art/manifest.json";

import { MotionLab } from "./MotionLab";
import { builtinSkins, type SkinPreset } from "../../../shared/skins";

const colors = [
  { label: "PHANTOM RED", value: "#EF1024" },
  { label: "INK BLACK", value: "#090909" },
  { label: "PAPER WHITE", value: "#F5F2EB" },
  { label: "ELECTRIC CYAN", value: "#05D5DA" },
  { label: "VELVET VIOLET", value: "#B643FF" },
];
export function Gallery() {
  const [accent, setAccent] = useState<Accent>("red"),
    [skinPreset,setSkinPreset]=useState<SkinPreset>("comic"),
    [density, setDensity] = useState<Density>("regular"),
    [view, setView] = useState("overview"),
    [filter, setFilter] = useState("all"),
    [notice, setNotice] = useState("");
  const lastNotice = useRef("");
  if (notice) lastNotice.current = notice;
  const params = new URLSearchParams(location.search),
    exportId = params.get("export");
  const catalog = (
    <script type="application/json" id="kit-catalog">
      {JSON.stringify({
        components: componentDefinitions,
        samples,
        artwork: artManifest,
      })}
    </script>
  );
  if (exportId) {
    const sample = samples.find((s) => s.id === exportId);
    const exportAccent = ["red", "cyan", "violet"].includes(
      params.get("accent") ?? "",
    )
      ? (params.get("accent") as Accent)
      : "red";
    const exportDensity =
      params.get("density") === "compact" ? "compact" : "regular";
    return (
      <Theme
        skin={builtinSkins.find(s=>s.manifest.basePreset===(params.get("skin") ?? "comic")) ?? builtinSkins[0]}
        accent={exportAccent}
        density={exportDensity}
        motion="none"
        className="aw-export-canvas"
        data-ui-kit-ready
        data-export-root
        style={{ width: (sample?.width ?? 310) + 48 }}
      >
        {catalog}
        {sample ? (
          <ComponentSample
            key={`${exportId}-${exportAccent}-${exportDensity}`}
            kind={sample.kind}
            state={sample.state}
            accent={exportAccent}
            density={exportDensity}
            autoOpen
          />
        ) : (
          <p>未找到组件示例：{exportId}</p>
        )}
      </Theme>
    );
  }
  const shown =
    view === "states" ? samples : samples.filter((s) => s.state === "default");
  return (
    <Theme
      skin={builtinSkins.find(s=>s.manifest.basePreset===skinPreset)!}
      accent={accent}
      density={density}
      motion={params.get("motion") === "none" ? "none" : "system"}
      className="aw-gallery"
      data-view={view}
      data-ui-kit-ready
    >
      {catalog}
      <header className="kit-topbar">
        <a className="kit-brand" href="./ui-kit.html">
          <img src={artworkURL("cube-burst-red")} alt="" />
          <span>
            素材工坊<small>OmO</small>
          </span>
        </a>
        <span className="kit-topbar-label">
          DESIGN SYSTEM <i>/</i> VOL. 02
        </span>
        <span className="kit-topbar-status">
          <Check size={13} /> ORIGINAL ART / OFFLINE READY
        </span>
      </header>
      <main className="kit-container">
        <Reveal preset="panel" className="kit-hero-reveal">
          <section className="kit-hero">
            <div className="kit-hero-copy">
              <span className="kit-kicker">
                <span /> UI COMPONENT FACTORY / MOTION EDITION
              </span>
              <h1>
                <span>创造你的</span>
                <span className="kit-hero-title">
                  视觉冲击<span className="kit-exclamation">!</span>
                </span>
              </h1>
              <p>
                让每一次点击，都有自己的态度。
                <br />
                为素材工坊打造的原创控件、拼贴图形与交互语言。
              </p>
              <div className="kit-hero-stats">
                <div>
                  <strong>{componentDefinitions.length}</strong>
                  <span>可复用组件</span>
                </div>
                <div>
                  <strong>{samples.length}</strong>
                  <span>控件状态</span>
                </div>
                <div>
                  <strong>27</strong>
                  <span>原创矢量素材</span>
                </div>
              </div>
            </div>
            <div className="kit-hero-art" aria-hidden="true">
              <span className="kit-hero-word">
                MAKE
                <br />
                IT BOLD.
              </span>
              <img
                className="kit-hero-cube"
                src={artworkURL(`cube-burst-${accent}`)}
                alt=""
              />
              <img
                className="kit-hero-lightning"
                src={artworkURL(`lightning-${accent}`)}
                alt=""
              />
              <span className="kit-hero-art-tag">RED / BLACK / ATTITUDE</span>
            </div>
          </section>
        </Reveal>
        <div className="kit-palette-strip">
          {colors.map((c) => (
            <div key={c.value}>
              <span style={{ background: c.value }} />
              <small>{c.label}</small>
              <code>{c.value}</code>
            </div>
          ))}
        </div>
        <div className="kit-control-bar">
          <Segmented
            label="展示内容"
            value={view}
            onChange={setView}
            options={[
              { value: "overview", label: "组件总览" },
              { value: "states", label: "状态矩阵" },
              { value: "motion", label: "动效实验室" },
              { value: "scenes", label: "组合示例" },
              { value: "art", label: "原创素材" },
            ]}
          />
          <div className="kit-control-settings">
            <Segmented label="皮肤风格" value={skinPreset} onChange={v=>setSkinPreset(v as SkinPreset)} options={builtinSkins.map(s=>({value:s.manifest.basePreset,label:s.manifest.name}))}/>
            <Segmented
              label="组件配色"
              value={accent}
              onChange={(v) => setAccent(v as Accent)}
              options={[
                { value: "red", label: "红" },
                { value: "cyan", label: "青" },
                { value: "violet", label: "紫" },
              ]}
            />
            <Segmented
              label="组件密度"
              value={density}
              onChange={(v) => setDensity(v as Density)}
              options={[
                { value: "regular", label: "标准" },
                { value: "compact", label: "紧凑" },
              ]}
            />
          </div>
        </div>
        <div className="kit-layout">
          <aside className="kit-index">
            <span className="kit-index-label">THE INDEX</span>
            <button
              className={filter === "all" ? "is-active" : ""}
              onClick={() => {
                setFilter("all");
                if (view !== "overview" && view !== "states")
                  setView("overview");
              }}
            >
              <Grid2X2 size={14} />
              全部组件<span>{componentDefinitions.length}</span>
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                className={filter === c.id ? "is-active" : ""}
                onClick={() => {
                  setFilter(c.id);
                  if (view !== "overview" && view !== "states")
                    setView("overview");
                }}
              >
                <b>{c.number}</b>
                {c.label}
                <ChevronRight size={13} />
              </button>
            ))}
            <div className="kit-index-note">
              <Zap size={22} />
              <strong>
                锋利的外观
                <br />
                清晰的操作
              </strong>
              <p>
                装饰与内容分层。
                <br />
                每一个控件，都可以实际使用。
              </p>
            </div>
          </aside>
          <div className="kit-main-content">
            {view === "motion" && <MotionLab />}
            {(view === "overview" || view === "states") &&
              categories
                .filter((c) => filter === "all" || filter === c.id)
                .map((c) => (
                  <section
                    className="kit-component-section"
                    key={c.id}
                    id={c.id}
                  >
                    <div className="kit-section-heading">
                      <span className="kit-section-number">{c.number}</span>
                      <div>
                        <h2>{c.label}</h2>
                        <span>
                          {c.en} /{" "}
                          {view === "states" ? "STATE MATRIX" : "COMPONENTS"}
                        </span>
                      </div>
                      <small>
                        {shown.filter((s) => s.category === c.id).length} ITEMS
                      </small>
                    </div>
                    <div className="kit-sample-grid">
                      {shown
                        .filter((s) => s.category === c.id)
                        .map((s, i) => (
                          <Reveal
                            key={s.id}
                            preset="card"
                            delay={(i % 6) * 35}
                            replayKey={`${view}-${filter}`}
                          >
                            <article
                              className="kit-sample-tile"
                              key={s.id}
                              data-sample-id={s.id}
                            >
                              <header>
                                <span>{s.label}</span>
                                <small>{stateLabels[s.state]}</small>
                              </header>
                              <div
                                className={`kit-sample-preview ${s.kind === "asset-card" || s.kind === "group-card" ? "kit-sample-preview--card" : ""}`}
                              >
                                <ComponentSample
                                  kind={s.kind}
                                  state={s.state}
                                  accent={accent}
                                  density={density}
                                  onAction={setNotice}
                                />
                              </div>
                              <footer>
                                <code>{s.kind}</code>
                                {s.state === "open" ? (
                                  <span>
                                    点击展开 <ArrowUpRight size={11} />
                                  </span>
                                ) : (
                                  <span>
                                    {density === "compact" ? "28" : "36"} /{" "}
                                    {accent.toUpperCase()}
                                  </span>
                                )}
                              </footer>
                            </article>
                          </Reveal>
                        ))}
                    </div>
                  </section>
                ))}
            {(view === "overview" || view === "scenes") && (
              <section className="kit-compositions">
                <SectionTitle
                  title="把组件放进真实场景"
                  eyebrow="BUILT TO WORK TOGETHER"
                />
                <p className="kit-section-description">
                  同一套语言，三种工作状态。以下示例可以搜索、选择、下载和调整参数。
                </p>
                <Reveal preset="panel">
                  <LibraryScene />
                </Reveal>
                <Reveal preset="panel" delay={35}>
                  <DownloadScene />
                </Reveal>
                <Reveal preset="panel" delay={70}>
                  <MaterialScene />
                </Reveal>
              </section>
            )}
            {(view === "overview" || view === "art") && (
              <section className="kit-art-section">
                <SectionTitle
                  title="原创图形武器库"
                  eyebrow="ORIGINAL VECTOR ASSETS"
                />
                <p className="kit-section-description">
                  9 类图形 × 3 种配色。SVG 可缩放，网点和划痕可平铺，支持透明
                  PNG 导出。
                </p>
                <div className="kit-art-grid">
                  {artManifest
                    .filter((a) => a.accent === accent)
                    .map((a) => (
                      <article className="kit-art-tile" key={a.id}>
                        <div className="kit-art-preview">
                          <img src={`./ui-art/${a.filename}`} alt={a.label} />
                        </div>
                        <footer>
                          <div>
                            <strong>{a.label}</strong>
                            <small>
                              {a.width} × {a.height} / SVG
                            </small>
                          </div>
                          <a
                            href={`./ui-art/${a.filename}`}
                            download={a.filename}
                            aria-label={`下载${a.label} SVG`}
                          >
                            <ArrowUpRight size={17} />
                          </a>
                        </footer>
                      </article>
                    ))}
                </div>
              </section>
            )}
          </div>
        </div>
        <footer className="kit-page-footer">
          <div>
            <Box size={16} />
            <strong>素材工坊 / UI COMPONENT FACTORY</strong>
          </div>
          <span>ORIGINAL ART · REACT + CSS + SVG · VOL. 02</span>
        </footer>
      </main>
      <Presence present={!!notice} className="kit-notice">
        <Toast message={lastNotice.current} onClose={() => setNotice("")} />
      </Presence>
    </Theme>
  );
}
