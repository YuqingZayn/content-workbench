import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import type { Account, Job, Target, Variant } from "../../contracts/model";
import type {
  Prepared,
  PublishConnection,
  PublishResult,
  PublishSecrets,
} from "../../contracts/automation";
import { AppError } from "../files";
export type SnapshotInput = {
  job: Job;
  account: Account;
  target: Target;
  variant: Variant;
  text: string;
  media: { id: string; file: string; mime: string; sha256: string }[];
};
export interface AdapterContext {
  connection: PublishConnection;
  secrets: PublishSecrets;
  saveSecrets: (s: PublishSecrets) => void;
  persistPrepared: (p: Prepared) => void;
}
export interface PublisherAdapter {
  check(c: AdapterContext): Promise<{ remoteId: string; message: string }>;
  validate(input: SnapshotInput, c: AdapterContext): Promise<void>;
  prepare(
    input: SnapshotInput,
    c: AdapterContext,
    previous: Prepared,
  ): Promise<Prepared>;
  submit(
    input: SnapshotInput,
    c: AdapterContext,
    prepared: Prepared,
  ): Promise<PublishResult>;
  reconcile(
    input: SnapshotInput,
    c: AdapterContext,
    prepared: Prepared,
    result?: PublishResult,
  ): Promise<PublishResult>;
  cleanup?(c: AdapterContext, prepared: Prepared): Promise<void>;
}
export class PublishError extends Error {
  constructor(
    message: string,
    public retryable = false,
    public authError = false,
    public retryAfterMs?: number,
    public ambiguous = false,
  ) {
    super(message);
  }
}
export type Transport = (url: string, init?: RequestInit) => Promise<Response>;
export const transport: Transport = (url, init = {}) =>
  fetch(url, {
    ...init,
    redirect: "error",
    signal: init.signal ?? AbortSignal.timeout(30000),
  });
export function httpsUrl(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:" || u.username || u.password)
    throw new AppError(
      "HTTPS_REQUIRED",
      "连接地址必须是 HTTPS 且不能包含用户名密码",
    );
  return u;
}
export class Http {
  constructor(public fetch: Transport = transport) {}
  async json(
    url: string,
    init: RequestInit = {},
    submitting = false,
  ): Promise<any> {
    let response: Response;
    try {
      response = await this.fetch(url, init);
    } catch {
      throw new PublishError(
        submitting ? "提交连接中断，结果未知，请先核实" : "连接失败，尚未提交",
        !submitting,
        false,
        undefined,
        submitting,
      );
    }
    let data: any;
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok || data.error) {
      const status = response.status;
      const auth = status === 401 || status === 403 || data.error?.code === 190;
      const after = response.headers.get("retry-after");
      const parsedMs = after
        ? Number.isFinite(Number(after))
          ? Number(after) * 1000
          : Math.max(0, Date.parse(after) - Date.now())
        : typeof data.retry_after === "number"
          ? data.retry_after * 1000
          : undefined;
      const ms = Number.isFinite(parsedMs) ? Math.max(0, parsedMs!) : undefined;
      // Do not persist response bodies: providers may echo credentials, signed URLs or content.
      throw new PublishError(
        auth ? "平台授权已失效或权限不足" : `平台请求失败（HTTP ${status}）`,
        status === 429 || (!submitting && status >= 500),
        auth,
        ms,
        submitting && (status >= 500 || status === 408),
      );
    }
    return data;
  }
  post(url: string, data: unknown, token?: string, submitting = false) {
    return this.json(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      },
      submitting,
    );
  }
  async multipart(
    url: string,
    fields: Record<string, string>,
    files: SnapshotInput["media"],
    token?: string,
    submitting = false,
  ) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if ((await stat(file.file)).size > 100 * 1024 * 1024)
        throw new PublishError(
          "单文件超过此连接的 100 MB 上传保护上限，请使用辅助包",
        );
      form.set(
        files.length === 1 && fields.__single ? "source" : `files[${i}]`,
        await openAsBlob(file.file, { type: file.mime }),
        path.basename(file.file),
      );
    }
    form.delete("__single");
    return this.json(
      url,
      {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      },
      submitting,
    );
  }
}
export const resultId = (id: unknown) =>
  typeof id === "string" && /^[\w-]+$/.test(id) ? id : undefined;
