import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkspaceService } from "../src/services/workspace";
import { CodexService } from "../src/services/codex/service";
import type { CodexConnection } from "../src/services/codex/connection";
import type { AiRun } from "../src/contracts/model";
import { uuid } from "../src/services/files";

test("project conversations start before content, resume across stages and restart, and isolate project/content/account scopes", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "workbench-project-chat-"));
  const root = path.join(base, "project");
  const otherRoot = path.join(base, "other-project");
  const appData = path.join(base, "app-data");
  mkdirSync(root);
  mkdirSync(otherRoot);
  let workspace = new WorkspaceService(appData);
  let w = await workspace.open(root);
  const other = await workspace.open(otherRoot);
  workspace.updateProfile(other.project.id, {
    name: "Other",
    identityType: "brand",
    timezone: "Asia/Shanghai",
    identity: "OTHER_PROJECT_PRIVATE_FACT",
    facts: "",
    voice: "",
    baseRevision: other.project.revision,
  });
  const foreign = workspace.createContent(
    other.project.id,
    "Other private topic",
  );
  const requests: { method: string; params: any }[] = [];
  const createService = () => {
    const service = new CodexService(workspace, () => {});
    service.status = {
      state: "ready",
      message: "simulation",
      version: "fixture",
      account: { type: "chatgpt", email: "first@example.test" },
      models: [],
    };
    service.connection = {
      request: async (method: string, params: any) => {
        requests.push({ method, params });
        return method.startsWith("thread/")
          ? {
              thread: { id: params.threadId ?? uuid() },
              sandbox: { type: "dangerFullAccess" },
              approvalPolicy: "never",
            }
          : { turn: { id: uuid() } };
      },
      close() {},
    } as unknown as CodexConnection;
    return service;
  };
  let service = createService();
  const started = async (run: AiRun) => {
    for (let i = 0; i < 40 && !run.turnId; i++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.ok(run.turnId, run.error);
  };
  const finish = async (run: AiRun) => {
    await started(run);
    await service.onNotification({
      method: "item/agentMessage/delta",
      params: {
        threadId: run.threadId,
        turnId: run.turnId,
        delta: "可以先讨论选题。",
      },
    });
    await service.onNotification({
      method: "turn/completed",
      params: {
        threadId: run.threadId,
        turn: { id: run.turnId, status: "completed" },
      },
    });
    assert.equal(run.status, "completed");
  };
  try {
    assert.equal(w.contents.length, 0);
    const first = service.start({
      projectId: w.project.id,
      prompt: "帮我找选题",
      view: { page: "dashboard" },
    });
    await finish(first);
    assert.equal(first.contentId, undefined);
    assert.equal(first.mode, "task");
    assert.equal(requests.at(-1)!.params.outputSchema, undefined);
    assert.equal(workspace.load(w.project.id).contents.length, 0);
    const context = JSON.parse(
      readFileSync(
        path.join(root, `.content-workspace/ai-runs/${first.id}/input.json`),
        "utf8",
      ),
    );
    assert.equal(context.conversationScope, "project");
    assert.equal(context.view.page, "dashboard");
    assert.deepEqual(context.overview.totals, {
      contents: 0,
      assets: 0,
      jobs: 0,
    });
    assert.equal(
      JSON.stringify(context).includes("OTHER_PROJECT_PRIVATE_FACT"),
      false,
    );
    assert.throws(
      () =>
        service.start({
          projectId: w.project.id,
          prompt: "draft",
          mode: "draft",
        }),
      { code: "VARIANT_UNKNOWN" },
    );
    assert.throws(
      () =>
        service.start({
          projectId: w.project.id,
          prompt: "foreign",
          contentId: foreign.id,
        }),
      { code: "ENOENT" },
    );
    assert.throws(
      () =>
        service.start({
          projectId: w.project.id,
          prompt: "foreign",
          view: { page: "editor", contentId: foreign.id },
        }),
      { code: "ENOENT" },
    );
    const second = service.start({
      projectId: w.project.id,
      prompt: "再看素材",
      view: { page: "assets" },
    });
    await finish(second);
    assert.equal(first.threadId, second.threadId);
    assert.equal(requests.at(-2)!.method, "thread/resume");
    const content = workspace.createContent(w.project.id, "采用的选题");
    const topic = service.start({
      projectId: w.project.id,
      contentId: content.id,
      mode: "task",
      prompt: "围绕此主题讨论",
    });
    await finish(topic);
    assert.notEqual(topic.threadId, first.threadId);
    const otherRun = service.start({
      projectId: other.project.id,
      prompt: "另一项目",
    });
    await finish(otherRun);
    assert.notEqual(otherRun.threadId, first.threadId);
    service.close();
    workspace.closeAll();
    workspace = new WorkspaceService(appData);
    w = await workspace.open(root);
    service = createService();
    assert.equal(w.runs.filter((r) => !r.contentId).length, 2);
    assert.equal(
      w.runs.find((r) => r.id === first.id)?.output,
      "可以先讨论选题。",
    );
    const resumed = service.start({
      projectId: w.project.id,
      prompt: "回到主页继续",
      view: { page: "editor", contentId: content.id },
    });
    await finish(resumed);
    assert.equal(resumed.threadId, first.threadId);
    const resumedContext = JSON.parse(
      readFileSync(
        path.join(root, `.content-workspace/ai-runs/${resumed.id}/input.json`),
        "utf8",
      ),
    );
    assert.equal(resumedContext.viewingContent.id, content.id);
    assert.equal(resumedContext.overview.contents[0].title, "采用的选题");
    service.status.account = {
      type: "chatgpt",
      email: "switched@example.test",
    };
    const switched = service.start({
      projectId: w.project.id,
      prompt: "换号后讨论",
    });
    await finish(switched);
    assert.notEqual(switched.threadId, first.threadId);
    const stopped = service.start({
      projectId: w.project.id,
      prompt: "停止任务",
    });
    await started(stopped);
    await service.stop(w.project.id, stopped.id);
    assert.equal(requests.at(-1)!.method, "turn/interrupt");
    await service.onNotification({
      method: "turn/completed",
      params: {
        threadId: stopped.threadId,
        turn: { id: stopped.turnId, status: "interrupted" },
      },
    });
    assert.equal(stopped.status, "cancelled");
    workspace.context(w.project.id).project.readOnly = true;
    assert.throws(
      () => service.start({ projectId: w.project.id, prompt: "read-only" }),
      { code: "PROJECT_READ_ONLY" },
    );
  } finally {
    service.close();
    workspace.closeAll();
  }
});
