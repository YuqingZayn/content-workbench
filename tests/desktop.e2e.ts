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
    await page.getByRole("button", { name: "设置封面 1", exact: true }).click();
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
