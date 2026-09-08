import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
} from "@playwright/test";
import { mkdirSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Fixture only replaces Codex transport. Pages and project operations use the real Electron app.
async function mockCodex(app: ElectronApplication) {
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    const original = (ipcMain as any)._invokeHandlers.get("workbench:call");
    if (!original) throw new Error("Workbench IPC handler missing");
    const status = {
      state: "ready",
      message: "UI fixture",
      version: "fixture",
      defaultModel: "fixture",
      defaultReasoningEffort: "medium",
      models: [
        {
          id: "fixture",
          label: "Fixture model",
          supportedReasoningEfforts: [
            { reasoningEffort: "medium", description: "fixture" },
            { reasoningEffort: "high", description: "fixture" },
          ],
          defaultReasoningEffort: "medium",
        },
      ],
    };
    const runs: any[] = [];
    const requests: any[] = [];
    const emit = (event: any) =>
      BrowserWindow.getAllWindows()[0].webContents.send(
        "workbench:event",
        event,
      );
    ipcMain.on("fixture:finish-chat", () => {
      const run = runs.find((r) => r.status === "running");
      if (!run) throw new Error("No simulated active run");
      run.output = "选题建议：分享一次项目里的真实发现。";
      run.status = "completed";
      emit({ type: "run-status", projectId: run.projectId, runId: run.id });
    });
    ipcMain.handle("fixture:chat-requests", () => requests);
    ipcMain.removeHandler("workbench:call");
    ipcMain.handle("workbench:call", async (event, payload) => {
      if (["codex.connect", "codex.status"].includes(payload.method))
        return { ok: true, data: status };
      if (payload.method === "codex.start") {
        requests.push(payload.input);
        if (payload.input.prompt === "模拟发送失败")
          return { ok: false, error: { message: "模拟连接失败" } };
        const run = {
          ...payload.input,
          id: `fixture-${runs.length}`,
          createdAt: new Date().toISOString(),
          status: "running",
          output: "",
          baseRevision: 0,
        };
        runs.unshift(run);
        emit({ type: "run-status", projectId: run.projectId, runId: run.id });
        setTimeout(() => {
          if (run.status !== "running") return;
          emit({
            type: "codex-delta",
            projectId: run.projectId,
            runId: run.id,
            text: "正在梳理",
          });
          run.output = "正在梳理";
        }, 100);
        return { ok: true, data: run };
      }
      const result = await original(event, payload);
      if (result.ok && payload.method === "app.bootstrap")
        result.data.codex = status;
      if (result.ok && payload.method === "project.load")
        result.data.runs = [
          ...runs.filter((r) => r.projectId === result.data.project.id),
          ...result.data.runs,
        ];
      return result;
    });
  });
}

test("global assistant is usable before topics, keeps input and streaming across every page, and supports scoped drafting", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "workbench-global-chat-"));
  const root = path.join(base, "选题工作空间");
  mkdirSync(root);
  const env: Record<string, string> = {
    ...process.env,
    WORKBENCH_USER_DATA: path.join(base, "app-data"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await mockCodex(app);
    await page.reload();
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [root],
      });
    }, root);
    await page
      .getByRole("button", { name: "打开本地文件夹", exact: true })
      .click();
    const assistant = page.getByRole("complementary", {
      name: "Codex 助手",
      exact: true,
    });
    const input = page.getByLabel("Codex 生成要求", { exact: true });
    await expect(assistant).toBeVisible();
    await expect(page.getByLabel("Codex 对话范围")).toHaveValue("");
    await expect(assistant).toContainText("从一个想法开始");
    await input.fill("未发送的选题想法");
    for (const name of [
      "内容库",
      "素材库",
      "发布日历",
      "发布记录",
      "账号与定位",
      "设置与备份",
      "工作台",
    ]) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(assistant).toBeVisible();
      await expect(input).toHaveValue("未发送的选题想法");
    }
    await page.getByRole("button", { name: "切换 Codex 面板" }).click();
    await expect(assistant).toBeHidden();
    await page.getByRole("button", { name: "切换 Codex 面板" }).click();
    await expect(input).toHaveValue("未发送的选题想法");
    await input.fill("从选题开始");
    await input.press("Shift+Enter");
    await input.press("End");
    await input.pressSequentially("继续讨论");
    await expect(input).toHaveValue("从选题开始\n继续讨论");
    await input.dispatchEvent("keydown", {
      key: "Enter",
      code: "Enter",
      isComposing: true,
    });
    await expect(input).not.toHaveValue("");
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect(assistant).toContainText("正在梳理");
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await expect(assistant).toContainText("从选题开始");
    await expect(assistant).toContainText("正在梳理");
    await app.evaluate(({ ipcMain }) => {
      ipcMain.emit("fixture:finish-chat");
    });
    await expect(assistant).toContainText(
      "选题建议：分享一次项目里的真实发现。",
    );
    const requests = await app.evaluate(async ({ ipcMain }) =>
      (ipcMain as any)._invokeHandlers.get("fixture:chat-requests")(),
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].contentId).toBeUndefined();
    expect(requests[0].view).toEqual({ page: "dashboard" });
    expect(requests[0].mode).toBe("task");
    await input.fill("模拟发送失败");
    await input.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: "模拟连接失败" }),
    ).toBeVisible();
    await expect(input).toHaveValue("模拟发送失败");
    await page.getByRole("button", { name: "关闭提示", exact: true }).click();
    await input.fill("项目对话的输入草稿");
    await page.getByRole("button", { name: "工作台", exact: true }).click();
    await page.getByRole("button", { name: "新建内容", exact: true }).click();
    await page.getByLabel("主题名称", { exact: true }).fill("第一条选题");
    await page.getByRole("button", { name: "创建主题", exact: true }).click();
    await expect(input).toHaveValue("项目对话的输入草稿");
    await expect(assistant).toContainText(
      "选题建议：分享一次项目里的真实发现。",
    );
    await expect(assistant).toContainText("当前页面：内容编辑 · 第一条选题");
    await page
      .getByLabel("Codex 对话范围")
      .selectOption({ label: "主题 · 第一条选题" });
    await expect(assistant).not.toContainText(
      "选题建议：分享一次项目里的真实发现。",
    );
    await expect(input).toHaveValue("");
    await input.fill("主题对话的输入草稿");
    await page.getByLabel("Codex 对话范围").selectOption("");
    await expect(input).toHaveValue("项目对话的输入草稿");
    await page
      .getByLabel("Codex 对话范围")
      .selectOption({ label: "主题 · 第一条选题" });
    await expect(input).toHaveValue("主题对话的输入草稿");
    await page
      .getByRole("button", { name: "按当前平台与语言起草", exact: true })
      .click();
    await expect(page.getByLabel("Codex 任务方式")).toHaveValue("draft");
    await expect(
      page.getByRole("button", { name: "开始生成", exact: true }),
    ).toBeDisabled();
    await expect(assistant).toContainText("请先在内容编辑中添加平台版本");
    await page.getByLabel("Codex 对话范围").selectOption("");
    await page.getByRole("button", { name: "工作台", exact: true }).click();
    for (const width of [1280, 1920]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        BrowserWindow.getAllWindows()[0].setSize(width, 1000);
      }, width);
      await expect(assistant).toBeVisible();
      const fits = await page.evaluate(() => {
        const aside = document
          .querySelector(".assistant")!
          .getBoundingClientRect();
        const main = document.querySelector(".main-scroll")!;
        return (
          aside.right <= innerWidth + 1 &&
          main.scrollWidth <= main.clientWidth + 1 &&
          document.documentElement.scrollWidth <= innerWidth
        );
      });
      expect(fits).toBe(true);
    }
    mkdirSync(".local/e2e-evidence", { recursive: true });
    await page.screenshot({
      path: ".local/e2e-evidence/global-codex-dashboard.png",
    });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
