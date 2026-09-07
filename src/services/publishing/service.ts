import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import {
  accountSchema,
  targetSchema,
  type AppEvent,
  type Job,
  type Variant,
} from "../../contracts/model";
import {
  connectionSchema,
  irreversibleStates,
  type Provider,
  type PublishConnection,
  type PublishEvent,
  type PublishResult,
  type PublishSecrets,
} from "../../contracts/automation";
import { WorkspaceService } from "../workspace";
import {
  AppError,
  fileHash,
  hash,
  now,
  readJson,
  safePath,
  uuid,
  writeJson,
} from "../files";
import { ConnectionStore } from "./store";
import {
  PublishError,
  type AdapterContext,
  type PublisherAdapter,
  type SnapshotInput,
} from "./adapter";
import { MockAdapter } from "./mock";
const final = ["completed", "published", "cancelled", "skipped"];
const querying = ["unknown", "accepted", "processing"];
const sources: Record<Provider, string> = {
  mock: "本地模拟，无外部请求",
  discord: "https://docs.discord.com/developers/resources/webhook",
  x: "https://docs.x.com/x-api/posts/create-post",
  instagram:
    "https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/",
  facebook: "https://developers.facebook.com/docs/pages-api/posts/",
};
export class PublisherService {
  owner = uuid();
  running = new Map<string, Job>();
  accountBusy = new Set<string>();
  stopped = false;
  timer?: ReturnType<typeof setInterval>;
  heartbeat?: ReturnType<typeof setInterval>;
  backgroundErrors = new Map<string, string>();
  constructor(
    public workspace: WorkspaceService,
    public store: ConnectionStore,
    public emit: (e: AppEvent) => void,
    public adapters: Partial<Record<Provider, PublisherAdapter>> = {
      mock: new MockAdapter(),
    },
    public clock: () => number = Date.now,
  ) {}
  management() {
    const file = path.join(
      this.workspace.appData,
      "publishing",
      "managed-projects.json",
    );
    return existsSync(file) ? readJson<Record<string, boolean>>(file) : {};
  }
  setManagement(projectId: string, enabled: boolean) {
    this.workspace.context(projectId, true);
    if ([...this.running.values()].some((j) => j.projectId === projectId))
      throw new AppError(
        "PUBLISH_BUSY",
        "此项目正在处理，请等当前平台请求结束后停止管理",
      );
    writeJson(
      path.join(this.workspace.appData, "publishing", "managed-projects.json"),
      {
        ...this.management(),
        [projectId]: enabled,
      },
    );
    if (!enabled)
      for (const c of this.store.all().filter((c) => c.projectId === projectId))
        this.disconnect(projectId, c.id);
  }
  async reopenManaged() {
    const managed = this.management();
    for (const project of this.workspace.recent()) {
      if (
        managed[project.id] === false ||
        !this.store.all().some((c) => c.projectId === project.id && c.enabled)
      )
        continue;
      try {
        await this.workspace.open(project.root);
        this.backgroundErrors.delete(project.id);
      } catch {
        this.backgroundErrors.set(
          project.id,
          "后台项目无法打开，请重新定位或检查目录权限",
        );
      }
    }
  }
  background() {
    const managed = this.management();
    return this.workspace.recent().map((p) => {
      const ctx = this.workspace.contexts.get(p.id);
      return {
        projectId: p.id,
        name: p.name,
        enabled: !!ctx && managed[p.id] !== false,
        pending:
          ctx?.db
            .list<Job>("jobs", p.id)
            .filter((j) => j.execution && !final.includes(j.status)).length ??
          0,
        message:
          this.backgroundErrors.get(p.id) ??
          ctx?.project.warning ??
          (!ctx
            ? "尚未打开"
            : managed[p.id] === false
              ? "已停止；任务保持暂停，重新检查连接后逐项安排"
              : "应用运行期间处理已确认的任务"),
      };
    });
  }
  listConnections(projectId: string) {
    this.workspace.context(projectId);
    return this.store
      .all()
      .filter((c) => c.projectId === projectId)
      .map((c) => ({
        ...c,
        secretPresent: c.provider === "mock" || this.store.hasSecrets(c.id),
      }));
  }
  binding(projectId: string, targetId: string) {
    const target = this.workspace
      .list(projectId, "targets", targetSchema)
      .find((t) => t.id === targetId);
    const account = this.workspace
      .list(projectId, "accounts", accountSchema)
      .find((a) => a.id === target?.accountId);
    if (!target || !account)
      throw new AppError("TARGET_UNKNOWN", "目标或账号不属于当前项目");
    return { target, account };
  }
  async saveConnection(
    projectId: string,
    raw: unknown,
    secrets: PublishSecrets,
  ) {
    this.workspace.context(projectId, true);
    const input = connectionSchema.parse(raw);
    if (input.mediaEndpoint) {
      let url: URL;
      try {
        url = new URL(input.mediaEndpoint);
      } catch {
        throw new AppError("MEDIA_ENDPOINT", "请输入有效的 HTTPS 媒体出口地址");
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new AppError(
          "MEDIA_ENDPOINT",
          "媒体出口地址不能包含密钥、查询参数或片段；令牌请填在加密凭据栏",
        );
    }
    const { account, target } = this.binding(projectId, input.targetId);
    if (
      input.provider === "mock"
        ? account.accountType !== "mock"
        : account.platform !== input.provider || account.accountType === "mock"
    )
      throw new AppError(
        "CONNECTION_MISMATCH",
        "连接类型与账号不匹配；模拟连接需专用模拟账号",
      );
    if (
      input.provider === "facebook" &&
      (account.accountType !== "page" || target.kind !== "page")
    )
      throw new AppError(
        "PAGE_REQUIRED",
        "Facebook 自动连接仅支持 Page，不能使用个人主页或群组",
      );
    if (
      input.provider === "instagram" &&
      !["professional", "business", "creator"].includes(account.accountType)
    )
      throw new AppError(
        "PROFESSIONAL_REQUIRED",
        "Instagram 自动连接需要专业 / 商业 / 创作者账号",
      );
    const previous = this.store
      .all()
      .find((c) => c.projectId === projectId && c.targetId === target.id);
    if (
      previous &&
      [...this.running.values()].some(
        (j) => j.execution?.connectionId === previous.id,
      )
    )
      throw new AppError("PUBLISH_BUSY", "请等待当前平台操作结束再编辑连接");
    const c: PublishConnection = {
      ...input,
      id: previous?.id ?? uuid(),
      projectId,
      accountId: account.id,
      revision: (previous?.revision ?? 0) + 1,
      enabled: false,
      status: "not_checked",
      verification: input.provider === "mock" ? "simulated" : "unverified",
      supportedTypes:
        input.provider === "instagram"
          ? ["single_image", "carousel"]
          : ["text", "images"],
      source: sources[input.provider],
    };
    let old: PublishSecrets = {};
    if (previous)
      try {
        old = this.store.secrets(previous.id);
      } catch {
        if (!secrets.token && !secrets.webhook)
          throw new AppError(
            "CREDENTIALS_UNAVAILABLE",
            "旧凭据无法解密，请重新填写完整令牌或 Webhook",
          );
      }
    const merged = {
      ...old,
      ...Object.fromEntries(Object.entries(secrets).filter(([, v]) => v)),
    };
    if (c.provider !== "mock") this.store.setSecrets(c.id, merged);
    this.store.save(c);
    this.pauseConnection(c, "连接配置已更改，请检查后重新安排任务");
    return this.listConnections(projectId);
  }
  context(c: PublishConnection, job?: Job): AdapterContext {
    return {
      connection: c,
      secrets: this.store.secrets(c.id),
      saveSecrets: (s) => this.store.setSecrets(c.id, s),
      persistPrepared: (p) => {
        if (job) {
          job.execution!.prepared = structuredClone(p);
          this.persist(job, "媒体准备进度已保存", true);
        }
      },
    };
  }
  adapter(c: PublishConnection) {
    const a = this.adapters[c.provider];
    if (!a) throw new AppError("ADAPTER_UNAVAILABLE", "此平台适配器不可用");
    return a;
  }
  async checkConnection(projectId: string, id: string) {
    this.workspace.context(projectId, true);
    const c = this.connection(projectId, id);
    const { account, target } = this.binding(projectId, c.targetId);
    if (!account.enabled || !target.enabled)
      throw new AppError("ACCOUNT_DISABLED", "请先启用账号与目标");
    try {
      const result = await this.adapter(c).check(this.context(c));
      if (c.remoteId && c.remoteId !== result.remoteId)
        throw new Error("凭据对应的远端目标与填写 ID 不一致");
      c.remoteId = result.remoteId;
      c.status = "connected";
      c.enabled = true;
      c.message = result.message;
      writeJson(
        path.join(
          this.workspace.appData,
          "publishing",
          "managed-projects.json",
        ),
        {
          ...this.management(),
          [projectId]: true,
        },
      );
    } catch (e) {
      c.status = "error";
      c.enabled = false;
      c.message =
        e instanceof PublishError
          ? e.message
          : "连接检查失败，请核对账号、目标 ID、凭据及网络";
      this.pauseConnection(c, c.message);
    }
    c.checkedAt = now();
    this.store.save(c);
    this.emit({ type: "workspace-changed", projectId });
    return this.listConnections(projectId);
  }
  connection(projectId: string, id: string) {
    const c = this.store
      .all()
      .find((c) => c.id === id && c.projectId === projectId);
    if (!c) throw new AppError("CONNECTION_UNKNOWN", "连接不存在");
    return c;
  }
  disconnect(projectId: string, id: string) {
    this.workspace.context(projectId, true);
    const c = this.connection(projectId, id);
    c.enabled = false;
    c.status = "disconnected";
    c.message = "已断开，未发送任务已暂停";
    this.store.save(c);
    this.pauseConnection(c, c.message);
    return this.listConnections(projectId);
  }
  pauseConnection(c: PublishConnection, message: string) {
    const { db } = this.workspace.context(c.projectId, true);
    for (const j of db.list<Job>("jobs", c.projectId))
      if (j.execution?.connectionId === c.id && !final.includes(j.status)) {
        if (this.running.has(j.id)) continue;
        if (!j.execution.submittedAt && j.status !== "submitting")
          j.status = "paused";
        j.execution.error = message;
        this.persist(j, message);
      }
  }
  events(projectId: string, jobId: string): PublishEvent[] {
    const { db } = this.workspace.context(projectId);
    this.workspace.job(projectId, jobId);
    return (
      db.db
        .prepare(
          "SELECT payload FROM publish_events WHERE project_id=? AND job_id=? ORDER BY rowid",
        )
        .all(projectId, jobId) as { payload: string }[]
    ).map((r) => JSON.parse(r.payload));
  }
  persist(job: Job, message: string, leased = false) {
    if (this.stopped) throw new AppError("SCHEDULER_STOPPED", "调度已停止");
    const { db } = this.workspace.context(job.projectId, true);
    const e: PublishEvent = {
      id: uuid(),
      projectId: job.projectId,
      jobId: job.id,
      at: new Date(this.clock()).toISOString(),
      status: job.status,
      message,
      attempt: job.execution?.attempt ?? 0,
    };
    db.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        leased &&
        this.workspace.job(job.projectId, job.id).execution?.leaseOwner !==
          this.owner
      )
        throw new AppError("LEASE_LOST", "任务租约已失效");
      db.put("jobs", job);
      db.db
        .prepare("INSERT INTO publish_events VALUES(?,?,?,?)")
        .run(e.id, e.projectId, e.jobId, JSON.stringify(e));
      db.db.exec("COMMIT");
    } catch (e) {
      db.db.exec("ROLLBACK");
      throw e;
    }
    this.emit({ type: "workspace-changed", projectId: job.projectId });
  }
  async schedule(
    projectId: string,
    input: Parameters<WorkspaceService["schedule"]>[1] & {
      mode: "automatic" | "simulation";
      approved: boolean;
    },
  ) {
    if (!input.approved)
      throw new AppError(
        "PUBLISH_APPROVAL_REQUIRED",
        "请确认目标、固定内容和发布时间",
      );
    const bindings = input.targetIds.map((id) => {
      const c = this.store
        .all()
        .find((c) => c.projectId === projectId && c.targetId === id);
      if (!c?.enabled || c.status !== "connected")
        throw new AppError(
          "CONNECTION_REQUIRED",
          "请先配置并检查每个目标的连接",
        );
      if ((c.provider === "mock") !== (input.mode === "simulation"))
        throw new AppError("MOCK_BOUNDARY", "模拟与真实目标不能混用");
      return c;
    });
    const jobs = await this.workspace.schedule(projectId, input);
    for (const j of jobs) {
      const c = bindings.find((c) => c.targetId === j.targetId)!;
      const mediaCount = readJson<{ variant: Variant }>(
        safePath(
          this.workspace.context(projectId).project.root,
          `.content-workspace/snapshots/${j.snapshotId}/manifest.json`,
        ),
      ).variant.assetIds.length;
      j.mode = input.mode;
      j.status = "scheduled";
      j.execution = {
        connectionId: c.id,
        connectionRevision: c.revision,
        provider: c.provider,
        remoteId: c.remoteId,
        contentType:
          mediaCount > 1
            ? "images"
            : mediaCount === 1
              ? "single_image"
              : "text",
        attempt: 0,
        approvedAt: now(),
      };
      this.persist(
        j,
        input.mode === "simulation"
          ? "已安排本地模拟，不会对外发送"
          : "用户已确认自动发布快照与目标",
      );
    }
    return jobs;
  }
  async snapshot(job: Job): Promise<SnapshotInput> {
    const { project } = this.workspace.context(job.projectId);
    const root = safePath(
      project.root,
      `.content-workspace/snapshots/${job.snapshotId}`,
    );
    const m = readJson<{
      id: string;
      projectId: string;
      variant: Variant;
      platform: unknown;
      publishingFields: unknown;
      segments: unknown;
      payloadHash: string;
      media: Record<string, { file: string; sha256: string }>;
    }>(path.join(root, "manifest.json"));
    if (
      m.id !== job.snapshotId ||
      m.projectId !== job.projectId ||
      m.variant.id !== job.variantId
    )
      throw new PublishError("快照归属不匹配");
    const body = readFileSync(path.join(root, "正文.md"), "utf8");
    if (
      hash(
        JSON.stringify(
          {
            v: m.variant,
            platform: m.platform,
            publishingFields: m.publishingFields,
            body,
            segments: m.segments,
            media: m.media,
          },
          null,
          2,
        ),
      ) !== m.payloadHash
    )
      throw new PublishError("固定快照正文或清单已被修改");
    const media = [];
    for (const id of m.variant.assetIds) {
      const item = m.media[id];
      if (!item) throw new PublishError("快照缺少媒体");
      const file = safePath(root, item.file);
      if ((await fileHash(file)) !== item.sha256)
        throw new PublishError("固定快照媒体已被修改");
      const ext = path.extname(file).toLowerCase();
      media.push({
        id,
        file,
        sha256: item.sha256,
        mime:
          ext === ".png"
            ? "image/png"
            : ext === ".webp"
              ? "image/webp"
              : [".jpg", ".jpeg"].includes(ext)
                ? "image/jpeg"
                : "application/octet-stream",
      });
      if ((await stat(file)).size === 0) throw new PublishError("媒体文件为空");
    }
    return {
      ...this.binding(job.projectId, job.targetId),
      job,
      variant: m.variant,
      text: readFileSync(path.join(root, "正文.md"), "utf8"),
      media,
    };
  }
  start() {
    if (this.timer) return;
    this.stopped = false;
    const tick = () =>
      void this.tick().catch(() => {
        for (const { project } of this.workspace.contexts.values()) {
          this.backgroundErrors.set(
            project.id,
            "后台扫描失败，请检查项目目录后重新打开软件",
          );
          this.emit({ type: "workspace-changed", projectId: project.id });
        }
      });
    this.timer = setInterval(tick, 15000);
    this.heartbeat = setInterval(() => {
      for (const j of this.running.values()) {
        j.execution!.leaseUntil = new Date(this.clock() + 120000).toISOString();
        try {
          this.persist(j, "续约", true);
        } catch {
          /* next phase refuses lost lease */
        }
      }
    }, 30000);
    tick();
  }
  recover(projectId: string) {
    const { db, project } = this.workspace.context(projectId);
    if (project.readOnly) return;
    for (const j of db.list<Job>("jobs", projectId)) {
      if (!j.execution || final.includes(j.status) || this.running.has(j.id))
        continue;
      const e = j.execution;
      if (e.leaseOwner && Date.parse(e.leaseUntil ?? "") > this.clock())
        continue;
      if (j.status === "submitting") {
        j.status = "unknown";
        e.error = "提交时中断，先核实结果，禁止自动重发";
      } else if (["preparing", "validating"].includes(j.status))
        j.status = "scheduled";
      else continue;
      delete e.leaseOwner;
      delete e.leaseUntil;
      this.persist(j, "已恢复中断任务");
    }
  }
  claim(projectId: string, jobId: string): Job | undefined {
    const { db } = this.workspace.context(projectId, true);
    db.db.exec("BEGIN IMMEDIATE");
    try {
      const j = this.workspace.job(projectId, jobId);
      const e = j.execution!;
      if (
        !e ||
        ![
          "scheduled",
          "retry_wait",
          "processing",
          "accepted",
          "unknown",
        ].includes(j.status) ||
        db
          .list<Job>("jobs", projectId)
          .some(
            (other) =>
              other.id !== j.id &&
              other.accountId === j.accountId &&
              other.execution?.leaseOwner &&
              Date.parse(other.execution.leaseUntil ?? "") > this.clock(),
          )
      ) {
        db.db.exec("ROLLBACK");
        return;
      }
      if (e.leaseOwner && Date.parse(e.leaseUntil ?? "") > this.clock()) {
        db.db.exec("ROLLBACK");
        return;
      }
      e.leaseOwner = this.owner;
      e.leaseUntil = new Date(this.clock() + 120000).toISOString();
      db.put("jobs", j);
      db.db.exec("COMMIT");
      return j;
    } catch (e) {
      db.db.exec("ROLLBACK");
      throw e;
    }
  }
  async tick() {
    if (this.stopped) return;
    const managed = this.management();
    const work: Promise<void>[] = [];
    for (const { project, db } of this.workspace.contexts.values()) {
      if (project.readOnly || managed[project.id] === false) continue;
      this.recover(project.id);
      for (const candidate of db.list<Job>("jobs", project.id)) {
        if (this.running.size >= 2) break;
        const key = `${project.id}:${candidate.accountId}`;
        if (
          !candidate.execution ||
          candidate.mode === "manual_due" ||
          this.accountBusy.has(key) ||
          this.running.has(candidate.id)
        )
          continue;
        if (
          !["scheduled", "retry_wait", "processing", "accepted"].includes(
            candidate.status,
          )
        )
          continue;
        if (
          Date.parse(
            candidate.execution.nextAttemptAt ?? candidate.scheduledAtUtc,
          ) > this.clock()
        )
          continue;
        const j = this.claim(project.id, candidate.id);
        if (!j) continue;
        this.running.set(j.id, j);
        this.accountBusy.add(key);
        work.push(
          this.execute(j).finally(() => {
            this.running.delete(j.id);
            this.accountBusy.delete(key);
          }),
        );
      }
    }
    await Promise.allSettled(work);
  }
  async execute(j: Job) {
    const e = j.execution!;
    try {
      const c = this.connection(j.projectId, e.connectionId);
      const { account, target } = this.binding(j.projectId, j.targetId);
      if (
        !c.enabled ||
        c.status !== "connected" ||
        !account.enabled ||
        !target.enabled
      ) {
        j.status =
          e.submittedAt && querying.includes(j.status) ? j.status : "paused";
        e.error = "连接或账号已停用";
        e.nextAttemptAt = new Date(this.clock() + 60000).toISOString();
        this.persist(j, e.error, true);
        return;
      }
      if (
        c.revision !== e.connectionRevision &&
        !(e.submittedAt && e.remoteId && e.remoteId === c.remoteId)
      ) {
        j.status = e.submittedAt ? "unknown" : "needs_attention";
        e.error = "连接配置已更改，需重新确认目标";
        this.persist(j, e.error, true);
        return;
      }
      const a = this.adapter(c);
      const ctx = this.context(c, j);
      const input = await this.snapshot(j);
      if (querying.includes(j.status) && e.submittedAt) {
        await this.apply(
          j,
          await a.reconcile(input, ctx, e.prepared ?? {}, e.result),
        );
        return;
      }
      if (e.submittedAt) {
        j.status = "unknown";
        this.persist(j, "已有提交意图，只允许核实", true);
        return;
      }
      if (
        j.status === "scheduled" &&
        this.clock() - Date.parse(j.scheduledAtUtc) > 300000
      ) {
        j.status = "needs_attention";
        e.error = "错过排期超过 5 分钟，请重新安排，不自动补发";
        this.persist(j, e.error, true);
        return;
      }
      if (e.restored) {
        j.status = "paused";
        this.persist(j, "从备份恢复的任务需人工处理", true);
        return;
      }
      if (j.status !== "processing") e.attempt++;
      j.status = "validating";
      this.persist(j, "校验固定快照、账号与内容类型", true);
      await a.validate(input, ctx);
      j.status = "preparing";
      this.persist(j, "准备媒体，不公开发送", true);
      e.prepared = await a.prepare(input, ctx, e.prepared ?? {});
      if (e.prepared.ready === false) {
        j.status = "processing";
        e.nextAttemptAt = new Date(this.clock() + 15000).toISOString();
        this.persist(j, "媒体仍在处理中，尚未提交公开发布", true);
        return;
      }
      const current = this.connection(j.projectId, c.id);
      const latest = this.binding(j.projectId, j.targetId);
      if (this.stopped) return;
      if (
        !current.enabled ||
        current.revision !== c.revision ||
        !latest.account.enabled ||
        !latest.target.enabled
      ) {
        j.status = "paused";
        this.persist(j, "提交前连接已停用", true);
        return;
      }
      e.submittedAt = new Date(this.clock()).toISOString();
      j.status = "submitting";
      this.persist(j, "提交意图已持久化，开始请求平台", true);
      await this.apply(j, await a.submit(input, ctx, e.prepared));
    } catch (error) {
      if (this.stopped) return;
      // A receipt already committed locally remains final even if a later bookkeeping step fails.
      if (
        j.status === "published" &&
        this.workspace.job(j.projectId, j.id).status === "published"
      )
        return;
      const p =
        error instanceof PublishError
          ? error
          : new PublishError(
              error instanceof AppError
                ? error.message
                : "发布步骤失败，请检查连接与快照",
              false,
              false,
              undefined,
              j.status === "submitting",
            );
      if (p.authError) {
        for (const c of this.store
          .all()
          .filter(
            (c) => c.projectId === j.projectId && c.accountId === j.accountId,
          )) {
          c.enabled = false;
          c.status = "error";
          c.message = p.message;
          this.store.save(c);
          this.pauseConnection(c, p.message);
        }
      }
      if (
        (j.status === "submitting" && p.ambiguous) ||
        (j.status === "published" && e.submittedAt)
      ) {
        j.status = "unknown";
        e.result = { ...e.result, state: "unknown", message: p.message };
      } else if (querying.includes(j.status) && e.submittedAt) {
        e.nextAttemptAt = new Date(this.clock() + 60000).toISOString();
      } else {
        if (j.status === "submitting") delete e.submittedAt;
        j.status = p.authError
          ? "needs_attention"
          : p.retryable && e.attempt < 3
            ? "retry_wait"
            : "failed";
        if (j.status === "retry_wait")
          e.nextAttemptAt = new Date(
            this.clock() +
              Math.max(
                p.retryAfterMs ?? 0,
                [30000, 120000, 600000][e.attempt - 1] ?? 600000,
              ),
          ).toISOString();
      }
      e.error = p.message;
      this.persist(j, p.message, true);
    } finally {
      if (
        !this.stopped &&
        this.workspace.job(j.projectId, j.id).execution?.leaseOwner ===
          this.owner
      ) {
        delete e.leaseOwner;
        delete e.leaseUntil;
        this.persist(j, "本轮处理结束");
      }
    }
  }
  async apply(j: Job, result: PublishResult) {
    const e = j.execution!;
    e.result = result;
    e.error = result.message;
    if (result.state === "not_sent") {
      delete e.submittedAt;
      throw new PublishError(
        result.message ?? "平台明确未发送",
        result.retryable,
        result.authError,
        result.retryAfterMs,
      );
    }
    j.status = result.state;
    e.nextAttemptAt = ["processing", "accepted"].includes(result.state)
      ? new Date(this.clock() + 15000).toISOString()
      : undefined;
    this.persist(j, result.message ?? `平台返回 ${result.state}`, true);
    if (result.state === "published" && e.provider !== "mock") {
      const c = this.connection(j.projectId, e.connectionId);
      if (result.id)
        c.evidence = [
          ...(c.evidence ?? []).filter((v) => v.jobId !== j.id),
          {
            contentType: e.contentType ?? "unspecified",
            jobId: j.id,
            id: result.id,
            at: now(),
          },
        ];
      this.store.save(c);
      try {
        await this.adapter(c).cleanup?.(this.context(c, j), e.prepared ?? {});
      } catch {
        e.error = "发布已完成；临时媒体清理失败，可稍后重试清理";
        this.persist(j, e.error, true);
      }
    }
  }
  async action(
    projectId: string,
    jobId: string,
    action: "reconcile" | "retry" | "manual" | "pause" | "cleanup",
  ) {
    const j = this.workspace.job(projectId, jobId);
    this.workspace.context(projectId, true);
    if (!j.execution)
      throw new AppError("AUTOMATIC_REQUIRED", "这不是自动或模拟任务");
    if (j.mode === "manual_due")
      throw new AppError(
        "AUTOMATIC_REQUIRED",
        "已转为辅助发布，请使用人工回填",
      );
    if (
      this.running.has(j.id) ||
      (j.execution.leaseOwner &&
        Date.parse(j.execution.leaseUntil ?? "") > this.clock())
    )
      throw new AppError("PUBLISH_BUSY", "任务正在处理，请稍后操作");
    if (action === "reconcile") {
      const key = `${projectId}:${j.accountId}`;
      if (this.running.size >= 2 || this.accountBusy.has(key))
        throw new AppError(
          "PUBLISH_BUSY",
          "此账号或全局队列正在处理，请稍后核实",
        );
      if (!querying.includes(j.status))
        throw new AppError("RECONCILE_STATE", "当前任务无需核实");
      const claimed = this.claim(projectId, jobId);
      if (claimed) {
        this.running.set(j.id, claimed);
        this.accountBusy.add(key);
        try {
          await this.execute(claimed);
        } finally {
          this.running.delete(j.id);
          this.accountBusy.delete(key);
        }
      }
      return;
    }
    if (action === "cleanup") {
      if (j.status !== "published")
        throw new AppError("CLEANUP_STATE", "仅清理已发布任务的临时媒体");
      const c = this.connection(projectId, j.execution.connectionId);
      await this.adapter(c).cleanup?.(
        this.context(c),
        j.execution.prepared ?? {},
      );
      this.persist(j, "临时媒体清理已完成");
      return;
    }
    if (
      (irreversibleStates.includes(j.status) && j.status !== "processing") ||
      j.execution.submittedAt
    )
      throw new AppError(
        "RESULT_UNCERTAIN",
        "此任务已有提交或已结束，请先核实，不能重发或切换辅助",
      );
    if (action === "pause") j.status = "paused";
    if (action === "manual") {
      j.mode = "manual_due";
      j.status = "manual_pending";
    }
    if (action === "retry") {
      const c = this.connection(projectId, j.execution.connectionId);
      if (!c.enabled || c.status !== "connected")
        throw new AppError("CONNECTION_REQUIRED", "请先检查连接");
      if (!j.execution.remoteId || c.remoteId !== j.execution.remoteId)
        throw new AppError(
          "TARGET_CHANGED",
          "远端目标已改变，请从内容版本创建新排期并确认新目标",
        );
      if (j.execution.prepared?.temporary?.length)
        await this.adapter(c).cleanup?.(this.context(c), j.execution.prepared);
      j.execution.prepared = undefined;
      j.execution.connectionRevision = c.revision;
      j.execution.restored = false;
      j.execution.attempt = 0;
      j.execution.nextAttemptAt = undefined;
      j.scheduledAtUtc = new Date(this.clock()).toISOString();
      j.status = "scheduled";
    }
    this.persist(j, `用户操作：${action}`);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const j of this.running.values()) {
      if (final.includes(j.status)) continue;
      if (j.status === "submitting") j.status = "unknown";
      else if (!querying.includes(j.status)) j.status = "paused";
      delete j.execution!.leaseOwner;
      delete j.execution!.leaseUntil;
      this.persist(j, "软件退出，保留当前阶段供恢复");
    }
    this.stopped = true;
  }
}
