import assert from "node:assert/strict";
import path from "node:path";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { WorkspaceService } from "../src/services/workspace";
import { CodexService } from "../src/services/codex/service";
import { uuid } from "../src/services/files";

const parent = path.resolve(".local/codex-full-access");
mkdirSync(parent, { recursive: true });
const base = mkdtempSync(path.join(parent, "run-"));
const root = path.join(base, "project");
mkdirSync(root);
const inside = path.join(root, "inside.txt");
const outside = path.join(base, "outside.txt");
writeFileSync(inside, "before");
writeFileSync(outside, "before");
const workspace = new WorkspaceService(path.join(base, "app-data"));
const service = new CodexService(workspace, (event) => {
  if (event.type === "codex-activity") console.log(event.message);
});
try {
  const status = await service.connect();
  assert.equal(status.state, "ready", status.message);
  const w = await workspace.open(root);
  const content = workspace.createContent(w.project.id, "Full Access 隔离验收");
  let thread: string | undefined;
  for (let turn = 1; turn <= 2; turn++) {
    const marker = `full-access-${turn}-${uuid()}`;
    const run = service.start({
      projectId: w.project.id,
      contentId: content.id,
      mode: "task",
      prompt: `这是已授权的本地文件写入验收。请直接使用工具，把以下两个现有文件的全部内容改为 ${marker}（无换行）：${JSON.stringify([inside, outside])}。第二个文件在当前项目目录之外，同样是本次创建的测试文件。读回核对后简短回复完成。仅操作这两个文件；不修改其他文件，不搜索网络，不安装依赖。`,
    });
    const deadline = Date.now() + 180000;
    while (
      ["queued", "running", "stopping"].includes(run.status) &&
      Date.now() < deadline
    )
      await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(
      run.status,
      "completed",
      run.error ?? `task ended as ${run.status}`,
    );
    assert.equal(run.access, "full-access");
    assert.equal(
      readFileSync(inside, "utf8")
        .replace(/^\uFEFF/, "")
        .trim(),
      marker,
    );
    assert.equal(
      readFileSync(outside, "utf8")
        .replace(/^\uFEFF/, "")
        .trim(),
      marker,
    );
    if (thread)
      assert.equal(
        run.threadId,
        thread,
        "follow-up should resume the same Full Access thread",
      );
    thread = run.threadId;
    console.log(
      JSON.stringify({
        turn,
        status: run.status,
        access: run.access,
        insideProjectWrite: true,
        outsideProjectWrite: true,
      }),
    );
  }
  writeFileSync(
    path.join(base, "verification.json"),
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        version: status.version,
        turns: 2,
        insideProjectWrite: true,
        outsideProjectWrite: true,
      },
      null,
      2,
    ),
  );
} finally {
  service.close();
  workspace.closeAll();
}
