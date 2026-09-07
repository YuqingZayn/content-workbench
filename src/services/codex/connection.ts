import {
  spawn,
  execFileSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { EventEmitter } from "node:events";
import { StringDecoder } from "node:string_decoder";
import { existsSync } from "node:fs";
import path from "node:path";
import { AppError } from "../files";
export class JsonLines extends EventEmitter {
  buffer = "";
  decoder = new StringDecoder("utf8");
  push(chunk: Buffer) {
    this.buffer += this.decoder.write(chunk);
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      try {
        this.emit("message", JSON.parse(line));
      } catch {
        this.emit("invalid", line.slice(0, 200));
      }
    }
    if (this.buffer.length > 16 * 1024 * 1024)
      throw new Error("Codex message exceeds buffer limit");
  }
}
export function findCodex(configured?: string) {
  if (configured) {
    if (
      !existsSync(configured) ||
      ![".exe", ""].includes(path.extname(configured).toLowerCase())
    )
      throw new AppError("CODEX_NOT_FOUND", "CLI 路径无效，请选择 codex.exe");
    return configured;
  }
  try {
    const candidates = execFileSync(
      process.platform === "win32" ? "where.exe" : "which",
      ["codex"],
      { encoding: "utf8", windowsHide: true },
    )
      .trim()
      .split(/\r?\n/);
    const executable = candidates.find(
      (p) => process.platform !== "win32" || p.toLowerCase().endsWith(".exe"),
    );
    if (executable) return executable;
  } catch {
    /* report below */
  }
  throw new AppError(
    "CODEX_NOT_FOUND",
    "找不到 Codex CLI，请在设置中选择 codex.exe",
  );
}
export class CodexConnection extends EventEmitter {
  child?: ChildProcessWithoutNullStreams;
  pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  counter = 0;
  version = "";
  async connect(executable: string) {
    this.version = execFileSync(executable, ["--version"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    }).trim();
    this.child = spawn(executable, ["app-server", "--stdio"], {
      windowsHide: true,
      stdio: "pipe",
    });
    const lines = new JsonLines();
    lines.on("message", (m: any) => {
      if (m.id !== undefined && !m.method) {
        const p = this.pending.get(m.id);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(m.id);
          if (m.error)
            p.reject(new AppError("CODEX_PROTOCOL_ERROR", m.error.message));
          else p.resolve(m.result);
        }
      } else if (m.method) this.emit("notification", m);
    });
    lines.on("invalid", () =>
      this.emit("protocolWarning", "CLI 返回了无效 JSON 行"),
    );
    this.child.stdout.on("data", (b) => {
      try {
        lines.push(b);
      } catch (e) {
        this.fail(e as Error);
      }
    });
    this.child.stderr.on("data", () => {
      /* never expose CLI stderr, which can contain private paths */
    });
    this.child.on("error", (e) => this.fail(e));
    this.child.on("exit", () => {
      this.fail(new AppError("CODEX_DISCONNECTED", "Codex 进程已退出"));
      this.emit("disconnected");
    });
    await this.request("initialize", {
      clientInfo: {
        name: "content-workbench",
        title: "内容工作台",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    this.notify("initialized", {});
  }
  request<T = any>(method: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.killed) {
        reject(new AppError("CODEX_DISCONNECTED", "Codex 未连接"));
        return;
      }
      const id = ++this.counter;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AppError("CODEX_TIMEOUT", `${method} 响应超时`));
      }, 45000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  notify(method: string, params: unknown) {
    this.child?.stdin.write(JSON.stringify({ method, params }) + "\n");
  }
  respond(id: string | number, result: unknown) {
    this.child?.stdin.write(JSON.stringify({ id, result }) + "\n");
  }
  fail(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  close() {
    this.child?.kill();
    this.fail(new AppError("CODEX_DISCONNECTED", "连接已关闭"));
  }
}
