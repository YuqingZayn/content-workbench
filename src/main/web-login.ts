import { BrowserWindow, session, type Session } from "electron";
import path from "node:path";
import { existsSync } from "node:fs";
import { accountSchema, type AppEvent } from "../contracts/model";
import {
  allowedLoginNavigation,
  webLoginPartition,
  xhsIdentity,
  xhsWebLogin,
  type WebLoginStatus,
} from "../contracts/web-login";
import { AppError, readJson, writeJson } from "../services/files";
import { WorkspaceService } from "../services/workspace";

type LoginEntry = {
  session: Session;
  window?: BrowserWindow;
  epoch: number;
  pending?: Promise<WebLoginStatus>;
  debounce?: ReturnType<typeof setTimeout>;
  timer?: ReturnType<typeof setInterval>;
  abort?: AbortController;
  lastCheck: number;
  removeCookieListener: () => void;
};
export class WebLoginService {
  entries = new Map<string, LoginEntry>();
  states = new Map<string, WebLoginStatus>();
  clearing = new Set<string>();
  stopped = false;
  constructor(
    private workspace: WorkspaceService,
    private parent: () => BrowserWindow,
    private emit: (event: AppEvent) => void,
  ) {}
  account(projectId: string, accountId: string, write = false) {
    this.workspace.context(projectId, write);
    webLoginPartition(projectId, accountId);
    const account = this.workspace
      .list(projectId, "accounts", accountSchema)
      .find((a) => a.id === accountId);
    if (
      !account ||
      account.platform !== "xiaohongshu" ||
      account.accountType === "mock"
    )
      throw new AppError(
        "WEB_LOGIN_ACCOUNT",
        "请选择当前项目中登记的小红书账号",
      );
    return account;
  }
  file(projectId: string, accountId: string) {
    webLoginPartition(projectId, accountId);
    return path.join(
      this.workspace.appData,
      "web-logins",
      `${projectId}-${accountId}.json`,
    );
  }
  status(projectId: string, accountId: string): WebLoginStatus {
    this.account(projectId, accountId);
    const key = webLoginPartition(projectId, accountId);
    let status = this.states.get(key);
    if (!status) {
      const file = this.file(projectId, accountId);
      let saved: Partial<WebLoginStatus> = {};
      try {
        if (existsSync(file)) {
          const raw = readJson<unknown>(file);
          if (raw && typeof raw === "object" && !Array.isArray(raw))
            saved = raw;
        }
      } catch {
        /* Sessions can still be checked if metadata is damaged. */
      }
      status = {
        projectId,
        accountId,
        platform: "xiaohongshu",
        state: saved.userId ? "saved" : "not_logged_in",
        message: saved.userId
          ? "本机会话已保存，点击检查登录确认是否仍有效"
          : "尚未登录小红书",
        windowOpen: false,
        userId: typeof saved.userId === "string" ? saved.userId : undefined,
        userName:
          typeof saved.userName === "string" ? saved.userName : undefined,
        checkedAt:
          typeof saved.checkedAt === "string" ? saved.checkedAt : undefined,
      };
      this.states.set(key, status);
    }
    const windowOpen =
      !!this.entries.get(key)?.window &&
      !this.entries.get(key)!.window!.isDestroyed();
    if (
      status.state === "logged_in" &&
      Date.now() - Date.parse(status.checkedAt ?? "") > 300000
    )
      return {
        ...status,
        state: "saved",
        message: "登录检查已超过 5 分钟，点击检查确认当前状态",
        windowOpen,
      };
    return { ...status, windowOpen };
  }
  list(projectId: string) {
    return this.workspace
      .list(projectId, "accounts", accountSchema)
      .filter((a) => a.platform === "xiaohongshu" && a.accountType !== "mock")
      .map((a) => this.status(projectId, a.id));
  }
  save(status: WebLoginStatus) {
    if (this.stopped) return;
    this.states.set(
      webLoginPartition(status.projectId, status.accountId),
      status,
    );
    // Only status and public identity; browser secrets remain in the dedicated Chromium partition.
    writeJson(this.file(status.projectId, status.accountId), {
      ...status,
      windowOpen: false,
    });
    this.emit({ type: "web-login-changed", projectId: status.projectId });
  }
  entry(projectId: string, accountId: string) {
    const key = webLoginPartition(projectId, accountId);
    let entry = this.entries.get(key);
    if (!entry) {
      const ses = session.fromPartition(key);
      ses.setPermissionRequestHandler((_wc, _permission, callback) =>
        callback(false),
      );
      ses.setPermissionCheckHandler(() => false);
      ses.on("will-download", (e) => e.preventDefault());
      entry = {
        session: ses,
        epoch: 0,
        lastCheck: 0,
        removeCookieListener: () => {},
      };
      const onChange = () => this.queueCheck(projectId, accountId);
      ses.cookies.on("changed", onChange);
      entry.removeCookieListener = () =>
        ses.cookies.removeListener("changed", onChange);
      this.entries.set(key, entry);
    }
    return entry;
  }
  queueCheck(projectId: string, accountId: string) {
    const key = webLoginPartition(projectId, accountId);
    const e = this.entries.get(key);
    if (
      this.stopped ||
      !e?.window ||
      e.window.isDestroyed() ||
      this.clearing.has(key) ||
      e.debounce
    )
      return;
    e.debounce = setTimeout(
      () => {
        e.debounce = undefined;
        void this.check(projectId, accountId).catch(() => {});
      },
      Math.max(1000, 5000 - (Date.now() - e.lastCheck)),
    );
  }
  async open(projectId: string, accountId: string) {
    const a = this.account(projectId, accountId, true);
    if (!a.enabled) throw new AppError("ACCOUNT_DISABLED", "请先启用此账号");
    const key = webLoginPartition(projectId, accountId);
    if (this.clearing.has(key))
      throw new AppError(
        "LOGIN_BUSY",
        "正在清理此账号的本机会话，请稍后再登录",
      );
    const e = this.entry(projectId, accountId);
    if (e.window && !e.window.isDestroyed()) {
      e.window.show();
      e.window.focus();
      if (
        ["network_error", "unconfirmed"].includes(
          this.status(projectId, accountId).state,
        )
      )
        void e.window.loadURL(xhsWebLogin.home).catch(() => {});
      return this.status(projectId, accountId);
    }
    const previous = this.status(projectId, accountId);
    this.save({
      ...previous,
      state: "waiting",
      message: "已打开小红书官方页面，请完成扫码或手机号验证",
      windowOpen: true,
    });
    const window = new BrowserWindow({
      width: 1160,
      height: 820,
      minWidth: 850,
      minHeight: 640,
      show: true,
      parent: this.parent(),
      title: `小红书网页登录 · ${a.label} · creator.xiaohongshu.com`,
      backgroundColor: "#ffffff",
      webPreferences: {
        session: e.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        navigateOnDragDrop: false,
        spellcheck: false,
      },
    });
    e.window = window;
    window.setMenuBarVisibility(false);
    window.webContents.on("page-title-updated", (event) =>
      event.preventDefault(),
    );
    window.webContents.on("will-navigate", (event, url) => {
      if (!allowedLoginNavigation(url)) event.preventDefault();
    });
    window.webContents.on(
      "will-redirect",
      (event, url, _inPlace, mainFrame) => {
        if (mainFrame && !allowedLoginNavigation(url)) event.preventDefault();
      },
    );
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (allowedLoginNavigation(url)) void window.loadURL(url).catch(() => {});
      return { action: "deny" };
    });
    window.webContents.on("did-finish-load", () =>
      this.queueCheck(projectId, accountId),
    );
    window.webContents.on(
      "did-fail-load",
      (_event, code, _description, _url, mainFrame) => {
        if (
          mainFrame &&
          code !== -3 &&
          !this.stopped &&
          !this.clearing.has(key)
        )
          this.save({
            ...this.status(projectId, accountId),
            state: "network_error",
            message: "小红书网页加载失败，请检查网络后重新打开；原有会话保留",
          });
      },
    );
    window.on("closed", () => {
      e.window = undefined;
      if (e.timer) clearInterval(e.timer);
      if (e.debounce) clearTimeout(e.debounce);
      e.timer = e.debounce = undefined;
      if (this.stopped || this.clearing.has(key)) return;
      e.session.flushStorageData();
      void e.session.cookies.flushStore().catch(() => {});
      const status = this.status(projectId, accountId);
      this.save(
        status.state === "waiting"
          ? {
              ...status,
              state: status.userId ? "saved" : "not_logged_in",
              message: "登录窗口已关闭，可重新打开或检查本机会话",
            }
          : status,
      );
    });
    e.timer = setInterval(() => this.queueCheck(projectId, accountId), 10000);
    void window
      .loadURL(previous.userId ? xhsWebLogin.home : xhsWebLogin.login)
      .catch(() => {});
    return this.status(projectId, accountId);
  }
  async check(projectId: string, accountId: string): Promise<WebLoginStatus> {
    const a = this.account(projectId, accountId, true);
    const key = webLoginPartition(projectId, accountId);
    if (this.clearing.has(key))
      throw new AppError("LOGIN_BUSY", "正在退出本机登录");
    const e = this.entry(projectId, accountId);
    if (e.pending) return e.pending;
    const epoch = e.epoch;
    const previous = this.status(projectId, accountId);
    e.lastCheck = Date.now();
    e.abort = new AbortController();
    const timeout = setTimeout(() => e.abort?.abort(), 12000);
    const controller = e.abort;
    e.pending = (async () => {
      let result: ReturnType<typeof xhsIdentity>;
      try {
        const response = await e.session.fetch(xhsWebLogin.identity, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          redirect: "error",
          signal: controller.signal,
          headers: { Accept: "application/json", Referer: xhsWebLogin.home },
        });
        result = xhsIdentity(
          response.status,
          await response.json().catch(() => null),
        );
      } catch {
        result = {
          state: "network_error",
          message: "网络连接失败，无法检查登录；已有会话保留，请稍后重试",
        };
      }
      if (this.stopped || e.epoch !== epoch || this.clearing.has(key))
        return this.status(projectId, accountId);
      if (result.state === "not_logged_in" && previous.userId)
        result = {
          ...result,
          state: "expired",
          message: "小红书登录已失效，请重新登录",
        };
      if (
        result.state === "logged_in" &&
        /^[a-f\d]{24}$/i.test(a.externalId) &&
        a.externalId !== result.userId
      )
        result = {
          ...result,
          state: "account_mismatch",
          message:
            "实际登录 ID 与登记 ID 不一致，请核对账号；换号前先退出本机登录",
        };
      if (result.state === "logged_in" || result.state === "account_mismatch") {
        e.session.flushStorageData();
        await e.session.cookies.flushStore();
      }
      if (this.stopped || e.epoch !== epoch || this.clearing.has(key))
        return this.status(projectId, accountId);
      const status: WebLoginStatus = {
        ...previous,
        ...result,
        checkedAt: new Date().toISOString(),
        windowOpen: !!e.window,
      };
      this.save(status);
      return status;
    })().finally(() => {
      clearTimeout(timeout);
      e.pending = undefined;
    });
    return e.pending;
  }
  async logout(projectId: string, accountId: string) {
    this.account(projectId, accountId, true);
    const key = webLoginPartition(projectId, accountId);
    if (this.clearing.has(key))
      throw new AppError("LOGIN_BUSY", "正在退出本机登录");
    this.clearing.add(key);
    const e = this.entry(projectId, accountId);
    e.epoch++;
    e.abort?.abort();
    e.window?.destroy();
    e.window = undefined;
    try {
      await e.pending;
      await e.session.closeAllConnections();
      await e.session.clearStorageData();
      await e.session.clearCache();
      await e.session.clearAuthCache();
      e.session.flushStorageData();
      await e.session.cookies.flushStore();
      const status: WebLoginStatus = {
        projectId,
        accountId,
        platform: "xiaohongshu",
        state: "not_logged_in",
        message: "已退出此账号在工作台中的登录；其他浏览器和账号不受影响",
        windowOpen: false,
        checkedAt: new Date().toISOString(),
      };
      this.save(status);
      return status;
    } catch {
      this.save({
        ...this.status(projectId, accountId),
        state: "unconfirmed",
        message: "本机会话未完全清除，请再次点击退出本机登录",
      });
      throw new AppError(
        "LOGIN_CLEAR_FAILED",
        "本机会话未完全清除，请再次点击退出本机登录",
      );
    } finally {
      this.clearing.delete(key);
    }
  }
  close() {
    if (this.stopped) return;
    this.stopped = true;
    for (const e of this.entries.values()) {
      e.epoch++;
      e.abort?.abort();
      if (e.timer) clearInterval(e.timer);
      if (e.debounce) clearTimeout(e.debounce);
      e.removeCookieListener();
      e.session.flushStorageData();
      void e.session.cookies.flushStore().catch(() => {});
      if (e.window && !e.window.isDestroyed()) e.window.destroy();
    }
  }
}
