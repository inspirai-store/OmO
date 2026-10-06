import { useState } from "react";
import {
  Upload,
  Download,
  Box,
  Library,
  Star,
  Settings,
  Search,
  ArrowRight,
  Plus,
  Trash2,
  Folder,
  Layers,
} from "lucide-react";
import {
  Theme,
  Reveal,
  Presence,
  Button,
  IconButton,
  NavItem,
  Tabs,
  Segmented,
  TextField,
  SearchField,
  SelectField,
  TextArea,
  Checkbox,
  Radio,
  Range,
  Badge,
  Tag,
  StatusStamp,
  ProgressBar,
  Hint,
  StatCard,
  SectionTitle,
  Panel,
  Toolbar,
  AssetCard,
  GroupCard,
  TextureSlot,
  DropdownMenu,
  Tooltip,
  Dialog,
  Toast,
  LoadingState,
  EmptyState,
  type Accent,
  type Density,
} from "./index";

export const artworkURL = (name: string) => `./ui-art/${name}.svg`;
export const categories = [
  { id: "actions", label: "操作控件", en: "COMMAND", number: "01" },
  { id: "forms", label: "表单控件", en: "INPUT", number: "02" },
  { id: "information", label: "信息组件", en: "SIGNAL", number: "03" },
  { id: "structures", label: "结构组件", en: "FRAME", number: "04" },
  { id: "feedback", label: "浮层与反馈", en: "RESPONSE", number: "05" },
];
const definitions = [
  [
    "primary-button",
    "主按钮",
    "actions",
    ["default", "hover", "pressed", "focus", "disabled", "loading"],
    210,
  ],
  [
    "secondary-button",
    "次按钮",
    "actions",
    ["default", "hover", "pressed", "focus", "disabled"],
    210,
  ],
  [
    "danger-button",
    "危险按钮",
    "actions",
    ["default", "hover", "focus", "disabled"],
    210,
  ],
  [
    "icon-button",
    "图标按钮",
    "actions",
    ["default", "hover", "focus", "selected", "disabled", "loading"],
    90,
  ],
  [
    "nav-item",
    "导航项",
    "actions",
    ["default", "hover", "selected", "focus", "disabled"],
    260,
  ],
  ["tabs", "页签", "actions", ["default", "disabled"], 290],
  ["segmented", "分段选择", "actions", ["default", "disabled"], 260],
  [
    "text-field",
    "输入框",
    "forms",
    ["default", "focus", "disabled", "error"],
    290,
  ],
  [
    "search-field",
    "搜索框",
    "forms",
    ["default", "focus", "disabled", "error"],
    290,
  ],
  [
    "select-field",
    "下拉选择",
    "forms",
    ["default", "focus", "disabled", "error"],
    290,
  ],
  [
    "text-area",
    "文本域",
    "forms",
    ["default", "focus", "disabled", "error"],
    290,
  ],
  [
    "checkbox",
    "复选框",
    "forms",
    ["default", "selected", "partial", "focus", "disabled"],
    240,
  ],
  [
    "radio",
    "单选框",
    "forms",
    ["default", "selected", "focus", "disabled"],
    220,
  ],
  ["range", "滑块", "forms", ["default", "focus", "disabled"], 290],
  ["badge", "格式徽章", "information", ["default"], 240],
  ["tag", "标签", "information", ["default", "removable"], 240],
  [
    "status-stamp",
    "状态印章",
    "information",
    ["default", "working", "warning", "error"],
    240,
  ],
  [
    "progress",
    "进度条",
    "information",
    ["default", "empty", "complete", "loading"],
    290,
  ],
  [
    "hint",
    "提示条",
    "information",
    ["default", "success", "warning", "error"],
    310,
  ],
  ["stat-card", "统计卡", "information", ["default"], 260],
  ["section-title", "斜切标题", "structures", ["default", "long"], 330],
  ["panel", "描边面板", "structures", ["default", "paper"], 310],
  ["toolbar", "工具栏", "structures", ["default"], 330],
  [
    "asset-card",
    "素材卡",
    "structures",
    ["default", "hover", "selected", "focus", "disabled", "long"],
    220,
  ],
  [
    "group-card",
    "聚合卡",
    "structures",
    ["default", "selected", "partial"],
    240,
  ],
  [
    "texture-slot",
    "贴图槽位",
    "structures",
    ["default", "empty", "disabled"],
    310,
  ],
  ["menu", "操作菜单", "feedback", ["default", "open"], 240],
  ["tooltip", "提示浮层", "feedback", ["default", "open"], 240],
  ["dialog", "弹窗", "feedback", ["default", "open"], 280],
  ["toast", "通知", "feedback", ["default", "error"], 310],
  ["loading-state", "加载状态", "feedback", ["default"], 300],
  ["empty-state", "空状态", "feedback", ["default"], 310],
] as const;
export const componentDefinitions = definitions.map(
  ([kind, label, category, states, width]) => ({
    kind,
    label,
    category,
    states: [...states],
    width,
  }),
);
export const samples = componentDefinitions.flatMap((d) =>
  d.states.map((state) => ({ ...d, state, id: `${d.kind}--${state}` })),
);
export type Sample = (typeof samples)[number];
export const stateLabels: Record<string, string> = {
  default: "默认",
  hover: "悬停",
  pressed: "按下",
  focus: "焦点",
  disabled: "禁用",
  loading: "加载",
  selected: "选中",
  partial: "部分选中",
  error: "错误",
  removable: "可移除",
  working: "进行中",
  warning: "警告",
  success: "成功",
  empty: "空白",
  complete: "完成",
  long: "长内容",
  paper: "纸白",
  open: "展开",
};

export function ComponentSample({
  kind,
  state = "default",
  accent = "red",
  density = "regular",
  onAction,
  autoOpen = false,
}: {
  kind: string;
  state?: string;
  accent?: Accent;
  density?: Density;
  onAction?: (message: string) => void;
  autoOpen?: boolean;
}) {
  const [value, setValue] = useState("秋季木箱 · 暖木色"),
    [search, setSearch] = useState("木箱"),
    [option, setOption] = useState("glb"),
    [checked, setChecked] = useState(state === "selected"),
    [partial, setPartial] = useState(state === "partial"),
    [range, setRange] = useState(64),
    [tab, setTab] = useState("info"),
    [view, setView] = useState("grid"),
    [dialogOpen, setDialogOpen] = useState(
      autoOpen && state === "open" && kind === "dialog",
    ),
    [tagVisible, setTagVisible] = useState(true),
    [toastVisible, setToastVisible] = useState(true),
    [selected, setSelected] = useState(state === "selected"),
    [bound, setBound] = useState(state !== "empty");
  const common = { accent, density },
    disabled = state === "disabled",
    loading = state === "loading";
  const preview = { "data-preview-state": state };
  const error = state === "error" ? "请输入有效名称，不能为空。" : undefined;
  const act = (message: string) => onAction?.(message);
  const options = [
    { value: "glb", label: "GLB · 三维模型" },
    { value: "png", label: "PNG · 二维图像" },
    { value: "fbx", label: "FBX · 角色动画" },
  ];
  const tabOptions = [
    { value: "info", label: "属性" },
    { value: "files", label: "依赖" },
    { value: "source", label: "来源", disabled },
  ];
  let content;
  switch (kind) {
    case "primary-button":
      content = (
        <Button
          {...common}
          {...preview}
          variant="primary"
          disabled={disabled}
          loading={loading}
          icon={<Upload size={16} />}
          onClick={() => act("导入操作已触发")}
        >
          导入素材
        </Button>
      );
      break;
    case "secondary-button":
      content = (
        <Button
          {...common}
          {...preview}
          disabled={disabled}
          icon={<Download size={16} />}
          onClick={() => act("导出操作已触发")}
        >
          导出选中
        </Button>
      );
      break;
    case "danger-button":
      content = (
        <Button
          {...common}
          {...preview}
          variant="danger"
          disabled={disabled}
          icon={<Trash2 size={16} />}
          onClick={() => act("删除操作演示，不会删除实际文件")}
        >
          移入回收站
        </Button>
      );
      break;
    case "icon-button":
      content = (
        <IconButton
          {...common}
          {...preview}
          label="打开设置"
          icon={<Settings size={17} />}
          disabled={disabled}
          loading={loading}
          selected={state === "selected"}
          onClick={() => act("设置操作已触发")}
        />
      );
      break;
    case "nav-item":
      content = (
        <NavItem
          {...common}
          {...preview}
          icon={<Library size={17} />}
          selected={selected}
          disabled={disabled}
          onClick={() => {
            setSelected(!selected);
            act("导航状态已切换");
          }}
        >
          全部素材
        </NavItem>
      );
      break;
    case "tabs":
      content = (
        <div className="kit-sample-stack">
          <Tabs
            {...common}
            options={tabOptions}
            value={tab}
            onChange={setTab}
            label="详情页签"
          />
          <small>当前：{tabOptions.find((o) => o.value === tab)?.label}</small>
        </div>
      );
      break;
    case "segmented":
      content = (
        <Segmented
          {...common}
          label="浏览模式"
          options={[
            { value: "grid", label: "网格" },
            { value: "list", label: "列表", disabled },
          ]}
          value={view}
          onChange={setView}
        />
      );
      break;
    case "text-field":
      content = (
        <TextField
          {...common}
          {...preview}
          label="素材名称"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          error={error}
        />
      );
      break;
    case "search-field":
      content = (
        <SearchField
          {...common}
          {...preview}
          label="搜索素材"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder="名称、标签、来源…"
          disabled={disabled}
          error={error}
        />
      );
      break;
    case "select-field":
      content = (
        <SelectField
          {...common}
          {...preview}
          label="素材格式"
          value={option}
          onChange={(e) => setOption(e.target.value)}
          options={options}
          disabled={disabled}
          error={error}
        />
      );
      break;
    case "text-area":
      content = (
        <TextArea
          {...common}
          {...preview}
          label="素材备注"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          error={error}
          rows={3}
        />
      );
      break;
    case "checkbox":
      content = (
        <Checkbox
          {...common}
          {...preview}
          label="包含关联贴图"
          checked={checked}
          indeterminate={partial}
          onChange={(e) => {
            setChecked(e.target.checked);
            setPartial(false);
          }}
          disabled={disabled}
        />
      );
      break;
    case "radio":
      content = (
        <Radio
          {...common}
          {...preview}
          label="固定版本导出"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          name={`radio-${state}-${accent}-${density}`}
          disabled={disabled}
        />
      );
      break;
    case "range":
      content = (
        <Range
          {...common}
          {...preview}
          label="缩略图尺寸"
          value={range}
          min={0}
          max={100}
          onChange={(e) => setRange(Number(e.target.value))}
          disabled={disabled}
        />
      );
      break;
    case "badge":
      content = (
        <div className="kit-sample-inline">
          <Badge {...common}>GLB</Badge>
          <Badge {...common}>PNG</Badge>
          <Badge {...common}>CC0</Badge>
        </div>
      );
      break;
    case "tag":
      content = tagVisible ? (
        <div className="kit-sample-inline">
          <Tag
            {...common}
            label="木质"
            onRemove={
              state === "removable"
                ? () => {
                    setTagVisible(false);
                    act("标签已移除");
                  }
                : undefined
            }
          />
          <Tag {...common} label="可交互物件" />
        </div>
      ) : (
        <Button onClick={() => setTagVisible(true)}>重置标签</Button>
      );
      break;
    case "status-stamp":
      content = (
        <StatusStamp
          {...common}
          tone={
            state === "error"
              ? "error"
              : state === "warning"
                ? "warning"
                : state === "working"
                  ? "info"
                  : "success"
          }
        >
          {state === "error"
            ? "导出失败"
            : state === "warning"
              ? "待整理"
              : state === "working"
                ? "处理中"
                : "已就绪"}
        </StatusStamp>
      );
      break;
    case "progress":
      content = (
        <ProgressBar
          {...common}
          label="下载资源包"
          value={
            loading
              ? undefined
              : state === "empty"
                ? 0
                : state === "complete"
                  ? 100
                  : 64
          }
        />
      );
      break;
    case "hint":
      content = (
        <Hint
          {...common}
          tone={
            state === "error"
              ? "error"
              : state === "warning"
                ? "warning"
                : state === "success"
                  ? "success"
                  : "info"
          }
        >
          {state === "error"
            ? "导出失败，请检查目标文件夹。"
            : state === "warning"
              ? "有 2 个依赖文件需要确认。"
              : state === "success"
                ? "全部资源已加入项目。"
                : "原件托管，素材可离线使用。"}
        </Hint>
      );
      break;
    case "stat-card":
      content = (
        <StatCard
          {...common}
          label="托管素材 / ASSETS"
          value="13,059"
          detail="本地素材库 · 随时可用"
          icon={<Box size={23} />}
        />
      );
      break;
    case "section-title":
      content = (
        <SectionTitle
          {...common}
          title={state === "long" ? "模块化地牢与三维场景素材合集" : "全部素材"}
          eyebrow="YOUR ASSET LIBRARY"
        />
      );
      break;
    case "panel":
      content = (
        <Panel
          {...common}
          title="素材档案 / DOSSIER"
          variant={state === "paper" ? "paper" : "dark"}
          footer={<small>当前版本 · 固定依赖</small>}
        >
          <p>收集灵感，组织你的下一座世界。</p>
          <p style={{ marginTop: 8 }}>黑白面板 / 粗描边 / 错位叠层</p>
        </Panel>
      );
      break;
    case "toolbar":
      content = (
        <Toolbar {...common}>
          <Button
            icon={<Plus size={15} />}
            variant="primary"
            onClick={() => act("新建项目演示")}
          >
            新建项目
          </Button>
          <Button
            icon={<Layers size={15} />}
            onClick={() => act("聚合操作演示")}
          >
            聚合
          </Button>
          <IconButton label="更多操作" />
        </Toolbar>
      );
      break;
    case "asset-card":
      content = (
        <AssetCard
          {...common}
          {...preview}
          title={
            state === "long"
              ? "模块化木箱_秋季场景_暖木色_完整依赖_版本2026.glb"
              : "wooden_crate_02"
          }
          subtitle="3D 模型"
          meta="5,176 △"
          format="GLB"
          image={artworkURL("sample-crate")}
          selected={selected}
          disabled={disabled}
          onClick={() => setSelected(!selected)}
        />
      );
      break;
    case "group-card":
      content = (
        <GroupCard
          {...common}
          title="地牢场景素材包"
          subtitle="模型 + 贴图"
          meta="CC0"
          format="PACK"
          image={artworkURL("sample-dungeon")}
          count={24}
          selected={selected}
          partial={partial}
          onClick={() => {
            setSelected(!selected);
            setPartial(false);
          }}
        />
      );
      break;
    case "texture-slot":
      content = (
        <TextureSlot
          {...common}
          label="Base Color · 基础色"
          detail={bound ? "WoodFloor051_2K_Color.png" : undefined}
          image={bound ? artworkURL("sample-wood") : undefined}
          disabled={disabled}
          onPick={() => {
            setBound(true);
            act("已绑定演示贴图");
          }}
          onRemove={bound ? () => setBound(false) : undefined}
        />
      );
      break;
    case "menu":
      content = (
        <DropdownMenu
          {...common}
          label="素材操作"
          defaultOpen={autoOpen && state === "open"}
          items={[
            {
              id: "preview",
              label: "展开预览",
              icon: <Search size={15} />,
              onSelect: () => act("预览操作已触发"),
            },
            {
              id: "favorite",
              label: "加入收藏",
              icon: <Star size={15} />,
              checked,
              onSelect: () => {
                setChecked(!checked);
                act("收藏状态已切换");
              },
            },
            { id: "disabled", label: "缺失依赖，暂不可导出", disabled: true },
            {
              id: "delete",
              label: "移入回收站",
              danger: true,
              icon: <Trash2 size={15} />,
              onSelect: () => act("回收站操作演示"),
            },
          ]}
        />
      );
      break;
    case "tooltip":
      content = (
        <Tooltip
          {...common}
          text="固定素材版本，完整依赖一起导出。"
          previewOpen={autoOpen && state === "open"}
        >
          <Button icon={<InfoIcon />} onClick={() => act("帮助操作演示")}>
            查看导出说明
          </Button>
        </Tooltip>
      );
      break;
    case "dialog":
      content = (
        <>
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            创建游戏项目
          </Button>
          <Dialog
            {...common}
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title="创建游戏项目"
            footer={
              <>
                <Button onClick={() => setDialogOpen(false)}>取消</Button>
                <Button
                  variant="primary"
                  onClick={() => {
                    setDialogOpen(false);
                    act("项目创建演示完成");
                  }}
                >
                  创建项目
                </Button>
              </>
            }
          >
            <TextField
              label="项目名称"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <Hint>这里只展示控件行为，不会写入实际素材库。</Hint>
          </Dialog>
        </>
      );
      break;
    case "toast":
      content = toastVisible ? (
        <Toast
          {...common}
          tone={state === "error" ? "error" : "success"}
          message={
            state === "error"
              ? "导出失败，请检查目标目录。"
              : "24 个素材已加入项目。"
          }
          onClose={() => setToastVisible(false)}
        />
      ) : (
        <Button onClick={() => setToastVisible(true)}>重置通知</Button>
      );
      break;
    case "loading-state":
      content = <LoadingState {...common} />;
      break;
    case "empty-state":
      content = (
        <EmptyState
          {...common}
          title="这里等待你的第一份素材"
          action={
            <Button
              variant="primary"
              icon={<Download size={16} />}
              onClick={() => act("探索免费素材演示")}
            >
              探索免费素材
            </Button>
          }
        >
          导入文件或安装示例，开始构建你的素材库。
        </EmptyState>
      );
      break;
    default:
      content = <Hint tone="error">未知组件：{kind}</Hint>;
  }
  return (
    <Theme {...common} className="kit-sample-content">
      {content}
    </Theme>
  );
}
function InfoIcon() {
  return <Box size={16} />;
}

export function LibraryScene() {
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState("crate"),
    [view, setView] = useState("grid");
  const assets = [
    {
      id: "crate",
      title: "wooden_crate_02",
      subtitle: "3D 模型",
      format: "GLB",
      meta: "5,176 △",
      image: artworkURL("sample-crate"),
    },
    {
      id: "character",
      title: "角色_游侠_动画模型",
      subtitle: "角色动画",
      format: "FBX",
      meta: "12 动画",
      image: artworkURL("sample-character"),
    },
    {
      id: "dungeon",
      title: "模块化地牢场景素材合集_含完整依赖_版本2026",
      subtitle: "2D 游戏资源",
      format: "PNG",
      meta: "512 × 512",
      image: artworkURL("sample-dungeon"),
    },
  ];
  const filtered = assets.filter((a) =>
      a.title.toLowerCase().includes(search.toLowerCase()),
    ),
    active = assets.find((a) => a.id === selected);
  return (
    <Theme accent="red" className="kit-scene kit-library-scene">
      <div className="kit-scene-bar">
        <span>01 / ASSET BROWSER</span>
        <Badge>素材浏览</Badge>
      </div>
      <div className="kit-library-layout">
        <nav className="kit-scene-nav" aria-label="示例导航">
          <img src={artworkURL("cube-burst-red")} alt="素材工坊" />
          <NavItem icon={<Library size={16} />} selected>
            全部素材
          </NavItem>
          <NavItem icon={<Star size={16} />}>我的收藏</NavItem>
          <NavItem icon={<Folder size={16} />}>游戏项目</NavItem>
        </nav>
        <div className="kit-scene-main">
          <SectionTitle title="收集你的灵感" eyebrow="YOUR ASSET LIBRARY" />
          <div className="kit-scene-controls">
            <SearchField
              label="搜索演示素材"
              placeholder="试试 wooden 或角色"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onClear={() => setSearch("")}
            />
            <Segmented
              label="示例浏览方式"
              value={view}
              onChange={setView}
              options={[
                { value: "grid", label: "网格" },
                { value: "list", label: "列表" },
              ]}
            />
          </div>
          <div
            className={`kit-scene-assets ${view === "list" ? "is-list" : ""}`}
          >
            {filtered.map((a, index) => (
              <Reveal
                key={a.id}
                preset="card"
                delay={index * 35}
                replayKey={`${view}-${search}`}
              >
                <AssetCard
                  key={a.id}
                  {...a}
                  selected={a.id === selected}
                  onClick={() => setSelected(a.id)}
                />
              </Reveal>
            ))}
          </div>
          {!filtered.length && (
            <EmptyState title="没有匹配的素材">
              试试其他名称，或清除搜索。
            </EmptyState>
          )}
        </div>
        <Panel title="素材档案" className="kit-scene-inspector">
          {active && (
            <Reveal preset="stamp" replayKey={selected}>
              <Badge>{active.format}</Badge>
              <h3>{active.title}</h3>
              <small>
                {active.subtitle} · {active.meta}
              </small>
              <div className="kit-sample-inline">
                <Tag label="游戏资源" />
                <Tag label="CC0" />
              </div>
              <StatusStamp key={selected}>已就绪</StatusStamp>
            </Reveal>
          )}
        </Panel>
      </div>
    </Theme>
  );
}
export function DownloadScene() {
  const [progress, setProgress] = useState(36),
    [running, setRunning] = useState(false);
  return (
    <Theme accent="cyan" className="kit-scene">
      <div className="kit-scene-bar">
        <span>02 / RESOURCE DROP</span>
        <Badge>资源下载</Badge>
      </div>
      <div className="kit-download-layout">
        <div className="kit-download-art">
          <img src={artworkURL("sample-dungeon")} alt="原创地牢示例" />
          <img
            className="kit-download-burst"
            src={artworkURL("starburst-cyan")}
            alt=""
          />
          <span>
            BUILD
            <br />
            YOUR WORLD.
          </span>
        </div>
        <div className="kit-download-body">
          <SectionTitle
            title="下一座世界，从这里开始"
            eyebrow="FREE ASSETS / OFFLINE READY"
          />
          <div className="kit-sample-inline">
            <Tag label="模块化地牢" />
            <Tag label="完整依赖" />
            <Badge>CC0</Badge>
          </div>
          <p>模型、贴图与场景组件，整理成一份随时可以使用的素材包。</p>
          <ProgressBar label="地牢资源包下载演示" value={progress} />
          <Toolbar>
            <Button
              variant="primary"
              loading={running}
              icon={<Download size={16} />}
              onClick={() => {
                setRunning(true);
                setProgress(64);
              }}
            >
              下载资源包
            </Button>
            <Button
              onClick={() => {
                setRunning(false);
                setProgress(100);
              }}
            >
              完成演示
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setRunning(false);
                setProgress(36);
              }}
            >
              重置
            </Button>
          </Toolbar>
          <Presence present={progress === 100}>
            <Reveal preset="stamp">
              <Hint tone="success">资源包已就绪，可以加入游戏项目。</Hint>
            </Reveal>
          </Presence>
        </div>
      </div>
    </Theme>
  );
}
export function MaterialScene() {
  const [roughness, setRoughness] = useState(65),
    [metallic, setMetallic] = useState(12),
    [variant, setVariant] = useState("warm"),
    [bound, setBound] = useState(true);
  return (
    <Theme accent="violet" className="kit-scene">
      <div className="kit-scene-bar">
        <span>03 / MATERIAL LAB</span>
        <Badge>材质参数</Badge>
      </div>
      <div className="kit-material-layout">
        <div className="kit-material-stage">
          <span className="kit-stage-label">MATERIAL PREVIEW</span>
          <img
            src={artworkURL("sample-crate")}
            alt="原创木箱材质示意"
            style={{ filter: variant === "warm" ? "none" : "saturate(.25)" }}
          />
          <div className="kit-stage-caption">
            <Badge>PBR</Badge>
            <span>wooden_crate_02</span>
          </div>
        </div>
        <div className="kit-material-body">
          <SectionTitle title="定义你的材质" eyebrow="MATERIAL WORKBENCH" />
          <Segmented
            label="材质变体"
            value={variant}
            onChange={setVariant}
            options={[
              { value: "warm", label: "暖木色" },
              { value: "old", label: "旧木箱" },
            ]}
          />
          <Reveal preset="stamp" replayKey={bound ? "bound" : "empty"}>
            <TextureSlot
              label="Base Color · 基础色"
              detail={bound ? "WoodFloor051_2K_Color.png" : undefined}
              image={bound ? artworkURL("sample-wood") : undefined}
              onPick={() => setBound(true)}
              onRemove={bound ? () => setBound(false) : undefined}
            />
          </Reveal>
          <TextureSlot
            label="Normal · 法线"
            detail="WoodFloor051_NormalGL.png"
            image={artworkURL("sample-normal")}
            onPick={() => {}}
          />
          <Range
            label="粗糙度 / ROUGHNESS"
            value={roughness}
            min={0}
            max={100}
            onChange={(e) => setRoughness(Number(e.target.value))}
          />
          <Range
            label="金属度 / METALLIC"
            value={metallic}
            min={0}
            max={100}
            onChange={(e) => setMetallic(Number(e.target.value))}
          />
          <Hint>参数仅用于组件演示，不会修改真实素材。</Hint>
        </div>
      </div>
    </Theme>
  );
}
