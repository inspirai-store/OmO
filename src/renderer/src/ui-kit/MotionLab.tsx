import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Box,
  Check,
  Download,
  Play,
  RefreshCw,
  Star,
} from "lucide-react";
import {
  Theme,
  Button,
  Segmented,
  SectionTitle,
  Reveal,
  Presence,
  AssetCard,
  DropdownMenu,
  Dialog,
  TextField,
  Hint,
  Toast,
  type Motion,
} from "./index";
import { artworkURL } from "./samples";
import { useResolvedTheme } from "./core";

export function MotionLab() {
  const parentTheme = useResolvedTheme();
  const [mode, setMode] = useState<Motion>(parentTheme.motion),
    [replay, setReplay] = useState(0),
    [pressed, setPressed] = useState("default"),
    [actions, setActions] = useState(0);
  const [selection, setSelection] = useState("assets"),
    [asset, setAsset] = useState("crate"),
    [notice, setNotice] = useState(false),
    [dialog, setDialog] = useState(false),
    [name, setName] = useState("我的拼贴素材项目"),
    [favorite, setFavorite] = useState(false);
  useEffect(() => {
    if (!replay) return;
    setPressed("hover");
    setNotice(true);
    const timers = [
      setTimeout(() => setPressed("pressed"), 180),
      setTimeout(() => setPressed("hover"), 260),
      setTimeout(() => setPressed("default"), 500),
      setTimeout(() => setSelection("materials"), 180),
      setTimeout(() => setSelection("downloads"), 420),
    ];
    return () => timers.forEach(clearTimeout);
  }, [replay]);
  return (
    <Theme motion={mode} className="kit-motion-lab" data-motion-lab>
      <div className="kit-motion-intro">
        <SectionTitle
          title="让界面有自己的节奏"
          eyebrow="MOTION LAB / PLAY IT AGAIN"
        />
        <Button
          variant="primary"
          icon={<Play size={16} />}
          onClick={() => setReplay((value) => value + 1)}
        >
          重播动效
        </Button>
      </div>
      <p className="kit-section-description">
        底板先动，阴影跟上，标记落稳。操作即时响应，视觉随后完成。
      </p>
      <div className="kit-motion-settings">
        <Segmented
          label="动效模式"
          value={mode}
          onChange={(value) => setMode(value as Motion)}
          options={[
            { value: "system", label: "跟随系统" },
            { value: "reduced", label: "减少动画" },
            { value: "none", label: "静态状态" },
          ]}
        />
        <div className="kit-motion-beats" aria-label="动效节奏">
          <span>01 蓄力</span>
          <b>→</b>
          <span>02 冲击</span>
          <b>→</b>
          <span>03 回弹</span>
          <b>→</b>
          <span>04 落稳</span>
        </div>
      </div>
      <div className="kit-motion-grid">
        <article className="kit-motion-demo" data-motion-demo="button">
          <header>
            <b>01</b>
            <h3>短促压印</h3>
            <small>80 / 140 ms</small>
          </header>
          <div className="kit-motion-stage">
            <Button
              variant="primary"
              icon={<Download size={18} />}
              data-preview-state={pressed}
              onClick={() => setActions((value) => value + 1)}
            >
              收集灵感
            </Button>
            <span className="kit-motion-caption">
              悬停或按下 · 已触发 {actions} 次
            </span>
          </div>
          <footer>底板压缩 / 阴影错位 / 图标回弹</footer>
        </article>
        <article className="kit-motion-demo" data-motion-demo="selection">
          <header>
            <b>02</b>
            <h3>选中底板</h3>
            <small>220 ms</small>
          </header>
          <div className="kit-motion-stage">
            <Segmented
              label="动效选中演示"
              value={selection}
              onChange={setSelection}
              options={[
                { value: "assets", label: "素材" },
                { value: "materials", label: "材质" },
                { value: "downloads", label: "下载" },
              ]}
            />
            <span className="kit-motion-caption">
              点击切换 · 快速操作仍跟随最新选择
            </span>
          </div>
          <footer>底板滑入 / 短促回弹 / 文字水平</footer>
        </article>
        <article
          className="kit-motion-demo kit-motion-demo--wide"
          data-motion-demo="cards"
        >
          <header>
            <b>03</b>
            <h3>拼贴卡片</h3>
            <small>280 ms + 35 ms</small>
          </header>
          <div className="kit-motion-cards">
            {[
              { id: "crate", title: "wooden_crate_02.glb" },
              { id: "character", title: "角色_游侠_动画模型.fbx" },
              { id: "dungeon", title: "模块化地牢场景素材合集_完整依赖" },
            ].map((item, index) => (
              <Reveal
                key={item.id}
                preset="card"
                replayKey={replay}
                delay={index * 35}
              >
                <AssetCard
                  title={item.title}
                  image={artworkURL(`sample-${item.id}`)}
                  subtitle="本地示例素材"
                  format={index === 1 ? "FBX" : "GLB"}
                  selected={asset === item.id}
                  onClick={() => setAsset(item.id)}
                />
              </Reveal>
            ))}
          </div>
          <footer>叠纸边缘 / 错峰显现 / 选中角标</footer>
        </article>
        <article className="kit-motion-demo" data-motion-demo="menu">
          <header>
            <b>04</b>
            <h3>展开操作</h3>
            <small>220 / 140 ms</small>
          </header>
          <div className="kit-motion-stage">
            <DropdownMenu
              label="打开动效菜单"
              items={[
                {
                  id: "preview",
                  label: "展开预览",
                  icon: <Box size={16} />,
                  onSelect: () => setActions((value) => value + 1),
                },
                {
                  id: "favorite",
                  label: "加入收藏",
                  icon: <Star size={16} />,
                  checked: favorite,
                  onSelect: () => setFavorite((value) => !value),
                },
                { id: "disabled", label: "缺失依赖，暂不可用", disabled: true },
                {
                  id: "download",
                  label: "下载资源",
                  icon: <ArrowUpRight size={16} />,
                  onSelect: () => setNotice(true),
                },
              ]}
            />
            <span className="kit-motion-caption">
              使用上下箭头导航，Esc 关闭
            </span>
          </div>
          <footer>底板展开 / 菜单项错峰 / 快速收束</footer>
        </article>
        <article className="kit-motion-demo" data-motion-demo="dialog">
          <header>
            <b>05</b>
            <h3>分层弹窗</h3>
            <small>320 / 140 ms</small>
          </header>
          <div className="kit-motion-stage">
            <Button
              icon={<RefreshCw size={17} />}
              onClick={() => setDialog(true)}
            >
              打开动效弹窗
            </Button>
            <span className="kit-motion-caption">
              底板 → 标题 → 内容；关闭后恢复焦点
            </span>
          </div>
          <Dialog
            open={dialog}
            onClose={() => setDialog(false)}
            title="收集你的下一个世界"
            footer={
              <>
                <Button onClick={() => setDialog(false)}>取消</Button>
                <Button
                  variant="primary"
                  icon={<Check size={16} />}
                  onClick={() => {
                    setDialog(false);
                    setNotice(true);
                  }}
                >
                  完成演示
                </Button>
              </>
            }
          >
            <TextField
              label="项目名称"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Hint>长中文和多行内容保持水平阅读，焦点与操作区域稳定。</Hint>
          </Dialog>
          <footer>漫画底板 / 分层进入 / 焦点恢复</footer>
        </article>
        <article
          className="kit-motion-demo kit-motion-demo--wide"
          data-motion-demo="toast"
        >
          <header>
            <b>06</b>
            <h3>完成印章</h3>
            <small>280 / 140 ms</small>
          </header>
          <div className="kit-motion-toast">
            <div className="kit-sample-inline">
              <Button icon={<Play size={16} />} onClick={() => setNotice(true)}>
                弹出通知
              </Button>
              <Button variant="ghost" onClick={() => setNotice(false)}>
                收起通知
              </Button>
            </div>
            <Presence present={notice}>
              <Toast
                key={replay}
                message="灵感已收集，下一座世界等你构建。"
                onClose={() => setNotice(false)}
              />
            </Presence>
          </div>
          <footer>贴纸甩入 / 图标盖章 / 淡出收束</footer>
        </article>
      </div>
    </Theme>
  );
}
