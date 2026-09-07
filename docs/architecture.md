# 架构与数据边界

`renderer → preload → 主进程业务白名单 → 应用服务 → 文件 / SQLite / Codex`。

- Electron 开启 context isolation、sandbox，关闭 nodeIntegration。IPC 检查主窗口 / 主框架来源并验证输入。
- 文案、身份、素材登记使用 Markdown / JSON；发布任务、回执、AI 运行和会话映射使用 SQLite。项目之间的服务调用显式带 projectId。
- 写入正文前保存操作日志，临时文件原子替换；重启重放未完成日志。旧文案保留在 history，baseRevision / baseHash 防止静默覆盖。
- 媒体 URL 仅接受 projectId + assetId，服务器解析登记路径，拒绝目录穿越与符号链接越界。视频通过流式 Range 读取，不整片放进内存。
- 导入按文件流式计算 SHA-256。复制完成并校验后才登记；同项目相同哈希复用。跨项目不自动共享素材 ID。
- 发布前检查版本、目标归属与文件哈希，再复制快照。每目标独立任务。人工记录必须包含操作者、时间、结果和已发送段落。
- 日历只管理人工截止时间，未实现自动发送队列。关机不发送，恢复备份不补发。
- Codex 基于匹配 CLI 的生成协议，通过 stdio JSON 行请求和通知连接；同一主题复用 thread，任务全局串行。身份、素材、baseRevision 固定在 AiRun 输入清单。
- Codex 会话采用 `danger-full-access` 与 `approvalPolicy: never`，每次新建 / 恢复线程核对实际权限，每轮显式传入完全访问策略。执行任务直接操作本机文件并返回自然语言；起草版本保留结构化提案写回和并发冲突校验。两种模式采用独立会话键，旧只读会话不再复用。cwd 是默认目录，不构成文件访问边界，见 [完全访问说明](codex-full-access.md)。

## 项目目录

```text
profile/{identity,facts,voice}.md
assets/{images,videos}/
content/<contentId>/brief.md
content/<contentId>/variants/<variantId>.md
content/<contentId>/manifest.json
exports/<jobId>/
.content-workspace/
  project.json
  accounts.json
  targets.json
  assets.json
  state.sqlite
  writer.lock
  journal/
  history/
  snapshots/<snapshotId>/
  ai-runs/<runId>/
```

采用单写入进程锁。普通文件夹内现有文件不覆盖。备份使用 SQLite checkpoint 后的一致副本，恢复到空目录后暂停未完成任务。此版本不提供多人同时编辑、云同步和视频转码。

接口根据 [Electron protocol](https://www.electronjs.org/docs/latest/api/protocol) 与 [Codex App Server](https://learn.chatgpt.com/docs/app-server) 设计，实际协议字段以本机 0.153.3 生成类型和真实握手结果为准。
