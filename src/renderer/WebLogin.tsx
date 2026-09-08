import React, { useEffect, useState } from "react";
import { Globe, LogIn, LogOut, RefreshCw } from "lucide-react";
import type { Workspace } from "../contracts/model";
import type { WebLoginState, WebLoginStatus } from "../contracts/web-login";
const api = window.workbench;
const stateLabels: Record<WebLoginState, string> = {
  not_logged_in: "未登录",
  waiting: "等待网页登录",
  saved: "会话已保存，待检查",
  logged_in: "已登录",
  expired: "登录已失效",
  network_error: "网络异常",
  unconfirmed: "待确认",
  account_mismatch: "登录账号不一致",
};
export function WebLoginPanel({
  w,
  initialAccountId,
  refresh,
  notice,
}: {
  w: Workspace;
  initialAccountId: string;
  refresh: () => Promise<void>;
  notice: (s: string) => void;
}) {
  const accounts = w.accounts.filter(
    (a) => a.platform === "xiaohongshu" && a.accountType !== "mock",
  );
  const [selected, setSelected] = useState(
    initialAccountId || accounts[0]?.id || "",
  );
  const [statuses, setStatuses] = useState<WebLoginStatus[]>([]);
  const [busy, setBusy] = useState(false);
  const [accountName, setAccountName] = useState("我的小红书");
  useEffect(() => {
    let active = true;
    const load = () =>
      void api
        .call<WebLoginStatus[]>("web-login.list", { projectId: w.project.id })
        .then((s) => {
          if (active) setStatuses(s);
        })
        .catch((e) => {
          if (active) notice(e.message);
        });
    load();
    const unsubscribe = api.onEvent((event) => {
      if (
        event.type === "web-login-changed" &&
        event.projectId === w.project.id
      )
        load();
    });
    const timer = setInterval(load, 3000);
    return () => {
      active = false;
      unsubscribe();
      clearInterval(timer);
    };
  }, [w.project.id, w.accounts, notice]);
  const currentId = accounts.some((a) => a.id === selected)
    ? selected
    : accounts[0]?.id;
  const account = accounts.find((a) => a.id === currentId);
  const status = statuses.find((s) => s.accountId === currentId);
  const run = async (
    action: "open" | "check" | "logout",
    accountId = currentId,
  ) => {
    if (!accountId) return;
    setBusy(true);
    try {
      const value = await api.call<WebLoginStatus>(`web-login.${action}`, {
        projectId: w.project.id,
        accountId,
      });
      setStatuses((old) => [
        ...old.filter((s) => s.accountId !== accountId),
        value,
      ]);
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card web-login-panel">
      <div className="web-login-heading">
        <Globe size={26} />
        <div>
          <h2>小红书网页登录</h2>
          <p>在官方创作服务平台完成扫码或手机号登录，会话保存在这台电脑。</p>
        </div>
      </div>
      {!accounts.length ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const next = await api.call<Workspace>("accounts.add", {
                projectId: w.project.id,
                platform: "xiaohongshu",
                label: accountName.trim(),
                externalId: "",
                accountType: "profile",
              });
              const id = next.accounts.at(-1)!.id;
              setSelected(id);
              await refresh();
              await run("open", id);
            } catch (error) {
              notice((error as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            小红书账号名称
            <input
              aria-label="小红书账号名称"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              required
              maxLength={100}
            />
          </label>
          <button
            className="primary"
            disabled={busy || w.project.readOnly || !accountName.trim()}
          >
            <LogIn size={17} />
            添加账号并登录小红书
          </button>
        </form>
      ) : (
        <>
          <label>
            网页登录账号
            <select
              aria-label="网页登录账号"
              value={currentId}
              disabled={busy}
              onChange={(e) => setSelected(e.target.value)}
            >
              {accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  {a.label}
                  {a.enabled ? "" : "（已停用）"}
                </option>
              ))}
            </select>
          </label>
          <div className="web-login-status" role="status">
            <strong
              className={`state ${status?.state === "logged_in" ? "green" : ""}`}
            >
              {status ? stateLabels[status.state] : "读取登录状态"}
            </strong>
            <p>{status?.message}</p>
            {status?.userId && (
              <p>
                最近核对的登录身份：
                {status.userName ? `${status.userName} · ` : ""}
                {status.userId}
              </p>
            )}
            {status?.checkedAt && (
              <small>
                最近检查：{new Date(status.checkedAt).toLocaleString()}
              </small>
            )}
          </div>
          <div className="button-row">
            <button
              className="primary"
              disabled={busy || w.project.readOnly || !account?.enabled}
              onClick={() => void run("open")}
            >
              <LogIn size={17} />
              {status?.state === "logged_in"
                ? "打开小红书网页版"
                : status?.windowOpen
                  ? "返回小红书登录窗口"
                  : "登录小红书"}
            </button>
            <button
              className="secondary"
              disabled={busy || w.project.readOnly}
              onClick={() => void run("check")}
            >
              <RefreshCw size={16} />
              检查小红书登录
            </button>
            <button
              className="secondary"
              disabled={busy || w.project.readOnly}
              onClick={() => void run("logout")}
            >
              <LogOut size={16} />
              退出本机登录
            </button>
          </div>
          {!account?.enabled && (
            <p className="hint">
              请先在“平台账号与目标”启用此账号，再打开登录页。
            </p>
          )}
        </>
      )}
      <div className="info-banner">
        <p>
          官方地址：creator.xiaohongshu.com。每个项目账号使用独立会话，关闭登录窗口仍会保留。换号请先“退出本机登录”，再重新扫码。
        </p>
      </div>
      <p className="hint">
        扫码、短信验证码和平台安全验证均在小红书官方页面完成。当前提供网页登录，图文自动发布尚未接入；原有辅助发布包仍可使用。
      </p>
    </section>
  );
}
