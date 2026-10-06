# 参与素材工坊 / OmO

欢迎通过 Issue 提交问题、功能需求，通过 Pull Request 改进代码和中文文档。

## 本地开发

使用 Node.js 24.19.0 或更新版本、pnpm 11.25.0：

```sh
git clone https://github.com/alexxxiong/OmO.git
cd OmO
pnpm install --frozen-lockfile
pnpm dev
```

提交前运行 `pnpm build` 和 `pnpm test`。修改桌面交互时运行 `pnpm test:e2e`；修改皮肤或组件库时运行 `pnpm skins:check` 或 `pnpm ui:test`。Linux 桌面测试可使用 `xvfb-run --auto-servernum pnpm test:e2e`。

请围绕一个具体问题提交改动，说明触发方式、修改后行为和实际验证结果。保留原生控件属性、键盘行为、受控状态和既有 IPC 兼容性。修改导入、导出、数据库或皮肤协议时补充对应的回归验证。

## 源码与本地数据

- `src/main`：Electron 窗口、IPC、原生文件操作与皮肤导出。
- `src/core`：素材目录、导入导出、制作与加工服务。
- `src/shared`：共享类型、数据协议与校验。
- `src/renderer`：React 客户端、查看器、皮肤及 UI 组件库。
- `tests`：单元测试、桌面测试与许可明确的回归素材。
- `scripts`：构建、示例生成与验收工具。

素材库、用户偏好、API 密钥、生成历史、安装包和本地测试产物不提交到源码库。免费素材、Godot 示例导出和 UI PNG 可通过 README 中的命令重新生成。第三方文件需保留原许可证和来源记录。

贡献的代码使用项目的 MIT 许可证；引用其他许可证的资源请在相应目录标明。
