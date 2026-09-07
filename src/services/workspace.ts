import path from "node:path";
import {
  constants,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  accessSync,
  copyFileSync,
  renameSync,
} from "node:fs";
import { copyFile, open, rename, unlink, stat } from "node:fs/promises";
import { z } from "zod";
import {
  projectSchema,
  contentSchema,
  assetSchema,
  accountSchema,
  targetSchema,
  variantSchema,
  defaultPlatforms,
  platformDefinitionSchema,
  platformDetailsSchema,
  platformIdSchema,
  composerModeSchema,
  type PlatformDefinition,
  type ComposerMode,
  type ProjectView,
  type Content,
  type Variant,
  type Asset,
  type Account,
  type Target,
  type Workspace,
  type Job,
  type Receipt,
  type AiRun,
  type Platform,
} from "../contracts/model";
import { StateDatabase } from "../storage/database";
import {
  AppError,
  now,
  uuid,
  hash,
  readJson,
  writeJson,
  atomicWrite,
  safePath,
  acquireLock,
  recoverJournal,
  journalWrite,
  fileHash,
  assetFile,
  within,
} from "./files";
type Context = { project: ProjectView; db: StateDatabase; release: () => void };
const json = (value: unknown) => JSON.stringify(value, null, 2);
const envelope = <T>(items: T[]) => ({ schemaVersion: 1, items });
const ignored = new Set([
  ".git",
  "node_modules",
  "dist",
  "release",
  "build",
  "exports",
  "content",
  "profile",
  "cache",
]);
export class WorkspaceService {
  contexts = new Map<string, Context>();
  constructor(public appData: string) {
    mkdirSync(appData, { recursive: true });
  }
  recent() {
    const f = path.join(this.appData, "recent.json");
    return existsSync(f) ? readJson<ProjectView[]>(f) : [];
  }
  remember(project: ProjectView) {
    writeJson(
      path.join(this.appData, "recent.json"),
      [project, ...this.recent().filter((p) => p.id !== project.id)].slice(
        0,
        20,
      ),
    );
  }
  context(id: string, write = false) {
    const ctx = this.contexts.get(z.uuid().parse(id));
    if (!ctx) throw new AppError("PATH_UNAVAILABLE", "请先打开项目");
    if (write && ctx.project.readOnly)
      throw new AppError("PROJECT_READ_ONLY", "当前项目只读");
    return ctx;
  }
  async open(root: string): Promise<Workspace> {
    if (!existsSync(root))
      throw new AppError("PATH_UNAVAILABLE", "目录不存在，请使用重新定位");
    root = realpathSync(root);
    const existing = [...this.contexts.values()].find(
      (c) => c.project.root === root,
    );
    if (existing) return this.load(existing.project.id);
    let readOnly = false;
    let warning: string | undefined;
    try {
      accessSync(root, constants.W_OK);
    } catch {
      readOnly = true;
      warning = "目录只读";
    }
    const meta = safePath(root, ".content-workspace/project.json");
    if (!existsSync(meta)) {
      if (readOnly)
        throw new AppError(
          "PROJECT_READ_ONLY",
          "未初始化的只读目录无法登记，请选择可写目录",
        );
      const stamp = now();
      writeJson(meta, {
        schemaVersion: 1,
        id: uuid(),
        name: path.basename(root),
        identityType: "brand",
        defaultLocale: "zh-CN",
        timezone: "Asia/Shanghai",
        revision: 1,
        createdAt: stamp,
        updatedAt: stamp,
      });
      for (const file of ["accounts", "targets", "assets"])
        writeJson(
          safePath(root, `.content-workspace/${file}.json`),
          envelope([]),
        );
      for (const file of ["identity", "facts", "voice"]) {
        const p = safePath(root, `profile/${file}.md`);
        if (!existsSync(p)) atomicWrite(p, "");
      }
    }
    const raw = readJson<Record<string, unknown>>(meta);
    if (raw.schemaVersion !== 1)
      throw new AppError(
        "SCHEMA_UNSUPPORTED",
        "项目版本不受支持，已保留原文件；请使用兼容版本打开",
      );
    const project = { ...projectSchema.parse(raw), root, readOnly, warning };
    if (this.contexts.has(project.id))
      throw new AppError(
        "DUPLICATE_PROJECT",
        "此目录是已打开项目的副本，请使用“恢复备份”明确切换位置",
      );
    let release = () => {};
    if (!readOnly)
      try {
        release = acquireLock(root);
        recoverJournal(root);
      } catch (e) {
        if (e instanceof AppError && e.code === "PROJECT_READ_ONLY") {
          project.readOnly = true;
          project.warning = e.message;
        } else throw e;
      }
    let db: StateDatabase;
    try {
      db = new StateDatabase(
        safePath(root, ".content-workspace/state.sqlite"),
        project.readOnly,
      );
    } catch (e) {
      release();
      throw e;
    }
    this.contexts.set(project.id, { project, db, release });
    this.remember(project);
    if (!project.readOnly)
      for (const run of db.list<AiRun>("runs", project.id))
        if (["running", "queued", "stopping"].includes(run.status)) {
          run.status = "interrupted";
          run.error = "应用退出，未自动重新提交";
          db.put("runs", run);
        }
    return this.load(project.id);
  }
  close(id: string) {
    const ctx = this.context(id);
    ctx.db.close();
    ctx.release();
    this.contexts.delete(id);
  }
  closeAll() {
    for (const id of this.contexts.keys()) this.close(id);
  }
  list<T>(id: string, file: string, schema: z.ZodType<T>): T[] {
    const { project } = this.context(id);
    const items = z
      .object({ schemaVersion: z.literal(1), items: z.array(schema) })
      .parse(
        readJson(safePath(project.root, `.content-workspace/${file}.json`)),
      ).items;
    if (
      items.some(
        (item) =>
          typeof item === "object" &&
          item !== null &&
          "projectId" in item &&
          item.projectId !== id,
      )
    )
      throw new AppError("PROJECT_MISMATCH", "登记数据包含其他项目的记录");
    return items;
  }
  saveList(id: string, file: string, items: unknown[]) {
    const { project } = this.context(id, true);
    writeJson(
      safePath(project.root, `.content-workspace/${file}.json`),
      envelope(items),
    );
  }
  platforms(id: string): PlatformDefinition[] {
    const { project } = this.context(id);
    const file = safePath(project.root, ".content-workspace/platforms.json");
    const saved = existsSync(file)
      ? this.list(
          id,
          "platforms",
          platformDefinitionSchema.extend({
            composer: composerModeSchema.optional(),
          }),
        )
      : [];
    if (new Set(saved.map((p) => p.id)).size !== saved.length)
      throw new AppError(
        "PLATFORM_DUPLICATE",
        "平台配置中有重复标识，请检查 platforms.json",
      );
    const merged = new Map(defaultPlatforms.map((p) => [p.id, { ...p }]));
    for (const platform of saved)
      merged.set(platform.id, {
        ...platform,
        composer:
          platform.composer ?? merged.get(platform.id)?.composer ?? "post",
      });
    return [...merged.values()];
  }
  requirePlatform(id: string, platformId: Platform) {
    const platform = this.platforms(id).find(
      (p) => p.id === platformIdSchema.parse(platformId),
    );
    if (!platform)
      throw new AppError(
        "PLATFORM_UNKNOWN",
        "平台尚未添加，请先在平台管理中添加",
      );
    return platform;
  }
  savePlatform(
    id: string,
    input: {
      id?: string;
      name: string;
      color: string;
      composer?: ComposerMode;
    },
  ) {
    this.context(id, true);
    const details = platformDetailsSchema.parse(input);
    const items = this.platforms(id);
    const platformId =
      input.id === undefined
        ? `custom_${uuid()}`
        : this.requirePlatform(id, input.id).id;
    const normalized = (name: string) =>
      name.normalize("NFKC").trim().toLowerCase();
    if (
      items.some(
        (p) =>
          p.id !== platformId &&
          normalized(p.name) === normalized(details.name),
      )
    )
      throw new AppError(
        "PLATFORM_DUPLICATE",
        "已有同名平台，请选择现有平台或使用其他名称",
      );
    const saved = platformDefinitionSchema.parse({
      ...details,
      id: platformId,
      composer:
        details.composer ??
        items.find((p) => p.id === platformId)?.composer ??
        "post",
    });
    this.saveList(id, "platforms", [
      ...items.filter((p) => p.id !== platformId),
      saved,
    ]);
    return saved;
  }
  getContent(id: string, contentId: string): Content {
    const { project } = this.context(id);
    const cid = z.uuid().parse(contentId);
    const content = contentSchema.parse(
      readJson(safePath(project.root, `content/${cid}/manifest.json`)),
    );
    if (content.projectId !== id)
      throw new AppError("PROJECT_MISMATCH", "内容不属于当前项目");
    const previous = structuredClone(content);
    let externalChange = false;
    for (const variant of content.variants) {
      variant.body = readFileSync(
        safePath(project.root, `content/${cid}/variants/${variant.id}.md`),
        "utf8",
      );
      if (hash(variant.body) !== variant.bodyHash) {
        externalChange = true;
        variant.bodyHash = hash(variant.body);
        variant.revision++;
        variant.readiness = "draft";
      }
    }
    const brief = readFileSync(
      safePath(project.root, `content/${cid}/brief.md`),
      "utf8",
    );
    if (brief !== content.brief) externalChange = true;
    content.brief = brief;
    if (externalChange && !project.readOnly) {
      content.revision++;
      content.updatedAt = now();
      const history: Record<string, string> = {};
      for (const variant of previous.variants)
        history[
          `.content-workspace/history/${variant.id}-${variant.revision}-${uuid()}.json`
        ] = json(previous);
      journalWrite(project.root, {
        ...history,
        [`content/${cid}/manifest.json`]: json(content),
      });
    }
    return content;
  }
  load(id: string): Workspace {
    const { project, db } = this.context(id);
    const directory = safePath(project.root, "content");
    const contents: Content[] = [];
    if (existsSync(directory))
      for (const entry of readdirSync(directory)) {
        if (
          z.uuid().safeParse(entry).success &&
          existsSync(safePath(project.root, `content/${entry}/manifest.json`))
        )
          contents.push(this.getContent(id, entry));
      }
    const assets = this.list(id, "assets", assetSchema).map((a) => {
      let availability: Asset["availability"] = "available";
      try {
        const info = statSync(assetFile(project.root, a));
        if (info.size !== a.bytes || Math.abs(info.mtimeMs - a.modifiedMs) > 2)
          availability = "changed";
      } catch {
        availability = "missing";
      }
      return { ...a, availability };
    });
    const profile = { identity: "", facts: "", voice: "" };
    for (const field of Object.keys(profile) as (keyof typeof profile)[]) {
      const f = safePath(project.root, `profile/${field}.md`);
      if (existsSync(f)) profile[field] = readFileSync(f, "utf8");
    }
    return {
      project,
      platforms: this.platforms(id),
      profile,
      contents: contents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      assets,
      accounts: this.list(id, "accounts", accountSchema),
      targets: this.list(id, "targets", targetSchema),
      jobs: db.list<Job>("jobs", id),
      runs: db.list<AiRun>("runs", id),
    };
  }
  updateProfile(
    id: string,
    input: {
      name: string;
      identityType: "brand" | "founder" | "custom";
      timezone: string;
      identity: string;
      facts: string;
      voice: string;
      baseRevision: number;
    },
  ) {
    const { project } = this.context(id, true);
    if (input.baseRevision !== project.revision)
      throw new AppError("REVISION_CONFLICT", "身份资料已修改，请重新加载");
    try {
      new Intl.DateTimeFormat("zh", { timeZone: input.timezone });
    } catch {
      throw new AppError("INVALID_TIMEZONE", "请输入有效 IANA 时区");
    }
    const next = projectSchema.parse({
      ...project,
      ...input,
      revision: project.revision + 1,
      updatedAt: now(),
    });
    journalWrite(project.root, {
      ".content-workspace/project.json": json(next),
      "profile/identity.md": input.identity,
      "profile/facts.md": input.facts,
      "profile/voice.md": input.voice,
    });
    Object.assign(project, next);
    this.remember(project);
    return this.load(id);
  }
  createContent(id: string, title: string) {
    const { project } = this.context(id, true);
    const content: Content = {
      schemaVersion: 1,
      id: uuid(),
      projectId: id,
      title: title.trim() || "未命名主题",
      audience: "",
      objective: "",
      brief: "",
      revision: 1,
      state: "active",
      variants: [],
      updatedAt: now(),
    };
    journalWrite(project.root, {
      [`content/${content.id}/brief.md`]: "",
      [`content/${content.id}/manifest.json`]: json(content),
    });
    return content;
  }
  addVariant(
    id: string,
    contentId: string,
    platform: Platform,
    locale: string,
  ) {
    this.context(id, true);
    this.requirePlatform(id, platform);
    const content = this.getContent(id, contentId);
    const v = variantSchema.parse({
      id: uuid(),
      platform,
      locale,
      title: content.title,
      body: "",
      tags: [],
      assetIds: [],
      coverId: null,
      segments: [],
      revision: 0,
      bodyHash: hash(""),
      readiness: "draft",
    });
    content.variants.push(v);
    this.writeContent(id, content);
    return content;
  }
  writeContent(id: string, content: Content) {
    const { project } = this.context(id, true);
    content.revision++;
    content.updatedAt = now();
    const files: Record<string, string> = {
      [`content/${content.id}/manifest.json`]: json(content),
      [`content/${content.id}/brief.md`]: content.brief,
    };
    for (const v of content.variants)
      files[`content/${content.id}/variants/${v.id}.md`] = v.body;
    journalWrite(project.root, files);
  }
  validateAssets(id: string, variant: Variant) {
    const assets = this.list(id, "assets", assetSchema);
    const ids = [
      ...variant.assetIds,
      ...(variant.coverId ? [variant.coverId] : []),
      ...variant.segments.flatMap((s) => ("assetId" in s ? [s.assetId] : [])),
    ];
    for (const assetId of ids) {
      const a = assets.find((a) => a.id === assetId && a.projectId === id);
      if (!a) throw new AppError("ASSET_UNKNOWN", "草稿包含不属于此项目的素材");
    }
    if (
      variant.coverId &&
      assets.find((a) => a.id === variant.coverId)?.kind !== "image"
    )
      throw new AppError("INVALID_COVER", "封面必须是图片");
    for (const s of variant.segments)
      if (
        "assetId" in s &&
        assets.find((a) => a.id === s.assetId)?.kind !== s.type
      )
        throw new AppError("INVALID_SEGMENT", "消息段的媒体类型不匹配");
  }
  saveVariant(
    id: string,
    contentId: string,
    input: {
      variant: Variant;
      baseRevision: number;
      baseHash: string;
      brief?: string;
      audience?: string;
      objective?: string;
    },
  ) {
    const { project } = this.context(id, true);
    const content = this.getContent(id, contentId);
    const v = variantSchema.parse(input.variant);
    this.requirePlatform(id, v.platform);
    const current = content.variants.find((x) => x.id === v.id);
    if (!current) throw new AppError("VARIANT_UNKNOWN", "版本不存在");
    this.validateAssets(id, v);
    if (
      current.revision !== input.baseRevision ||
      hash(current.body) !== input.baseHash
    ) {
      const conflict = `.content-workspace/history/${uuid()}-conflict.json`;
      writeJson(safePath(project.root, conflict), {
        contentId,
        current,
        proposed: v,
        createdAt: now(),
      });
      throw new AppError(
        "REVISION_CONFLICT",
        "磁盘或草稿已经变化，双方版本已保留，请加载当前版本后合并",
        { current, proposed: v, conflict },
      );
    }
    const history = `.content-workspace/history/${v.id}-${current.revision}-${uuid()}.json`;
    const previous = { ...content };
    writeJson(safePath(project.root, history), previous);
    const changed =
      JSON.stringify({ ...current, readiness: "draft" }) !==
      JSON.stringify({ ...v, readiness: "draft" });
    v.revision = current.revision + 1;
    v.bodyHash = hash(v.body);
    if (changed) v.readiness = "draft";
    content.variants = content.variants.map((x) => (x.id === v.id ? v : x));
    if (input.brief !== undefined) content.brief = input.brief;
    if (input.audience !== undefined) content.audience = input.audience;
    if (input.objective !== undefined) content.objective = input.objective;
    this.writeContent(id, content);
    return content;
  }
  histories(id: string, contentId: string, variantId: string) {
    const { project } = this.context(id);
    const folder = safePath(project.root, ".content-workspace/history");
    if (!existsSync(folder)) return [];
    return readdirSync(folder)
      .filter(
        (x) =>
          x.startsWith(z.uuid().parse(variantId) + "-") &&
          !x.includes("conflict"),
      )
      .map((name) => readJson<Content>(path.join(folder, name)))
      .filter((c) => c.id === contentId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 30);
  }
  async importAssets(
    id: string,
    paths: string[],
    mode: "copy" | "reference",
    onProgress?: (message: string) => void,
  ) {
    const { project } = this.context(id, true);
    let assets = this.list(id, "assets", assetSchema);
    const result: { name: string; status: string; message?: string }[] = [];
    const files: string[] = [];
    // Reopening an indexed project must not reread every large source file.
    const registeredPaths = new Map(
      assets.map((asset) => [
        path
          .resolve(
            asset.storageMode === "copy"
              ? path.join(project.root, asset.path)
              : asset.path,
          )
          .toLowerCase(),
        asset,
      ]),
    );
    const walk = (p: string) => {
      if (files.length >= 10000)
        throw new AppError("IMPORT_LIMIT", "单次最多导入 10000 个文件");
      const real = realpathSync(p);
      if (real !== path.resolve(p)) return;
      const info = statSync(p);
      if (info.isDirectory()) {
        for (const d of readdirSync(p, { withFileTypes: true }))
          if (
            !d.isSymbolicLink() &&
            !d.name.startsWith(".") &&
            !ignored.has(d.name)
          )
            walk(path.join(p, d.name));
      } else files.push(p);
    };
    for (const p of paths) walk(p);
    for (const file of files) {
      let temp: string | undefined;
      try {
        const known = registeredPaths.get(path.resolve(file).toLowerCase());
        if (known) {
          const info = await stat(file);
          const unchanged =
            info.size === known.bytes &&
            Math.abs(info.mtimeMs - known.modifiedMs) <= 2;
          if (unchanged) {
            result.push({ name: path.basename(file), status: "reused" });
            continue;
          }
        }
        onProgress?.(`正在索引 ${path.basename(file)}`);
        const handle = await open(file, "r");
        const b = Buffer.alloc(32);
        try {
          await handle.read(b, 0, 32, 0);
        } finally {
          await handle.close();
        }
        const format = b
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          ? { mime: "image/png", kind: "image", ext: ".png" }
          : b[0] === 255 && b[1] === 216
            ? { mime: "image/jpeg", kind: "image", ext: ".jpg" }
            : b.toString("ascii", 0, 4) === "RIFF" &&
                b.toString("ascii", 8, 12) === "WEBP"
              ? { mime: "image/webp", kind: "image", ext: ".webp" }
              : b.toString("ascii", 4, 8) === "ftyp"
                ? { mime: "video/mp4", kind: "video", ext: ".mp4" }
                : null;
        if (!format) {
          result.push({
            name: path.basename(file),
            status: "skipped",
            message: "格式未支持",
          });
          continue;
        }
        const digest = await fileHash(file);
        assets = this.list(id, "assets", assetSchema);
        const duplicate = assets.find((a) => a.sha256 === digest);
        if (duplicate) {
          result.push({ name: path.basename(file), status: "reused" });
          continue;
        }
        const aid = uuid();
        let registered = file;
        let storageMode = mode;
        if (within(project.root, realpathSync(file))) {
          storageMode = "copy";
          registered = path.relative(project.root, file);
        } else if (mode === "copy") {
          registered = `assets/${format.kind === "image" ? "images" : "videos"}/${aid}${format.ext}`;
          const dest = safePath(project.root, registered);
          mkdirSync(path.dirname(dest), { recursive: true });
          temp = dest + ".tmp";
          await copyFile(file, temp, constants.COPYFILE_EXCL);
          if ((await fileHash(temp)) !== digest)
            throw new AppError("COPY_FAILED", "复制校验失败");
          await rename(temp, dest);
          temp = undefined;
        }
        const actual =
          storageMode === "copy"
            ? safePath(project.root, registered)
            : registered;
        const info = await stat(actual);
        const asset = assetSchema.parse({
          id: aid,
          projectId: id,
          name: path.basename(file),
          kind: format.kind,
          storageMode,
          path: registered,
          sha256: digest,
          bytes: info.size,
          mime: format.mime,
          modifiedMs: info.mtimeMs,
          tags: [],
        });
        assets = this.list(id, "assets", assetSchema);
        if (!assets.some((a) => a.sha256 === digest)) {
          assets.push(asset);
          this.saveList(id, "assets", assets);
        }
        result.push({ name: asset.name, status: "imported" });
      } catch (e) {
        if (temp) await unlink(temp).catch(() => {});
        result.push({
          name: path.basename(file),
          status: "failed",
          message: (e as Error).message,
        });
      }
    }
    return result;
  }
  mediaPath(id: string, assetId: string) {
    const { project } = this.context(id);
    const asset = this.list(id, "assets", assetSchema).find(
      (a) => a.id === z.uuid().parse(assetId) && a.projectId === id,
    );
    if (!asset) throw new AppError("ASSET_UNKNOWN", "素材未获授权");
    return { file: assetFile(project.root, asset), asset };
  }
  async reconnectAsset(id: string, assetId: string, file: string) {
    const { project } = this.context(id, true);
    const assets = this.list(id, "assets", assetSchema);
    const a = assets.find((x) => x.id === assetId);
    if (!a) throw new AppError("ASSET_UNKNOWN", "素材不存在");
    if ((await fileHash(file)) !== a.sha256)
      throw new AppError(
        "ASSET_CHANGED",
        "选择的文件内容不同，请作为新素材导入",
      );
    a.path = realpathSync(file);
    a.storageMode = "reference";
    a.modifiedMs = statSync(file).mtimeMs;
    this.saveList(project.id, "assets", assets);
    return this.load(id);
  }
  removeAsset(id: string, assetId: string) {
    const w = this.load(id);
    if (
      w.contents.some((c) =>
        c.variants.some(
          (v) =>
            v.assetIds.includes(assetId) ||
            v.coverId === assetId ||
            v.segments.some((s) => "assetId" in s && s.assetId === assetId),
        ),
      )
    )
      throw new AppError("ASSET_IN_USE", "素材仍被草稿引用，请先解除关联");
    this.saveList(
      id,
      "assets",
      w.assets.filter((a) => a.id !== assetId),
    );
  }
  addAccount(
    id: string,
    input: {
      platform: Platform;
      label: string;
      externalId: string;
      accountType: string;
    },
  ) {
    this.context(id, true);
    this.requirePlatform(id, input.platform);
    if (input.externalId.trim())
      for (const other of this.recent()) {
        let accounts: Account[] = [];
        try {
          accounts = readJson<{ items: Account[] }>(
            safePath(other.root, ".content-workspace/accounts.json"),
          ).items;
        } catch {
          continue;
        }
        if (
          accounts.some(
            (a) =>
              a.platform === input.platform &&
              a.externalId === input.externalId,
          )
        )
          throw new AppError(
            "ACCOUNT_DUPLICATE",
            `此账号已登记在 ${other.name}`,
          );
      }
    const accounts = this.list(id, "accounts", accountSchema);
    accounts.push(
      accountSchema.parse({
        ...input,
        id: uuid(),
        projectId: id,
        enabled: true,
      }),
    );
    this.saveList(id, "accounts", accounts);
    return this.load(id);
  }
  addTarget(
    id: string,
    input: { accountId: string; label: string; kind: Target["kind"] },
  ) {
    const accounts = this.list(id, "accounts", accountSchema);
    if (!accounts.some((a) => a.id === input.accountId))
      throw new AppError("ACCOUNT_UNKNOWN", "账号不属于当前项目");
    const targets = this.list(id, "targets", targetSchema);
    targets.push(
      targetSchema.parse({
        ...input,
        id: uuid(),
        projectId: id,
        enabled: true,
      }),
    );
    this.saveList(id, "targets", targets);
    return this.load(id);
  }
  setAccountEnabled(id: string, accountId: string, enabled: boolean) {
    const { db } = this.context(id, true);
    const accounts = this.list(id, "accounts", accountSchema);
    const a = accounts.find((a) => a.id === accountId);
    if (!a) throw new AppError("ACCOUNT_UNKNOWN", "账号不存在");
    a.enabled = enabled;
    this.saveList(id, "accounts", accounts);
    if (!enabled)
      for (const j of db.list<Job>("jobs", id))
        if (
          j.accountId === accountId &&
          !["completed", "cancelled"].includes(j.status)
        ) {
          j.status = "paused";
          db.put("jobs", j);
        }
    return this.load(id);
  }
  async schedule(
    id: string,
    input: {
      contentId: string;
      variantId: string;
      targetIds: string[];
      scheduledAtUtc: string;
      timezone: string;
    },
  ) {
    const { project, db } = this.context(id, true);
    const content = this.getContent(id, input.contentId);
    const v = content.variants.find((v) => v.id === input.variantId);
    if (!v || v.readiness !== "ready")
      throw new AppError("NOT_READY", "请保存并标记版本就绪");
    const platform = this.requirePlatform(id, v.platform);
    if (!v.body.trim() && !v.assetIds.length && !v.segments.length)
      throw new AppError("EMPTY_CONTENT", "内容为空");
    if (hash(v.body) !== v.bodyHash)
      throw new AppError(
        "REVISION_CONFLICT",
        "文案已在外部修改，请重新保存并标记就绪",
      );
    this.validateAssets(id, v);
    if (!Number.isFinite(Date.parse(input.scheduledAtUtc)))
      throw new AppError("INVALID_TIME", "排期时间无效");
    new Intl.DateTimeFormat("zh", { timeZone: input.timezone });
    const targets = this.list(id, "targets", targetSchema);
    const accounts = this.list(id, "accounts", accountSchema);
    const selected = [...new Set(input.targetIds)].map((targetId) => {
      const target = targets.find((t) => t.id === targetId && t.enabled);
      const account = accounts.find(
        (a) => a.id === target?.accountId && a.enabled,
      );
      if (!target || !account || account.platform !== v.platform)
        throw new AppError("TARGET_MISMATCH", "目标平台或账号不匹配，或已停用");
      return { target, account };
    });
    if (!selected.length)
      throw new AppError("TARGET_REQUIRED", "请选择至少一个发布目标");
    const sid = uuid();
    const snapshotRoot = safePath(
      project.root,
      `.content-workspace/snapshots/${sid}`,
    );
    mkdirSync(snapshotRoot, { recursive: true });
    const media: Record<string, { file: string; sha256: string }> = {};
    const assetIds = [
      ...new Set([
        ...v.assetIds,
        ...(v.coverId ? [v.coverId] : []),
        ...v.segments.flatMap((s) => ("assetId" in s ? [s.assetId] : [])),
      ]),
    ];
    for (const aid of assetIds) {
      const { file, asset } = this.mediaPath(id, aid);
      const filename = `${String(Object.keys(media).length + 1).padStart(2, "0")}-${aid}${path.extname(file)}`;
      const destination = path.join(snapshotRoot, filename);
      await copyFile(file, destination, constants.COPYFILE_EXCL);
      if ((await fileHash(destination)) !== asset.sha256)
        throw new AppError("ASSET_CHANGED", "素材已改变，请重新导入后安排任务");
      media[aid] = { file: filename, sha256: asset.sha256 };
    }
    const segments = v.segments.length
      ? v.segments
      : [
          ...(v.body.trim()
            ? [
                {
                  type: "text" as const,
                  text:
                    v.body +
                    (v.tags.length &&
                    !["video", "article"].includes(platform.composer)
                      ? "\n\n" +
                        v.tags.map((t) => "#" + t.replace(/^#/, "")).join(" ")
                      : ""),
                },
              ]
            : []),
          ...v.assetIds.map((aid) => ({
            type: this.mediaPath(id, aid).asset.kind,
            assetId: aid,
          })),
        ];
    const snapshot = {
      schemaVersion: 1,
      id: sid,
      projectId: id,
      variant: v,
      platform,
      segments,
      media,
      createdAt: now(),
      payloadHash: hash(json({ v, platform, segments, media })),
    };
    writeJson(path.join(snapshotRoot, "manifest.json"), snapshot);
    atomicWrite(path.join(snapshotRoot, "正文.md"), v.body);
    const jobs = selected.map(
      ({ target, account }): Job => ({
        id: uuid(),
        projectId: id,
        contentId: content.id,
        variantId: v.id,
        snapshotId: sid,
        accountId: account.id,
        targetId: target.id,
        targetLabel: target.label,
        accountLabel: account.label,
        title: v.title,
        platform: v.platform,
        mode: "manual_due",
        scheduledAtUtc: new Date(input.scheduledAtUtc).toISOString(),
        timezone: input.timezone,
        status:
          Date.parse(input.scheduledAtUtc) > Date.now()
            ? "scheduled"
            : "manual_pending",
        createdAt: now(),
        receipt: null,
        segmentCount: segments.length,
      }),
    );
    db.db.exec("BEGIN");
    try {
      for (const job of jobs) db.put("jobs", job);
      db.db.exec("COMMIT");
    } catch (e) {
      db.db.exec("ROLLBACK");
      throw e;
    }
    return jobs;
  }
  job(id: string, jobId: string) {
    const job = this.context(id)
      .db.list<Job>("jobs", id)
      .find((j) => j.id === jobId);
    if (!job) throw new AppError("JOB_UNKNOWN", "任务不存在");
    return job;
  }
  exportJob(id: string, jobId: string) {
    const { project } = this.context(id, true);
    const job = this.job(id, jobId);
    const source = safePath(
      project.root,
      `.content-workspace/snapshots/${job.snapshotId}`,
    );
    const finalTarget = safePath(project.root, `exports/${job.id}`);
    if (existsSync(finalTarget)) {
      if (!existsSync(path.join(finalTarget, "target.json")))
        throw new AppError(
          "EXPORT_INCOMPLETE",
          "导出目录不完整，请保留该目录并另行备份后处理",
        );
      return finalTarget;
    }
    const target = safePath(project.root, `exports/${job.id}-${uuid()}.tmp`);
    mkdirSync(target, { recursive: true });
    this.copySafeTree(source, target);
    const snapshot = readJson<{
      platform?: PlatformDefinition;
      variant: Variant;
      segments: Variant["segments"];
      media: Record<string, { file: string }>;
    }>(path.join(source, "manifest.json"));
    const messages = snapshot.segments
      .map(
        (s, i) =>
          `## ${String(i + 1).padStart(2, "0")} · ${s.type}\n\n${s.type === "text" ? s.text : s.type === "link" ? s.label + "\n" + s.url : snapshot.media[s.assetId].file}`,
      )
      .join("\n\n");
    atomicWrite(
      path.join(target, "发送顺序.md"),
      `# ${job.targetLabel}\n\n平台：${snapshot.platform?.name ?? this.requirePlatform(id, job.platform).name}\n发送身份：${job.accountLabel}\n此包仅用于人工发布，导出不代表已发送。\n\n${messages}`,
    );
    const article = snapshot.variant.article;
    atomicWrite(
      path.join(target, "发布信息.md"),
      [
        `# ${snapshot.variant.title}`,
        `平台：${snapshot.platform?.name ?? this.requirePlatform(id, job.platform).name}`,
        `话题 / 关键词：${snapshot.variant.tags.join(" ")}`,
        `封面文件：${snapshot.variant.coverId ? (snapshot.media[snapshot.variant.coverId]?.file ?? "") : ""}`,
        ...(article
          ? [
              `作者：${article.author}`,
              `摘要：${article.digest}`,
              `原文链接：${article.sourceUrl}`,
            ]
          : []),
        "标题、作者、摘要、封面和关键词请按目标平台的对应字段填写。正文见 正文.md。",
      ].join("\n\n"),
    );
    writeJson(path.join(target, "target.json"), { ...job, exportedAt: now() });
    renameSync(target, finalTarget);
    return finalTarget;
  }
  recordManual(id: string, jobId: string, receipt: Receipt) {
    const { db } = this.context(id, true);
    const job = this.job(id, jobId);
    if (["completed", "cancelled"].includes(job.status))
      throw new AppError("JOB_FINAL", "此任务已经结束");
    if (
      !receipt.recordedBy.trim() ||
      !receipt.result.trim() ||
      !Number.isFinite(Date.parse(receipt.recordedAt))
    )
      throw new AppError("RECEIPT_REQUIRED", "请填写发送人、实际时间与结果");
    if (receipt.url && !/^https?:\/\//.test(receipt.url))
      throw new AppError("INVALID_URL", "链接应以 http 或 https 开头");
    const done = [
      ...new Set([
        ...(job.receipt?.completedSegments ?? []),
        ...receipt.completedSegments,
      ]),
    ];
    if (
      done.some(
        (i) => !Number.isInteger(i) || i < 0 || i >= job.segmentCount,
      ) ||
      !done.length
    )
      throw new AppError("INVALID_SEGMENTS", "请选择已发送的消息段");
    job.receipt = { ...receipt, completedSegments: done };
    job.status = done.length === job.segmentCount ? "completed" : "partial";
    db.put("jobs", job);
    return job;
  }
  updateJob(
    id: string,
    jobId: string,
    input: {
      status?: "paused" | "cancelled" | "scheduled";
      scheduledAtUtc?: string;
    },
  ) {
    const { db } = this.context(id, true);
    const job = this.job(id, jobId);
    if (["completed", "cancelled", "partial"].includes(job.status))
      throw new AppError("JOB_FINAL", "此任务不能重新安排");
    if (input.scheduledAtUtc) {
      if (!Number.isFinite(Date.parse(input.scheduledAtUtc)))
        throw new AppError("INVALID_TIME", "时间无效");
      job.scheduledAtUtc = new Date(input.scheduledAtUtc).toISOString();
    }
    if (input.status) job.status = input.status;
    db.put("jobs", job);
    return job;
  }
  backup(id: string, destination: string, includeExternal: boolean) {
    const { project, db } = this.context(id, true);
    if (within(project.root, path.resolve(destination)))
      throw new AppError("INVALID_BACKUP_PATH", "备份需放在项目目录外");
    if (existsSync(destination) && readdirSync(destination).length)
      throw new AppError("DESTINATION_EXISTS", "备份目标必须为空目录");
    mkdirSync(destination, { recursive: true });
    const metadata = path.join(destination, ".content-workspace");
    mkdirSync(metadata, { recursive: true });
    recoverJournal(project.root);
    for (const folder of ["profile", "content", "assets"]) {
      const source = safePath(project.root, folder);
      if (existsSync(source))
        this.copySafeTree(source, path.join(destination, folder));
    }
    for (const entry of [
      "project.json",
      "platforms.json",
      "accounts.json",
      "targets.json",
      "assets.json",
      "history",
      "snapshots",
      "ai-runs",
    ]) {
      const source = safePath(project.root, `.content-workspace/${entry}`);
      if (existsSync(source))
        this.copySafeTree(source, path.join(metadata, entry));
    }
    db.db.exec("PRAGMA wal_checkpoint(FULL)");
    copyFileSync(
      safePath(project.root, ".content-workspace/state.sqlite"),
      path.join(metadata, "state.sqlite"),
    );
    const assets = this.list(id, "assets", assetSchema);
    const missing: string[] = [];
    for (const a of assets) {
      if (a.storageMode === "copy") {
        const file = assetFile(project.root, a);
        const dest = safePath(destination, a.path);
        if (!existsSync(dest)) {
          mkdirSync(path.dirname(dest), { recursive: true });
          copyFileSync(file, dest, constants.COPYFILE_EXCL);
        }
        a.modifiedMs = statSync(dest).mtimeMs;
      }
    }
    for (const a of assets)
      if (a.storageMode === "reference") {
        if (includeExternal) {
          try {
            const file = assetFile(project.root, a);
            const relative = `assets/external/${a.id}${path.extname(file)}`;
            const dest = path.join(destination, relative);
            mkdirSync(path.dirname(dest), { recursive: true });
            copyFileSync(file, dest);
            a.path = relative;
            a.storageMode = "copy";
            a.modifiedMs = statSync(dest).mtimeMs;
          } catch {
            missing.push(a.path);
          }
        } else missing.push(a.path);
      }
    writeJson(path.join(metadata, "assets.json"), envelope(assets));
    writeJson(path.join(destination, "backup-manifest.json"), {
      schemaVersion: 1,
      projectId: id,
      createdAt: now(),
      externalFilesNotIncluded: missing,
      credentialsIncluded: false,
      queuePolicy: "paused-on-restore",
    });
    return destination;
  }
  copySafeTree(source: string, dest: string) {
    const actual = realpathSync(source);
    if (
      path.resolve(actual).toLowerCase() !== path.resolve(source).toLowerCase()
    )
      throw new AppError("PATH_UNAVAILABLE", "备份拒绝符号链接");
    if (statSync(source).isDirectory()) {
      mkdirSync(dest, { recursive: true });
      for (const entry of readdirSync(source, { withFileTypes: true })) {
        if (entry.isSymbolicLink())
          throw new AppError("PATH_UNAVAILABLE", "备份拒绝符号链接");
        this.copySafeTree(
          path.join(source, entry.name),
          path.join(dest, entry.name),
        );
      }
    } else {
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(source, dest, constants.COPYFILE_EXCL);
    }
  }
  async restore(source: string, destination: string) {
    if (existsSync(destination) && readdirSync(destination).length)
      throw new AppError("DESTINATION_EXISTS", "恢复目标必须为空目录");
    if (
      within(source, path.resolve(destination)) ||
      within(destination, path.resolve(source))
    )
      throw new AppError("INVALID_BACKUP_PATH", "备份与恢复目录不能互相包含");
    const p = projectSchema.parse(
      readJson(path.join(source, ".content-workspace/project.json")),
    );
    this.copySafeTree(source, destination);
    if (this.contexts.has(p.id)) this.close(p.id);
    const workspace = await this.open(destination);
    const ctx = this.context(p.id, true);
    for (const job of ctx.db.list<Job>("jobs", p.id))
      if (!["completed", "cancelled"].includes(job.status)) {
        job.status = "paused";
        ctx.db.put("jobs", job);
      }
    return { ...workspace, jobs: ctx.db.list<Job>("jobs", p.id) };
  }
  async saveDerived(
    id: string,
    sourceId: string,
    png: Buffer,
    kind: "crop" | "frame",
    parameters: Record<string, number>,
  ) {
    this.context(id, true);
    const { asset } = this.mediaPath(id, sourceId);
    if (
      (kind === "frame" && asset.kind !== "video") ||
      (kind === "crop" && asset.kind !== "image")
    )
      throw new AppError("INVALID_DERIVATION", "素材类型不匹配");
    const { project } = this.context(id, true);
    const assetId = uuid();
    const relative = `assets/images/${assetId}.png`;
    const file = safePath(project.root, relative);
    atomicWrite(file, png);
    const info = statSync(file);
    const derived: Asset = {
      id: assetId,
      projectId: id,
      name:
        kind === "frame" ? `关键帧 · ${asset.name}` : `裁剪 · ${asset.name}`,
      kind: "image",
      storageMode: "copy",
      path: relative,
      sha256: hash(png),
      bytes: info.size,
      mime: "image/png",
      modifiedMs: info.mtimeMs,
      tags: [],
      derivedFrom: { assetId: sourceId, kind, parameters },
    };
    const assets = this.list(id, "assets", assetSchema);
    assets.push(derived);
    this.saveList(id, "assets", assets);
    return derived;
  }
}
