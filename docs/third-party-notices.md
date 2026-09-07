# 依赖与来源

业务实现为本工程独立编写。原始研究提供设计参考，没有直接复制 AiToEarn、Postiz、Pendpost、Mixpost 等第三方实现代码。

- Electron：MIT。安装与便携构建使用 Electron 官方发布的 Chromium / Node 运行时，运行时自己的 LICENSE 与第三方声明随分发保留。
- React / React DOM：MIT。
- Zod：MIT。
- Lucide 图标：ISC。
- Sharp 0.35.4：Apache-2.0；其原生包随附 libvips 及其他组件的许可声明，分发时保留依赖内 LICENSE。libvips 源码与许可见 [libvips/libvips](https://github.com/libvips/libvips)。
- TypeScript、Playwright：Apache-2.0；Vite、esbuild 等构建工具分别遵循包内声明。
- `src/services/codex/generated/` 由已安装 Codex CLI 0.153.3 的 `app-server generate-ts` 生成，用于协议类型约束，未包含登录信息或用户会话。
- SQLite 使用 Node 内置 `node:sqlite`，避免额外原生模块 ABI 安装。Node 22.18 会显示实验性 API 提示，运行目标 Electron 已实测后在验收文档记录。
- 测试图片、视频由本工程生成，无真实用户素材。FFmpeg 仅用于开发时生成 testsrc2 / sine 夹具，未作为应用依赖或分发运行时。

精确依赖版本在 `package-lock.json`。公开仓库目前未为本工程代码授予额外开源许可证。
