import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkspaceService } from "../src/services/workspace";
import { PublisherService } from "../src/services/publishing/service";
import { ConnectionStore } from "../src/services/publishing/store";
import { MockAdapter } from "../src/services/publishing/mock";
import { mockScenarios, type MockScenario } from "../src/contracts/automation";
import type { Job } from "../src/contracts/model";
import { DatabaseSync } from "node:sqlite";
import { StateDatabase } from "../src/storage/database";
const codec = {
  encrypt: (s: string) => Buffer.from(s).toString("base64"),
  decrypt: (s: string) => Buffer.from(s, "base64").toString(),
};
for (const afterCommit of [false, true])
  test(`receipt persistence failure ${afterCommit ? "after" : "before"} commit never repeats a post`, async () => {
    const s = await setup();
    try {
      const [job] = await s.schedule();
      const persist = s.service.persist.bind(s.service);
      let injected = false;
      s.service.persist = (j, message, leased) => {
        if (j.status === "published" && !injected) {
          injected = true;
          if (afterCommit) persist(j, message, leased);
          throw new Error("simulated local receipt write interruption");
        }
        persist(j, message, leased);
      };
      await s.service.tick();
      const stored = s.w.job(s.pid, job.id);
      assert.equal(stored.status, afterCommit ? "published" : "unknown");
      assert.ok(stored.execution?.result?.id);
      await s.service.tick();
      assert.equal(s.submits, 1);
      if (!afterCommit) {
        await s.service.action(s.pid, job.id, "reconcile");
        assert.equal(s.submits, 1);
      }
    } finally {
      s.close();
    }
  });
async function setup(scenario: MockScenario = "success") {
  const base = mkdtempSync(path.join(os.tmpdir(), "publishing-test-"));
  const root = path.join(base, "项目");
  mkdirSync(root);
  const w = new WorkspaceService(path.join(base, "app"));
  let view = await w.open(root);
  const pid = view.project.id;
  view = w.addAccount(pid, {
    platform: "discord",
    label: "仅模拟",
    externalId: "",
    accountType: "mock",
  });
  const account = view.accounts[0];
  view = w.addTarget(pid, {
    accountId: account.id,
    label: "模拟目标",
    kind: "channel",
  });
  const target = view.targets[0];
  let content = w.createContent(pid, "自动发布模拟");
  content = w.addVariant(pid, content.id, "discord", "zh-CN");
  let v = content.variants[0];
  content = w.saveVariant(pid, content.id, {
    variant: { ...v, body: "合成测试，不发布", readiness: "ready" },
    baseRevision: v.revision,
    baseHash: v.bodyHash,
  });
  v = content.variants[0];
  content = w.saveVariant(pid, content.id, {
    variant: { ...v, readiness: "ready" },
    baseRevision: v.revision,
    baseHash: v.bodyHash,
  });
  v = content.variants[0];
  const clock = { now: Date.now() };
  const store = new ConnectionStore(
    path.join(base, "app", "publishing"),
    codec,
  );
  const mock = new MockAdapter();
  let submits = 0;
  const orig = mock.submit.bind(mock);
  mock.submit = async (...args) => {
    submits++;
    return orig(...args);
  };
  const service = new PublisherService(
    w,
    store,
    () => {},
    { mock },
    () => clock.now,
  );
  await service.saveConnection(
    pid,
    { targetId: target.id, provider: "mock", scenario },
    {},
  );
  const c = service.listConnections(pid)[0];
  await service.checkConnection(pid, c.id);
  const schedule = async (targetIds = [target.id], at = clock.now) =>
    service.schedule(pid, {
      contentId: content.id,
      variantId: v.id,
      targetIds,
      scheduledAtUtc: new Date(at).toISOString(),
      timezone: "Asia/Shanghai",
      mode: "simulation",
      approved: true,
    });
  return {
    base,
    root,
    w,
    pid,
    clock,
    store,
    service,
    mock,
    target,
    account,
    c,
    schedule,
    get submits() {
      return submits;
    },
    close() {
      service.stop();
      w.closeAll();
    },
  };
}
for (const scenario of mockScenarios)
  test(`Mock ${scenario}: honest states and no duplicate submit`, async () => {
    const s = await setup(scenario);
    try {
      const [job] = await s.schedule();
      await s.service.tick();
      let j = s.w.job(s.pid, job.id);
      const expected = {
        success: "published",
        processing: "processing",
        upload_failure: "retry_wait",
        submit_timeout: "unknown",
        rate_limit: "retry_wait",
        auth_expired: "needs_attention",
        rejected: "failed",
      };
      assert.equal(j.status, expected[scenario]);
      if (scenario === "submit_timeout") {
        for (let i = 0; i < 4; i++) {
          s.clock.now += 600000;
          await s.service.tick();
        }
        assert.equal(s.submits, 1);
        await assert.rejects(() => s.service.action(s.pid, j.id, "retry"), {
          code: "RESULT_UNCERTAIN",
        });
        await s.service.action(s.pid, j.id, "reconcile");
        assert.equal(s.w.job(s.pid, j.id).status, "unknown");
        assert.equal(s.submits, 1);
      }
      if (scenario === "processing") {
        s.clock.now += 20000;
        await s.service.tick();
        assert.equal(s.w.job(s.pid, j.id).status, "published");
        assert.equal(s.submits, 1);
      }
      if (scenario === "rate_limit") {
        assert.ok(
          Date.parse(j.execution!.nextAttemptAt!) - s.clock.now >= 90000,
        );
        s.clock.now += 90001;
        await s.service.tick();
        assert.equal(s.w.job(s.pid, j.id).status, "published");
      }
      if (scenario === "upload_failure") {
        for (let i = 0; i < 3; i++) {
          s.clock.now += 700000;
          await s.service.tick();
        }
        j = s.w.job(s.pid, j.id);
        assert.equal(j.status, "failed");
        assert.equal(j.execution!.attempt, 3);
        assert.equal(s.submits, 0);
      }
      if (scenario === "auth_expired") {
        assert.equal(s.service.listConnections(s.pid)[0].enabled, false);
        assert.equal(s.submits, 0);
      }
      if (scenario === "success") {
        s.clock.now += 600000;
        await s.service.tick();
        assert.equal(s.submits, 1);
        assert.equal(s.service.claim(s.pid, j.id), undefined);
      }
      assert.equal(j.mode, "simulation");
      assert.ok(s.service.events(s.pid, j.id).length >= 4);
    } finally {
      s.close();
    }
  });

test("missed jobs, disconnect, snapshot tamper, and lease recovery remain safe", async () => {
  const s = await setup();
  try {
    const [missed] = await s.schedule(undefined, s.clock.now - 300001);
    await s.service.tick();
    assert.equal(s.w.job(s.pid, missed.id).status, "needs_attention");
    assert.equal(s.submits, 0);
    const [job] = await s.schedule();
    const claimed = s.service.claim(s.pid, job.id)!;
    const other = new PublisherService(
      s.w,
      s.store,
      () => {},
      { mock: s.mock },
      () => s.clock.now,
    );
    assert.equal(other.claim(s.pid, job.id), undefined);
    claimed.status = "submitting";
    claimed.execution!.submittedAt = new Date(s.clock.now).toISOString();
    s.w.context(s.pid).db.put("jobs", claimed);
    s.clock.now += 120001;
    other.recover(s.pid);
    assert.equal(s.w.job(s.pid, job.id).status, "unknown");
    await other.tick();
    assert.equal(s.submits, 0);
    const [tampered] = await s.schedule();
    writeFileSync(
      path.join(
        s.root,
        `.content-workspace/snapshots/${tampered.snapshotId}/正文.md`,
      ),
      "tampered",
    );
    await s.service.tick();
    assert.equal(s.w.job(s.pid, tampered.id).status, "failed");
    assert.equal(s.submits, 0);
    const [paused] = await s.schedule();
    s.service.disconnect(s.pid, s.c.id);
    await s.service.tick();
    assert.equal(s.w.job(s.pid, paused.id).status, "paused");
    assert.equal(s.w.job(s.pid, job.id).status, "unknown");
  } finally {
    s.close();
  }
});

test("background registration reopens projects and stopping management pauses unsent work", async () => {
  const s = await setup();
  try {
    const [j] = await s.schedule(undefined, s.clock.now + 60000);
    s.w.closeAll();
    await s.service.reopenManaged();
    assert.ok(s.w.contexts.has(s.pid));
    assert.equal(s.service.background()[0].pending, 1);
    s.service.setManagement(s.pid, false);
    assert.equal(s.w.job(s.pid, j.id).status, "paused");
    assert.equal(s.service.listConnections(s.pid)[0].enabled, false);
    s.clock.now += 60001;
    await s.service.tick();
    assert.equal(s.submits, 0);
    s.w.closeAll();
    await s.service.reopenManaged();
    assert.equal(s.w.contexts.size, 0);
  } finally {
    s.close();
  }
});

test("preparing resumes persisted media, while submit intent exists before the platform call", async () => {
  const s = await setup();
  try {
    const [j] = await s.schedule();
    const claimed = s.service.claim(s.pid, j.id)!;
    claimed.status = "preparing";
    claimed.execution!.prepared = { mediaIds: ["previous-upload"] };
    s.w.context(s.pid).db.put("jobs", claimed);
    s.clock.now += 120001;
    const original = s.mock.prepare.bind(s.mock);
    s.mock.prepare = async (i, c, p) => {
      assert.deepEqual(p.mediaIds, ["previous-upload"]);
      return original(i, c, p);
    };
    const submit = s.mock.submit.bind(s.mock);
    s.mock.submit = async (i, c) => {
      const stored = s.w.job(s.pid, i.job.id);
      assert.equal(stored.status, "submitting");
      assert.ok(stored.execution?.submittedAt);
      return submit(i, c);
    };
    await s.service.tick();
    assert.equal(s.w.job(s.pid, j.id).status, "published");
    assert.equal(s.submits, 1);
  } finally {
    s.close();
  }
});

test("global queue permits two accounts and holds the third until capacity is released", async () => {
  const s = await setup();
  let release!: () => void;
  try {
    const targets = [s.target.id];
    for (let index = 0; index < 2; index++) {
      const a = s.w
        .addAccount(s.pid, {
          platform: "discord",
          label: `模拟${index}`,
          externalId: "",
          accountType: "mock",
        })
        .accounts.at(-1)!;
      const t = s.w
        .addTarget(s.pid, {
          accountId: a.id,
          label: `目标${index}`,
          kind: "channel",
        })
        .targets.at(-1)!;
      await s.service.saveConnection(
        s.pid,
        { targetId: t.id, provider: "mock" },
        {},
      );
      await s.service.checkConnection(
        s.pid,
        s.service.listConnections(s.pid).find((c) => c.targetId === t.id)!.id,
      );
      targets.push(t.id);
    }
    await s.schedule(targets);
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const original = s.mock.prepare.bind(s.mock);
    s.mock.prepare = async (...args) => {
      await gate;
      return original(...args);
    };
    const work = s.service.tick();
    assert.equal(s.service.running.size, 2);
    assert.equal(s.service.accountBusy.size, 2);
    await s.service.tick();
    assert.equal(s.service.running.size, 2);
    release();
    await work;
    await s.service.tick();
    assert.equal(s.submits, 3);
  } finally {
    release?.();
    s.close();
  }
});

test("old SQLite v1 jobs and session mappings survive the transactional v2 migration", async () => {
  const s = await setup();
  try {
    const [job] = await s.schedule();
    const file = path.join(s.base, "legacy.sqlite");
    const old = new DatabaseSync(file);
    old.exec(
      "CREATE TABLE jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,payload TEXT NOT NULL); CREATE TABLE runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,payload TEXT NOT NULL); CREATE TABLE sessions(content_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,thread_id TEXT NOT NULL); PRAGMA user_version=1;",
    );
    old
      .prepare("INSERT INTO jobs VALUES(?,?,?)")
      .run(
        job.id,
        s.pid,
        JSON.stringify({ ...job, mode: "manual_due", execution: undefined }),
      );
    old
      .prepare("INSERT INTO sessions VALUES(?,?,?)")
      .run(job.contentId, s.pid, "existing-thread");
    old.close();
    const upgraded = new StateDatabase(file);
    try {
      assert.equal(upgraded.list<Job>("jobs", s.pid)[0].mode, "manual_due");
      assert.equal(upgraded.session(s.pid, job.contentId), "existing-thread");
      assert.equal(
        upgraded.db.prepare("SELECT version FROM migrations").get()?.version,
        2,
      );
    } finally {
      upgraded.close();
    }
  } finally {
    s.close();
  }
});

test("real accounts cannot use mock connections, and retries cannot change the remote target", async () => {
  const s = await setup();
  try {
    const a = s.w
      .addAccount(s.pid, {
        platform: "discord",
        label: "真实类型测试",
        externalId: "",
        accountType: "webhook",
      })
      .accounts.at(-1)!;
    const t = s.w
      .addTarget(s.pid, { accountId: a.id, label: "真实类型", kind: "channel" })
      .targets.at(-1)!;
    await assert.rejects(
      () =>
        s.service.saveConnection(
          s.pid,
          { targetId: t.id, provider: "mock" },
          {},
        ),
      { code: "CONNECTION_MISMATCH" },
    );
    const [j] = await s.schedule();
    await s.service.action(s.pid, j.id, "pause");
    await s.service.saveConnection(
      s.pid,
      { targetId: s.target.id, provider: "mock", remoteId: "different" },
      {},
    );
    await s.service.checkConnection(s.pid, s.c.id);
    await assert.rejects(() => s.service.action(s.pid, j.id, "retry"), {
      code: "TARGET_CHANGED",
    });
    assert.equal(s.submits, 0);
  } finally {
    s.close();
  }
});

test("backup migration preserves published and uncertain outcomes and pauses unsent work", async () => {
  const s = await setup();
  try {
    const [done] = await s.schedule();
    await s.service.tick();
    const [unsent] = await s.schedule(undefined, s.clock.now + 600000);
    const [uncertain] = await s.schedule();
    uncertain.status = "submitting";
    uncertain.execution!.submittedAt = new Date(s.clock.now).toISOString();
    s.w.context(s.pid).db.put("jobs", uncertain);
    const backup = path.join(s.base, "backup");
    s.w.backup(s.pid, backup, false);
    s.store.setSecrets(s.c.id, { token: "fixture-secret" });
    assert.equal(
      readFileSync(
        path.join(s.base, "app/publishing/credentials.json"),
        "utf8",
      ).includes("fixture-secret"),
      false,
    );
    const restored = await s.w.restore(backup, path.join(s.base, "restored"));
    assert.equal(
      restored.jobs.find((j) => j.id === done.id)?.status,
      "published",
    );
    assert.equal(
      restored.jobs.find((j) => j.id === unsent.id)?.status,
      "paused",
    );
    assert.equal(
      restored.jobs.find((j) => j.id === uncertain.id)?.status,
      "unknown",
    );
    await s.service.tick();
    assert.equal(s.submits, 1);
    const version = s.w
      .context(s.pid)
      .db.db.prepare("PRAGMA user_version")
      .get() as { user_version: number };
    assert.equal(version.user_version, 2);
  } finally {
    s.close();
  }
});

test("same-account tasks serialize across scheduler instances and successful targets are retained", async () => {
  const s = await setup();
  try {
    const otherTarget = s.w
      .addTarget(s.pid, {
        accountId: s.account.id,
        label: "目标2",
        kind: "channel",
      })
      .targets.at(-1)!;
    await s.service.saveConnection(
      s.pid,
      {
        targetId: otherTarget.id,
        provider: "mock",
        scenario: "submit_timeout",
      },
      {},
    );
    await s.service.checkConnection(
      s.pid,
      s.service
        .listConnections(s.pid)
        .find((c) => c.targetId === otherTarget.id)!.id,
    );
    const jobs = await s.schedule([s.target.id, otherTarget.id]);
    const second = new PublisherService(
      s.w,
      s.store,
      () => {},
      { mock: s.mock },
      () => s.clock.now,
    );
    await Promise.all([s.service.tick(), second.tick()]);
    await s.service.tick();
    assert.equal(s.w.job(s.pid, jobs[0].id).status, "published");
    assert.equal(s.w.job(s.pid, jobs[1].id).status, "unknown");
    assert.equal(s.submits, 2);
    await second.tick();
    assert.equal(s.submits, 2);
  } finally {
    s.close();
  }
});
