# GitHub 同类项目研究与设计取舍

研究日期：2026-09-07。目标：为“以官号／创始人 IP 分项目、打开本地文件夹、图片与视频预览、连接本地 Codex、多平台发布”的桌面工作台寻找可参考实现。

方法：使用 Exa、GitHub 搜索与 GitHub API，读取仓库 README、目录树、默认分支提交、许可证标识，并抽查 12 个代码／接口文件。未安装或运行第三方应用，未连接社交账号，未验证真实发布成功率。下文区分仓库声明、代码观察和本项目的设计建议。

## 1. 推荐结论

目前检查的仓库中，没有一个已经验证能完整覆盖我们的全部要求。建议保留本地桌面主架构，按模块借鉴：

- **AiToEarn**：账号分组、国内外渠道编排、Electron 媒体工具链。
- **Postiz**：平台接入接口、发布回执、异步处理及编辑预览。
- **Pendpost**：本地内容文件、媒体流式预览、AI 工具接口与排期类型。
- **social-auto-upload／auto-upload**：国内平台字段、账号状态检查、发布前预演与失败处理。
- **Codex WebUI／codex-desktop**：本地目录选择、会话归属、流式任务与附件交互。
- **Mixpost**：按账号切换预览、媒体复用与发布日历的组织方式。

这些参考会落实为具体任务，而不是直接把某个大型系统整体搬进桌面应用。接口存在、README 标注支持和用户账号真正可发布是三件不同的事。

## 2. 仓库快照

Star 为查询时快照；提交日期取默认分支最后一次提交的 UTC 日期，不使用仓库 updated_at 推断代码更新。许可证列记录 GitHub 识别结果，不代表完成了所有文件和依赖的复用审查。

| 项目 | Star | 默认分支最后提交 | 许可证标识 | 适合参考的部分 |
|---|---:|---|---|---|
| [Postiz](https://github.com/gitroomhq/postiz-app) | 35,538 | 2026-09-03 | AGPL-3.0 | 发布接口、异步状态、预览、排期 |
| [AiToEarn](https://github.com/yikart/AiToEarn) | 25,747 | 2026-08-15 | MIT | 账号组、国内外平台、桌面媒体工具链 |
| [social-auto-upload](https://github.com/dreammis/social-auto-upload) | 14,806 | 2026-09-02 | MIT | 国内平台上传器、CLI 参数、图文与视频差异 |
| [Mixpost](https://github.com/inovector/mixpost) | 3,668 | 2026-03-16 | MIT | 账号预览、素材复用；公开仓库为 Lite |
| [auto-upload](https://github.com/s840207702/auto-upload) | 15 | 2026-05-17 | Apache-2.0 | 本地发布中心、账号检测、封面与平台表单 |
| [Codex WebUI](https://github.com/lezi-fun/codex-webui) | 12 | 2026-08-14 | MIT | app-server、目录上下文、流式界面 |
| [Pendpost](https://github.com/pendpost/pendpost) | 7 | 2026-09-05 | MIT | 本地媒体、AI 操作接口、多客户内容上下文 |
| [codex-desktop](https://github.com/dfones288/codex-desktop) | 6 | 2026-07-07 | 未识别，目录树未见 LICENSE | Electron、项目会话与附件交互 |

以上八个仓库查询时均未归档。小型仓库的设计可能很贴题，但不据此推断其运行稳定性；高 Star 项目也需要按实际部署和账号条件验证。

## 3. AiToEarn：优先参考账号组织与桌面素材能力

**已观察到的依据：** README 描述国内外平台分发、内容草稿和日历功能；当前仓库包含 `project/aitoearn-electron`。桌面端 package.json 列有 Electron 打包、SQLite、FFmpeg／ffprobe 及裁剪相关依赖。账号组模型包含名称和排序；服务端账号组服务处理组归属、账号排序和删除组后的账号归位。

代码入口：

- [桌面端 package.json](https://github.com/yikart/AiToEarn/blob/d3aa8bea5b146a8675607cf0144d891aad3e9683/project/aitoearn-electron/package.json)
- [桌面账号组模型](https://github.com/yikart/AiToEarn/blob/d3aa8bea5b146a8675607cf0144d891aad3e9683/project/aitoearn-electron/electron/db/models/accountGroup.ts)
- [账号组服务](https://github.com/yikart/AiToEarn/blob/d3aa8bea5b146a8675607cf0144d891aad3e9683/project/aitoearn-backend/apps/aitoearn-server/src/core/channels/accounts/account-group.service.ts)

**我们的采纳方式：** 顶层用“官号／创始人 IP 项目”，内部用可排序的平台账号与发布目标；媒体检测、封面裁剪、视频预览放进本地媒体模块。账号组只提供组织思路，项目身份、独立语气和文件夹归属仍需自己设计。

**边界：** 仓库同时包含 Web、后端和 Electron，完整系统的 MongoDB／Redis／Relay 等依赖不能被描述成纯离线桌面工具。README 中的 Server Relay 与 AI Relay 是项目提供的服务路径，本地 Codex 集成不能默认依赖它们。旧的 `yikart/AttAiToEarn` 地址在本次 API 请求中重定向到 AiToEarn，后续阅读应使用当前单仓目录。

## 4. Postiz：优先参考平台接口与异步回执

**代码观察：** `SocialProvider` 将授权、令牌刷新、内容检查、发布、状态查询和最终提交组织为接口；发布结果包含平台内容 ID、URL 与中间状态。接口注释明确讨论“最终提交结果不明后不能重复发布”的恢复约束。前端通用预览组件处理正文与图片／视频展示。

代码入口：

- [平台接口](https://github.com/gitroomhq/postiz-app/blob/36d5fc7b3ac3f17178b1589cf7a7337523017a41/libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts)
- [内容预览](https://github.com/gitroomhq/postiz-app/blob/36d5fc7b3ac3f17178b1589cf7a7337523017a41/apps/frontend/src/components/launches/general.preview.component.tsx)

**我们的采纳方式：** 定义统一 PublisherAdapter，把平台差异放进接入模块；任务状态区分上传中、平台处理中、已接收、已公开和结果待核实。媒体快照、回执及独立重试在第一轮自动发布开发中一起完成。

**边界：** README 所列系统使用 Next.js、NestJS、PostgreSQL、Temporal 等组件。我们首版采用桌面应用与 SQLite 队列，借鉴接口思想，不把其服务端部署方案原样引入。具体代码复用另按许可证和依赖评估。

## 5. Pendpost：方向贴近，适合参考本地媒体与 AI 接口

**仓库声明：** 采用本地内容与状态文件，提供仪表盘及 MCP 操作入口，区分平台原生定时与需要本机持续运行的定时。

**代码观察：** `lib/media.mjs` 对本地媒体使用字节范围响应，支持视频拖动播放；媒体请求可以带所属客户 ID，以对应根目录解析。`lib/scheduler.mjs` 中存在渠道阻断、过期任务和原生排期恢复相关处理。

代码入口：

- [本地媒体服务](https://github.com/pendpost/pendpost/blob/4848ee8146cf5a5f3a2d0843c334bd37c1bda1d5/lib/media.mjs)
- [排期实现](https://github.com/pendpost/pendpost/blob/4848ee8146cf5a5f3a2d0843c334bd37c1bda1d5/lib/scheduler.mjs)

**我们的采纳方式：** 所有媒体请求显式带 projectId；本地播放器按范围读取；界面操作与未来 AI 工具共用应用服务；排期记录 `manual_due / local_queue / platform_native` 执行方式。

**边界：** 当前仅 7 Star、创建于 2026 年 6 月，未经我们运行验证。不能把已有测试文件或其“防封禁”措辞视为账号安全或可靠性的保证。其文件服务可作为流程参考，路径规范化、符号链接和 Range 边界仍需独立实现与验证。

## 6. social-auto-upload：国内平台发布细节资料库

**仓库声明与文档观察：** 当前 CLI 文档分别描述账号准备、图文上传、视频上传、封面和定时参数；抖音、小红书等有图文命令，平台功能表明确有些渠道或内容形态未支持。README 同时说明项目正在重构、部分详细文档可能落后。

入口：[当前 CLI 文档](https://github.com/dreammis/social-auto-upload/blob/0012d2c355f88f683cc38dde2a2db209e14091bc/docs/CLI.md)、[平台能力说明](https://github.com/dreammis/social-auto-upload/blob/0012d2c355f88f683cc38dde2a2db209e14091bc/README.md)。

**我们的采纳方式：** 按“平台＋内容类型”定义字段和能力，不把一个支持视频的 uploader 自动视为支持图文。账号准备、内容检查、上传和结果查询分步骤记录。国内连接可在后续单独验证为一个受控适配器。

**边界：** 多个平台使用浏览器登录态和网页交互，并非全部使用官方发布 API。页面变化、二维码登录、账号权限及媒体类型需要逐一验证；本次没有执行其上传命令。视频号不等于普通微信群。

## 7. auto-upload：本地发布中心的交互细节

**仓库声明：** 本地 Web 工作台集中管理账号、素材队列、平台封面、文案、话题和发布时间；提供发布前账号检测、停在最终发布前的调试流程、平台失败后停止该平台后续任务。README 清楚区分当前已适配能力与保留的旧平台目录。

**代码观察：** 账号选择组件按当前平台筛选账号，并将选中账号单独呈现。[账号选择组件](https://github.com/s840207702/auto-upload/blob/054f01ecc8f441f120abba4333cdc73e8f025802/frontend/src/components/publish/AccountSelection.vue)

**我们的采纳方式：** 发布页固定展示项目身份、平台账号、目标群／频道；每个平台的封面和字段独立编辑。提供“检查发布包”模式，验证媒体、字段与账号状态；预演不等于已经发布。

**边界：** 项目只有少量关注，默认分支最后提交为 2026-05-17；主要围绕国内视频与浏览器自动化，不作为全平台稳定可用的现成底座。README 里的具体封面比例只是其当时实现，不能直接写成当前平台统一规范。

## 8. Codex 客户端：参考会话交互，协议仍以官方和本机为准

### Codex WebUI

README 说明通过真实 `codex app-server --stdio` 接入，呈现会话、流式内容、工具事件和目录选择；同时明确 Windows 尚未充分测试。`workspace-context.js` 对非 Git 文件夹有正常降级路径。[仓库](https://github.com/lezi-fun/codex-webui)、[目录上下文实现](https://github.com/lezi-fun/codex-webui/blob/c19e233b02c49614d6b9febfcf433319600dc610/workspace-context.js)

采纳：目录与任务归属、真实连接状态、非 Git 项目、流式事件 UI。Windows 进程管理、协议字段和本机认证仍独立验证。

### codex-desktop

README 描述 Electron 包装本机 `codex exec --json`、项目分组、附件和历史会话。`codexExecManager.ts` 使用会话 ID 管理子进程，并以保存的 cwd 启动任务，便于理解切换界面不应改变任务目录。[仓库](https://github.com/dfones288/codex-desktop)、[进程与会话实现](https://github.com/dfones288/codex-desktop/blob/96670443404acce4ee47b58b86454726235f8ef2/src/main/codexExecManager.ts)

采纳：项目选择、图片粘贴、附件清单、运行中提示和任务归属。正式集成仍采用 app-server；不要照搬其读取内部历史文件、默认模型或旧模型查询命令。本次未识别仓库许可证，因此仅作为设计参考，不安排直接复制代码。

## 9. Mixpost：参考编辑预览，区分 Lite 与商业功能

README 将素材复用、平台版本和日历作为重要功能，但也明确此仓库为 Lite。抽查的 `PostPreviewProviders.vue` 按选中账号映射预览组件，并展示该账号错误。[预览实现](https://github.com/inovector/mixpost/blob/df57648b866310446703f5294350552b62735df5/resources/js/Components/Post/PostPreviewProviders.vue)、[版本说明](https://github.com/inovector/mixpost/blob/df57648b866310446703f5294350552b62735df5/README.md)

采纳：同一内容按账号切换预览，限制错误就近显示，避免统一文案中找不到哪个目标不满足要求。工作区和高级协作在本次仅为 README 级信息，不声称公开 Lite 代码已完整实现这些功能。

## 10. 写入实施方案的具体变化

| 设计决定 | 主要参考 | 实施结果 |
|---|---|---|
| 项目 → 平台账号 → 发布目标 | AiToEarn、auto-upload | 官号与 IP 独立；群／频道和发送身份分开 |
| 本地媒体按项目读取并支持拖动视频 | Pendpost | 媒体 URL 带项目归属；实现 Range 边界与大文件读取 |
| 独立封面、平台版本与限制提示 | Mixpost、Postiz、auto-upload | 编辑页分目标预览，阻塞项定位到具体版本 |
| 统一发布接入接口 | Postiz | 授权、校验、提交、查询、回执分别建模 |
| 任务状态区分已接收与已公开 | Postiz | 请求成功不直接当作公开发布成功 |
| 原生排期与本地排期分开 | Pendpost | 保存执行方式与平台任务 ID；明确关机后的行为 |
| 一键检查发布包 | auto-upload、social-auto-upload | 提交前检查文件、字段、能力和连接状态 |
| Codex 的项目会话与任务绑定 | 两个 Codex 客户端 | projectId／threadId／turnId 固定关联 |
| UI 与 AI 共用应用服务 | Pendpost | 后续可加 MCP；模型无需直接改 SQLite 或读取令牌 |
| 国内网页上传独立作为可选连接 | social-auto-upload | 先完成辅助发布闭环，再做隔离验证 |

首版最值得优先阅读的三个入口是 AiToEarn 的桌面账号组、Postiz 的 SocialProvider、Pendpost 的本地媒体实现；Codex 接入另读官方 app-server 和本机生成类型。

## 11. 实际代码复用前的技术验证任务

1. AiToEarn：打开桌面子项目，确认账号组、媒体功能分别依赖哪些本地／远程服务，输出依赖图；不直接引入整套后端。
2. Postiz：根据接口思想实现自有 MockAdapter，模拟 pending、成功和请求结果不明，验证任务状态机。
3. Pendpost：用自己的播放器测试大文件、视频拖动、无效 Range、跨项目路径和符号链接，参考思路并独立实现。
4. Codex：对本机 0.153.3 的生成协议做握手与只读会话验证，不能据旧客户端 README 宣称已经兼容。
5. 国内发布工具：只在明确的测试账号和测试内容范围内验证，第一步停在最终提交之前；未完成真实验证时维持辅助发布能力。

研究已收敛为模块级参考，后续执行以《01_产品与技术实施方案》和《02_开发任务与验收》为准。
