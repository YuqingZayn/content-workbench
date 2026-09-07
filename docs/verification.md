# 实现与验证记录

记录日期：2026-09-07。测试均使用隔离演示项目与自生成素材，没有向社交平台发帖。

## 已通过

- TypeScript 静态检查和 ESLint。
- 业务测试：Range 正常 / 非法边界、2GB 以上偏移、目录穿越 / junction、JSONL 半行 / 多行 / UTF-8 分片和未知事件、无效 schema / CLI 路径。
- 文件 / SQLite 集成：两个项目隔离，重复素材复用，独立草稿，三段群消息，两个逐群任务，一个部分再完成、另一个未完成；导出不标记发送；修改草稿不影响快照；外部编辑保留双方并可合并；日志重启恢复；引用丢失 / 变化 / 重连；移动项目；备份恢复后暂停。
- 真实 Codex CLI 0.153.3：initialize、account/read、model/list 返回成功（7 个模型项）；演示官号两轮、演示创始人两轮生成都通过 outputSchema 校验并保存为新草稿。同一主题两轮复用同一 threadId，两个身份各自独立 threadId。官号输出使用“我们”，创始人使用“我”。
- Electron 44.2.0 官方 Windows x64 压缩包已通过 npm 包内 SHA-256 校验：`4021363e3090d67a144ebedb90765cf193b0e61f300c519c83f0174502a481da`。

## 进行中

桌面完整流程、视频播放 / 抽帧截图、Windows 安装与便携构建。完成后更新本节，当前不将其描述为已通过。

## 可复现命令

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run test:e2e
npm run verify:codex # 显式联网生成，会使用当前 Codex 额度
npm run dist:win
```

验收夹具 `tests/fixtures/` 是纯色图片与 FFmpeg testsrc2 / sine 自生成四秒 H.264/AAC MP4。`verify:codex` 使用单独 `.local/codex-verification/` 项目，不修改全局 Codex 配置。截图、真实运行日志、应用用户数据、构建产物默认不提交仓库。

## 已知修复

- Node 22.18 在此 Windows 环境中用 `fs.cpSync` 导出中文路径发生原生进程退出；替换为逐文件校验复制后，全部集成测试通过。
- 外部正文改变后，更新历史和哈希，允许用户加载磁盘版本再合并。编辑器的保存基线固定在开始编辑的版本，不使用后台刷新后的新基线。
- 发布包通过临时目录完成后再改名，避免中断的半包被视作完整导出。备份显式包含原有目录结构里已登记的媒体。
