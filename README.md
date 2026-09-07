# 内容工作台 · Content Workbench

一个本地优先的 Windows 桌面内容工作台：按品牌官号、创始人 IP 分项目，管理图片和视频，用本机 Codex 起草平台版本，再完成排期、发布包导出和人工结果记录。

Electron 44 + React 19 + TypeScript + SQLite。业务项目是普通文件夹，不要求 Git，也不搬走原素材。此仓库管理应用源码，不保存运营账号凭据或真实业务数据。

![桌面工作台演示](docs/screenshots/dashboard.png)

## 运行

需要 Node.js 22.18 或更高版本、Windows 10/11 x64。首次运行会下载 Electron 运行时。

```powershell
npm ci
npm run dev
```

连接 AI 时，先在本机安装并登录 Codex CLI，或在设置中选择 `codex.exe`。手动编辑、素材管理和辅助发布不依赖 Codex 登录。当前协议验证基于 CLI 0.153.3；不读取 Codex 内部数据库或复制登录凭据。

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run test:e2e
npm run dist:win
```

`release/` 输出安装版和便携版；默认测试不会发送社交平台内容。`npm run verify:codex` 会使用本机已登录的 Codex 运行真实演示生成，需要单独显式执行，结果保存在忽略的 `.local/` 中。

## 第一个闭环

1. 打开两个本地文件夹，分别设置官号和创始人身份资料。
2. 导入图片和 MP4，支持复制、外部引用、重复识别、视频拖动、关键帧和裁剪副本。
3. 创建内容主题，添加独立的平台 / 语言版本，编辑或让 Codex 按当前身份起草。
4. 保存并标记就绪，选择账号和群 / 频道等目标，安排人工截止时间。
5. 每个目标独立导出固定文案和有序媒体，再回填实际发送人、时间、结果和已发送段落。
6. 重启后保持项目、草稿、媒体顺序和逐目标状态。恢复备份后，未完成任务默认暂停。

九个平台：X、Discord、YouTube、Facebook、B站、抖音、小红书、Instagram、微信群。当前均为辅助发布；没有伪装成自动发布的操作。实际平台发送由用户执行。

## 文档

- [使用指南](docs/user-guide.md)
- [实现与验证记录](docs/verification.md)
- [实际平台能力](docs/platform-capabilities.md)
- [架构与数据边界](docs/architecture.md)
- [任务进度与后续工作](docs/roadmap.md)
- [依赖与来源](docs/third-party-notices.md)

业务文件以 UTF-8 Markdown / JSON 保存，SQLite 保存任务、回执和会话映射。打开源码目录作为业务项目之前请确认用途；日常运营应使用单独的文件夹。

本仓库公开可见，当前未授予额外开源许可。
