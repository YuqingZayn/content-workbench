import path from "node:path";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { WorkspaceService } from "../src/services/workspace";
import { CodexService } from "../src/services/codex/service";
const base = path.resolve(".local/project-chat-verification");
mkdirSync(base, { recursive: true });
const root = mkdtempSync(path.join(base, "run-"));
const projectRoot = path.join(root, "project");
mkdirSync(projectRoot);
const workspace = new WorkspaceService(path.join(root, "app-data"));
const service = new CodexService(workspace, () => {});
try {
  const w = await workspace.open(projectRoot);
  const status = await service.connect();
  if (status.state !== "ready") throw new Error(status.message);
  const model = status.models.find((m) => m.id === status.defaultModel);
  const reasoningEffort = model?.supportedReasoningEfforts?.some(
    (e) => e.reasoningEffort === "low",
  )
    ? "low"
    : undefined;
  const results: { status: string; threadId?: string; output: string }[] = [];
  for (const page of ["dashboard", "assets"] as const) {
    const run = service.start({
      projectId: w.project.id,
      view: { page },
      reasoningEffort,
      prompt:
        page === "dashboard"
          ? "这是隔离的项目聊天测试，没有任何内容主题。请记住测试选题为‘雨后散步’，仅回答‘已记住选题：雨后散步’。不要调用工具，不要改文件。"
          : "这是同一项目切换到素材页面后的第二轮。请只用一句话说出上一轮的测试选题。不要调用工具，不要改文件。",
    });
    const deadline = Date.now() + 180000;
    while (
      ["queued", "running", "stopping"].includes(run.status) &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 500));
    if (run.status !== "completed")
      throw new Error(run.error ?? `Unexpected run state: ${run.status}`);
    if (!run.output.includes("雨后散步"))
      throw new Error("Conversation continuity check failed");
    results.push({
      status: run.status,
      threadId: run.threadId,
      output: run.output,
    });
    console.log(
      JSON.stringify({
        page,
        status: run.status,
        scope: run.contentId ?? "project",
      }),
    );
  }
  if (results[0].threadId !== results[1].threadId)
    throw new Error("Thread changed across pages");
  if (workspace.load(w.project.id).contents.length !== 0)
    throw new Error("Unexpected topic created");
  const result = {
    verifiedAt: new Date().toISOString(),
    cliVersion: status.version,
    sameThread: true,
    contentCount: 0,
    results,
  };
  writeFileSync(
    path.join(root, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(
    JSON.stringify({
      verified: true,
      sameThread: true,
      contentCount: 0,
      result: path.join(root, "result.json"),
    }),
  );
} finally {
  service.close();
  workspace.closeAll();
}
