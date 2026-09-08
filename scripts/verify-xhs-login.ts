// Explicit, anonymous live check. It opens the official login page without logging in or publishing.
import { _electron as electron } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Workspace } from "../src/contracts/model";
import type { WebLoginStatus } from "../src/contracts/web-login";
const base = path.resolve(".local/xhs-live-check");
mkdirSync(base, { recursive: true });
const scratch = mkdtempSync(path.join(base, "run-"));
const project = path.join(scratch, "project");
mkdirSync(project);
const env: Record<string, string> = {
  ...process.env,
  WORKBENCH_USER_DATA: path.join(scratch, "user-data"),
  TEMP: scratch,
  TMP: scratch,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], env });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const ids = await page.evaluate(async (root) => {
    let w = await window.workbench.call<Workspace>("project.open", {
      path: root,
    });
    w = await window.workbench.call<Workspace>("accounts.add", {
      projectId: w.project.id,
      platform: "xiaohongshu",
      label: "官方入口检查",
      externalId: "",
      accountType: "profile",
    });
    const ids = { projectId: w.project.id, accountId: w.accounts.at(-1)!.id };
    await window.workbench.call("web-login.open", ids);
    return ids;
  }, project);
  const login =
    app.windows().find((p) => p !== page) ?? (await app.waitForEvent("window"));
  await login.waitForURL("https://creator.xiaohongshu.com/**", {
    timeout: 30000,
  });
  await login
    .getByText(/扫码登录|手机号登录|验证码登录|手机登录|短信登录/)
    .first()
    .waitFor({ timeout: 30000 });
  const text = await login.locator("body").innerText();
  const status = await page.evaluate(
    (ids) => window.workbench.call<WebLoginStatus>("web-login.check", ids),
    ids,
  );
  const result = {
    checkedAt: new Date().toISOString(),
    url: login.url(),
    title: await login.title(),
    officialLoginVisible: /扫码|验证码|手机号/.test(text),
    state: status.state,
    isolated: await login.evaluate(
      () =>
        typeof (window as any).workbench === "undefined" &&
        typeof (window as any).require === "undefined",
    ),
    authenticated: false,
  };
  await login.screenshot({ path: path.join(scratch, "official-login.png") });
  writeFileSync(
    path.join(base, "result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  if (
    !result.officialLoginVisible ||
    status.state !== "not_logged_in" ||
    !result.isolated
  )
    process.exitCode = 1;
} catch (error) {
  const login = app
    .windows()
    .find((p) => p.url().startsWith("https://creator.xiaohongshu.com"));
  if (login) {
    await login.screenshot({ path: path.join(base, "load-diagnostic.png") });
    console.log(
      JSON.stringify({
        url: login.url(),
        title: await login.title(),
        visibleText: (await login.locator("body").innerText()).slice(0, 2000),
      }),
    );
  }
  throw error;
} finally {
  await app.close();
}
