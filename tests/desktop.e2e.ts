import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  openSync,
  writeSync,
  ftruncateSync,
  closeSync,
  unlinkSync,
  readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import type { Workspace } from "../src/contracts/model";
const base = mkdtempSync(path.join(os.tmpdir(), "content-workbench-e2e-"));
const userData = path.join(base, "user-data");
const official = path.join(base, "演示官号");
const founder = path.join(base, "演示创始人");
for (const folder of [official, founder, path.resolve(".local/e2e-evidence")])
  mkdirSync(folder, { recursive: true });
async function launch() {
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    WORKBENCH_USER_DATA: userData,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env, timeout: 30000 });
  const page = await app.firstWindow();
  page.on("console", (message) => {
    if (message.type() === "error") console.log("Renderer:", message.text());
  });
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}
async function dialogFiles(app: ElectronApplication, paths: string[]) {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, paths);
}
async function addVariant(
  page: Page,
  platform: string,
  locale: string,
  body: string,
) {
  await page
    .getByRole("button", { name: "添加版本", exact: true })
    .first()
    .click();
  const modal = page.getByRole("dialog", { name: "添加平台版本" });
  await modal.getByLabel("平台", { exact: true }).selectOption(platform);
  await modal.getByLabel("语言", { exact: true }).selectOption(locale);
  await modal.getByRole("button", { name: "添加版本", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await page.getByLabel("版本正文", { exact: true }).fill(body);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect(page.locator(".save-state")).toHaveText("已保存到本地");
}

test("native platform forms, media formats, message editing and persisted metadata", async () => {
  const root = path.join(base, "平台专用发布验收");
  mkdirSync(root);
  let { app, page } = await launch();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const save = async () => {
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.locator(".save-state")).toHaveText("已保存到本地");
  };
  const attach = async (names: string[]) => {
    await page.getByRole("button", { name: "选择素材", exact: true }).click();
    for (const name of names)
      await page.locator(".asset-pick").filter({ hasText: name }).click();
    await page.getByRole("button", { name: "完成选择", exact: true }).click();
  };
  const screenshot = async (name: string) => {
    await page.locator(".editor-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: `.local/e2e-evidence/native-${name}.png` });
  };
  try {
    await dialogFiles(app, [root]);
    await page
      .getByRole("button", { name: "打开本地文件夹", exact: true })
      .click();
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await dialogFiles(
      app,
      ["demo-1.png", "demo-2.png", "demo-h264.mp4"].map((f) =>
        path.resolve("tests/fixtures", f),
      ),
    );
    await page.getByRole("button", { name: "导入素材", exact: true }).click();
    await expect(page.locator(".asset-card")).toHaveCount(3);
    await page.getByRole("button", { name: "内容库", exact: true }).click();
    await page.getByRole("button", { name: "新建内容", exact: true }).click();
    await page.getByLabel("主题名称", { exact: true }).fill("各平台发布准备");
    await page.getByRole("button", { name: "创建主题", exact: true }).click();
    await page
      .getByLabel("Codex 对话范围", { exact: true })
      .selectOption({ label: "主题 · 各平台发布准备" });
    await expect(
      page.getByLabel("Codex 任务方式", { exact: true }),
    ).toHaveValue("task");
    await expect(page.locator(".assistant-header")).toContainText(
      "Full Access",
    );
    await expect(
      page.getByLabel("Codex 参考版本", { exact: true }),
    ).toHaveValue("");
    await page
      .getByRole("button", { name: "按当前平台与语言起草", exact: true })
      .click();
    await expect(
      page.getByLabel("Codex 任务方式", { exact: true }),
    ).toHaveValue("draft");
    await page
      .getByLabel("Codex 任务方式", { exact: true })
      .selectOption("task");
    await addVariant(page, "youtube", "zh-CN", "这是视频简介。");
    await expect(
      page.getByLabel("Codex 参考版本", { exact: true }),
    ).toHaveValue("");
    await page
      .getByLabel("Codex 任务方式", { exact: true })
      .selectOption("draft");
    await expect(
      page.getByLabel("Codex 参考版本", { exact: true }),
    ).not.toHaveValue("");
    await page
      .getByLabel("Codex 任务方式", { exact: true })
      .selectOption("task");
    await page.getByLabel("Codex 参考版本", { exact: true }).selectOption("");
    await page
      .getByLabel("视频可见性", { exact: true })
      .selectOption("unlisted");
    await page
      .getByLabel("是否面向儿童", { exact: true })
      .selectOption("general");
    await page.getByLabel("播放列表", { exact: true }).fill("入门教程");
    await page
      .getByLabel("章节时间轴", { exact: true })
      .fill("00:00 开场\n00:30 演示\n02:00 总结");
    await attach(["demo-h264.mp4", "demo-1.png"]);
    await expect(page.locator(".video-stage video")).toHaveCount(0);
    await page.getByRole("button", { name: "设置封面 2", exact: true }).click();
    await page
      .getByRole("button", { name: "播放预览 demo-h264.mp4", exact: true })
      .click();
    await expect
      .poll(() =>
        page
          .locator(".video-stage video")
          .evaluate((video: HTMLVideoElement) => video.readyState),
      )
      .toBeGreaterThanOrEqual(2);
    await expect(page.locator(".video-preview")).toContainText("02:00 总结");
    await page.getByLabel("发布类型", { exact: true }).selectOption("shorts");
    await expect(page.locator('[data-composer="short_video"]')).toBeVisible();
    await expect(page.getByLabel("版本标题", { exact: true })).toBeVisible();
    await expect(page.getByLabel("章节时间轴", { exact: true })).toHaveCount(0);
    await expect(page.locator(".video-preview")).not.toContainText(
      "02:00 总结",
    );
    await page.getByLabel("发布类型", { exact: true }).selectOption("video");
    await expect(page.getByLabel("章节时间轴", { exact: true })).toHaveValue(
      "00:00 开场\n00:30 演示\n02:00 总结",
    );
    await save();
    await screenshot("youtube");
    await addVariant(page, "bilibili", "zh-CN", "B站投稿简介");
    await page.getByLabel("投稿类型", { exact: true }).selectOption("repost");
    await page
      .getByLabel("转载来源", { exact: true })
      .fill("https://example.com/original");
    await page.getByLabel("投稿分区", { exact: true }).fill("知识");
    await page.getByLabel("所属合集", { exact: true }).fill("学习记录");
    await page.getByLabel("发布类型", { exact: true }).selectOption("dynamic");
    await expect(page.getByLabel("投稿分区", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("版本标题", { exact: true })).toBeHidden();
    await expect(page.locator(".post-preview-actions")).toContainText("转发");
    await page.getByLabel("发布类型", { exact: true }).selectOption("video");
    await expect(page.getByLabel("转载来源", { exact: true })).toHaveValue(
      "https://example.com/original",
    );
    await save();
    await screenshot("bilibili");
    await addVariant(page, "douyin", "zh-CN", "抖音图文配文");
    await page.getByLabel("发布类型", { exact: true }).selectOption("images");
    await attach(["demo-1.png", "demo-2.png"]);
    await page.getByLabel("作品位置", { exact: true }).fill("深圳");
    await page.getByLabel("封面文案", { exact: true }).fill("三步上手");
    await expect(page.locator(".douyin-images-preview")).toContainText(
      "三步上手",
    );
    await save();
    await screenshot("douyin");
    await addVariant(page, "instagram", "en", "A visual story");
    await attach(["demo-1.png", "demo-2.png"]);
    await page.getByLabel("帖子位置", { exact: true }).fill("Shanghai");
    await page
      .getByLabel("图片替代文字 · demo-1.png", { exact: true })
      .fill("A synthetic demo picture");
    await expect(
      page.locator(".photo-preview .preview-media img"),
    ).toHaveAttribute("alt", "A synthetic demo picture");
    await page.getByLabel("发布类型", { exact: true }).selectOption("reel");
    await expect(page.locator('[data-preview="short_video"]')).toBeVisible();
    await page.getByLabel("发布类型", { exact: true }).selectOption("story");
    await expect(page.locator(".story-preview .preview-media")).toHaveCSS(
      "aspect-ratio",
      "9 / 16",
    );
    await page.getByRole("button", { name: "下一张预览", exact: true }).click();
    await expect(page.locator(".story-preview img")).toHaveAttribute(
      "alt",
      "demo-2.png",
    );
    await page.getByLabel("发布类型", { exact: true }).selectOption("feed");
    await expect(
      page.getByLabel("图片替代文字 · demo-1.png", { exact: true }),
    ).toHaveValue("A synthetic demo picture");
    await save();
    await screenshot("instagram");
    await addVariant(page, "facebook", "en", "Read this update");
    await page.getByLabel("发布类型", { exact: true }).selectOption("link");
    await page
      .getByLabel("分享链接", { exact: true })
      .fill("https://example.com/update");
    await page
      .getByLabel("链接标题备注", { exact: true })
      .fill("Project update");
    await page.getByLabel("预期可见范围", { exact: true }).fill("朋友");
    await expect(page.locator(".facebook-link-card")).toContainText(
      "Project update",
    );
    await expect(page.locator(".post-preview-actions")).toHaveText(
      "赞评论分享",
    );
    await save();
    await screenshot("facebook");
    await addVariant(
      page,
      "discord",
      "en",
      "**Release notes**\n`npm run dev`\n||Preview details||",
    );
    await page.getByLabel("发布类型", { exact: true }).selectOption("forum");
    await page
      .getByLabel("版本标题", { exact: true })
      .fill("Release discussion");
    await page.getByLabel("论坛标签", { exact: true }).fill("release feedback");
    await expect(page.locator(".forum-heading")).toContainText(
      "Release discussion",
    );
    await expect(page.locator(".discord-markdown strong")).toHaveText(
      "Release notes",
    );
    await expect(page.locator(".discord-markdown code")).toHaveText(
      "npm run dev",
    );
    await expect(page.locator(".discord-spoiler")).not.toHaveAttribute(
      "open",
      "",
    );
    await save();
    await screenshot("discord");
    await page.getByRole("button", { name: "文字段", exact: true }).click();
    await expect(page.getByLabel("第 1 段文字", { exact: true })).toHaveValue(
      "**Release notes**\n`npm run dev`\n||Preview details||",
    );
    await page
      .getByLabel("第 2 段文字", { exact: true })
      .fill("Follow-up message");
    await save();
    await addVariant(page, "wechat", "zh-CN", "第一段\n\n第二段");
    await attach(["demo-1.png"]);
    await page
      .getByLabel("发布类型", { exact: true })
      .selectOption("announcement");
    await page
      .getByRole("button", { name: "按空行拆分正文", exact: true })
      .click();
    await expect(page.getByLabel("第 1 段文字", { exact: true })).toHaveValue(
      "第一段",
    );
    await expect(page.getByLabel("第 2 段文字", { exact: true })).toHaveValue(
      "第二段",
    );
    await expect(page.locator(".segment")).toHaveCount(3);
    await page
      .getByRole("button", { name: "复制消息段 2", exact: true })
      .click();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      "第二段",
    );
    await page
      .getByRole("button", { name: "加入已选媒体", exact: true })
      .click();
    await expect(page.locator(".segment")).toHaveCount(3);
    await save();
    await screenshot("wechat");
    await app.close();
    ({ app, page } = await launch());
    await dialogFiles(app, [root]);
    await page
      .getByRole("button", { name: "打开本地文件夹", exact: true })
      .click();
    const data = await page.evaluate(async () => {
      const boot = await window.workbench.call<{ recent: { id: string }[] }>(
        "app.bootstrap",
      );
      return window.workbench.call<Workspace>("project.load", {
        projectId: boot.recent[0].id,
      });
    });
    const variants = data.contents[0].variants;
    expect(variants).toHaveLength(7);
    expect(
      variants.find((v) => v.platform === "youtube")!.publishing.youtube
        .playlist,
    ).toBe("入门教程");
    expect(
      variants.find((v) => v.platform === "bilibili")!.publishing.bilibili
        .source,
    ).toBe("https://example.com/original");
    expect(
      variants.find((v) => v.platform === "facebook")!.publishing.facebook
        .linkUrl,
    ).toBe("https://example.com/update");
    expect(
      variants.find((v) => v.platform === "wechat")!.segments,
    ).toHaveLength(3);
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
});

test("editable platforms, distinct composers and light default survive restart", async () => {
  const root = path.join(base, "平台界面验收");
  mkdirSync(root, { recursive: true });
  let { app, page } = await launch();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(246, 247, 249)",
    );
    await dialogFiles(app, [root]);
    await page
      .getByRole("button", { name: "打开本地文件夹", exact: true })
      .click();
    await page.getByRole("button", { name: "账号与定位", exact: true }).click();
    await page.getByRole("button", { name: "平台管理", exact: true }).click();
    const manager = page.getByRole("region", { name: "平台管理", exact: true });
    await manager
      .getByRole("button", { name: "编辑微信公众号", exact: true })
      .click();
    await manager.getByLabel("平台名称", { exact: true }).fill("公众号验收");
    await expect(manager.getByLabel("编辑方式", { exact: true })).toHaveValue(
      "article",
    );
    await manager
      .getByRole("button", { name: "保存平台", exact: true })
      .click();
    await expect(
      manager.getByRole("button", { name: "编辑公众号验收", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "平台账号与目标", exact: true })
      .click();
    await page
      .getByRole("button", { name: "登记平台账号", exact: true })
      .click();
    const modal = page.getByRole("dialog", {
      name: "登记平台账号",
      exact: true,
    });
    await modal.getByRole("button", { name: "新增平台", exact: true }).click();
    await modal.getByLabel("平台名称", { exact: true }).fill("自定义资讯");
    await modal.getByLabel("编辑方式", { exact: true }).selectOption("post");
    await modal.getByRole("button", { name: "保存平台", exact: true }).click();
    await expect(
      modal.getByLabel("平台", { exact: true }).locator("option:checked"),
    ).toHaveText("自定义资讯");
    await modal
      .getByRole("button", { name: "编辑当前平台", exact: true })
      .click();
    await modal.getByLabel("平台名称", { exact: true }).fill("X");
    await modal.getByRole("button", { name: "保存平台", exact: true }).click();
    await expect(modal.getByRole("alert")).toContainText("已有同名平台");
    await modal.getByLabel("平台名称", { exact: true }).fill("自定义资讯台");
    await modal.getByRole("button", { name: "保存平台", exact: true }).click();
    await expect(
      modal.getByRole("group", { name: "编辑平台", exact: true }),
    ).toHaveCount(0);
    await modal.getByLabel("账号名称", { exact: true }).fill("资讯账号");
    await modal.getByRole("button", { name: "保存账号", exact: true }).click();
    await expect(page.locator(".account-card")).toContainText("自定义资讯台");
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await dialogFiles(
      app,
      ["demo-1.png", "demo-2.png"].map((f) =>
        path.resolve("tests/fixtures", f),
      ),
    );
    await page.getByRole("button", { name: "导入素材", exact: true }).click();
    await expect(page.locator(".asset-card")).toHaveCount(2);
    await page.getByRole("button", { name: "内容库", exact: true }).click();
    await page.getByRole("button", { name: "新建内容", exact: true }).click();
    await page
      .getByLabel("主题名称", { exact: true })
      .fill("不同平台的编辑验收");
    await page.getByRole("button", { name: "创建主题", exact: true }).click();
    await addVariant(
      page,
      "x",
      "zh-CN",
      "这是 X 的单条帖子，正文在附件之前。 #内容创作",
    );
    await expect(page.locator('[data-composer="post"]')).toBeVisible();
    await expect(page.getByLabel("版本标题", { exact: true })).toBeHidden();
    await expect(page.locator('[data-preview="post"] h3')).toHaveCount(0);
    const attachImages = async () => {
      await page.getByRole("button", { name: "选择素材", exact: true }).click();
      await page
        .locator(".asset-pick")
        .filter({ hasText: "demo-1.png" })
        .click();
      await page
        .locator(".asset-pick")
        .filter({ hasText: "demo-2.png" })
        .click();
      await page.getByRole("button", { name: "完成选择", exact: true }).click();
    };
    await attachImages();
    await expect(
      page.getByRole("button", { name: "设置封面 1", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(
      page.locator(".post-media-grid .asset-preview.loaded"),
    ).toHaveCount(2);
    await page.locator(".editor-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: ".local/e2e-evidence/x-composer-light.png" });
    await addVariant(
      page,
      "xiaohongshu",
      "zh-CN",
      "图文笔记的标题、图片和话题各自编辑。",
    );
    await expect(page.getByLabel("版本标题", { exact: true })).toBeVisible();
    await expect(page.locator('[data-preview="note"]')).toBeVisible();
    await attachImages();
    await page.getByRole("button", { name: "设置封面 2", exact: true }).click();
    await expect(page.locator(".binding").first()).toContainText("demo-2.png");
    await expect(
      page.locator(".note-preview .preview-media img"),
    ).toHaveAttribute("alt", "demo-2.png");
    await page.getByRole("button", { name: "下一张预览", exact: true }).click();
    await expect(
      page.locator(".note-preview .preview-media img"),
    ).toHaveAttribute("alt", "demo-1.png");
    await page.getByRole("button", { name: "上一张预览", exact: true }).click();
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await page.locator(".editor-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    const ordering = await page
      .locator(".compose-grid")
      .evaluate((element) => ({
        media: element.querySelector(".compose-media")!.getBoundingClientRect()
          .top,
        text: element.querySelector(".compose-text")!.getBoundingClientRect()
          .top,
      }));
    expect(ordering.media).toBeLessThan(ordering.text);
    await page.screenshot({
      path: ".local/e2e-evidence/note-composer-light.png",
    });
    await addVariant(
      page,
      "wechat_official",
      "zh-CN",
      "引言\n\n## 文章小标题\n这是一段 **重点内容**。",
    );
    await page.getByLabel("作者（选填）", { exact: true }).fill("演示作者");
    await page
      .getByLabel("摘要（选填）", { exact: true })
      .fill("这一段是文章摘要。");
    await page
      .getByLabel("原文链接（选填）", { exact: true })
      .fill("https://example.com/article");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.locator(".save-state")).toHaveText("已保存到本地");
    await expect(page.locator(".article-preview-body h3")).toHaveText(
      "文章小标题",
    );
    await expect(page.locator(".article-preview-body strong")).toHaveText(
      "重点内容",
    );
    await page.locator(".editor-scroll").evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({
      path: ".local/e2e-evidence/article-composer-light.png",
    });
    await addVariant(page, "youtube", "zh-CN", "00:00 开场\n00:30 视频内容");
    await expect(page.locator('[data-preview="video"]')).toBeVisible();
    await expect(page.getByLabel("作者（选填）", { exact: true })).toHaveCount(
      0,
    );
    await addVariant(page, "douyin", "zh-CN", "短视频描述");
    await expect(page.locator('[data-preview="short_video"]')).toBeVisible();
    await expect(page.getByLabel("版本标题", { exact: true })).toBeHidden();
    await addVariant(page, "discord", "zh-CN", "频道消息");
    await expect(page.locator('[data-preview="chat"]')).toContainText(
      "频道消息",
    );
    await page.getByRole("button", { name: "设置与备份", exact: true }).click();
    await page.getByLabel("外观主题", { exact: true }).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(23, 29, 25)",
    );
    await page.getByLabel("外观主题", { exact: true }).selectOption("system");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(23, 29, 25)",
    );
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      "rgb(246, 247, 249)",
    );
    await page.getByLabel("外观主题", { exact: true }).selectOption("light");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.screenshot({
      path: ".local/e2e-evidence/platform-settings-light.png",
    });
    await app.close();
    ({ app, page } = await launch());
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await dialogFiles(app, [root]);
    await page
      .getByRole("button", { name: "打开本地文件夹", exact: true })
      .click();
    const data = await page.evaluate(async () => {
      const boot = await window.workbench.call<{ recent: { id: string }[] }>(
        "app.bootstrap",
      );
      return window.workbench.call<Workspace>("project.load", {
        projectId: boot.recent[0].id,
      });
    });
    expect(data.platforms.find((p) => p.id === "wechat_official")?.name).toBe(
      "公众号验收",
    );
    expect(data.platforms.find((p) => p.name === "自定义资讯台")?.id).toBe(
      data.accounts[0].platform,
    );
    expect(
      data.contents[0].variants.find((v) => v.platform === "wechat_official")
        ?.article.author,
    ).toBe("演示作者");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
test("desktop first loop: import/play, versions, two targets, independent identity, restart", async () => {
  let { app, page } = await launch();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await expect(page.getByRole("heading", { name: /让好内容/ })).toBeVisible();
    await dialogFiles(app, [official]);
    await page
      .getByRole("button", { name: "打开本地文件夹", exact: true })
      .click();
    await expect(page.locator(".project-switch")).toContainText("演示官号");
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await dialogFiles(
      app,
      [
        "demo-1.png",
        "demo-2.png",
        "demo-3.png",
        "demo.jpg",
        "demo.webp",
        "demo-h264.mp4",
      ].map((f) => path.resolve("tests/fixtures", f)),
    );
    await page.getByRole("button", { name: "导入素材", exact: true }).click();
    await expect(page.locator(".asset-card")).toHaveCount(6);
    for (const filename of ["demo-1.png", "demo.jpg", "demo.webp"]) {
      await page.locator(".asset-card").filter({ hasText: filename }).click();
      const img = page.getByRole("dialog").locator(".media-viewer img");
      await expect
        .poll(() =>
          img.evaluate(
            (e: HTMLImageElement) => e.complete && e.naturalWidth > 0,
          ),
        )
        .toBe(true);
      await page
        .getByRole("button", { name: "关闭对话框", exact: true })
        .click();
    }
    await page
      .locator(".asset-card")
      .filter({ hasText: "demo-h264.mp4" })
      .click();
    const video = page.getByRole("dialog").locator("video");
    await expect
      .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState))
      .toBeGreaterThanOrEqual(1);
    const metrics = await video.evaluate(async (v: HTMLVideoElement) => {
      await v.play();
      await new Promise((r) => setTimeout(r, 500));
      v.pause();
      const played = v.currentTime;
      v.currentTime = 2.5;
      await new Promise<void>((r) =>
        v.addEventListener("seeked", () => r(), { once: true }),
      );
      return {
        duration: v.duration,
        played,
        seek: v.currentTime,
        width: v.videoWidth,
        height: v.videoHeight,
      };
    });
    expect(metrics.duration).toBeGreaterThan(3);
    expect(metrics.played).toBeGreaterThan(0);
    expect(metrics.seek).toBeCloseTo(2.5, 1);
    expect(metrics.width).toBe(640);
    await page
      .getByRole("button", { name: "保存当前关键帧", exact: true })
      .click();
    await expect(page.locator(".asset-card")).toHaveCount(7);
    await page.screenshot({ path: ".local/e2e-evidence/video-preview.png" });
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    const ws = await page.evaluate(async () => {
      const b = await window.workbench.call<any>("app.bootstrap");
      return window.workbench.call<Workspace>("project.load", {
        projectId: b.recent[0].id,
      });
    });
    const ranges = await app.evaluate(
      async ({ net }, p) => {
        const url = `media://asset/${p.id}/${p.assetId}`;
        const valid = await net.fetch(url, {
          headers: { Range: "bytes=0-31" },
        });
        const invalid = await net.fetch(url, {
          headers: { Range: "bytes=99999999999-" },
        });
        const foreign = await net.fetch(
          `media://asset/${p.id}/00000000-0000-4000-8000-000000000001`,
        );
        return {
          valid: valid.status,
          length: (await valid.arrayBuffer()).byteLength,
          invalid: invalid.status,
          foreign: foreign.status,
        };
      },
      {
        id: ws.project.id,
        assetId: ws.assets.find((a) => a.kind === "video")!.id,
      },
    );
    expect(ranges).toEqual({
      valid: 206,
      length: 32,
      invalid: 416,
      foreign: 404,
    });
    await page.getByRole("button", { name: "账号与定位", exact: true }).click();
    await page.getByRole("button", { name: "身份资料", exact: true }).click();
    await page
      .getByLabel("身份定位", { exact: true })
      .fill("演示品牌官号，使用团队视角。");
    await page
      .getByLabel("已确认事实", { exact: true })
      .fill("演示团队完成了素材导入测试。");
    await page
      .getByRole("button", { name: "保存身份资料", exact: true })
      .click();
    await page
      .getByRole("button", { name: "平台账号与目标", exact: true })
      .click();
    await page
      .getByRole("button", { name: "登记平台账号", exact: true })
      .click();
    await page.getByLabel("账号名称", { exact: true }).fill("演示运营微信");
    await page.getByRole("button", { name: "保存账号", exact: true }).click();
    await expect(page.locator(".account-card")).toHaveCount(1);
    for (const name of ["演示共创一群", "演示共创二群"]) {
      await page.getByRole("button", { name: "添加目标", exact: true }).click();
      await page.getByLabel("目标名称", { exact: true }).fill(name);
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "添加目标", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await page.getByRole("button", { name: "内容库", exact: true }).click();
    await page.getByRole("button", { name: "新建内容", exact: true }).click();
    await page
      .getByLabel("主题名称", { exact: true })
      .fill("把内容工作台的第一个闭环分享出去");
    await page.getByRole("button", { name: "创建主题", exact: true }).click();
    await addVariant(
      page,
      "x",
      "en",
      "We completed a local content workflow demo.",
    );
    await addVariant(
      page,
      "instagram",
      "en",
      "A small step toward a calmer content workflow.",
    );
    await addVariant(
      page,
      "xiaohongshu",
      "zh-CN",
      "把素材、草稿和发布记录放在一起，是这次演示最实用的进展。",
    );
    await addVariant(
      page,
      "wechat",
      "zh-CN",
      "今天完成了内容工作台的素材导入演示，欢迎一起交流。",
    );
    await page.getByRole("button", { name: "选择素材", exact: true }).click();
    await page.locator(".asset-pick").filter({ hasText: "demo-1.png" }).click();
    await page.locator(".asset-pick").filter({ hasText: "demo-2.png" }).click();
    await page.getByRole("button", { name: "完成选择", exact: true }).click();
    await page.getByRole("button", { name: "下移素材 1", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "设置封面 1", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.locator(".save-state")).toHaveText("已保存到本地");
    await page.getByRole("button", { name: "标记就绪", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "安排发布", exact: true }),
    ).toBeEnabled();
    await page.screenshot({ path: ".local/e2e-evidence/content-editor.png" });
    await page.getByRole("button", { name: "安排发布", exact: true }).click();
    const schedule = page.getByRole("dialog");
    await schedule.getByRole("checkbox", { name: /演示共创一群/ }).check();
    await schedule.getByRole("checkbox", { name: /演示共创二群/ }).check();
    await schedule
      .getByRole("button", { name: "创建 2 个目标任务", exact: true })
      .click();
    await expect(schedule).toHaveCount(0);
    await page.getByRole("button", { name: "发布记录", exact: true }).click();
    await expect(page.locator(".job-row")).toHaveCount(2);
    await app.evaluate(({ shell }) => {
      shell.openPath = async () => "";
    });
    await page
      .locator(".job-row")
      .first()
      .getByRole("button", { name: "导出发布包", exact: true })
      .click();
    await page
      .locator(".job-row")
      .first()
      .getByRole("button", { name: "回填结果", exact: true })
      .click();
    await page.getByLabel("实际发送人", { exact: true }).fill("演示操作者");
    await page
      .getByRole("button", { name: "保存人工记录", exact: true })
      .click();
    await expect(
      page.locator(".job-row .state").filter({ hasText: "已完成" }),
    ).toHaveCount(1);
    await page.screenshot({ path: ".local/e2e-evidence/publish-records.png" });
    await dialogFiles(app, [founder]);
    await page.locator(".project-switch").click();
    await page
      .getByRole("button", { name: "打开其他文件夹", exact: true })
      .click();
    await expect(page.locator(".project-switch")).toContainText("演示创始人");
    await page.getByRole("button", { name: "账号与定位", exact: true }).click();
    await page.getByRole("button", { name: "身份资料", exact: true }).click();
    await page.getByLabel("身份类型", { exact: true }).selectOption("founder");
    await page
      .getByLabel("身份定位", { exact: true })
      .fill("演示创始人，使用个人观察和第一人称。");
    await page
      .getByRole("button", { name: "保存身份资料", exact: true })
      .click();
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await dialogFiles(
      app,
      ["demo-1.png", "demo-2.png", "demo-3.png", "demo-h264.mp4"].map((f) =>
        path.resolve("tests/fixtures", f),
      ),
    );
    await page.getByRole("button", { name: "导入素材", exact: true }).click();
    await expect(page.locator(".asset-card")).toHaveCount(4);
    await page.locator(".project-switch").click();
    await page
      .locator(".project-menu")
      .getByRole("button")
      .filter({ hasText: "演示官号" })
      .click();
    await expect(page.locator(".project-switch")).toContainText("演示官号");
    await page.screenshot({ path: ".local/e2e-evidence/dashboard.png" });
    const before = await page.evaluate(
      (id) =>
        window.workbench.call<Workspace>("project.load", { projectId: id }),
      ws.project.id,
    );
    expect(before.contents[0].variants).toHaveLength(4);
    expect(before.jobs.filter((j) => j.status === "completed")).toHaveLength(1);
    expect(before.jobs.filter((j) => j.status !== "completed")).toHaveLength(1);
    await app.close();
    ({ app, page } = await launch());
    await page
      .locator(".recent-projects")
      .getByRole("button")
      .filter({ hasText: "演示官号" })
      .click();
    const after = await page.evaluate(
      (id) =>
        window.workbench.call<Workspace>("project.load", { projectId: id }),
      ws.project.id,
    );
    expect(after.contents).toEqual(before.contents);
    expect(after.jobs).toEqual(before.jobs);
    expect(after.assets.map((a) => a.id)).toEqual(
      before.assets.map((a) => a.id),
    );
    expect(errors).toEqual([]);
    writeFileSync(
      ".local/e2e-evidence/result.json",
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          metrics,
          ranges,
          projectId: ws.project.id,
          versions: after.contents[0].variants.length,
          jobs: after.jobs.map((j) => ({
            status: j.status,
            target: j.targetLabel,
          })),
          restartPersistent: true,
          rendererErrors: errors,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await page.screenshot({ path: ".local/e2e-evidence/failure.png" });
    console.log((await page.locator("body").innerText()).slice(-3500));
    throw error;
  } finally {
    await app.close();
  }
});
test("2 GiB registered media streams bounded ranges without whole-file memory use", async () => {
  const root = path.join(base, "大文件中文路径");
  mkdirSync(root);
  const file = path.join(root, "2GB reference.mp4");
  const size = 2 * 1024 * 1024 * 1024 + 64;
  const fd = openSync(file, "wx");
  writeSync(
    fd,
    Buffer.from("00000018667479706d703432000000006d70343269736f6d", "hex"),
  );
  try {
    if (process.platform === "win32")
      execFileSync("fsutil.exe", ["sparse", "setflag", file], {
        windowsHide: true,
      });
    ftruncateSync(fd, size);
  } finally {
    closeSync(fd);
  }
  const { app, page } = await launch();
  try {
    const before = await app.evaluate(() => process.memoryUsage().rss);
    const w = await page.evaluate(
      (root) =>
        window.workbench.call<Workspace>("project.open", { path: root }),
      root,
    );
    expect(w.assets).toHaveLength(1);
    const result = await app.evaluate(
      async ({ net }, p) => {
        const response = await net.fetch(
          `media://asset/${p.projectId}/${p.assetId}`,
          { headers: { Range: `bytes=${p.start}-${p.start + 31}` } },
        );
        return {
          status: response.status,
          bytes: (await response.arrayBuffer()).byteLength,
          range: response.headers.get("content-range"),
          rss: process.memoryUsage().rss,
        };
      },
      {
        projectId: w.project.id,
        assetId: w.assets[0].id,
        start: 2 * 1024 * 1024 * 1024,
      },
    );
    expect(result.status).toBe(206);
    expect(result.bytes).toBe(32);
    expect(result.range).toBe(`bytes 2147483648-2147483679/${size}`);
    expect(result.rss - before).toBeLessThan(256 * 1024 * 1024);
    writeFileSync(
      ".local/e2e-evidence/large-range.json",
      JSON.stringify(
        {
          verifiedAt: new Date().toISOString(),
          size,
          ...result,
          rssGrowth: result.rss - before,
          sparseFixture: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
    unlinkSync(file);
  }
});

test("large-image pages use cached previews and load originals only on request", async () => {
  const root = path.join(base, "大图预览性能");
  mkdirSync(root);
  const count = 8;
  for (let index = 0; index < count; index++) {
    await sharp({
      create: {
        width: 3200,
        height: 2400,
        channels: 3,
        background: { r: 40 + index * 20, g: 120, b: 90 },
      },
    })
      .composite([
        {
          input: Buffer.from(
            `<svg width="3200" height="2400"><circle cx="${600 + index * 180}" cy="1200" r="700" fill="#edca93"/><rect x="300" y="300" width="1000" height="120" fill="#ffffff"/></svg>`,
          ),
        },
      ])
      .png({ compressionLevel: 0 })
      .toFile(path.join(root, `large-${index}.png`));
  }
  const { app, page } = await launch();
  try {
    await dialogFiles(app, [root]);
    await page
      .getByRole("button", { name: "打开本地文件夹", exact: true })
      .click();
    await expect(page.locator(".project-switch")).toContainText("大图预览性能");
    const w = await page.evaluate(async () => {
      const bootstrap = await window.workbench.call<any>("app.bootstrap");
      return window.workbench.call<Workspace>("project.load", {
        projectId: bootstrap.recent[0].id,
      });
    });
    expect(w.assets).toHaveLength(count);
    const originalMs = await page.evaluate(
      async ({ projectId, ids }) => {
        const start = performance.now();
        await Promise.all(
          ids.map(
            (id) =>
              new Promise<void>((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                  void img.decode().then(() => resolve(), reject);
                };
                img.onerror = () => reject(new Error("Original failed"));
                img.src = `media://asset/${projectId}/${id}`;
              }),
          ),
        );
        return performance.now() - start;
      },
      { projectId: w.project.id, ids: w.assets.map((asset) => asset.id) },
    );
    const start = Date.now();
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await expect(page.locator(".asset-card .asset-preview.loaded")).toHaveCount(
      count,
    );
    const coldMs = Date.now() - start;
    const previews = await page
      .locator(".asset-card img")
      .evaluateAll((images) =>
        images.map((image) => ({
          src: (image as HTMLImageElement).src,
          width: (image as HTMLImageElement).naturalWidth,
        })),
      );
    expect(
      previews.every(
        (image) =>
          image.src.startsWith("media://thumbnail/") && image.width <= 512,
      ),
    ).toBe(true);
    const cached = await app.evaluate(
      async ({ net }, { projectId, ids }) => {
        const start = performance.now();
        const results = await Promise.all(
          ids.map(async (id) => {
            const response = await net.fetch(
              `media://thumbnail/${projectId}/${id}`,
            );
            return {
              status: response.status,
              cache: response.headers.get("x-preview-cache"),
              bytes: (await response.arrayBuffer()).byteLength,
              etag: response.headers.get("etag"),
            };
          }),
        );
        const conditional = await net.fetch(
          `media://thumbnail/${projectId}/${ids[0]}`,
          { headers: { "If-None-Match": results[0].etag! } },
        );
        const foreign = await net.fetch(
          `media://thumbnail/${projectId}/00000000-0000-4000-8000-000000000001`,
        );
        return {
          results,
          ms: performance.now() - start,
          conditional: conditional.status,
          foreign: foreign.status,
        };
      },
      { projectId: w.project.id, ids: w.assets.map((asset) => asset.id) },
    );
    expect(
      cached.results.every(
        (result) => result.status === 200 && result.cache === "hit",
      ),
    ).toBe(true);
    expect(cached.conditional).toBe(304);
    expect(cached.foreign).toBe(404);
    const originalBytes = w.assets.reduce((sum, asset) => sum + asset.bytes, 0);
    const previewBytes = cached.results.reduce(
      (sum, result) => sum + result.bytes,
      0,
    );
    expect(previewBytes).toBeLessThan(originalBytes / 50);
    await page.getByRole("button", { name: "工作台", exact: true }).click();
    const warmStart = Date.now();
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await expect(page.locator(".asset-card .asset-preview.loaded")).toHaveCount(
      count,
    );
    const warmMs = Date.now() - warmStart;
    await page.locator(".asset-card").first().click();
    await expect(
      page.locator(".media-viewer .asset-preview.loaded"),
    ).toHaveCount(1);
    const detail = page.locator(".media-viewer img");
    expect(
      await detail.evaluate((img: HTMLImageElement) => img.naturalWidth),
    ).toBe(1600);
    await page.getByRole("button", { name: "查看原图", exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator(".media-viewer img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBe(3200);
    await page.getByRole("button", { name: "关闭对话框", exact: true }).click();
    await page.screenshot({ path: ".local/e2e-evidence/optimized-assets.png" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({
      path: ".local/e2e-evidence/optimized-assets-dark.png",
    });
    const report = {
      verifiedAt: new Date().toISOString(),
      count,
      originalBytes,
      previewBytes,
      originalMs,
      coldMs,
      warmMs,
      cachedProtocolMs: cached.ms,
      cacheHits: count,
      detailEdge: 1600,
      originalEdge: 3200,
    };
    writeFileSync(
      ".local/e2e-evidence/image-performance.json",
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } finally {
    await app.close();
  }
});

test("v0.2 publishing connections, simulation and restart keep honest receipts", async () => {
  const root = path.join(base, "v02发布模拟");
  mkdirSync(root);
  let { app, page } = await launch();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await dialogFiles(app, [root]);
    await page
      .getByRole("button", { name: "打开本地文件夹", exact: true })
      .click();
    await page.getByRole("button", { name: "账号与定位", exact: true }).click();
    await page
      .getByRole("button", { name: "自动发布连接", exact: true })
      .click();
    await page
      .getByRole("button", { name: "创建模拟账号与目标", exact: true })
      .click();
    const selector = page.getByLabel("自动发布连接目标", { exact: true });
    await expect(selector.locator("option")).toHaveCount(2);
    await selector.selectOption({ index: 1 });
    await page
      .getByRole("button", { name: "保存连接配置", exact: true })
      .click();
    await page
      .getByRole("button", { name: "检查发布连接", exact: true })
      .click();
    await expect(
      page.getByText("连接已检查 · 仅模拟", { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: ".local/e2e-evidence/v02-connections.png" });
    await page.getByRole("button", { name: "素材库", exact: true }).click();
    await dialogFiles(app, [path.resolve("tests/fixtures/demo-1.png")]);
    await page.getByRole("button", { name: "导入素材", exact: true }).click();
    await expect(page.locator(".asset-card")).toHaveCount(1);
    await page.getByRole("button", { name: "内容库", exact: true }).click();
    await page.getByRole("button", { name: "新建内容", exact: true }).click();
    await page.getByLabel("主题名称", { exact: true }).fill("V0.2 图文模拟");
    await page.getByRole("button", { name: "创建主题", exact: true }).click();
    await addVariant(
      page,
      "discord",
      "zh-CN",
      "合成模拟图文，不向任何平台发送。",
    );
    await page.getByRole("button", { name: "选择素材", exact: true }).click();
    await page.locator(".asset-pick").filter({ hasText: "demo-1.png" }).click();
    await page.getByRole("button", { name: "完成选择", exact: true }).click();
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await expect(page.locator(".save-state")).toHaveText("已保存到本地");
    await page.getByRole("button", { name: "标记就绪", exact: true }).click();
    await page.getByRole("button", { name: "安排发布", exact: true }).click();
    const modal = page.getByRole("dialog");
    await modal
      .getByLabel("发布方式", { exact: true })
      .selectOption("simulation");
    await modal.getByRole("checkbox", { name: /本地模拟目标/ }).check();
    await modal.getByLabel("确认自动发布", { exact: true }).check();
    await modal
      .getByRole("button", { name: "创建 1 个目标任务", exact: true })
      .click();
    await page.getByRole("button", { name: "发布记录", exact: true }).click();
    await expect(page.locator(".job-row")).toHaveCount(1);
    await expect(page.locator(".job-row")).toContainText("已核实发布", {
      timeout: 25000,
    });
    await expect(page.locator(".job-row")).toContainText("模拟 · 无外部发送");
    await expect(page.locator(".job-row")).toContainText("尝试 1 次");
    await page.getByRole("button", { name: "设置与备份", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "后台发布项目", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "隐藏到托盘，继续处理", exact: true })
      .click();
    expect(
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].isVisible(),
      ),
    ).toBe(false);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].show(),
    );
    await page.getByRole("button", { name: "发布记录", exact: true }).click();
    await page.getByRole("button", { name: "操作记录", exact: true }).click();
    await expect(page.locator(".automation-events")).toContainText(
      "提交意图已持久化",
    );
    await page.screenshot({ path: ".local/e2e-evidence/v02-simulation.png" });
    await app.close();
    ({ app, page } = await launch());
    const background = await page.evaluate(() =>
      window.workbench.call<{ name: string; enabled: boolean }[]>(
        "background.list",
      ),
    );
    expect(background.find((p) => p.name === "v02发布模拟")?.enabled).toBe(
      true,
    );
    const fixtureWebhook =
      "https://discord.com/api/webhooks/123/v02-fixture-not-a-real-secret";
    const saved = await page.evaluate(async (webhook) => {
      const bootstrap = await window.workbench.call<{
        recent: { id: string; name: string }[];
      }>("app.bootstrap");
      const projectId = bootstrap.recent.find(
        (p) => p.name === "v02发布模拟",
      )!.id;
      let w = await window.workbench.call<Workspace>("accounts.add", {
        projectId,
        platform: "discord",
        label: "本地凭据测试",
        externalId: "",
        accountType: "webhook",
      });
      w = await window.workbench.call<Workspace>("targets.add", {
        projectId,
        accountId: w.accounts.at(-1)!.id,
        label: "凭据隔离测试",
        kind: "channel",
      });
      const connections = await window.workbench.call<
        { id: string; targetId: string }[]
      >("connections.save", {
        projectId,
        connection: { targetId: w.targets.at(-1)!.id, provider: "discord" },
        secrets: { webhook },
      });
      return {
        connections,
        id: connections.find((c) => c.targetId === w.targets.at(-1)!.id)!.id,
      };
    }, fixtureWebhook);
    expect(JSON.stringify(saved.connections)).not.toContain(fixtureWebhook);
    const encrypted = readFileSync(
      path.join(userData, "publishing/credentials.json"),
      "utf8",
    );
    expect(encrypted).not.toContain(fixtureWebhook);
    const ciphertext = JSON.parse(encrypted)[saved.id] as string;
    expect(
      await app.evaluate(
        ({ safeStorage }, args) => {
          return (
            safeStorage.isEncryptionAvailable() &&
            JSON.parse(
              safeStorage.decryptString(Buffer.from(args.ciphertext, "base64")),
            ).webhook === args.fixtureWebhook
          );
        },
        { ciphertext, fixtureWebhook },
      ),
    ).toBe(true);
    await dialogFiles(app, [root]);
    await page
      .getByRole("button", { name: "打开本地文件夹", exact: true })
      .click();
    await page.getByRole("button", { name: "发布记录", exact: true }).click();
    await expect(page.locator(".job-row")).toContainText("已核实发布");
    await expect(page.locator(".job-row")).toContainText("尝试 1 次");
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
