import { SkinSettings } from "./SkinSettings";
import { SectionTitle, Segmented, StatCard, ProgressBar } from "./ui-kit";
import { ClientButton } from "./client-ui";
import { useEffect, useState } from "react";
import {
  Download,
  ExternalLink,
  Check,
  Box,
  FolderOpen,
  Pause,
  Play,
  X,
  RotateCw,
  HardDrive,
  ShieldCheck,
  ArrowUpRight,
  Image,
  Sparkles,
} from "lucide-react";
import type {
  DownloadPlan,
  Project,
  Sample,
  Settings,
  Stats,
  Job,
} from "../../shared/types";
import { Modal, Loading, Field, Empty } from "./components";
import { call, report, useStore, bytes } from "./store";
import {
  command as c,
  group as g,
  menuBindings,
  MoreButton,
} from "./ContextMenu";
import { projectBindings } from "./WorkshopMenus";
const statusNames: Record<string, string> = {
  queued: "排队",
  running: "运行中",
  paused: "已暂停",
  completed: "完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "需检查",
};
export function Sources() {
  const [samples, setSamples] = useState<Sample[]>([]),
    [provider, setProvider] = useState("featured"),
    [search, setSearch] = useState(""),
    [results, setResults] = useState<Sample[]>([]),
    [offset, setOffset] = useState(0),
    [hasMore, setHasMore] = useState(false),
    [loading, setLoading] = useState(false),
    [plan, setPlan] = useState<(DownloadPlan & { id: string }) | null>(null),
    [resolving, setResolving] = useState(""),
    epoch = useStore((s) => s.epoch);
  useEffect(() => {
    void call<Sample[]>("sources.samples").then(setSamples).catch(report);
  }, [epoch]);
  async function resolve(s: Sample) {
    setResolving(s.id);
    try {
      setPlan(await call("sources.resolve", { id: s.id, sample: s }));
    } catch (e) {
      report(e);
    } finally {
      setResolving("");
    }
  }
  async function searchCatalog(append = false) {
    setLoading(true);
    try {
      const data = await call("sources.search", {
        provider,
        search,
        offset: append ? offset + 30 : 0,
      });
      const rows = data.items ?? data;
      setResults(append ? [...results, ...rows] : rows);
      setOffset(append ? offset + 30 : 0);
      setHasMore(rows.length === 30);
    } catch (e) {
      report(e);
    } finally {
      setLoading(false);
    }
  }
  const cards = provider === "featured" ? samples : results;
  function sourceCommands(s: Sample) {
    const item = { ...s };
    return [
      c("spec", "查看规格与依赖…", () => resolve(item)),
      c(
        "download",
        item.installed ? "检查并下载新版本…" : "下载并导入…",
        () => resolve(item),
        { disabled: !!resolving },
      ),
      ...(item.installed
        ? [
            c("local", "定位到本地素材", () =>
              useStore
                .getState()
                .setQuery({ search: item.upstreamId, showRelated: true }),
            ),
          ]
        : []),
      c("source", "打开来源页", () =>
        call("system.openSource", { url: item.pageUrl }),
      ),
      c("copy", "复制来源链接", () =>
        call("system.copy", { sourceUrl: item.pageUrl }),
      ),
    ];
  }
  return (
    <div className="full-page sources-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">CURATED · FREE · LOCAL</span>
          <SectionTitle as="h1" title={"让灵感有处可寻"} />
          <p>
            精选免费素材，安装后离线可用。作者、来源和许可证跟随每一份资源。
          </p>
        </div>
        <ClientButton
          className="primary"
          onClick={() =>
            void call("samples.installAll")
              .then((ids: string[]) =>
                useStore
                  .getState()
                  .notify(
                    `${ids.length} 组示例已加入下载队列，可在任务中心查看`,
                  ),
              )
              .catch(report)
          }
        >
          <Download size={16} />
          安装全部示例
        </ClientButton>
      </header>
      <div className="source-banner">
        <div className="source-orbit">
          <Box size={45} />
        </div>
        <div>
          <span>从二维地牢，到三维世界</span>
          <h2>搭建你的第一座素材库</h2>
          <p>
            角色、敌人、装备、机关、建筑、生产与载具 · {samples.length} 组 CC0
            资源
          </p>
        </div>
        <div className="provider-marks">
          KENNEY <i>ambientCG</i> Poly Haven
        </div>
      </div>
      <div className="sources-controls">
        <Segmented
          label="免费素材来源"
          value={provider}
          onChange={(value) => {
            setProvider(value);
            setResults([]);
          }}
          options={[
            { value: "featured", label: "精选示例" },
            { value: "ambientcg", label: "ambientCG" },
            { value: "polyhaven", label: "Poly Haven" },
          ]}
        />
        {provider !== "featured" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void searchCatalog();
            }}
          >
            <input
              placeholder="搜索免费素材，建议使用英文关键词"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ClientButton type="submit">查询目录</ClientButton>
          </form>
        )}
      </div>
      {loading ? (
        <Loading text="查询官方素材目录…" />
      ) : (
        <div className="source-grid">
          {cards.map((s, i) => (
            <article
              className={`source-card source-${s.category}`}
              key={s.id}
              tabIndex={0}
              {...menuBindings(() => sourceCommands(s))}
            >
              <div className="source-art">
                {s.thumbnail ? (
                  <img src={s.thumbnail} alt="" />
                ) : (
                  <>
                    <span className="source-index">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    {s.category === "model" || s.category === "animation" ? (
                      <Box size={48} />
                    ) : s.category === "texture" ? (
                      <div className="material-orb" />
                    ) : (
                      <Image size={48} />
                    )}
                    <span className="source-category">
                      {s.category.toUpperCase()}
                    </span>
                  </>
                )}
              </div>
              <div className="source-card-content">
                <span className="eyebrow">
                  {s.provider === "polyhaven" ? "Poly Haven" : s.provider}
                </span>
                <h3>{s.title}</h3>
                <p>{s.description}</p>
                <div className="tag-list">
                  {s.tags.slice(0, 3).map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                  <span>CC0</span>
                </div>
                <footer>
                  <MoreButton
                    items={() => sourceCommands(s)}
                    label="免费素材更多操作"
                  />
                  <ClientButton
                    disabled={!!resolving}
                    onClick={() => void resolve(s)}
                  >
                    {s.installed ? <Check size={15} /> : <Download size={15} />}{" "}
                    {s.installed
                      ? "检查并下载新版本"
                      : resolving === s.id
                        ? "解析中…"
                        : "安装"}
                  </ClientButton>
                </footer>
              </div>
            </article>
          ))}
        </div>
      )}
      {provider !== "featured" && !cards.length && !loading && (
        <Empty icon={<Sparkles size={30} />} heading="按需查询官方目录">
          检索后会解析实际文件、依赖和下载规格。
        </Empty>
      )}
      {provider !== "featured" && hasMore && !loading && (
        <ClientButton onClick={() => void searchCatalog(true)}>
          加载下一页
        </ClientButton>
      )}
      {plan && (
        <Modal
          title={`安装 ${plan.sample.title}`}
          onClose={() => setPlan(null)}
        >
          <div className="summary-cards">
            <div>
              <span>规格</span>
              <strong>
                {plan.source.provider === "polyhaven"
                  ? "2K"
                  : plan.sample.provider === "ambientcg"
                    ? "2K PNG"
                    : "原始包"}
              </strong>
            </div>
            <div>
              <span>下载量</span>
              <strong>{plan.bytes ? bytes(plan.bytes) : "上游未提供"}</strong>
            </div>
            <div>
              <span>文件</span>
              <strong>{plan.files.length}</strong>
            </div>
          </div>
          <div className="license-banner">
            <ShieldCheck size={22} />
            <div>
              <strong>{plan.source.license}</strong>
              <span>{plan.source.author}</span>
            </div>
          </div>
          <p>{plan.source.evidence}</p>
          <div className="file-list">
            {plan.files.map((f) => (
              <div key={f.path}>
                <span>{f.path}</span>
                <small>{f.bytes ? bytes(f.bytes) : ""}</small>
              </div>
            ))}
          </div>
          <div className="modal-actions">
            <ClientButton onClick={() => setPlan(null)}>取消</ClientButton>
            <ClientButton
              className="primary"
              onClick={async () => {
                try {
                  await call("downloads.start", { planId: plan.id });
                  setPlan(null);
                  useStore.getState().notify("下载任务已创建");
                } catch (e) {
                  report(e);
                }
              }}
            >
              <Download size={16} />
              下载并导入
            </ClientButton>
          </div>
        </Modal>
      )}
    </div>
  );
}
export function Tasks() {
  const jobs = useStore((s) => s.jobs),
    [filter, setFilter] = useState(""),
    [detail, setDetail] = useState<Job | null>(null);
  function taskCommands(j: Job) {
    const job = { ...j },
      control = (action: string) => () =>
        call("jobs.control", { id: job.id, action });
    return [
      c("detail", "查看任务详情", () => setDetail(job)),
      ...(["queued", "running"].includes(job.status) &&
      job.type !== "convert" &&
      !job.type.startsWith("family-") &&
      job.type !== "processing-organize" &&
      !job.type.startsWith("generation")
        ? [c("pause", "暂停", control("pause"))]
        : []),
      ...(job.status === "paused"
        ? [c("resume", "继续", control("resume"))]
        : []),
      ...(["queued", "running", "paused"].includes(job.status)
        ? [c("cancel", "取消任务", control("cancel"), { danger: true })]
        : []),
      ...(["failed", "cancelled"].includes(job.status)
        ? [c("retry", "重试", control("retry"))]
        : []),
      ...(job.result?.target
        ? [
            c("output", "查看输出", () =>
              call("system.jobOutput", { jobId: job.id }),
            ),
          ]
        : []),
      ...(job.error
        ? [
            c("copy", "复制错误信息", () =>
              call("system.copy", { jobId: job.id }),
            ),
          ]
        : []),
    ];
  }
  function blankTaskCommands() {
    return [
      c("refresh", "刷新任务", () =>
        call<Job[]>("jobs.list").then((rows) =>
          rows.forEach((j) => useStore.getState().updateJob(j)),
        ),
      ),
      g(
        "filter",
        "状态筛选",
        [["", "全部任务"], ...Object.entries(statusNames)].map(
          ([value, label]) =>
            c(value || "all", label, () => setFilter(value), {
              checked: filter === value,
            }),
        ),
      ),
    ];
  }
  return (
    <div
      className="full-page tasks-page"
      tabIndex={0}
      {...menuBindings(blankTaskCommands)}
    >
      <header className="page-heading">
        <div>
          <span className="eyebrow">BACKGROUND JOBS</span>
          <SectionTitle as="h1" title={"任务中心"} />
          <p>下载、复制、校验与转换的进度都在这里。</p>
        </div>
        <span className="pill">
          {jobs.filter((j) => ["running", "queued"].includes(j.status)).length}{" "}
          个活动任务
        </span>
        <MoreButton items={blankTaskCommands} label="任务中心更多操作" />
      </header>
      {!jobs.length ? (
        <Empty icon={<Check size={30} />} heading="一切就绪">
          新导入和下载会自动出现在这里。
        </Empty>
      ) : (
        <div className="job-list">
          {jobs
            .filter((j) => !filter || j.status === filter)
            .map((j) => (
              <article
                className={`job-card ${j.status}`}
                key={j.id}
                tabIndex={0}
                {...menuBindings(() => taskCommands(j))}
              >
                <div className="job-icon">
                  {j.type === "download" || j.type === "sample" ? (
                    <Download />
                  ) : j.type === "backup" ? (
                    <ShieldCheck />
                  ) : (
                    <Box />
                  )}
                </div>
                <div className="job-body">
                  <div className="job-title">
                    <h3>{j.title}</h3>
                    <span>{statusNames[j.status]}</span>
                  </div>
                  <p>
                    {j.error || j.stage}
                    {j.status === "running" && j.total > 1
                      ? ` · ${j.done.toLocaleString()} / ${j.total.toLocaleString()}`
                      : ""}
                  </p>
                  <ProgressBar
                    label={statusNames[j.status]}
                    value={j.progress * 100}
                  />
                  <small>
                    {new Date(j.createdAt).toLocaleString("zh-CN")}
                    {j.result?.assets
                      ? ` · ${j.result.assets.length} 个素材`
                      : ""}
                    {j.result?.duplicate ? " · 已复用库内副本" : ""}
                  </small>
                </div>
                <div className="job-actions">
                  <MoreButton
                    items={() => taskCommands(j)}
                    label="任务更多操作"
                  />
                </div>
              </article>
            ))}
        </div>
      )}
      {detail && (
        <Modal title="任务详情" onClose={() => setDetail(null)}>
          <h3>{detail.title}</h3>
          <p>
            {statusNames[detail.status]} · {detail.stage}
          </p>
          <p>
            {detail.done.toLocaleString()} / {detail.total.toLocaleString()} ·{" "}
            {Math.round(detail.progress * 100)}%
          </p>
          {detail.error && <p className="warning">{detail.error}</p>}
          {detail.result?.target && <p>{detail.result.target}</p>}
          {detail.result?.failures?.map((s: string) => (
            <p key={s}>{s}</p>
          ))}
        </Modal>
      )}
    </div>
  );
}
export function Dashboard({
  projects,
  onImport,
}: {
  projects: Project[];
  onImport: () => void;
}) {
  const epoch = useStore((s) => s.epoch),
    [stats, setStats] = useState<Stats | null>(null),
    setQuery = useStore((s) => s.setQuery),
    setPage = useStore((s) => s.setPage);
  useEffect(() => {
    void call<Stats>("library.stats").then(setStats).catch(report);
  }, [epoch]);
  return (
    <div className="full-page dashboard">
      <header className="page-heading">
        <div>
          <span className="eyebrow">YOUR CREATIVE WORKSPACE</span>
          <SectionTitle as="h1" title={"每一份素材，都是世界的起点"} />
          <p>欢迎回到素材工坊。继续整理、探索，或开始一个新项目。</p>
        </div>
        <ClientButton className="primary" onClick={onImport}>
          <Download size={16} />
          导入素材
        </ClientButton>
      </header>
      <div className="stats-grid">
        {[
          [Box, "素材", stats?.assets ?? 0],
          [FolderOpen, "项目", stats?.projects ?? 0],
          [HardDrive, "托管空间", bytes(stats?.bytes ?? 0)],
          [ShieldCheck, "资源包", stats?.packages ?? 0],
        ].map(([Icon, label, value]: any) => (
          <StatCard
            key={label}
            icon={<Icon size={20} />}
            label={label}
            value={typeof value === "number" ? value.toLocaleString() : value}
          />
        ))}
      </div>
      {!!stats?.auxiliaryAssets && (
        <p className="muted">
          另有 {stats.auxiliaryAssets.toLocaleString()} 张辅助预览图 ·
          原始文件总数 {stats.files.toLocaleString()}
        </p>
      )}
      <div className="section-heading">
        <h2>我的项目</h2>
        <ClientButton className="text-button" onClick={() => setQuery({})}>
          浏览全部 <ArrowUpRight size={16} />
        </ClientButton>
      </div>
      <div className="project-grid">
        {projects.map((p) => (
          <ClientButton
            key={p.id}
            className="project-tile"
            {...projectBindings(p)}
            onClick={() => setQuery({ projectId: p.id })}
          >
            <div
              className="project-art"
              style={{ "--project-color": p.color } as any}
            >
              <Box size={45} />
              <span>{p.name.slice(0, 1)}</span>
            </div>
            <h3>{p.name}</h3>
            <p>{p.assetCount} 个固定版本素材</p>
          </ClientButton>
        ))}
        {!projects.length && (
          <div className="intro-card">
            <h3>从一个真实示例开始</h3>
            <p>安装免费素材，自动创建 2D 地牢和 3D 场景项目。</p>
            <ClientButton onClick={() => setPage("sources")}>
              探索免费素材 <ArrowUpRight size={16} />
            </ClientButton>
          </div>
        )}
      </div>
      <div className="section-heading">
        <h2>最近查看</h2>
      </div>
      <div className="recent-grid">
        {stats?.recent.map((a) => (
          <button
            key={a.id}
            onClick={() => {
              setQuery({ recent: true });
              useStore.getState().setSelection([a.id], a.id);
            }}
          >
            {a.thumbnailUrl ? (
              <img src={a.thumbnailUrl} alt="" />
            ) : (
              <Box size={30} />
            )}
            <span>{a.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
export function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null),
    [cacheStats, setCacheStats] = useState<Stats | null>(null),
    [busy, setBusy] = useState(false),
    [backup, setBackup] = useState(""),
    [target, setTarget] = useState("");
  useEffect(() => {
    void call<Settings>("settings.get").then(setSettings).catch(report);
  }, []);
  async function select(
    kind: "folder" | "executable",
    action: (path: string) => void,
  ) {
    const p = await window.workshop.choose({ kind });
    if (p[0]) action(p[0]);
  }
  if (!settings) return <Loading />;
  function libraryCommands() {
    return [
      c("open", "打开素材库目录", () =>
        call("system.openFolder", { path: settings!.root }),
      ),
      c("backup", "创建完整备份…", async () => {
        const [target] = await window.workshop.choose({
          kind: "folder",
          title: "选择备份位置",
        });
        if (target) {
          await call("backups.create", { target });
          useStore.getState().notify("备份已加入任务");
        }
      }),
      c("restore", "恢复到新目录…", async () => {
        const [backup] = await window.workshop.choose({
          kind: "folder",
          title: "选择已完成的备份目录",
        });
        if (!backup) return;
        const [target] = await window.workshop.choose({
          kind: "folder",
          title: "选择新的空目录",
        });
        if (target) {
          await call("backups.restore", { backup, target });
          useStore.getState().notify("恢复任务已创建");
        }
      }),
    ];
  }
  function cacheCommands() {
    return [
      c("stats", "查看缓存占用", async () =>
        setCacheStats(await call<Stats>("library.stats")),
      ),
      c("clear", "清理缓存", () =>
        call("cache.clear").then(() =>
          useStore.getState().notify("缓存已清理"),
        ),
      ),
      c("rebuild", "重建预览", () =>
        call("cache.rebuild").then(() =>
          useStore.getState().notify("重建已加入任务"),
        ),
      ),
    ];
  }
  return (
    <div className="full-page settings-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">LOCAL FIRST</span>
          <SectionTitle as="h1" title={"工坊设置"} />
          <p>选择存储位置、外部工具与数据保护方式。</p>
        </div>
      </header>
      <SkinSettings />
      <section
        className="settings-section"
        tabIndex={0}
        {...menuBindings(libraryCommands)}
      >
        <h2>
          <HardDrive size={19} />
          本地素材库
          <MoreButton items={libraryCommands} label="素材库更多操作" />
        </h2>
        <Field label="当前素材库">
          <div className="input-action">
            <input readOnly value={settings.root} />
            <ClientButton
              onClick={() =>
                void call("system.openFolder", { path: settings.root }).catch(
                  report,
                )
              }
            >
              <FolderOpen size={17} />
            </ClientButton>
          </div>
        </Field>
        <ClientButton
          onClick={() =>
            void select("folder", async (root) => {
              try {
                await call("library.open", { root });
              } catch (e) {
                report(e);
              }
            })
          }
        >
          打开 / 创建其他素材库
        </ClientButton>
        <p className="muted">
          切换前需完成或取消后台任务。迁移时先关闭客户端，复制完整目录，再从此处打开。
        </p>
        <Field label="缩略图缓存容量（GB）">
          <input
            type="number"
            min=".1"
            max="1000"
            value={settings.cacheGB}
            onChange={(e) =>
              setSettings({ ...settings, cacheGB: Number(e.target.value) })
            }
          />
        </Field>
        <div
          className="button-row"
          tabIndex={0}
          {...menuBindings(cacheCommands)}
        >
          <span>缩略图缓存</span>
          <MoreButton items={cacheCommands} label="缓存更多操作" />
        </div>
      </section>
      {cacheStats && (
        <Modal title="缓存占用" onClose={() => setCacheStats(null)}>
          <p>当前缓存：{bytes(cacheStats.cacheBytes)}</p>
          <p>容量上限：{settings.cacheGB} GB</p>
          <p>生成的缩略图属于可重建缓存，未计入素材。</p>
        </Modal>
      )}
      <section className="settings-section">
        <h2>
          <Box size={19} />
          外部工具
        </h2>
        {(["godotPath", "blenderPath"] as const).map((key, i) => (
          <Field
            label={i ? "Blender 可执行文件" : "Godot 可执行文件"}
            key={key}
          >
            <div className="input-action">
              <input
                value={settings[key]}
                onChange={(e) =>
                  setSettings({ ...settings, [key]: e.target.value })
                }
                placeholder="可选"
              />
              <ClientButton
                onClick={() =>
                  void select("executable", (p) =>
                    setSettings({ ...settings, [key]: p }),
                  )
                }
              >
                <FolderOpen size={17} />
              </ClientButton>
            </div>
          </Field>
        ))}
        <ClientButton
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              setSettings(await call("settings.save", settings));
              useStore.getState().notify("设置已保存");
            } catch (e) {
              report(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          保存设置
        </ClientButton>
      </section>
      <section className="settings-section">
        <h2>
          <ShieldCheck size={19} />
          备份与恢复
        </h2>
        <p>
          备份包含原件、固定版本、项目、标签、变体及许可。可重建的预览缓存不进入备份。
        </p>
        <ClientButton
          onClick={() =>
            void select("folder", async (target) => {
              try {
                await call("backups.create", { target });
                useStore.getState().notify("备份已加入后台任务");
              } catch (e) {
                report(e);
              }
            })
          }
        >
          创建完整备份
        </ClientButton>
        <div className="restore-form">
          <ClientButton
            onClick={() =>
              void select("folder", async (target) => {
                try {
                  await call("backups.rebuild", { target });
                  useStore.getState().notify("清单重建已加入后台任务");
                } catch (e) {
                  report(e);
                }
              })
            }
          >
            从清单重建到新目录
          </ClientButton>
          <Field label="已有备份目录">
            <div className="input-action">
              <input readOnly value={backup} />
              <ClientButton onClick={() => void select("folder", setBackup)}>
                选择
              </ClientButton>
            </div>
          </Field>
          <Field label="恢复到新的空目录">
            <div className="input-action">
              <input readOnly value={target} />
              <ClientButton onClick={() => void select("folder", setTarget)}>
                选择
              </ClientButton>
            </div>
          </Field>
          <ClientButton
            disabled={!backup || !target}
            onClick={() =>
              void call("backups.restore", { backup, target })
                .then(() =>
                  useStore.getState().notify("备份校验与恢复已加入任务中心"),
                )
                .catch(report)
            }
          >
            校验并恢复
          </ClientButton>
        </div>
      </section>
      <p className="muted">
        素材工坊 / OmO 0.1.0 · Electron / Three.js · 离线管理，按需联网
      </p>
    </div>
  );
}
