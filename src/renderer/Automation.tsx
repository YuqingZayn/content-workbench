import React, { useEffect, useState } from "react";
import type { Job, Workspace } from "../contracts/model";
import {
  connectionSchema,
  mockScenarios,
  type Provider,
  type PublishConnection,
  type PublishEvent,
} from "../contracts/automation";
const api = window.workbench;
export const publishStatus: Record<string, string> = {
  scheduled: "已排期",
  paused: "已暂停",
  manual_pending: "待人工发布",
  validating: "校验中",
  preparing: "准备媒体",
  submitting: "正在提交",
  processing: "平台处理中",
  accepted: "平台已接收，待核实",
  published: "已核实发布",
  retry_wait: "等待重试",
  unknown: "结果未知，待核实",
  needs_attention: "需要处理",
  failed: "已失败",
  skipped: "已跳过",
};
const scenarioLabels: Record<string, string> = {
  success: "成功",
  processing: "平台处理中 → 核实成功",
  upload_failure: "上传失败（未提交）",
  submit_timeout: "最终提交超时（结果未知）",
  rate_limit: "限流后恢复",
  auth_expired: "授权失效",
  rejected: "内容被拒绝",
};
export function ConnectionsPanel({
  w,
  refresh,
  notice,
}: {
  w: Workspace;
  refresh: () => Promise<void>;
  notice: (s: string) => void;
}) {
  const [connections, setConnections] = useState<PublishConnection[]>([]),
    [targetId, setTargetId] = useState(""),
    [provider, setProvider] = useState<Provider>("discord"),
    [remoteId, setRemoteId] = useState(""),
    [scenario, setScenario] =
      useState<(typeof mockScenarios)[number]>("success"),
    [token, setToken] = useState(""),
    [webhook, setWebhook] = useState(""),
    [refreshToken, setRefreshToken] = useState(""),
    [clientId, setClientId] = useState(""),
    [mediaEndpoint, setMediaEndpoint] = useState(""),
    [mediaToken, setMediaToken] = useState(""),
    [graphVersion, setGraphVersion] = useState("v24.0"),
    [busy, setBusy] = useState(false),
    [mockPlatform, setMockPlatform] = useState("discord");
  const load = async () =>
    setConnections(
      await api.call<PublishConnection[]>("connections.list", {
        projectId: w.project.id,
      }),
    );
  useEffect(() => {
    void load().catch((e) => notice(e.message));
  }, [w.project.id, w.accounts, w.targets]);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
      await refresh();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const selectTarget = (id: string) => {
    setTargetId(id);
    const c = connections.find((c) => c.targetId === id);
    const a = w.accounts.find(
      (a) => a.id === w.targets.find((t) => t.id === id)?.accountId,
    );
    setProvider(
      c?.provider ??
        (a?.accountType === "mock" ? "mock" : (a?.platform as Provider)) ??
        "discord",
    );
    setRemoteId(c?.remoteId ?? "");
    setScenario(c?.scenario ?? "success");
    setClientId(c?.clientId ?? "");
    setGraphVersion(c?.graphVersion ?? "v24.0");
    setMediaEndpoint(c?.mediaEndpoint ?? "");
    setToken("");
    setWebhook("");
    setRefreshToken("");
    setMediaToken("");
  };
  const options = w.targets.filter((t) =>
    w.accounts.some(
      (a) =>
        a.id === t.accountId &&
        (a.accountType === "mock" ||
          ["discord", "x", "instagram", "facebook"].includes(a.platform)),
    ),
  );
  return (
    <div className="publishing-connections">
      <div className="info-banner">
        <p>
          自动发布支持 Discord、X、Instagram 专业账号和 Facebook
          Page。连接检查只验证身份，不代表已完成真实发帖验收。普通微信群与其他平台继续使用辅助发布。
        </p>
      </div>
      <section className="card settings-card">
        <div>
          <h2>本地模拟验收</h2>
          <p>使用专用模拟账号验证成功、超时、限流与恢复；不调用平台接口。</p>
        </div>
        <div className="button-row">
          <select
            aria-label="模拟目标平台"
            value={mockPlatform}
            onChange={(e) => setMockPlatform(e.target.value)}
          >
            {w.platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="secondary"
            disabled={busy || w.project.readOnly}
            onClick={() =>
              void run(() =>
                api.call("connections.mockTarget", {
                  projectId: w.project.id,
                  platform: mockPlatform,
                }),
              )
            }
          >
            创建模拟账号与目标
          </button>
        </div>
      </section>
      <form
        className="card profile-form"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await api.call("connections.save", {
              projectId: w.project.id,
              connection: connectionSchema.parse({
                targetId,
                provider,
                remoteId,
                scenario,
                clientId,
                mediaEndpoint,
                graphVersion,
              }),
              secrets: { token, webhook, refreshToken, mediaToken },
            });
            setToken("");
            setWebhook("");
            setRefreshToken("");
            setMediaToken("");
            notice("连接已保存，请检查连接后再安排发布");
          });
        }}
      >
        <h2>连接发布目标</h2>
        <label>
          目标
          <select
            aria-label="自动发布连接目标"
            required
            value={targetId}
            onChange={(e) => selectTarget(e.target.value)}
          >
            <option value="">请选择已登记的目标</option>
            {options.map((t) => (
              <option value={t.id} key={t.id}>
                {w.accounts.find((a) => a.id === t.accountId)?.label} →{" "}
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {targetId && (
          <>
            <p>
              连接方式：{provider === "mock" ? "本地模拟" : provider} ·
              密钥保存在本机系统加密存储，留空保留已有密钥。
            </p>
            {provider === "mock" ? (
              <label>
                模拟场景
                <select
                  aria-label="模拟场景"
                  value={scenario}
                  onChange={(e) =>
                    setScenario(e.target.value as typeof scenario)
                  }
                >
                  {mockScenarios.map((s) => (
                    <option value={s} key={s}>
                      {scenarioLabels[s]}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <>
                <label>
                  远端目标 ID
                  <input
                    aria-label="远端目标 ID"
                    value={remoteId}
                    onChange={(e) => setRemoteId(e.target.value)}
                    placeholder={
                      provider === "discord"
                        ? "频道 ID（检查时可读取）"
                        : "X 用户 ID / Instagram 专业账号 ID / Facebook Page ID"
                    }
                  />
                </label>
                {provider === "discord" ? (
                  <label>
                    Discord Webhook
                    <input
                      aria-label="Discord Webhook"
                      type="password"
                      autoComplete="off"
                      value={webhook}
                      onChange={(e) => setWebhook(e.target.value)}
                    />
                  </label>
                ) : (
                  <label>
                    访问令牌
                    <input
                      aria-label="平台访问令牌"
                      type="password"
                      autoComplete="off"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                    />
                  </label>
                )}
                {provider === "x" && (
                  <>
                    <label>
                      OAuth 客户端 ID
                      <input
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                      />
                    </label>
                    <label>
                      刷新令牌（offline.access 授权）
                      <input
                        type="password"
                        autoComplete="off"
                        value={refreshToken}
                        onChange={(e) => setRefreshToken(e.target.value)}
                      />
                    </label>
                    <p className="hint">
                      使用用户 OAuth 2.0 授权，需要
                      tweet.write、tweet.read、users.read
                      和媒体上传权限。令牌过期时在非提交阶段刷新；付费与配额以 X
                      开发者后台为准。
                    </p>
                  </>
                )}
                {["facebook", "instagram"].includes(provider) && (
                  <label>
                    Graph API 版本
                    <input
                      value={graphVersion}
                      onChange={(e) => setGraphVersion(e.target.value)}
                      placeholder="v24.0"
                    />
                  </label>
                )}
                {provider === "instagram" && (
                  <>
                    <p>
                      使用 Instagram Login 的专业账号令牌。单图 / 轮播使用
                      JPEG；Reel / Story 继续辅助发布。
                    </p>
                    <label>
                      临时媒体出口服务地址
                      <input
                        aria-label="媒体出口地址"
                        value={mediaEndpoint}
                        onChange={(e) => setMediaEndpoint(e.target.value)}
                        placeholder="https://你的服务"
                      />
                    </label>
                    <label>
                      媒体出口服务令牌
                      <input
                        type="password"
                        autoComplete="off"
                        value={mediaToken}
                        onChange={(e) => setMediaToken(e.target.value)}
                      />
                    </label>
                    <p className="hint">
                      媒体出口须实现文档中的对象上传与清理接口，只上传任务快照内的素材。
                    </p>
                  </>
                )}
              </>
            )}
            <button className="primary" disabled={busy || w.project.readOnly}>
              保存连接配置
            </button>
          </>
        )}
      </form>
      {connections.map((c) => (
        <section className="card settings-card" key={c.id}>
          <div>
            <h3>
              {w.targets.find((t) => t.id === c.targetId)?.label} ·{" "}
              {c.provider === "mock" ? "模拟连接" : c.provider}
            </h3>
            <p>
              {c.status === "connected"
                ? "连接已检查"
                : c.status === "error"
                  ? "连接失败"
                  : c.status === "disconnected"
                    ? "已断开"
                    : "尚未检查"}{" "}
              ·{" "}
              {c.verification === "simulated"
                ? "仅模拟"
                : c.verification === "verified"
                  ? "有真实发布回执"
                  : "真实发布未验证"}
            </p>
            <small>
              {c.message}{" "}
              {c.checkedAt && new Date(c.checkedAt).toLocaleString()}
            </small>
            <p>内容：{c.supportedTypes.join(" / ")} · 原生平台定时：未启用</p>
            <p>远端目标：{c.remoteId || "检查连接后确定"}</p>
            {c.evidence?.map((e) => (
              <small key={e.jobId}>
                仅此类型有真实回执：{e.contentType} ·{" "}
                {new Date(e.at).toLocaleString()} · {e.id}
              </small>
            ))}
          </div>
          <div className="button-row">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => selectTarget(c.targetId)}
            >
              编辑连接
            </button>
            <button
              className="primary"
              disabled={busy || w.project.readOnly}
              onClick={() =>
                void run(() =>
                  api.call("connections.check", {
                    projectId: w.project.id,
                    connectionId: c.id,
                  }),
                )
              }
            >
              检查发布连接
            </button>
            <button
              className="secondary"
              disabled={busy || w.project.readOnly || !c.enabled}
              onClick={() =>
                void run(() =>
                  api.call("connections.disconnect", {
                    projectId: w.project.id,
                    connectionId: c.id,
                  }),
                )
              }
            >
              断开并暂停
            </button>
          </div>
        </section>
      ))}
    </div>
  );
}
export function JobAutomationActions({
  job,
  refresh,
  notice,
}: {
  job: Job;
  refresh: () => Promise<void>;
  notice: (s: string) => void;
}) {
  const [events, setEvents] = useState<PublishEvent[] | null>(null),
    [busy, setBusy] = useState(false);
  if (!job.execution) return null;
  const run = async (action: string) => {
    setBusy(true);
    try {
      await api.call("publish.action", {
        projectId: job.projectId,
        jobId: job.id,
        action,
      });
      await refresh();
      if (events)
        setEvents(
          await api.call<PublishEvent[]>("publish.events", {
            projectId: job.projectId,
            jobId: job.id,
          }),
        );
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const canRetry =
    job.mode !== "manual_due" &&
    !job.execution.submittedAt &&
    [
      "paused",
      "failed",
      "needs_attention",
      "retry_wait",
      "processing",
    ].includes(job.status);
  return (
    <div className="automation-actions">
      <strong className="state">
        {job.mode === "simulation"
          ? "模拟 · 无外部发送"
          : job.mode === "manual_due"
            ? "已转辅助发布"
            : "自动发布"}
      </strong>
      <p>{job.execution.error}</p>
      <small>固定目标：{job.execution.remoteId || "未记录"}</small>
      {job.execution.result?.id && (
        <small>回执 ID：{job.execution.result.id}</small>
      )}
      {job.execution.result?.url && <p>{job.execution.result.url}</p>}
      <small>
        尝试 {job.execution.attempt} 次
        {job.execution.nextAttemptAt &&
          ` · 下次处理 ${new Date(job.execution.nextAttemptAt).toLocaleString()}`}
      </small>
      <div className="button-row">
        {["unknown", "accepted", "processing"].includes(job.status) && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run("reconcile")}
          >
            核实平台结果
          </button>
        )}
        {canRetry && (
          <>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run("retry")}
            >
              重新安排现在执行
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run("manual")}
            >
              转为辅助发布
            </button>
          </>
        )}
        {!job.execution.submittedAt &&
          job.mode !== "manual_due" &&
          ["scheduled", "retry_wait", "needs_attention", "processing"].includes(
            job.status,
          ) && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => void run("pause")}
            >
              暂停自动任务
            </button>
          )}
        {job.status === "published" &&
        job.execution.prepared?.temporary?.length &&
        !job.execution.prepared.cleanupDone ? (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void run("cleanup")}
          >
            清理临时媒体
          </button>
        ) : null}
        <button
          className="text-button"
          onClick={() => {
            if (events) setEvents(null);
            else
              void api
                .call<PublishEvent[]>("publish.events", {
                  projectId: job.projectId,
                  jobId: job.id,
                })
                .then(setEvents)
                .catch((e) => notice(e.message));
          }}
        >
          操作记录
        </button>
      </div>
      {events && (
        <div className="automation-events">
          {events
            .filter((e) => e.message !== "续约")
            .map((e) => (
              <p key={e.id}>
                {new Date(e.at).toLocaleString()} ·{" "}
                {publishStatus[e.status] ?? e.status} · {e.message}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}

type BackgroundProject = {
  projectId: string;
  name: string;
  enabled: boolean;
  pending: number;
  message: string;
};
export function BackgroundPanel({
  projectId,
  notice,
}: {
  projectId: string;
  notice: (s: string) => void;
}) {
  const [projects, setProjects] = useState<BackgroundProject[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void api
        .call<BackgroundProject[]>("background.list")
        .then((v) => {
          if (alive) setProjects(v);
        })
        .catch((e) => notice(e.message));
    load();
    const timer = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId, notice]);
  return (
    <section className="card backup-card">
      <h2>后台发布项目</h2>
      <p>
        切换项目后，已确认的排期仍会处理。隐藏到托盘可继续运行；完全退出后停止，错过超过
        5 分钟的排期需要重新安排。
      </p>
      <button
        className="secondary"
        onClick={() =>
          void api.call("app.background").catch((e) => notice(e.message))
        }
      >
        隐藏到托盘，继续处理
      </button>
      {projects.map((p) => (
        <div className="settings-card" key={p.projectId}>
          <div>
            <strong>{p.name}</strong>
            <p>
              {p.pending} 项未完成 · {p.message}
            </p>
          </div>
          <button
            className="secondary"
            disabled={busy || !p.enabled}
            onClick={async () => {
              setBusy(true);
              try {
                setProjects(
                  await api.call<BackgroundProject[]>("background.stop", {
                    projectId: p.projectId,
                  }),
                );
              } catch (e) {
                notice((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            停止管理并暂停待执行任务
          </button>
        </div>
      ))}
    </section>
  );
}
