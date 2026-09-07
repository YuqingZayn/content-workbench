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
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1foAAAAASUVORK5CYII=",
  "base64",
);
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
test("all nine platforms export independent manual packages without external sends", async () => {
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
    assert.equal(workspace.load(w.project.id).jobs.length, 9);
  } finally {
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
