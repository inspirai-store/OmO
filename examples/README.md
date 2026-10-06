# Godot 示例

`godot-2d` 和 `godot-3d` 保留示例场景与脚本。素材导出目录 `assets/workshop` 是本地生成产物，不随源码提交。

在项目根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm samples
pnpm demos
```

`pnpm samples` 按素材来源的当前可用性下载示例并记录许可证，`pnpm demos` 根据已安装素材重新生成场景和资源引用。运行成功后，用 Godot 4 打开对应的 `project.godot`。

免费素材需要联网下载一次。之后素材浏览、加工和游戏工程预览可离线使用。每件导出素材的来源与许可位于 `assets/workshop` 下的 `licenses` 目录；这些素材的许可独立于 OmO 源码的 MIT 许可。
