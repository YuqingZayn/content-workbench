import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  clipboard,
  nativeImage,
} from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createReadStream, statSync } from "node:fs";
import { Readable } from "node:stream";
import { z } from "zod";
import { WorkspaceService } from "../services/workspace";
import { CodexService } from "../services/codex/service";
import { AppError, parseRange, uuid, writeJson } from "../services/files";
import { variantSchema, platforms, type AppEvent } from "../contracts/model";
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
if (!app.requestSingleInstanceLock()) app.quit();
let win: BrowserWindow;
let service: WorkspaceService;
let codex: CodexService;
let closing = false;
let queue: Promise<unknown> = Promise.resolve();
const emit = (event: AppEvent) => {
  if (win && !win.isDestroyed()) win.webContents.send("workbench:event", event);
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
  if (method === "app.bootstrap")
    return {
      recent: service.recent(),
      settings: codex.readSettings(),
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
    if (codex.active)
      throw new AppError("PROJECT_BUSY", "请先等待或停止 AI 任务");
    return service.restore(source, destination);
  }
  if (method === "codex.status") return codex.status;
  if (method === "codex.connect")
    return codex.connect(codex.readSettings().codexPath);
  if (method === "settings.codexPath") {
    const r = await dialog.showOpenDialog(win, {
      title: "选择 codex.exe",
      properties: ["openFile"],
      filters: [{ name: "Codex CLI", extensions: ["exe"] }],
    });
    if (r.canceled) return null;
    writeJson(path.join(service.appData, "settings.json"), {
      codexPath: r.filePaths[0],
    });
    return { codexPath: r.filePaths[0] };
  }
  if (method === "codex.start")
    return codex.start(
      z
        .object({
          projectId: z.uuid(),
          contentId: z.uuid(),
          variantId: z.uuid(),
          prompt: z.string().min(1).max(20000),
          model: z.string().optional(),
        })
        .parse(data),
    );
  if (method === "codex.stop") {
    const p = z.object({ projectId: z.uuid(), runId: z.uuid() }).parse(data);
    return codex.stop(p.projectId, p.runId);
  }
  const { projectId } = pid.parse(data);
  if (method === "project.load") return service.load(projectId);
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
        platform: z.enum(platforms),
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
  if (method === "accounts.add") {
    const p = z
      .object({
        platform: z.enum(platforms),
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
      })
      .parse(data);
    return service.schedule(projectId, p);
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
  codex = new CodexService(service, emit);
  protocol.handle("media", (request) => {
    try {
      if (!["GET", "HEAD"].includes(request.method))
        return new Response(null, { status: 405 });
      const url = new URL(request.url);
      const ids = url.pathname.split("/").filter(Boolean);
      if (url.hostname !== "asset" || ids.length !== 2)
        return new Response(null, { status: 404 });
      const { file, asset } = service.mediaPath(ids[0], ids[1]);
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
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  const entry =
    process.env.WORKBENCH_DEV_URL ??
    pathToFileURL(path.join(__dirname, "../renderer/index.html")).href;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== entry) event.preventDefault();
  });
  win.webContents.on('will-prevent-unload', async event => {
    const choice = await dialog.showMessageBox(win, {type:'question',buttons:['返回保存','放弃未保存修改并退出'],defaultId:0,cancelId:0,message:'当前草稿尚未保存。'});
    if(choice.response === 1) { event.preventDefault(); closing = true; win.destroy(); app.quit(); }
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
    if (codex.active || codex.queue.length) {
      event.preventDefault();
      void dialog
        .showMessageBox(win, {
          type: "question",
          buttons: ["继续工作", "停止任务并退出"],
          defaultId: 0,
          message: "Codex 正在生成内容，退出会中断任务。",
        })
        .then((r) => {
          if (r.response === 1) {
            closing = true;
            win.close();
          }
        });
    }
  });
  await win.loadURL(entry);
});
app.on("second-instance", () => {
  if (win) {
    win.show();
    win.focus();
  }
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  closing = true;
  codex?.close();
  service?.closeAll();
});
