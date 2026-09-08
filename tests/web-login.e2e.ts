import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import type { Workspace } from "../src/contracts/model";
import type { WebLoginStatus } from "../src/contracts/web-login";
import { webLoginPartition } from "../src/contracts/web-login";

const base = mkdtempSync(path.join(os.tmpdir(), "workbench-web-login-"));
const userData = path.join(base, "app-data");
const root = path.join(base, "网页登录测试");
mkdirSync(root);
async function launch() {
  const env: Record<string, string> = {
    ...process.env,
    WORKBENCH_USER_DATA: userData,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}
async function mockOfficialSite(
  app: ElectronApplication,
  partition: string,
  networkFailure = false,
) {
  await app.evaluate(
    async ({ session }, args) => {
      const ses = session.fromPartition(args.partition);
      if (await ses.protocol.isProtocolHandled("https")) {
        // Only the explicitly registered custom handler can be removed, not Chromium's implementation.
        ses.protocol.unhandle("https");
      }
      ses.protocol.handle("https", async (request) => {
        if (new URL(request.url).hostname !== "creator.xiaohongshu.com")
          throw new Error("Unexpected test network request");
        if (request.url.includes("/api/galaxy/user/info")) {
          if (args.networkFailure)
            return new Response("{}", {
              status: 503,
              headers: { "Content-Type": "application/json" },
            });
          const cookies = await ses.cookies.get({
            url: "https://creator.xiaohongshu.com/",
            name: "test-session",
          });
          return new Response(
            JSON.stringify(
              cookies.length
                ? {
                    success: true,
                    data: {
                      userId: "abc123fixture",
                      userName: "测试小红书账号",
                    },
                  }
                : { success: false, result: -100 },
            ),
            {
              status: cookies.length ? 200 : 401,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        return new Response(
          `<html><meta charset="utf-8"><h1>模拟官方登录页面</h1>
        <button onclick="document.cookie='test-session=synthetic-browser-secret; Path=/; Max-Age=86400; Secure; SameSite=Lax';localStorage.setItem('private-fixture','local-only');location.href='/new/home'">模拟完成扫码</button>
        <a href="https://creator.xiaohongshu.com.evil.test/">不可信导航</a></html>`,
          { headers: { "Content-Type": "text/html; charset=utf-8" } },
        );
      });
    },
    { partition, networkFailure },
  );
}

test("xiaohongshu web login isolates accounts, persists sessions and protects logout from stale results", async () => {
  let { app, page } = await launch();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    const w = await page.evaluate(async (root) => {
      const w = await window.workbench.call<Workspace>("project.open", {
        path: root,
      });
      return window.workbench.call<Workspace>("accounts.add", {
        projectId: w.project.id,
        platform: "xiaohongshu",
        label: "测试小红书一",
        externalId: "",
        accountType: "profile",
      });
    }, root);
    const projectId = w.project.id,
      first = w.accounts[0].id;
    const second = await page.evaluate(async (projectId) => {
      const next = await window.workbench.call<Workspace>("accounts.add", {
        projectId,
        platform: "xiaohongshu",
        label: "测试小红书二",
        externalId: "",
        accountType: "profile",
      });
      return next.accounts.at(-1)!.id;
    }, projectId);
    const partition = webLoginPartition(projectId, first),
      secondPartition = webLoginPartition(projectId, second);
    await mockOfficialSite(app, partition);
    await mockOfficialSite(app, secondPartition);
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [root],
      });
    }, root);
    await page
      .getByRole("button", { name: "打开本地文件夹", exact: true })
      .click();
    await page.getByRole("button", { name: "账号与定位", exact: true }).click();
    await page
      .getByRole("button", { name: "小红书网页登录", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "小红书网页登录", exact: true }),
    ).toBeVisible();
    await page.getByLabel("网页登录账号").selectOption(first);
    await page.getByRole("button", { name: "登录小红书", exact: true }).click();
    await expect.poll(() => app.windows().length).toBe(2);
    let loginPage = app.windows().find((p) => p !== page)!;
    await loginPage
      .getByRole("heading", { name: "模拟官方登录页面" })
      .waitFor();
    expect(
      await loginPage.evaluate(() => [
        typeof (window as any).workbench,
        typeof (window as any).require,
        typeof (window as any).process,
      ]),
    ).toEqual(["undefined", "undefined", "undefined"]);
    const preferences = await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows().find((w) =>
        w.getTitle().startsWith("小红书网页登录"),
      )!.webContents;
      return (contents as any).getLastWebPreferences();
    });
    expect(preferences.nodeIntegration).toBe(false);
    expect(preferences.sandbox).toBe(true);
    expect(preferences.contextIsolation).toBe(true);
    expect(preferences.webSecurity).toBe(true);
    await loginPage.getByRole("button", { name: "模拟完成扫码" }).click();
    await page
      .getByRole("button", { name: "检查小红书登录", exact: true })
      .click();
    await expect(page.locator(".web-login-status")).toContainText("已登录");
    await expect(page.locator(".web-login-status")).toContainText(
      "测试小红书账号",
    );
    const states = await page.evaluate(
      (projectId) =>
        window.workbench.call<WebLoginStatus[]>("web-login.list", {
          projectId,
        }),
      projectId,
    );
    expect(JSON.stringify(states)).not.toContain("synthetic-browser-secret");
    const meta = readFileSync(
      path.join(userData, "web-logins", `${projectId}-${first}.json`),
      "utf8",
    );
    expect(meta).not.toContain("synthetic-browser-secret");
    await mockOfficialSite(app, partition, true);
    await page
      .getByRole("button", { name: "检查小红书登录", exact: true })
      .click();
    await expect(page.locator(".web-login-status")).toContainText("网络异常");
    expect(
      await app.evaluate(
        async ({ session }, partition) =>
          (
            await session
              .fromPartition(partition)
              .cookies.get({ name: "test-session" })
          ).length,
        partition,
      ),
    ).toBe(1);
    await mockOfficialSite(app, partition);
    await page
      .getByRole("button", { name: "检查小红书登录", exact: true })
      .click();
    await expect(page.locator(".web-login-status")).toContainText("已登录");
    await page.getByLabel("网页登录账号").selectOption(second);
    await page
      .getByRole("button", { name: "检查小红书登录", exact: true })
      .click();
    await expect(page.locator(".web-login-status")).toContainText("未登录");
    await page.getByRole("button", { name: "登录小红书", exact: true }).click();
    await expect.poll(() => app.windows().length).toBe(3);
    const secondPage = app
      .windows()
      .find((p) => p !== page && p !== loginPage)!;
    await secondPage.getByRole("button", { name: "模拟完成扫码" }).click();
    await page
      .getByRole("button", { name: "检查小红书登录", exact: true })
      .click();
    await expect(page.locator(".web-login-status")).toContainText("已登录");
    await app.close();
    ({ app, page } = await launch());
    await mockOfficialSite(app, partition);
    await mockOfficialSite(app, secondPartition);
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [root],
      });
    }, root);
    await page
      .getByRole("button", { name: "打开本地文件夹", exact: true })
      .click();
    await page.getByRole("button", { name: "账号与定位", exact: true }).click();
    await page
      .getByRole("button", { name: "小红书网页登录", exact: true })
      .click();
    await page.getByLabel("网页登录账号").selectOption(first);
    await expect(page.locator(".web-login-status")).toContainText(
      "会话已保存，待检查",
    );
    await page
      .getByRole("button", { name: "检查小红书登录", exact: true })
      .click();
    await expect(page.locator(".web-login-status")).toContainText("已登录");
    await page
      .getByRole("button", { name: "打开小红书网页版", exact: true })
      .click();
    await expect.poll(() => app.windows().length).toBe(2);
    loginPage = app.windows().find((p) => p !== page)!;
    await loginPage.waitForLoadState("domcontentloaded");
    expect(
      await loginPage.evaluate(() => localStorage.getItem("private-fixture")),
    ).toBe("local-only");
    await app.evaluate(({ session }, partition) => {
      const ses = session.fromPartition(partition);
      const original = ses.fetch.bind(ses);
      ses.fetch = async () => {
        ses.fetch = original;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return new Response(
          JSON.stringify({
            success: true,
            data: { userId: "late-result-must-not-relogin" },
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      };
    }, partition);
    await page.evaluate(
      async (args) => {
        await Promise.all([
          window.workbench.call("web-login.check", args),
          window.workbench.call("web-login.logout", args),
        ]);
      },
      { projectId, accountId: first },
    );
    await expect(page.locator(".web-login-status")).toContainText("未登录");
    await expect.poll(() => app.windows().length).toBe(1);
    expect(
      await app.evaluate(
        async ({ session }, partition) =>
          (
            await session
              .fromPartition(partition)
              .cookies.get({ name: "test-session" })
          ).length,
        partition,
      ),
    ).toBe(0);
    await page.getByRole("button", { name: "登录小红书", exact: true }).click();
    await expect.poll(() => app.windows().length).toBe(2);
    loginPage = app.windows().find((p) => p !== page)!;
    await loginPage
      .getByRole("heading", { name: "模拟官方登录页面" })
      .waitFor();
    expect(
      await loginPage.evaluate(() => localStorage.getItem("private-fixture")),
    ).toBeNull();
    await loginPage
      .getByRole("link", { name: "不可信导航" })
      .click({ noWaitAfter: true });
    expect(loginPage.url()).toBe("https://creator.xiaohongshu.com/login");
    await page.getByLabel("网页登录账号").selectOption(second);
    await page
      .getByRole("button", { name: "检查小红书登录", exact: true })
      .click();
    await expect(page.locator(".web-login-status")).toContainText("已登录");
    mkdirSync(".local/e2e-evidence", { recursive: true });
    await page.screenshot({ path: ".local/e2e-evidence/xhs-web-login.png" });
    // Closing the main window must also close the separate login window.
    const closed = app.waitForEvent("close");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.getTitle() === "内容工作台")!
        .close(),
    );
    await closed;
    expect(errors).toEqual([]);
  } finally {
    await app.close().catch(() => {});
  }
});
