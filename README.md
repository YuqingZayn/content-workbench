# 内容工作台 · Content Workbench

本地优先的 Windows 内容工作台：按运营身份管理文件夹、图片视频和平台版本，连接本机 Codex，完成文案准备、排期、发布包与结果记录。

当前为 **V0.2.1 开发版，dev 分支**。本地与模拟验收已完成；Discord、X、Instagram 专业账号、Facebook Page 的图文适配器已实现，真实平台发送尚未验收。本次不生成安装包。其他平台继续辅助发布。

## 怎么启动软件

需要 Windows x64、Node.js 22.18 或更高版本、npm。在此 README 所在的 `content-workbench` 目录打开 PowerShell：

```powershell
git switch dev
npm ci
npm run dev
```

`npm ci` 只在首次安装或依赖锁变化后需要执行。以后启动只需：

```powershell
npm run dev
```

本机完整命令：

```powershell
Set-Location 'E:\20260416词元开物\20260907内容工作台\content-workbench'
npm run dev
```

也可以双击上一级的 **`启动内容工作台.cmd`**，它会自动进入源码目录并运行同一命令。脚本是本机交付文件，不包含在 GitHub 源码 ZIP 中。

启动后会编译代码、开启 Vite 服务并打开 Electron 软件窗口，同时连接本机 Codex CLI。保留终端窗口；完整功能在 Electron 中使用。默认端口 5173 被占用时自动改用空闲端口。重复启动会唤起已有开发窗口。

**升级后先保存草稿、退出旧窗口，再启动。** 开发主进程不会因源码改变自动重启。看到左下角 `v0.2 · DEV` 表示当前界面版本，但仍应按上述方式重启主进程。开发临时文件放在忽略的 `.local/runtime-temp/` 中。

“设置与备份 → 后台发布项目 → 隐藏到托盘，继续处理”可保留软件运行。完全退出应用会结束开发服务并停止本地排期；电脑睡眠或关机时不会发送。之前 `release/0.1.1/` 中的安装版是旧版本，不包含 V0.2 更新。

| 启动问题 | 处理方法 |
|---|---|
| 找不到 npm | 安装 Node.js 和 npm，重新打开终端 |
| 找不到 package.json | 进入 `content-workbench` 源码目录再运行 |
| 找不到 Electron / Vite | 在源码目录执行 `npm ci` |
| 重复启动没有新窗口 | 已有实例会被唤起；更新主进程需要先退出旧实例 |
| Codex 未连接 / 换号后 token 失效 | 在软件设置中查看登录状态，登录或刷新连接；必要时选择 codex.exe |

## 打开后怎么用

1. 点击“打开本地文件夹”，选择自己的运营资料目录；一个身份对应一个文件夹。不要把源码目录当日常业务项目。
2. 在“账号与定位”填写身份、平台账号与目标；平台可新增或编辑，包含微信公众号。
3. 导入素材，新建内容主题，添加平台 / 语言版本。不同平台使用对应编辑界面，默认浅色主题。
4. 保存草稿并标记就绪，安排辅助发布、导出固定文案与有序媒体，在平台操作后人工回填。
5. 体验 V0.2 时，在“自动发布连接”创建专用模拟目标、保存并检查连接，再安排“本地模拟”。不需要任何凭据，也不会发送到外部平台。

[完整 V0.2 操作、连接配置和故障恢复](docs/v0.2-publishing.md) · [平台编辑界面与外观](docs/platform-editors.md)

## 小红书怎么登录

进入 **账号与定位 → 网页登录**，选择小红书账号，点击 **登录小红书**。没有账号时可直接“添加账号并登录小红书”。官方窗口默认显示短信登录，右上角二维码图标可切换扫码。每个项目账号独立保存会话；换号前点击“退出本机登录”。当前支持网页登录与状态检查，小红书自动发布尚未接入。

[小红书登录、会话保存与换号说明](docs/xiaohongshu-login.md)

## Codex 与私密文件

本机需安装并登录 Codex CLI。软件中可查看登录状态、打开登录页面、换号后重新连接；右侧聊天按 Enter 发送，Shift+Enter 换行，可选择模型与思考强度。

内置 Codex 使用 Full Access，可操作当前 Windows 账号可访问的本机文件、运行命令和联网。执行任务与起草版本分开处理；权限与验证方式见 [Codex 完全访问](docs/codex-full-access.md)。手动编辑、素材管理和本地模拟不依赖 Codex 登录。

手工保管的密钥与业务备份放在 **`local-private/`**（Git 忽略），完整清单见 [私密文件与 Git 忽略规则](docs/local-private-files.md)。软件录入的平台凭据使用系统加密，位于应用用户数据目录，不进项目快照、发布包或业务备份；不要复制 Codex 登录凭据到仓库。

## 本地检查

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run test:publishing
npm run test:media
npm run test:e2e
```

默认测试使用合成数据和模拟响应，不发送社交平台内容。`npm run build` 只编译源码，不生成安装包。`dev` 分支的 CI 不打包；`npm run dist:win` 是单独的安装包命令，本次无需执行。真实 Codex 验证脚本会使用账号额度，需要有意执行。

## 实现与验收

- [V0.2 进度与验收](docs/v0.2-progress.md)
- [实际平台能力](docs/platform-capabilities.md)
- [任务进度](docs/roadmap.md)
- [完整验证记录](docs/verification.md)
- [架构与数据边界](docs/architecture.md)
- [图片性能优化](docs/image-performance.md)
- [原始产品与任务文档](docs/specs/)
- [依赖与来源](docs/third-party-notices.md)

Electron + React + TypeScript + SQLite；业务内容采用普通 Markdown / JSON 文件。本仓库管理应用源码，不保存真实运营素材和凭据。公开仓库：[YuqingZayn/content-workbench](https://github.com/YuqingZayn/content-workbench)，当前未授予额外开源许可。
