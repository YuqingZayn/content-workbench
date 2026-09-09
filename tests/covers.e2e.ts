import { test, expect, _electron as electron } from "@playwright/test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Content } from "../src/contracts/model";

test("local cover import, first-image reordering, independent video cover, library usage and reopen", async () => {
  const base = mkdtempSync(path.join(os.tmpdir(), "workbench-covers-"));
  const root = path.join(base, "封面管理验收");
  mkdirSync(root);
  copyFileSync(
    path.resolve("tests/fixtures/demo-h264.mp4"),
    path.join(root, "正文视频.mp4"),
  );
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    WORKBENCH_USER_DATA: path.join(base, "user-data"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.WORKBENCH_DEV_URL;
  delete env.WORKBENCH_AUTO_CONNECT_CODEX;
  const app = await electron.launch({ args: ["."], env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const dialog = async (file: string) =>
    app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, file);
  const save = async () => {
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.locator(".save-state")).toHaveText("已保存到本地");
  };
  const manifest = () =>
    JSON.parse(
      readFileSync(
        path.join(
          root,
          "content",
          readdirSync(path.join(root, "content"))[0],
          "manifest.json",
        ),
        "utf8",
      ),
    ) as Content;
  try {
    await dialog(root);
    await page
      .getByRole("button", { name: "打开本地文件夹", exact: true })
      .click();
    await page.getByRole("button", { name: "内容库", exact: true }).click();
    await page.getByRole("button", { name: "新建内容", exact: true }).click();
    await page.getByLabel("主题名称", { exact: true }).fill("封面工作流");
    await page.getByRole("button", { name: "创建主题", exact: true }).click();
    await page
      .getByRole("button", { name: "添加版本", exact: true })
      .first()
      .click();
    const modal = page.getByRole("dialog", { name: "添加平台版本" });
    await modal.getByLabel("平台", { exact: true }).selectOption("xiaohongshu");
    await modal.getByRole("button", { name: "添加版本", exact: true }).click();
    await page
      .getByLabel("版本正文", { exact: true })
      .fill("封面可以准确概括内容");
    const cover = page.getByRole("region", { name: "封面管理" });
    await expect(cover).toHaveAttribute("data-cover-mode", "first_media");
    await dialog(path.resolve("tests/fixtures/demo-1.png"));
    await cover.getByRole("button", { name: "导入首图", exact: true }).click();
    await expect(cover.locator(".cover-selection-info strong")).toHaveText(
      "demo-1.png",
    );
    await save();
    const first = manifest().variants[0].assetIds[0];
    await dialog(path.resolve("tests/fixtures/demo-2.png"));
    await cover.getByRole("button", { name: "导入首图", exact: true }).click();
    await expect(cover.locator(".cover-selection-info strong")).toHaveText(
      "demo-2.png",
    );
    await save();
    const second = manifest().variants[0].assetIds[0];
    expect(manifest().variants[0].assetIds).toEqual([second, first]);
    expect(manifest().variants[0].coverId).toBeNull();
    await page.getByRole("button", { name: "下移素材 1", exact: true }).click();
    await expect(cover.locator(".cover-selection-info strong")).toHaveText(
      "demo-1.png",
    );
    await expect(
      page.locator(".note-preview .preview-media img"),
    ).toHaveAttribute("alt", "demo-1.png");
    await page.getByLabel("发布类型", { exact: true }).selectOption("video");
    await expect(cover).toHaveAttribute("data-cover-mode", "independent");
    // Reimporting an existing image should deduplicate and select it as cover.
    await dialog(path.resolve("tests/fixtures/demo-2.png"));
    await cover.getByRole("button", { name: "导入封面", exact: true }).click();
    await expect(cover.locator(".cover-selection-info strong")).toHaveText(
      "demo-2.png",
    );
    await page.getByRole("button", { name: "移除关联 1", exact: true }).click();
    await page.getByRole("button", { name: "移除关联 1", exact: true }).click();
    await expect(cover.locator(".cover-selection-info strong")).toHaveText(
      "demo-2.png",
    );
    await page.getByRole("button", { name: "选择素材", exact: true }).click();
    await page
      .getByRole("dialog", { name: "关联项目素材" })
      .locator(".asset-pick")
      .filter({ hasText: "正文视频.mp4" })
      .click();
    await page.getByRole("button", { name: "完成选择", exact: true }).click();
    await save();
    expect(manifest().variants[0].coverId).toBe(second);
    expect(manifest().variants[0].assetIds).toHaveLength(1);
    expect(manifest().variants[0].assetIds).not.toContain(second);
    await expect(page.locator(".video-stage img")).toHaveAttribute(
      "alt",
      "视频封面",
    );
    await cover.locator("summary").click();
    await expect(cover.locator("table")).toContainText("Shorts");
    await cover.locator("summary").click();
    await page.locator(".editor-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    mkdirSync(path.resolve(".local/e2e-evidence"), { recursive: true });
    await page.screenshot({ path: ".local/e2e-evidence/covers-editor.png" });
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await page.getByRole("button", { name: "封面", exact: true }).click();
    await expect(page.locator(".asset-card")).toHaveCount(1);
    await expect(page.locator(".asset-card")).toContainText("demo-2.png");
    await page.locator(".asset-card").click();
    await expect(page.locator(".cover-usage")).toContainText(
      "封面工作流 · 小红书",
    );
    await page.reload();
    // Reopen via the public app API to avoid relying on shell restore preferences.
    const reopened = await page.evaluate(
      (root) =>
        window.workbench.call<{ contents: Content[] }>("project.open", {
          path: root,
        }),
      root,
    );
    expect(reopened.contents[0].variants[0].coverId).toBe(second);
    expect(errors).toEqual([]);
  } finally {
    await app
      .evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) win.destroy();
      })
      .catch(() => {});
    await app.close();
  }
});
