# 素材工坊 UI 组件工场

第二轮交付：32 类控件与风格组件、101 个适用状态、红/青/紫三种配色和标准/紧凑两种密度，增加统一动效层与拼贴轮廓。图形由项目原创 SVG 构成，许可沿用项目 MIT。

## 打开展示页

直接打开 离线展示页（本地生成文件：preview/ui-kit.html），无需 Electron、网络或素材库。可以切换组件总览、状态矩阵、动效实验室、组合示例与原创素材；展开状态示例通过按钮实际打开浮层。动效实验室有六组可操作演示，支持重播、减少动画与静态模式。

开发预览：

```sh
pnpm ui:dev
```

浏览器地址为 `http://127.0.0.1:5175/ui-kit.html`。原桌面应用入口仍为 `pnpm dev`。

## 交付文件

下载整包（本地生成文件：../ui-kit-bundle.zip）：含全部导出素材、离线展示页、索引与验收记录，并在 `source/` 中附组件源码和导出脚本。源码是当前项目的增量模块，接入时使用项目已有 React、Lucide、Vite、Playwright 与 Sharp 依赖。

| 文件/目录                | 内容                                                                  |
| ------------------------ | --------------------------------------------------------------------- |
| `component-atlas.png`    | 32 类组件总览图集                                                     |
| `gallery-overview.png`   | 完整展示页                                                            |
| `gallery-hero.png`       | 展示页首屏                                                            |
| `motion-lab.png`         | 六组动效演示的静态总览                                                |
| `scene-compositions.png` | 素材浏览、资源下载、材质参数组合示例                                  |
| `artwork-gallery.png`    | 原创装饰图集                                                          |
| `controls/`              | 197 张透明 2× 控件 PNG：红色全部状态，青/紫默认状态，红色紧凑默认状态 |
| `artwork/`               | 27 个 SVG 与 54 张透明 1×/2× PNG                                      |
| `index.json`             | 对应组件、状态、配色、密度、像素尺寸、逻辑尺寸和文件路径              |
| `validation.json`        | 实际验收结果                                                          |
| `preview/`               | 可直接离线打开的独立展示页及本地图形                                  |

控件 PNG 供设计排版和外观复用；项目内实际操作使用 React 组件。半透明网点和划痕纹理可平铺，装饰文件没有游戏角色或官方标志。

## 接入组件

从 `src/renderer/src/ui-kit/index.tsx` 导入组件。统一入口继续兼容已有导入，内部拆成 `operations`、`forms`、`information`、`structure`、`layers` 与 `motion` 模块。`Theme` 提供局部样式和上下文；基础样式在 `theme.css`，动效与拼贴轮廓在 `motion.css`。

以下示例可放进渲染器页面：

```tsx
import { useState } from "react";
import { Theme, Button, TextField, Panel } from "./ui-kit";

function ProjectForm() {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <Theme accent="red" density="regular">
      <Panel title="创建游戏项目">
        <TextField
          label="项目名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <Button
          variant="primary"
          loading={saving}
          onClick={() => setSaving(true)}
        >
          创建项目
        </Button>
      </Panel>
    </Theme>
  );
}
```

- `accent` 为 `red | cyan | violet`，`density` 为 `regular | compact`；可在 `Theme` 统一设置或在组件上覆盖。
- `motion` 为 `system | reduced | none`，默认 `system`；系统减少动画设置优先生效。浮层继承最近 `Theme` 的配色、密度和动效，浮层显式属性优先。嵌套局部主题使用 `Theme`。
- 按钮透传原生属性和 `ref`，默认 `type="button"`。`loading` 同时设置忙碌状态与禁用，防止重复触发。
- 表单透传原生属性和 `ref`。`label` 自动关联输入控件，`error` 与 `help` 自动关联说明文本。`Checkbox` 支持 `indeterminate`。
- `Tabs`、`Segmented` 使用 `options / value / onChange / label`。页签支持左右箭头和 Home/End，并跳过禁用项；如有内容面板，可通过选项的 `panelId` 关联。
- `AssetCard` 使用 `title / subtitle / meta / format / image / selected / onClick`；`GroupCard` 增加 `count / partial`。实际网格接入时继续使用现有虚拟滚动尺寸。
- `TextureSlot` 使用 `label / detail / image / onPick / onRemove`，贴图数据由业务层提供。
- `DropdownMenu` 接收 `items`，每项可指定 `id / label / icon / disabled / checked / danger / onSelect`。支持键盘导航、Esc、点击外部关闭和焦点恢复；浮层自动避让窗口边缘。
- `Dialog` 使用 `open / onClose / title / footer / wide`。采用原生模态弹窗并限制 Tab 焦点，Esc 和背景点击可关闭。
- `Tooltip` 关联实际触发控件的说明文本；菜单和提示在弹窗内使用时挂到对应弹窗。
- 通知、进度和空状态只展示外部传入的数据，不调用 IPC、不修改素材库。

组件的演示与导出共用 `samples.tsx`；原创装饰源代码在 `scripts/ui-art.mjs`。

## 重新导出和验收

```sh
pnpm ui:export
pnpm ui:test
```

导出脚本生成实际组件截图，并附带独立离线预览。验收覆盖受控表单、页签/菜单键盘操作、弹窗焦点、禁用/加载状态、组合示例、1050×700 与 1510×950 布局、减少动画、PNG 尺寸/透明度、离线入口和原 Electron/缩略图入口。

## 复用动效

```tsx
import { Theme, Reveal, Presence, AssetCard, Toast } from "./ui-kit";

<Theme accent="violet" motion="system">
  <Reveal preset="card" delay={35} replayKey={selectedId}>
    <AssetCard title="wooden_crate_02.glb" selected onClick={onSelect} />
  </Reveal>
  <Presence present={notificationOpen} onExitComplete={onDismissed}>
    <Toast message="素材已就绪" onClose={onClose} />
  </Presence>
</Theme>;
```

`Reveal` 支持 `title | card | panel | stamp`，默认 `panel`。首次进入视口时播放；修改 `replayKey` 重播，保留内部组件状态。`delay` 限制在 0–175ms。根节点和点击区域不位移，只有透明度与不接收点击的装饰层运动。`Presence` 在退出完成前保留内容，结束后卸载并触发一次回调；退出期间重新显示会取消旧的卸载任务。调用方在退出期间应保留内容。

统一时间变量：按下 80ms、悬停 140ms、选中 220ms、入场 280ms、弹窗 320ms、退出 140ms；错峰 35ms，上限 175ms。`MOTION_TOKENS` 供组合交互使用，CSS 变量保持相同数值。`reduced` 仅保留不超过 80ms 的透明度变化；`none` 直接显示最终状态。主题切换会收束已经启动的过渡。

菜单关闭时立即停止交互并恢复触发器焦点；弹窗保留原生模态层至退出完成后再恢复焦点。快速重开会取消退出，表单数据不会被重播重置。PNG 导出统一使用 `motion="none"`，离线展示页保留正常交互动效。

仅组合示例中的原创木箱示意根据变体切换颜色，实际查看器未接入主题滤镜。

本阶段完成组件与素材基础。后续全应用接入顺序为：导航与素材库 → 详情与材质工作台 → 工作台、免费素材、任务、设置及业务弹窗。
