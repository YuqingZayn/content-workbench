import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  renameSync,
} from "node:fs";
import { WorkspaceService } from "../src/services/workspace";
import {
  hash,
  uuid,
  readJson,
  writeJson,
  journalWrite,
  recoverJournal,
  fileHash,
} from "../src/services/files";
import type { Content } from "../src/contracts/model";
import { platforms, type AiRun } from "../src/contracts/model";
import { CodexService } from "../src/services/codex/service";
import {
  defaultPublishing,
  type Publishing,
  type NativePlatform,
} from "../src/contracts/publishing";
import type { Variant } from "../src/contracts/model";
import type { CodexConnection } from "../src/services/codex/connection";

test("Full Access applies on start and resume; task output never overwrites a draft", async () => {
  const { root, workspace, w } = await setup();
  const service = new CodexService(workspace, () => {});
  const requests: { method: string; params: any }[] = [];
  const approvals: unknown[] = [];
  let effectiveSandbox = "dangerFullAccess";
  service.connection = {
    request: async (method: string, params: any) => {
      requests.push({ method, params });
      return method.startsWith("thread/")
        ? {
            thread: { id: params.threadId ?? uuid() },
            sandbox: { type: effectiveSandbox },
            approvalPolicy: "never",
          }
        : { turn: { id: uuid() } };
    },
    respond: (_id: unknown, response: unknown) => approvals.push(response),
  } as unknown as CodexConnection;
  service.status = {
    state: "ready",
    message: "test simulation",
    version: "test",
    models: [],
  };
  const finish = async (run: AiRun, output: string) => {
    // drain awaits an RPC before assigning the turn ID.
    for (let i = 0; i < 20 && !run.turnId && run.status !== "interrupted"; i++)
      await new Promise((resolve) => setImmediate(resolve));
    run.output = output;
    await service.onNotification({
      method: "turn/completed",
      params: {
        threadId: run.threadId,
        turn: { id: run.turnId, status: "completed" },
      },
    });
  };
  try {
    const content = workspace.createContent(w.project.id, "本地任务");
    const first = service.start({
      projectId: w.project.id,
      contentId: content.id,
      mode: "task",
      prompt: "修改文件",
    });
    await finish(first, "已完成指定文件修改。");
    assert.equal(first.status, "completed");
    assert.equal(first.access, "full-access");
    assert.equal(
      workspace.getContent(w.project.id, content.id).variants.length,
      0,
    );
    assert.equal(requests[0].params.sandbox, "danger-full-access");
    assert.equal(requests[0].params.approvalPolicy, "never");
    assert.deepEqual(requests[1].params.sandboxPolicy, {
      type: "dangerFullAccess",
    });
    assert.equal(requests[1].params.outputSchema, undefined);
    const second = service.start({
      projectId: w.project.id,
      contentId: content.id,
      mode: "task",
      prompt: "继续",
    });
    for (let i = 0; i < 20 && !second.turnId; i++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(requests[2].method, "thread/resume");
    assert.equal(requests[2].params.sandbox, "danger-full-access");
    assert.equal(second.threadId, first.threadId);
    const params = { threadId: second.threadId, turnId: second.turnId };
    await service.onNotification({
      id: 1,
      method: "item/commandExecution/requestApproval",
      params,
    });
    await service.onNotification({
      id: 2,
      method: "item/fileChange/requestApproval",
      params,
    });
    await service.onNotification({
      id: 3,
      method: "item/fileChange/requestApproval",
      params: { ...params, threadId: "other-thread" },
    });
    assert.deepEqual(approvals, [
      { decision: "accept" },
      { decision: "accept" },
      { decision: "decline" },
    ]);
    await finish(second, "第二轮完成。");
    let withVariant = workspace.addVariant(
      w.project.id,
      content.id,
      "wechat",
      "zh-CN",
    );
    withVariant = ready(workspace, w.project.id, withVariant, "已有的正文");
    const variant = withVariant.variants[0];
    const task = service.start({
      projectId: w.project.id,
      contentId: content.id,
      variantId: variant.id,
      mode: "task",
      prompt: "只整理文件",
    });
    await finish(task, "已整理文件。");
    assert.equal(
      workspace.getContent(w.project.id, content.id).variants[0].body,
      "已有的正文",
    );
    const draft = service.start({
      projectId: w.project.id,
      contentId: content.id,
      variantId: variant.id,
      mode: "draft",
      prompt: "起草文案",
    });
    await finish(
      draft,
      JSON.stringify({
        variantId: variant.id,
        title: "标题",
        body: "新文案",
        tags: [],
        assetIds: [],
        factNotes: [],
      }),
    );
    assert.equal(draft.status, "applied");
    assert.notEqual(draft.threadId, task.threadId);
    assert.ok(requests.at(-1)!.params.outputSchema);
    assert.equal(
      workspace.getContent(w.project.id, content.id).variants[0].body,
      "新文案",
    );
    effectiveSandbox = "readOnly";
    const before = requests.filter((r) => r.method === "turn/start").length;
    const rejected = service.start({
      projectId: w.project.id,
      contentId: content.id,
      mode: "task",
      prompt: "检测权限降级",
    });
    for (let i = 0; i < 20 && rejected.status !== "interrupted"; i++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(rejected.status, "interrupted");
    assert.match(rejected.error!, /未启用 Full Access/);
    assert.equal(
      requests.filter((r) => r.method === "turn/start").length,
      before,
    );
    assert.ok(
      readFileSync(
        path.join(root, `.content-workspace/ai-runs/${first.id}/output.txt`),
        "utf8",
      ).includes("指定文件修改"),
    );
  } finally {
    service.active = undefined;
    service.queue = [];
    workspace.closeAll();
  }
});

test("native publishing fields survive save, immutable exports, AI context, reopening and backup", async () => {
  const { base, root, workspace, w } = await setup();
  const ai = new CodexService(workspace, () => {});
  try {
    await workspace.importAssets(
      w.project.id,
      [path.resolve("tests/fixtures/demo-1.png")],
      "copy",
    );
    const aid = workspace.load(w.project.id).assets[0].id;
    const p = defaultPublishing();
    p.youtube = {
      format: "video",
      visibility: "unlisted",
      audience: "general",
      playlist: "教程合集",
      chapters: "00:00 开场\n00:30 演示\n02:00 总结",
    };
    p.bilibili = {
      format: "video",
      copyright: "repost",
      source: "https://example.com/original",
      category: "知识",
      collection: "投稿合集",
    };
    p.douyin = { format: "images", location: "深圳", coverText: "三步上手" };
    p.instagram = {
      format: "feed",
      location: "上海",
      altText: { [aid]: "测试图片的替代描述" },
    };
    p.facebook = {
      format: "link",
      linkUrl: "https://example.com/story",
      linkTitle: "链接备注",
      audience: "朋友",
    };
    p.discord.format = "forum";
    p.wechat.format = "announcement";
    const cases: [NativePlatform, string][] = [
      ["youtube", "可见性：不公开列出"],
      ["bilibili", "转载来源：https://example.com/original"],
      ["douyin", "封面文案：三步上手"],
      ["instagram", "测试图片的替代描述"],
      ["facebook", "链接：https://example.com/story"],
      ["discord", "论坛标签：公告"],
      ["wechat", "发布类型：群公告"],
    ];
    for (const [platform, expected] of cases) {
      let content = workspace.createContent(
        w.project.id,
        `${platform} 本地验收`,
      );
      content = workspace.addVariant(
        w.project.id,
        content.id,
        platform,
        "zh-CN",
      );
      const v = content.variants[0];
      content = workspace.saveVariant(w.project.id, content.id, {
        variant: {
          ...v,
          title: "测试标题",
          body: "第一段\n\n第二段",
          tags: ["公告"],
          publishing: p,
          assetIds: [aid],
        },
        baseRevision: v.revision,
        baseHash: v.bodyHash,
      });
      content = ready(workspace, w.project.id, content, "第一段\n\n第二段", [
        aid,
      ]);
      const saved = content.variants[0];
      const account = workspace
        .addAccount(w.project.id, {
          platform,
          label: "验收账号",
          externalId: "",
          accountType: "profile",
        })
        .accounts.at(-1)!;
      const target = workspace
        .addTarget(w.project.id, {
          accountId: account.id,
          label: "验收目标",
          kind: "channel",
        })
        .targets.at(-1)!;
      const [job] = await workspace.schedule(w.project.id, {
        contentId: content.id,
        variantId: saved.id,
        targetIds: [target.id],
        scheduledAtUtc: "2030-01-01T00:00:00Z",
        timezone: "Asia/Shanghai",
      });
      // Changing the draft and platform after scheduling must not rewrite the export.
      workspace.saveVariant(w.project.id, content.id, {
        variant: { ...saved, publishing: defaultPublishing() },
        baseRevision: saved.revision,
        baseHash: saved.bodyHash,
      });
      workspace.savePlatform(w.project.id, {
        id: platform,
        name: `${platform} 新名称`,
        color: "#345678",
        composer: "article",
      });
      const exported = workspace.exportJob(w.project.id, job.id);
      const info = readFileSync(path.join(exported, "发布信息.md"), "utf8");
      assert.ok(info.includes(expected), `${platform}: ${info}`);
      const manifest = readJson<{ variant: Variant }>(
        path.join(exported, "manifest.json"),
      );
      assert.deepEqual(manifest.variant.publishing, p);
      if (platform === "youtube")
        assert.match(
          readFileSync(path.join(exported, "正文.md"), "utf8"),
          /02:00 总结/,
        );
      if (platform === "facebook")
        assert.match(
          readFileSync(path.join(exported, "发送顺序.md"), "utf8"),
          /https:\/\/example.com\/story/,
        );
      // Save the platform-specific draft again for restart and AI-context checks.
      const current = workspace.getContent(w.project.id, content.id)
        .variants[0];
      workspace.saveVariant(w.project.id, content.id, {
        variant: { ...current, publishing: p },
        baseRevision: current.revision,
        baseHash: current.bodyHash,
      });
    }
    ai.status = {
      state: "ready",
      message: "local simulation",
      version: "test",
      models: [],
    };
    ai.active = {} as AiRun;
    const content = workspace
      .load(w.project.id)
      .contents.find((c) => c.variants[0].platform === "youtube")!;
    const run = ai.start({
      projectId: w.project.id,
      contentId: content.id,
      variantId: content.variants[0].id,
      prompt: "仅检查上下文",
    });
    const context = readJson<{ variant: { publishing: Publishing } }>(
      path.join(root, `.content-workspace/ai-runs/${run.id}/input.json`),
    );
    assert.equal(context.variant.publishing.youtube.playlist, "教程合集");
    ai.queue = [];
    ai.active = undefined;
    workspace.close(w.project.id);
    const reopened = await workspace.open(root);
    for (const c of reopened.contents)
      assert.deepEqual(c.variants[0].publishing, p);
    const backup = path.join(base, "native-platform-backup");
    workspace.backup(w.project.id, backup, true);
    workspace.close(w.project.id);
    const restored = await workspace.restore(
      backup,
      path.join(base, "native-platform-restored"),
    );
    for (const c of restored.contents)
      assert.deepEqual(c.variants[0].publishing, p);
  } finally {
    ai.active = undefined;
    ai.queue = [];
    workspace.closeAll();
  }
});
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1foAAAAASUVORK5CYII=",
  "base64",
);

test("reopening an indexed folder skips reading unchanged media and still imports changed files", async () => {
  const { root, workspace, w } = await setup();
  try {
    const file = path.join(root, "registered.png");
    writeFileSync(file, image);
    await workspace.importAssets(w.project.id, [root], "reference");
    const progress: string[] = [];
    const result = await workspace.importAssets(
      w.project.id,
      [root],
      "reference",
      (message) => progress.push(message),
    );
    assert.equal(
      result.find((item) => item.name === "registered.png")?.status,
      "reused",
    );
    assert.deepEqual(progress, []);
    writeFileSync(
      file,
      Buffer.concat([image, Buffer.from("new pixels marker")]),
    );
    const changed = await workspace.importAssets(
      w.project.id,
      [file],
      "reference",
    );
    assert.equal(changed[0].status, "imported");
    assert.equal(workspace.load(w.project.id).assets.length, 2);
  } finally {
    workspace.closeAll();
  }
});
async function setup() {
  const base = mkdtempSync(path.join(os.tmpdir(), "workbench-integration-"));
  const root = path.join(base, "中文 官号");
  mkdirSync(root);
  const workspace = new WorkspaceService(path.join(base, "application"));
  const w = await workspace.open(root);
  return { base, root, workspace, w };
}
function ready(
  workspace: WorkspaceService,
  pid: string,
  c: Content,
  body = "演示文案",
  assetIds: string[] = [],
) {
  let v = { ...c.variants[0], body, assetIds };
  let saved = workspace.saveVariant(pid, c.id, {
    variant: v,
    baseRevision: v.revision,
    baseHash: v.bodyHash,
  });
  v = { ...saved.variants[0], readiness: "ready" };
  saved = workspace.saveVariant(pid, c.id, {
    variant: v,
    baseRevision: v.revision,
    baseHash: v.bodyHash,
  });
  return saved;
}
test("two identities, media, independent variants, snapshots, partial receipts, reopen and backup restore", async () => {
  const { base, root, workspace, w } = await setup();
  try {
    const source = path.join(base, "原素材.png");
    writeFileSync(source, image);
    await workspace.importAssets(w.project.id, [source], "copy");
    await workspace.importAssets(w.project.id, [source], "reference");
    assert.equal(workspace.load(w.project.id).assets.length, 1);
    assert.equal(existsSync(source), true);
    const aid = workspace.load(w.project.id).assets[0].id;
    let c = workspace.createContent(w.project.id, "演示发布");
    c = workspace.addVariant(w.project.id, c.id, "wechat", "zh-CN");
    c = ready(workspace, w.project.id, c, "第一段", [aid]);
    c = workspace.saveVariant(w.project.id, c.id, {
      variant: {
        ...c.variants[0],
        segments: [
          { type: "text", text: "开场" },
          { type: "image", assetId: aid },
          { type: "text", text: "补充" },
        ],
      },
      baseRevision: c.variants[0].revision,
      baseHash: c.variants[0].bodyHash,
    });
    let v = c.variants[0];
    c = workspace.saveVariant(w.project.id, c.id, {
      variant: { ...v, readiness: "ready" },
      baseRevision: v.revision,
      baseHash: v.bodyHash,
    });
    v = c.variants[0];
    let current = workspace.addAccount(w.project.id, {
      platform: "wechat",
      label: "演示发送身份",
      externalId: "",
      accountType: "operator",
    });
    const account = current.accounts[0];
    current = workspace.addTarget(w.project.id, {
      accountId: account.id,
      label: "演示群一",
      kind: "group",
    });
    current = workspace.addTarget(w.project.id, {
      accountId: account.id,
      label: "演示群二",
      kind: "group",
    });
    const jobs = await workspace.schedule(w.project.id, {
      contentId: c.id,
      variantId: v.id,
      targetIds: current.targets.map((t) => t.id),
      scheduledAtUtc: "2030-01-01T12:00:00Z",
      timezone: "Asia/Shanghai",
    });
    assert.equal(jobs.length, 2);
    const exported = workspace.exportJob(w.project.id, jobs[0].id);
    assert.equal(workspace.job(w.project.id, jobs[0].id).status, "scheduled");
    assert.match(
      readFileSync(path.join(exported, "发送顺序.md"), "utf8"),
      /01.*text[\s\S]*02.*image[\s\S]*03.*text/,
    );
    const receipt = {
      recordedBy: "测试操作者",
      recordedAt: new Date().toISOString(),
      result: "演示回填",
      url: "",
      completedSegments: [0],
    };
    assert.equal(
      workspace.recordManual(w.project.id, jobs[0].id, receipt).status,
      "partial",
    );
    assert.equal(
      workspace.recordManual(w.project.id, jobs[0].id, {
        ...receipt,
        completedSegments: [1, 2],
      }).status,
      "completed",
    );
    assert.equal(workspace.job(w.project.id, jobs[1].id).status, "scheduled");
    assert.throws(() =>
      workspace.recordManual(w.project.id, jobs[0].id, receipt),
    );
    workspace.saveVariant(w.project.id, c.id, {
      variant: { ...v, body: "已修改草稿" },
      baseRevision: v.revision,
      baseHash: v.bodyHash,
    });
    assert.equal(
      readFileSync(path.join(exported, "正文.md"), "utf8"),
      "第一段",
    );
    const snapImage = Object.values(
      readJson<{ media: Record<string, { file: string }> }>(
        path.join(exported, "manifest.json"),
      ).media,
    )[0].file;
    assert.equal(await fileHash(path.join(exported, snapImage)), hash(image));
    const ip = path.join(base, "创始人 IP");
    mkdirSync(ip);
    const second = await workspace.open(ip);
    const other = workspace.createContent(second.project.id, "创始人观察");
    const ov = workspace.addVariant(
      second.project.id,
      other.id,
      "instagram",
      "en",
    ).variants[0];
    assert.throws(() =>
      workspace.saveVariant(second.project.id, other.id, {
        variant: { ...ov, assetIds: [aid] },
        baseRevision: ov.revision,
        baseHash: ov.bodyHash,
      }),
    );
    assert.equal(
      workspace.load(w.project.id).contents[0].variants[0].body,
      "已修改草稿",
    );
    workspace.closeAll();
    const again = await workspace.open(root);
    assert.equal(
      again.jobs.find((j) => j.id === jobs[0].id)?.status,
      "completed",
    );
    assert.equal(
      again.jobs.find((j) => j.id === jobs[1].id)?.status,
      "scheduled",
    );
    const backup = path.join(base, "备份");
    workspace.backup(w.project.id, backup, true);
    const restored = await workspace.restore(backup, path.join(base, "恢复"));
    assert.equal(
      restored.jobs.find((j) => j.id === jobs[0].id)?.status,
      "completed",
    );
    assert.equal(
      restored.jobs.find((j) => j.id === jobs[1].id)?.status,
      "paused",
    );
    assert.equal(restored.contents[0].variants[0].body, "已修改草稿");
  } finally {
    workspace.closeAll();
  }
});
test("external edits preserve both versions and allow conflict resolution", async () => {
  const { workspace, w, root } = await setup();
  try {
    let c = workspace.createContent(w.project.id, "冲突测试");
    c = workspace.addVariant(w.project.id, c.id, "x", "en");
    c = ready(workspace, w.project.id, c, "original");
    const v = c.variants[0];
    const body = path.join(root, "content", c.id, "variants", v.id + ".md");
    writeFileSync(body, "external change");
    assert.throws(
      () =>
        workspace.saveVariant(w.project.id, c.id, {
          variant: { ...v, body: "local change" },
          baseRevision: v.revision,
          baseHash: v.bodyHash,
        }),
      { code: "REVISION_CONFLICT" },
    );
    assert.equal(readFileSync(body, "utf8"), "external change");
    const loaded = workspace.getContent(w.project.id, c.id).variants[0];
    const saved = workspace.saveVariant(w.project.id, c.id, {
      variant: { ...loaded, body: "merged change" },
      baseRevision: loaded.revision,
      baseHash: loaded.bodyHash,
    });
    assert.equal(saved.variants[0].body, "merged change");
  } finally {
    workspace.closeAll();
  }
});
test("journal rolls forward interrupted writes and path boundaries remain enforced", async () => {
  const { root, workspace } = await setup();
  try {
    const cid = uuid();
    writeJson(path.join(root, ".content-workspace/journal", uuid() + ".json"), {
      files: {
        [`content/${cid}/variants/draft.md`]: "完整正文",
        [`content/${cid}/manifest.json`]: JSON.stringify({ revision: 2 }),
      },
    });
    recoverJournal(root);
    assert.equal(
      readFileSync(
        path.join(root, "content", cid, "variants/draft.md"),
        "utf8",
      ),
      "完整正文",
    );
    assert.throws(() => journalWrite(root, { "../outside.txt": "no" }));
    assert.equal(existsSync(path.join(root, "../outside.txt")), false);
  } finally {
    workspace.closeAll();
  }
});
test("missing and changed references do not corrupt snapshots; cross-project media is refused", async () => {
  const { base, workspace, w } = await setup();
  try {
    const file = path.join(base, "引用图片.png");
    writeFileSync(file, image);
    await workspace.importAssets(w.project.id, [file], "reference");
    const aid = workspace.load(w.project.id).assets[0].id;
    assert.throws(() => workspace.mediaPath(uuid(), aid));
    renameSync(file, file + ".moved");
    assert.equal(
      workspace.load(w.project.id).assets[0].availability,
      "missing",
    );
    await workspace.reconnectAsset(w.project.id, aid, file + ".moved");
    assert.equal(
      workspace.load(w.project.id).assets[0].availability,
      "available",
    );
    writeFileSync(
      file + ".moved",
      Buffer.concat([image, Buffer.from("changed")]),
    );
    assert.equal(
      workspace.load(w.project.id).assets[0].availability,
      "changed",
    );
    let c = workspace.createContent(w.project.id, "changed");
    c = workspace.addVariant(w.project.id, c.id, "x", "en");
    c = ready(workspace, w.project.id, c, "text", [aid]);
    const w2 = workspace.addAccount(w.project.id, {
      platform: "x",
      label: "test",
      externalId: "",
      accountType: "profile",
    });
    const w3 = workspace.addTarget(w.project.id, {
      accountId: w2.accounts[0].id,
      label: "profile",
      kind: "profile",
    });
    await assert.rejects(
      () =>
        workspace.schedule(w.project.id, {
          contentId: c.id,
          variantId: c.variants[0].id,
          targetIds: [w3.targets[0].id],
          scheduledAtUtc: new Date().toISOString(),
          timezone: "Asia/Shanghai",
        }),
      { code: "ASSET_CHANGED" },
    );
    assert.equal(workspace.load(w.project.id).jobs.length, 0);
  } finally {
    workspace.closeAll();
  }
});
test("duplicate project IDs are rejected, moved project and lock release work", async () => {
  const { base, root, workspace, w } = await setup();
  try {
    const backup = path.join(base, "backup");
    workspace.backup(w.project.id, backup, false);
    await assert.rejects(() => workspace.open(backup), {
      code: "DUPLICATE_PROJECT",
    });
    workspace.close(w.project.id);
    const moved = path.join(base, "移动后的项目");
    renameSync(root, moved);
    const opened = await workspace.open(moved);
    assert.equal(opened.project.id, w.project.id);
    assert.equal(opened.project.root, moved);
  } finally {
    workspace.closeAll();
  }
});
test("all built-in platforms export independent manual packages without external sends", async () => {
  const { workspace, w } = await setup();
  try {
    for (const platform of platforms) {
      let c = workspace.createContent(w.project.id, `演示 ${platform}`);
      c = workspace.addVariant(w.project.id, c.id, platform, "zh-CN");
      c = ready(workspace, w.project.id, c, "仅用于本地辅助发布验收");
      const account = workspace
        .addAccount(w.project.id, {
          platform,
          label: `演示 ${platform}`,
          externalId: "",
          accountType: "profile",
        })
        .accounts.at(-1)!;
      const target = workspace
        .addTarget(w.project.id, {
          accountId: account.id,
          label: `目标 ${platform}`,
          kind: "profile",
        })
        .targets.at(-1)!;
      const [job] = await workspace.schedule(w.project.id, {
        contentId: c.id,
        variantId: c.variants[0].id,
        targetIds: [target.id],
        scheduledAtUtc: "2030-01-01T00:00:00Z",
        timezone: "Asia/Shanghai",
      });
      const folder = workspace.exportJob(w.project.id, job.id);
      assert.equal(
        readJson<{ platform: string }>(path.join(folder, "target.json"))
          .platform,
        platform,
      );
      assert.equal(workspace.job(w.project.id, job.id).status, "scheduled");
    }
    assert.equal(workspace.load(w.project.id).jobs.length, platforms.length);
  } finally {
    workspace.closeAll();
  }
});

test("platform configuration supports legacy and read-only projects, rejects duplicate names and unregistered IDs", async () => {
  const { base, root, workspace, w } = await setup();
  const observer = new WorkspaceService(path.join(base, "observer"));
  try {
    const config = path.join(root, ".content-workspace/platforms.json");
    assert.equal(existsSync(config), false);
    assert.equal(w.platforms.find((p) => p.id === "wechat")?.name, "微信群");
    assert.equal(
      w.platforms.find((p) => p.id === "wechat_official")?.name,
      "微信公众号",
    );
    const locked = await observer.open(root);
    assert.equal(locked.project.readOnly, true);
    assert.deepEqual(locked.platforms, w.platforms);
    assert.throws(
      () =>
        observer.savePlatform(w.project.id, {
          name: "不应保存",
          color: "#112233",
        }),
      { code: "PROJECT_READ_ONLY" },
    );
    assert.equal(existsSync(config), false);
    const saved = workspace.savePlatform(w.project.id, {
      name: "  知乎  ",
      color: "#112233",
    });
    assert.equal(saved.name, "知乎");
    assert.throws(
      () =>
        workspace.savePlatform(w.project.id, {
          name: "知乎",
          color: "#112233",
        }),
      { code: "PLATFORM_DUPLICATE" },
    );
    assert.throws(
      () =>
        workspace.savePlatform(w.project.id, {
          name: " ｘ ",
          color: "#112233",
        }),
      { code: "PLATFORM_DUPLICATE" },
    );
    assert.throws(() =>
      workspace.savePlatform(w.project.id, { name: " ", color: "#112233" }),
    );
    assert.throws(() =>
      workspace.savePlatform(w.project.id, { name: "有效名称", color: "red" }),
    );
    assert.throws(
      () =>
        workspace.savePlatform(w.project.id, {
          id: "missing",
          name: "改名",
          color: "#112233",
        }),
      { code: "PLATFORM_UNKNOWN" },
    );
    const c = workspace.createContent(w.project.id, "验证平台边界");
    assert.throws(
      () => workspace.addVariant(w.project.id, c.id, "missing", "zh-CN"),
      { code: "PLATFORM_UNKNOWN" },
    );
    assert.throws(
      () =>
        workspace.addAccount(w.project.id, {
          platform: "missing",
          label: "测试",
          externalId: "",
          accountType: "profile",
        }),
      { code: "PLATFORM_UNKNOWN" },
    );
    const changed = workspace.savePlatform(w.project.id, {
      id: "wechat",
      name: "微信社群",
      color: "#445566",
    });
    assert.equal(changed.id, "wechat");
    assert.equal(
      workspace.platforms(w.project.id).find((p) => p.id === "wechat")?.name,
      "微信社群",
    );
    assert.equal(
      workspace.platforms(w.project.id).find((p) => p.id === "wechat_official")
        ?.name,
      "微信公众号",
    );
    const otherRoot = path.join(base, "其他身份");
    mkdirSync(otherRoot);
    const other = await workspace.open(otherRoot);
    assert.equal(
      other.platforms.some((p) => p.id === saved.id),
      false,
    );
    assert.equal(
      other.platforms.find((p) => p.id === "wechat")?.name,
      "微信群",
    );
    writeJson(config, {
      schemaVersion: 1,
      items: [{ id: "xiaohongshu", name: "旧配置笔记", color: "#112233" }],
    });
    assert.equal(
      workspace.platforms(w.project.id).find((p) => p.id === "xiaohongshu")
        ?.composer,
      "note",
    );
  } finally {
    observer.closeAll();
    workspace.closeAll();
  }
});

test("custom platform retains identity through AI context, renamed jobs, exports, restart and backup restore", async () => {
  const { base, root, workspace, w } = await setup();
  const ai = new CodexService(workspace, () => {});
  try {
    const custom = workspace.savePlatform(w.project.id, {
      name: "测试长文平台",
      color: "#345678",
      composer: "article",
    });
    let c = workspace.createContent(w.project.id, "自定义平台内容");
    c = workspace.addVariant(w.project.id, c.id, custom.id, "zh-CN");
    c = workspace.saveVariant(w.project.id, c.id, {
      variant: {
        ...c.variants[0],
        article: {
          author: "测试作者",
          digest: "文章摘要",
          sourceUrl: "https://example.com/article",
        },
      },
      baseRevision: c.variants[0].revision,
      baseHash: c.variants[0].bodyHash,
    });
    c = ready(workspace, w.project.id, c, "本地测试，不会发送");
    const variant = c.variants[0];
    assert.throws(
      () =>
        workspace.saveVariant(w.project.id, c.id, {
          variant: { ...variant, platform: "missing" },
          baseRevision: variant.revision,
          baseHash: variant.bodyHash,
        }),
      { code: "PLATFORM_UNKNOWN" },
    );
    const account = workspace
      .addAccount(w.project.id, {
        platform: custom.id,
        label: "测试账号",
        externalId: "",
        accountType: "profile",
      })
      .accounts.at(-1)!;
    const target = workspace
      .addTarget(w.project.id, {
        accountId: account.id,
        label: "测试目标",
        kind: "page",
      })
      .targets.at(-1)!;
    const [job] = await workspace.schedule(w.project.id, {
      contentId: c.id,
      variantId: variant.id,
      targetIds: [target.id],
      scheduledAtUtc: "2030-01-01T00:00:00Z",
      timezone: "Asia/Shanghai",
    });
    const renamed = workspace.savePlatform(w.project.id, {
      ...custom,
      name: "测试长文平台新版",
      color: "#654321",
    });
    assert.equal(renamed.id, custom.id);
    ai.status = {
      state: "ready",
      message: "test simulation",
      version: "test",
      models: [],
    };
    ai.active = {} as AiRun;
    const run = ai.start({
      projectId: w.project.id,
      contentId: c.id,
      variantId: variant.id,
      prompt: "仅检查上下文",
    });
    const context = readJson<{ platform: { id: string; name: string } }>(
      path.join(root, `.content-workspace/ai-runs/${run.id}/input.json`),
    );
    assert.equal(context.platform.id, custom.id);
    assert.equal(context.platform.name, renamed.name);
    ai.queue = [];
    ai.active = undefined;
    const exported = workspace.exportJob(w.project.id, job.id);
    const publishInfo = readFileSync(
      path.join(exported, "发布信息.md"),
      "utf8",
    );
    assert.match(publishInfo, /作者：测试作者/);
    assert.match(publishInfo, /摘要：文章摘要/);
    assert.match(publishInfo, /原文链接：https:\/\/example.com\/article/);
    assert.match(
      readFileSync(path.join(exported, "发送顺序.md"), "utf8"),
      /平台：测试长文平台\n/,
    );
    assert.equal(
      readJson<{ platform: { name: string } }>(
        path.join(exported, "manifest.json"),
      ).platform.name,
      custom.name,
    );
    workspace.close(w.project.id);
    const reopened = await workspace.open(root);
    assert.deepEqual(
      reopened.platforms.find((p) => p.id === custom.id),
      renamed,
    );
    assert.equal(reopened.contents[0].variants[0].platform, custom.id);
    assert.equal(reopened.contents[0].variants[0].article.author, "测试作者");
    assert.equal(reopened.accounts[0].platform, custom.id);
    assert.equal(reopened.jobs[0].platform, custom.id);
    const backup = path.join(base, "platform-backup");
    workspace.backup(w.project.id, backup, true);
    assert.equal(
      existsSync(path.join(backup, ".content-workspace/platforms.json")),
      true,
    );
    workspace.close(w.project.id);
    const restored = await workspace.restore(
      backup,
      path.join(base, "platform-restored"),
    );
    assert.deepEqual(
      restored.platforms.find((p) => p.id === custom.id),
      renamed,
    );
    const restoredJob = workspace.job(w.project.id, job.id);
    assert.equal(restoredJob.platform, custom.id);
    assert.equal(restoredJob.status, "paused");
    const completed = workspace.recordManual(w.project.id, job.id, {
      recordedBy: "本地验收",
      recordedAt: new Date().toISOString(),
      result: "验收模拟",
      url: "",
      completedSegments: [0],
    });
    assert.equal(completed.status, "completed");
  } finally {
    ai.active = undefined;
    ai.queue = [];
    workspace.closeAll();
  }
});
test("AI event simulation preserves concurrent edits, rejects foreign media and ignores stale completion", async () => {
  const { workspace, w } = await setup();
  const ai = new CodexService(workspace, () => {});
  try {
    let c = workspace.createContent(w.project.id, "AI 冲突演示");
    c = workspace.addVariant(w.project.id, c.id, "wechat", "zh-CN");
    ai.status = {
      state: "ready",
      message: "test simulation",
      version: "test",
      models: [],
    };
    const makeRun = () => {
      ai.active = {} as AiRun;
      const run = ai.start({
        projectId: w.project.id,
        contentId: c.id,
        variantId: c.variants[0].id,
        prompt: "test simulation",
      });
      ai.queue = [];
      run.threadId = "thread-test";
      run.turnId = uuid();
      run.status = "running";
      ai.active = run;
      return run;
    };
    const run = makeRun();
    const v = workspace.getContent(w.project.id, c.id).variants[0];
    workspace.saveVariant(w.project.id, c.id, {
      variant: { ...v, body: "user edited during AI" },
      baseRevision: v.revision,
      baseHash: v.bodyHash,
    });
    run.output = JSON.stringify({
      variantId: v.id,
      title: "AI",
      body: "AI suggestion",
      tags: [],
      assetIds: [],
      factNotes: [],
    });
    await ai.onNotification({
      method: "turn/completed",
      params: {
        threadId: run.threadId,
        turn: { id: run.turnId, status: "completed" },
      },
    });
    assert.equal(
      workspace.load(w.project.id).runs.find((r) => r.id === run.id)?.status,
      "suggestion",
    );
    assert.equal(
      workspace.getContent(w.project.id, c.id).variants[0].body,
      "user edited during AI",
    );
    const next = makeRun();
    next.output = JSON.stringify({
      variantId: v.id,
      title: "AI",
      body: "invalid media",
      tags: [],
      assetIds: [uuid()],
      factNotes: [],
    });
    await ai.onNotification({
      method: "turn/completed",
      params: {
        threadId: run.threadId,
        turn: { id: run.turnId, status: "completed" },
      },
    });
    assert.equal(ai.active?.id, next.id);
    await ai.onNotification({
      method: "turn/completed",
      params: {
        threadId: next.threadId,
        turn: { id: next.turnId, status: "completed" },
      },
    });
    assert.equal(
      workspace.load(w.project.id).runs.find((r) => r.id === next.id)?.status,
      "invalid",
    );
    assert.equal(
      workspace.getContent(w.project.id, c.id).variants[0].body,
      "user edited during AI",
    );
  } finally {
    ai.active = undefined;
    ai.queue = [];
    workspace.closeAll();
  }
});
