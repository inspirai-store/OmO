# 素材工坊 · OmO

[English](README.en.md) · [MIT 许可证](LICENSE) · [参与贡献](CONTRIBUTING.md)

**OmO（素材工坊）** 是面向游戏开发的本地桌面素材工作台。统一管理图片、图集、三维模型、PBR 材质和界面皮肤，从导入、预览、整理、制作到 Godot 工程交付，保留原件、版本、来源与许可证。当前版本为 **0.1.0**。

![漫画皮肤下的素材工坊](docs/skins/comic-1510.png)

## 功能

- **素材库**：复制托管原件，中文搜索，项目与收藏集，标签、分类、版本、聚合、回收站和备份恢复。
- **图片与模型预览**：透明通道、像素网格、图集、九宫格、帧序列、多页 TIFF；GLB/glTF、OBJ/MTL、FBX、动画与 HDR/EXR 环境。
- **材质与交付**：PBR 贴图绑定、材质变体与并排对照；将依赖、版本、来源和许可导出为 Godot 资源或标准 ZIP。
- **制作与加工**：可选接入 Codex、OpenAI／兼容 Images API、RunningHub；参考图、蒙版、批量候选、同类素材与本地裁剪、缩放、补边、调色等工具。
- **可切换皮肤**：漫画、清爽、纸感三套全局主题，密度与动效设置；图片与图集绑定真实控件槽位，九宫格组包，安装、导入、导出 `.awskin`。
- **UI 组件库**：React 控件、原创 SVG、动效预设、交互展示页以及透明 PNG 和素材图集导出。

本地管理、预览、加工与导出可离线使用。免费素材下载和云端 AI 功能按需联网；首次启动即可使用空素材库，无需配置 AI 服务。

## 开发运行

需要 **Node.js 24.19.0 或更新版本**、**pnpm 11.25.0**。依赖版本与锁文件已固定。

```sh
git clone https://github.com/inspirai-store/OmO.git
cd OmO
pnpm install --frozen-lockfile
pnpm dev
```

客户端从用户数据目录打开默认素材库，可在设置中选择其他目录。开发脚本使用的示例库位于 `.data/library`；这些数据、密钥和安装包不包含在 Git 仓库中。项目名与界面英文名为 OmO，沿用既有应用存储标识，保留旧版素材库与外观配置兼容性。

## 构建与验证

```sh
pnpm build          # 类型检查与 Electron / React 构建
pnpm test           # 单元测试
pnpm test:e2e       # Electron 桌面业务测试
pnpm package       # 当前平台的目录版客户端
pnpm dist          # 当前平台的发行包
```

Windows x64 已实际验收。macOS arm64/x64 与 Linux 提供构建配置，需要在对应平台验证；三平台工作流见 [.github/workflows/desktop.yml](.github/workflows/desktop.yml)。Linux 无显示器测试可运行 `xvfb-run --auto-servernum pnpm test:e2e`。发行包暂未签名，自动更新尚未接入。

SQLite 优先使用 better-sqlite3；缺少兼容原生模块时使用 Electron 所含 Node 的 `node:sqlite`，保持 SQLite/WAL 格式。Sharp 使用平台预编译模块。解码资源在安装依赖时从固定版本的 Three.js 复制到本地，运行时无需 CDN。

## 皮肤与 UI 素材

```sh
pnpm ui:dev        # 独立组件展示页
pnpm ui:test       # 组件交互与动效验证
pnpm ui:export     # PNG / SVG、状态图集、离线展示整包
pnpm skins:check   # 客户端皮肤闭环验证
pnpm skins:export  # 原生 Electron 导出三套皮肤素材与协议索引
```

设置中的「外观与皮肤」支持全局切换与皮肤安装，素材库的「界面皮肤」支持按槽位组装。Skin Protocol v1 仅接受本地图片与声明式配置。示例包：[漫画](docs/skins/comic.awskin)、[清爽](docs/skins/fresh.awskin)、[纸感](docs/skins/paper.awskin)、[图集绑定示例](docs/skins/example-fresh.awskin)。协议、槽位索引、IPC 与导出格式见 [皮肤协议与使用说明](docs/皮肤协议与使用说明.md)。

PNG、离线网页和 ZIP 整包是生成产物，运行导出命令后位于 `docs/ui-kit` 和 `docs/skins`；源码库保留组件源码、原创 SVG、示例皮肤包及说明。

## 示例素材与 Godot 工程

```sh
pnpm samples       # 下载许可明确的免费示例，首次需要联网
pnpm demos         # 从已安装素材生成 2D / 3D Godot 工程
```

详情见 [Godot 示例](examples/README.md)。素材许可证与源码许可证独立；每件导出素材保留来源和许可记录。压力测试 `pnpm benchmark` 会生成十万文件，普通测试默认跳过。

## 文档

| 内容 | 文档 |
| --- | --- |
| 导入、搜索、项目、导出、备份 | [用户操作说明](docs/用户操作说明.md) |
| 支持格式与当前边界 | [格式支持与限制](docs/格式支持与限制.md) |
| 服务、存储、IPC 与清单 | [技术实现说明](docs/技术实现说明.md) |
| AI 服务接入与生成 | [AI 生成操作说明](docs/AI生成操作说明.md) |
| 图像加工与结果整理 | [加工工具](docs/图像加工操作说明.md)、[保存与整理](docs/加工结果保存与整理.md) |
| 同类素材与固定模板版本 | [同类素材流程](docs/同类素材制作流程.md) |
| 皮肤协议、槽位与组包 | [皮肤系统](docs/皮肤协议与使用说明.md) |
| 验收与已知限制 | [验收记录](docs/验收记录.md)、[皮肤验收](docs/skins/验收记录.md) |
| 贡献与源码许可 | [贡献指南](CONTRIBUTING.md)、[MIT](LICENSE) |

文档中的历史测试结果仅代表记录时的运行环境；本机路径已作公开化处理。当前边界以格式说明与客户端能力提示为准。

## 许可

OmO 源码、原创 UI 控件和装饰采用 **MIT** 许可证。第三方依赖见 [许可清单](resources/THIRD-PARTY-LICENSES.json) 与 [说明](resources/THIRD-PARTY-NOTICES.txt)。回归素材和示例素材依各自来源许可证使用，原始许可记录予以保留。
