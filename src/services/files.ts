import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  readdirSync,
  unlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const now = () => new Date().toISOString();
export const uuid = () => randomUUID();
export const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, "utf8"));
}
export function atomicWrite(file: string, data: string | Buffer) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${uuid()}.tmp`;
  writeFileSync(tmp, data, { flag: "wx", flush: true });
  renameSync(tmp, file);
}
export const writeJson = (file: string, value: unknown) =>
  atomicWrite(file, JSON.stringify(value, null, 2));
export function within(root: string, target: string) {
  const rel = path.relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel))
  );
}
export function safePath(root: string, relative: string) {
  const target = path.resolve(root, relative);
  if (!within(root, target))
    throw new AppError("PATH_UNAVAILABLE", "路径不在项目内");
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (!within(realpathSync(root), realpathSync(ancestor)))
    throw new AppError("PATH_UNAVAILABLE", "拒绝越界的符号链接");
  return target;
}
export async function fileHash(file: string) {
  const digest = createHash("sha256");
  await pipeline(
    createReadStream(file),
    new Writable({
      write(chunk, _enc, cb) {
        digest.update(chunk);
        cb();
      },
    }),
  );
  return digest.digest("hex");
}
export function journalWrite(root: string, files: Record<string, string>) {
  const id = uuid();
  const folder = safePath(root, ".content-workspace/journal");
  mkdirSync(folder, { recursive: true });
  const record = path.join(folder, `${id}.json`);
  writeJson(record, { id, files });
  for (const [name, data] of Object.entries(files))
    atomicWrite(safePath(root, name), data);
  unlinkSync(record);
}
export function recoverJournal(root: string) {
  const folder = safePath(root, ".content-workspace/journal");
  if (!existsSync(folder)) return;
  for (const name of readdirSync(folder).filter((x) => x.endsWith(".json"))) {
    const file = path.join(folder, name);
    const record = readJson<{ files: Record<string, string> }>(file);
    for (const [rel, data] of Object.entries(record.files))
      atomicWrite(safePath(root, rel), data);
    unlinkSync(file);
  }
}
export function acquireLock(root: string) {
  const file = safePath(root, ".content-workspace/writer.lock");
  if (existsSync(file)) {
    const lock = readJson<{ pid: number }>(file);
    let alive = true;
    try {
      process.kill(lock.pid, 0);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ESRCH") alive = false;
    }
    if (alive)
      throw new AppError(
        "PROJECT_READ_ONLY",
        "此项目已在另一进程中打开，当前为只读",
      );
    unlinkSync(file);
  }
  writeFileSync(file, JSON.stringify({ pid: process.pid, createdAt: now() }), {
    flag: "wx",
  });
  return () => {
    if (existsSync(file) && readJson<{ pid: number }>(file).pid === process.pid)
      unlinkSync(file);
  };
}
export function assetFile(
  root: string,
  asset: { path: string; storageMode: string },
) {
  const file =
    asset.storageMode === "reference" ? asset.path : safePath(root, asset.path);
  if (!existsSync(file) || !statSync(file).isFile())
    throw new AppError("ASSET_MISSING", "素材文件丢失，请重新定位");
  if (
    asset.storageMode === "reference" &&
    path.resolve(realpathSync(file)).toLowerCase() !==
      path.resolve(file).toLowerCase()
  )
    throw new AppError(
      "PATH_UNAVAILABLE",
      "外部引用路径已变成符号链接，请重新导入",
    );
  return file;
}
export function parseRange(
  value: string | null,
  size: number,
): { start: number; end: number } | null {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2]) || size === 0)
    throw new AppError("RANGE_INVALID", "无效的媒体范围");
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1]
    ? match[2]
      ? Math.min(Number(match[2]), size - 1)
      : size - 1
    : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    start > end
  )
    throw new AppError("RANGE_INVALID", "无效的媒体范围");
  return { start, end };
}
