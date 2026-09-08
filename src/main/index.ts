import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  clipboard,
  nativeImage,
  nativeTheme,
  safeStorage,
  powerMonitor,
  Tray,
  Menu,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { readFile } from "node:fs/promises";
import { PublisherService } from "../services/publishing/service";
import { ConnectionStore } from "../services/publishing/store";
import { MockAdapter } from "../services/publishing/mock";
import { officialAdapters } from "../services/publishing/platforms";
import { connectionSchema } from "../contracts/automation";
import { ThumbnailService } from "../services/thumbnails";
import { WebLoginService } from "./web-login";
import { z } from "zod";
import { WorkspaceService } from "../services/workspace";
import { CodexService } from "../services/codex/service";
import { AppError, parseRange, uuid, writeJson } from "../services/files";
import {
  variantSchema,
  platformIdSchema,
  platformDetailsSchema,
  themeSchema,
  codexViewSchema,
  type AppEvent,
} from "../contracts/model";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "media",
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);
if (process.env.WORKBENCH_USER_DATA)
  app.setPath("userData", process.env.WORKBENCH_USER_DATA);
if (!app.requestSingleInstanceLock()) app.exit(0);
nativeTheme.themeSource = "light";
let win: BrowserWindow;
let service: WorkspaceService;
let codex: CodexService;
let thumbnails: ThumbnailService;
let publisher: PublisherService;
let webLogin: WebLoginService;
let tray: Tray;
let closing = false;
let shuttingDown = false;
let queue: Promise<unknown> = Promise.resolve();
const emit = (event: AppEvent) => {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
    win.webContents.send("workbench:event", event);
};
const pid = z.object({ projectId: z.uuid() });
async function selectDirectory(title: string) {
  const r = await dialog.showOpenDialog(win, {
    title,
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled ? null : r.filePaths[0];
}
async function dispatch(method: string, raw: unknown): Promise<unknown> {
  const data = raw ?? {};
  if (method === "background.list") return publisher.background();
  if (method === "app.background") {
    win.hide();
    return true;
  }
  if (method === "app.bootstrap")
    return {
      recent: service.recent(),
      settings: { ...codex.readSettings(), theme: nativeTheme.themeSource },
      codex: codex.status,
    };
  if (method === "project.open") {
    const p = z.object({ path: z.string().optional() }).parse(data);
    const dir = p.path ?? (await selectDirectory("打开账号项目文件夹"));
    if (!dir) return null;
    const result = await service.open(dir);
    if (!result.project.readOnly)
      await service.importAssets(
        result.project.id,
        [dir],
        "reference",
        (message) =>
          emit({
            type: "import-progress",
            projectId: result.project.id,
            message,
          }),
      );
    return service.load(result.project.id);
  }
  if (method === "backup.restore") {
    const source = await selectDirectory("选择备份文件夹");
    if (!source) return null;
    const destination = await selectDirectory("选择空的恢复文件夹");
    if (!destination) return null;
    if (codex.active || publisher.running.size)
      throw new AppError("PROJECT_BUSY", "请先等待或停止后台任务");
    return service.restore(source, destination);
  }
  if (method === "codex.status") return codex.status;
  if (method === "clipboard.copy") {
    const p = z.object({ text: z.string().max(200000) }).parse(data);
    await clipboard.writeText(p.text);
    return true;
  }
  if (method === "codex.connect") return codex.reconnect();
  if (method === "codex.login") {
    const url = new URL(await codex.login());
    if (
      url.protocol !== "https:" ||
      !["auth.openai.com", "auth0.openai.com", "chatgpt.com"].includes(
        url.hostname,
      )
    ) {
      await codex.cancelLogin();
      throw new AppError("CODEX_LOGIN_URL", "CLI 返回了不受支持的登录地址");
    }
    await shell.openExternal(url.href);
    return codex.status;
  }
  if (method === "codex.login.cancel") return codex.cancelLogin();
  if (method === "settings.codexPath") {
    const r = await dialog.showOpenDialog(win, {
      title: "选择 codex.exe",
      properties: ["openFile"],
      filters: [{ name: "Codex CLI", extensions: ["exe"] }],
    });
    if (r.canceled) return null;
    writeJson(path.join(service.appData, "settings.json"), {
      ...codex.readSettings(),
      codexPath: r.filePaths[0],
    });
    return { codexPath: r.filePaths[0] };
  }
  if (method === "settings.theme") {
    const { theme } = z.object({ theme: themeSchema }).parse(data);
    writeJson(path.join(service.appData, "settings.json"), {
      ...codex.readSettings(),
      theme,
    });
    nativeTheme.themeSource = theme;
    win.setBackgroundColor(
      nativeTheme.shouldUseDarkColors ? "#171d19" : "#f6f7f9",
    );
    return { theme };
  }
  if (method === "codex.start")
    return codex.start(
      z
        .object({
          projectId: z.uuid(),
          contentId: z.uuid().optional(),
          view: codexViewSchema.optional(),
          variantId: z.uuid().optional(),
          mode: z.enum(["draft", "task"]).optional(),
          prompt: z.string().min(1).max(20000),
          model: z.string().optional(),
          reasoningEffort: z.string().min(1).max(40).optional(),
        })
        .parse(data),
    );
  if (method === "codex.stop") {
    const p = z.object({ projectId: z.uuid(), runId: z.uuid() }).parse(data);
    return codex.stop(p.projectId, p.runId);
  }
  const { projectId } = pid.parse(data);
  if (method === "web-login.list") return webLogin.list(projectId);
  if (
    ["web-login.open", "web-login.check", "web-login.logout"].includes(method)
  ) {
    const { accountId } = z.object({ accountId: z.uuid() }).parse(data);
    return method === "web-login.open"
      ? webLogin.open(projectId, accountId)
      : method === "web-login.logout"
        ? webLogin.logout(projectId, accountId)
        : webLogin.check(projectId, accountId);
  }
  if (method === "background.stop") {
    publisher.setManagement(projectId, false);
    return publisher.background();
  }
  if (method === "project.load") return service.load(projectId);
  if (method === "platforms.save") {
    const p = platformDetailsSchema
      .extend({ id: platformIdSchema.optional() })
      .parse(data);
    return service.savePlatform(projectId, p);
  }
  if (method === "project.reveal") {
    return shell.openPath(service.context(projectId).project.root);
  }
  if (method === "project.profile") {
    const p = z
      .object({
        projectId: z.uuid(),
        name: z.string().min(1).max(100),
        identityType: z.enum(["brand", "founder", "custom"]),
        timezone: z.string(),
        identity: z.string().max(100000),
        facts: z.string().max(100000),
        voice: z.string().max(100000),
        baseRevision: z.number().int(),
      })
      .parse(data);
    return service.updateProfile(projectId, p);
  }
  if (method === "content.create") {
    const p = z.object({ title: z.string().max(300) }).parse(data);
    return service.createContent(projectId, p.title);
  }
  if (method === "content.addVariant") {
    const p = z
      .object({
        contentId: z.uuid(),
        platform: platformIdSchema,
        locale: z.string().min(1),
      })
      .parse(data);
    return service.addVariant(projectId, p.contentId, p.platform, p.locale);
  }
  if (method === "content.save") {
    const p = z
      .object({
        contentId: z.uuid(),
        variant: variantSchema,
        baseRevision: z.number().int(),
        baseHash: z.string(),
        brief: z.string().optional(),
        audience: z.string().optional(),
        objective: z.string().optional(),
      })
      .parse(data);
    return service.saveVariant(projectId, p.contentId, p);
  }
  if (method === "content.histories") {
    const p = z
      .object({ contentId: z.uuid(), variantId: z.uuid() })
      .parse(data);
    return service.histories(projectId, p.contentId, p.variantId);
  }
  if (method === "assets.import") {
    const p = z
      .object({
        paths: z.array(z.string()).max(1000).optional(),
        mode: z.enum(["copy", "reference"]),
      })
      .parse(data);
    let paths = p.paths;
    if (!paths) {
      const r = await dialog.showOpenDialog(win, {
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "图片与视频",
            extensions: ["jpg", "jpeg", "png", "webp", "mp4", "mov"],
          },
        ],
      });
      if (r.canceled) return [];
      paths = r.filePaths;
    }
    return service.importAssets(projectId, paths, p.mode, (message) =>
      emit({ type: "import-progress", projectId, message }),
    );
  }
  if (method === "assets.paste") {
    const items = await clipboard.read();
    const item = items.find((i) => i.types.includes("image/png"));
    if (!item) throw new AppError("CLIPBOARD_EMPTY", "剪贴板里没有图片");
    const blob = (await item.getType("image/png")) as Blob;
    const img = nativeImage.createFromBuffer(
      Buffer.from(await blob.arrayBuffer()),
    );
    if (img.isEmpty())
      throw new AppError("CLIPBOARD_EMPTY", "剪贴板里没有图片");
    const { project } = service.context(projectId, true);
    const dest = path.join(project.root, "assets/images", uuid() + ".png");
    const { atomicWrite } = await import("../services/files");
    atomicWrite(dest, img.toPNG());
    return service.importAssets(projectId, [dest], "copy");
  }
  if (method === "assets.reconnect") {
    const p = z.object({ assetId: z.uuid() }).parse(data);
    const r = await dialog.showOpenDialog(win, { properties: ["openFile"] });
    if (r.canceled) return null;
    return service.reconnectAsset(projectId, p.assetId, r.filePaths[0]);
  }
  if (method === "assets.remove") {
    const p = z.object({ assetId: z.uuid() }).parse(data);
    return service.removeAsset(projectId, p.assetId);
  }
  if (method === "assets.derive") {
    const p = z
      .object({
        assetId: z.uuid(),
        kind: z.enum(["crop", "frame"]),
        dataUrl: z.string().max(40000000).optional(),
        parameters: z.record(z.string(), z.number().finite()),
      })
      .parse(data);
    let image;
    if (p.kind === "crop") {
      image = nativeImage.createFromPath(
        service.mediaPath(projectId, p.assetId).file,
      );
      const size = image.getSize();
      const r = p.parameters;
      if (
        !["x", "y", "width", "height"].every(
          (k) => Number.isInteger(r[k]) && r[k] >= 0,
        ) ||
        r.width < 1 ||
        r.height < 1 ||
        r.x + r.width > size.width ||
        r.y + r.height > size.height
      )
        throw new AppError("INVALID_CROP", "裁剪框超出图片边界");
      image = image.crop({ x: r.x, y: r.y, width: r.width, height: r.height });
    } else {
      if (!p.dataUrl?.startsWith("data:image/png;base64,"))
        throw new AppError("INVALID_FRAME", "关键帧必须是 PNG 图片");
      image = nativeImage.createFromDataURL(p.dataUrl);
    }
    if (image.isEmpty()) throw new AppError("INVALID_IMAGE", "图片解码失败");
    return service.saveDerived(
      projectId,
      p.assetId,
      image.toPNG(),
      p.kind,
      p.parameters,
    );
  }
  if (method === "connections.list")
    return publisher.listConnections(projectId);
  if (method === "connections.save") {
    const p = z
      .object({
        connection: connectionSchema,
        secrets: z.object({
          token: z.string().max(16000).optional(),
          webhook: z.string().max(4000).optional(),
          refreshToken: z.string().max(16000).optional(),
          mediaToken: z.string().max(16000).optional(),
        }),
      })
      .parse(data);
    return publisher.saveConnection(projectId, p.connection, p.secrets);
  }
  if (method === "connections.check" || method === "connections.disconnect") {
    const { connectionId } = z.object({ connectionId: z.uuid() }).parse(data);
    return method === "connections.check"
      ? publisher.checkConnection(projectId, connectionId)
      : publisher.disconnect(projectId, connectionId);
  }
  if (method === "connections.mockTarget") {
    const { platform } = z.object({ platform: platformIdSchema }).parse(data);
    const w = service.addAccount(projectId, {
      platform,
      label: "模拟账号 · " + Date.now(),
      externalId: "",
      accountType: "mock",
    });
    const account = w.accounts.at(-1)!;
    const next = service.addTarget(projectId, {
      accountId: account.id,
      label: "本地模拟目标",
      kind: "channel",
    });
    return next;
  }
  if (method === "publish.events")
    return publisher.events(
      projectId,
      z.object({ jobId: z.uuid() }).parse(data).jobId,
    );
  if (method === "publish.action") {
    const p = z
      .object({
        jobId: z.uuid(),
        action: z.enum(["reconcile", "retry", "manual", "pause", "cleanup"]),
      })
      .parse(data);
    await publisher.action(projectId, p.jobId, p.action);
    return service.load(projectId);
  }
  if (method === "accounts.add") {
    const p = z
      .object({
        platform: platformIdSchema,
        label: z.string().min(1),
        externalId: z.string(),
        accountType: z.string(),
      })
      .parse(data);
    return service.addAccount(projectId, p);
  }
  if (method === "accounts.enabled") {
    const p = z
      .object({ accountId: z.uuid(), enabled: z.boolean() })
      .parse(data);
    return service.setAccountEnabled(projectId, p.accountId, p.enabled);
  }
  if (method === "targets.add") {
    const p = z
      .object({
        accountId: z.uuid(),
        label: z.string().min(1),
        kind: z.enum(["profile", "page", "channel", "group"]),
      })
      .parse(data);
    return service.addTarget(projectId, p);
  }
  if (method === "publish.schedule") {
    const p = z
      .object({
        contentId: z.uuid(),
        variantId: z.uuid(),
        targetIds: z.array(z.uuid()),
        scheduledAtUtc: z.string(),
        timezone: z.string(),
        mode: z
          .enum(["manual_due", "automatic", "simulation"])
          .default("manual_due"),
        approved: z.boolean().default(false),
      })
      .parse(data);
    return p.mode === "manual_due"
      ? service.schedule(projectId, p)
      : publisher.schedule(projectId, { ...p, mode: p.mode });
  }
  if (method === "publish.export") {
    const p = z.object({ jobId: z.uuid() }).parse(data);
    const dir = service.exportJob(projectId, p.jobId);
    await shell.openPath(dir);
    return dir;
  }
  if (method === "publish.record") {
    const p = z
      .object({
        jobId: z.uuid(),
        receipt: z.object({
          recordedBy: z.string(),
          recordedAt: z.string(),
          result: z.string(),
          url: z.string(),
          completedSegments: z.array(z.number().int()),
        }),
      })
      .parse(data);
    return service.recordManual(projectId, p.jobId, p.receipt);
  }
  if (method === "publish.update") {
    const p = z
      .object({
        jobId: z.uuid(),
        status: z.enum(["paused", "cancelled", "scheduled"]).optional(),
        scheduledAtUtc: z.string().optional(),
      })
      .parse(data);
    return service.updateJob(projectId, p.jobId, p);
  }
  if (method === "backup.create") {
    const p = z.object({ includeExternal: z.boolean() }).parse(data);
    const dir = await selectDirectory("选择空文件夹保存备份");
    if (!dir) return null;
    return service.backup(projectId, dir, p.includeExternal);
  }
  throw new AppError("UNKNOWN_METHOD", "此操作不可用");
}
app.whenReady().then(async () => {
  service = new WorkspaceService(app.getPath("userData"));
  webLogin = new WebLoginService(service, () => win, emit);
  publisher = new PublisherService(
    service,
    new ConnectionStore(path.join(app.getPath("userData"), "publishing"), {
      encrypt(text) {
        if (!safeStorage.isEncryptionAvailable())
          throw new AppError(
            "ENCRYPTION_UNAVAILABLE",
            "系统凭据加密不可用，不能保存平台密钥",
          );
        return safeStorage.encryptString(text).toString("base64");
      },
      decrypt(text) {
        return safeStorage.decryptString(Buffer.from(text, "base64"));
      },
    }),
    emit,
    { mock: new MockAdapter(), ...officialAdapters() },
  );
  await publisher.reopenManaged();
  publisher.start();
  powerMonitor.on("resume", () => void publisher.tick().catch(() => {}));
  codex = new CodexService(service, emit);
  nativeTheme.themeSource = themeSchema
    .catch("light")
    .parse(codex.readSettings().theme);
  thumbnails = new ThumbnailService(
    path.join(app.getPath("userData"), "cache", "previews-v1"),
    path.join(__dirname, "thumbnail-worker.cjs"),
  );
  protocol.handle("media", async (request) => {
    try {
      if (!["GET", "HEAD"].includes(request.method))
        return new Response(null, { status: 405 });
      const url = new URL(request.url);
      const ids = url.pathname.split("/").filter(Boolean);
      if (
        !["asset", "thumbnail", "preview"].includes(url.hostname) ||
        ids.length !== 2
      )
        return new Response(null, { status: 404 });
      const { file, asset } = service.mediaPath(ids[0], ids[1]);
      if (url.hostname !== "asset") {
        const result = await thumbnails.get(
          file,
          asset,
          url.hostname === "preview" ? 1600 : 512,
          request.signal,
        );
        const headers = {
          "Content-Type": "image/webp",
          "Cache-Control": "private, no-cache",
          ETag: result.etag,
          "Access-Control-Allow-Origin": "*",
          "X-Preview-Cache": result.cached ? "hit" : "generated",
        };
        if (request.headers.get("if-none-match") === result.etag)
          return new Response(null, { status: 304, headers });
        const body = await readFile(result.file);
        return new Response(
          request.method === "HEAD" ? null : new Uint8Array(body),
          {
            headers: { ...headers, "Content-Length": String(body.length) },
          },
        );
      }
      const size = statSync(file).size;
      let range;
      try {
        range = parseRange(request.headers.get("range"), size);
      } catch {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${size}` },
        });
      }
      const headers: Record<string, string> = {
        "Content-Type": asset.mime,
        "Accept-Ranges": "bytes",
        "Content-Length": String(range ? range.end - range.start + 1 : size),
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      };
      if (range)
        headers["Content-Range"] = `bytes ${range.start}-${range.end}/${size}`;
      if (request.method === "HEAD")
        return new Response(null, { status: range ? 206 : 200, headers });
      const stream = createReadStream(file, range ?? {});
      request.signal.addEventListener("abort", () => stream.destroy(), {
        once: true,
      });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: range ? 206 : 200,
        headers,
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    title: "内容工作台",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171d19" : "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  // A local embedded icon keeps the development runtime independent of packaged assets.
  tray = new Tray(
    nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAGklEQVQ4T2Nk+M/wn4ECwESJ5lEDRg0YNWAwGQAAh+Uf8RfJqL8AAAAASUVORK5CYII=",
    ),
  );
  tray.setToolTip("内容工作台 · 后台发布任务");
  const showWindow = () => {
    win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
  };
  tray.on("double-click", showWindow);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开内容工作台", click: showWindow },
      {
        label: "退出内容工作台",
        click: () => {
          showWindow();
          win.close();
        },
      },
    ]),
  );
  const entry =
    process.env.WORKBENCH_DEV_URL ??
    pathToFileURL(path.join(__dirname, "../renderer/index.html")).href;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== entry) event.preventDefault();
  });
  win.webContents.on("will-prevent-unload", async (event) => {
    const choice = await dialog.showMessageBox(win, {
      type: "question",
      buttons: ["返回保存", "放弃未保存修改并退出"],
      defaultId: 0,
      cancelId: 0,
      message: "当前草稿尚未保存。",
    });
    if (choice.response === 1) {
      event.preventDefault();
      closing = true;
      win.destroy();
      app.quit();
    }
  });
  win.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  ipcMain.handle("workbench:call", async (event, payload) => {
    const requestId = uuid();
    try {
      if (
        event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame ||
        !event.senderFrame.url.startsWith(entry)
      )
        throw new AppError("IPC_FORBIDDEN", "请求来源不受信任");
      const { method, input } = z
        .object({ method: z.string(), input: z.unknown().optional() })
        .parse(payload);
      const execute = () => dispatch(method, input);
      let data;
      if (
        [
          "codex.status",
          "codex.stop",
          "app.bootstrap",
          "project.load",
          "web-login.list",
          "web-login.check",
        ].includes(method)
      )
        data = await execute();
      else {
        const operation = queue.then(execute, execute);
        queue = operation.catch(() => {});
        data = await operation;
      }
      return { ok: true, data, requestId };
    } catch (e) {
      return {
        ok: false,
        error: {
          code: e instanceof AppError ? e.code : "OPERATION_FAILED",
          message: (e as Error).message,
          details: e instanceof AppError ? e.details : undefined,
        },
        requestId,
      };
    }
  });
  win.on("close", (event) => {
    if (closing) return;
    if (codex.active || codex.queue.length || publisher.running.size) {
      event.preventDefault();
      void dialog
        .showMessageBox(win, {
          type: "question",
          buttons: ["继续工作", "停止任务并退出"],
          defaultId: 0,
          message: "后台任务正在执行，退出将停止处理并保留状态供恢复。",
        })
        .then((r) => {
          if (r.response === 1) {
            closing = true;
            win.close();
          }
        });
    }
  });
  win.on("closed", () => app.quit());
  await win.loadURL(entry);
  win.show();
  if (
    process.env.WORKBENCH_DEV_URL &&
    process.env.WORKBENCH_AUTO_CONNECT_CODEX === "1"
  ) {
    const status = await codex.connect(codex.readSettings().codexPath);
    console.info(
      `[dev] Codex ${status.state}: ${status.message}; ${status.version}; models=${status.models.length}`,
    );
  }
});
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
process.on("message", (message: unknown) => {
  if (
    process.env.WORKBENCH_DEV_URL &&
    (message as { type?: string } | null)?.type === "workbench:focus" &&
    win &&
    !win.isDestroyed()
  ) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (shuttingDown) return;
  shuttingDown = true;
  closing = true;
  publisher?.stop();
  webLogin?.close();
  tray?.destroy();
  codex?.close();
  thumbnails?.close();
  service?.closeAll();
});
