import path from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { WorkspaceService } from "../src/services/workspace";
import { CodexService } from "../src/services/codex/service";
const root = path.resolve(".local/codex-verification");
mkdirSync(root, { recursive: true });
const workspace = new WorkspaceService(path.join(root, "app-data"));
const service = new CodexService(workspace, (e) => {
  if (["run-status", "codex-activity"].includes(e.type))
    console.log(JSON.stringify(e));
});
const results: unknown[] = [];
try {
  const status = await service.connect();
  console.log(JSON.stringify(status));
  if (status.state !== "ready") throw new Error(status.message);
  for (const identity of ["brand", "founder"] as const) {
    const directory = path.join(root, identity);
    mkdirSync(directory, { recursive: true });
    let w = await workspace.open(directory);
    w = workspace.updateProfile(w.project.id, {
      name: identity === "brand" ? "演示官号" : "演示创始人",
      identityType: identity,
      timezone: "Asia/Shanghai",
      identity:
        identity === "brand"
          ? "这是隔离测试官号，使用我们。"
          : "这是隔离测试创始人，用我表达个人观察。",
      facts:
        "这是一条演示：团队完成了本地内容工作台的素材导入测试。没有用户数据，不提供虚构指标。",
      voice:
        identity === "brand"
          ? "克制、清晰、团队视角。"
          : "自然、第一人称、表达个人观察，不虚构经历。",
      baseRevision: w.project.revision,
    });
    const c = workspace.createContent(w.project.id, "内容工作台演示");
    const withVariant = workspace.addVariant(
      w.project.id,
      c.id,
      "wechat",
      "zh-CN",
    );
    for (let turn = 0; turn < 2; turn++) {
      const run = service.start({
        projectId: w.project.id,
        contentId: c.id,
        variantId: withVariant.variants[0].id,
        prompt:
          turn === 0
            ? "根据已确认事实，为当前身份写一段约 60 字的群消息。不使用任何工具。"
            : "延续上一轮，把文案缩短到 40 字以内，保持当前身份视角。不使用任何工具。",
      });
      const start = Date.now();
      while (Date.now() - start < 180000) {
        await new Promise((r) => setTimeout(r, 1000));
        const done = workspace
          .load(w.project.id)
          .runs.find((r) => r.id === run.id)!;
        if (!["queued", "running", "stopping"].includes(done.status)) {
          results.push({
            identity,
            turn: turn + 1,
            status: done.status,
            threadId: done.threadId,
            output: done.output,
            error: done.error,
          });
          console.log(JSON.stringify(results.at(-1)));
          if (done.status !== "applied")
            throw new Error(done.error ?? done.status);
          break;
        }
      }
      if (service.active) throw new Error("Real generation timed out");
    }
  }
  writeFileSync(
    path.join(root, "result.json"),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        version: status.version,
        modelCount: status.models.length,
        results,
      },
      null,
      2,
    ),
  );
} finally {
  service.close();
  workspace.closeAll();
}
