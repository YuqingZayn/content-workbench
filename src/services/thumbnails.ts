import { Worker } from "node:worker_threads";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { stat, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { Asset } from "../contracts/model";

type Output = { file: string; etag: string; cached: boolean };
type Job = {
  key: string;
  source: string;
  destination: string;
  temporary: string;
  edge: number;
  fingerprint: string;
  signals: (AbortSignal | undefined)[];
  promise: Promise<Output>;
  resolve: (result: Output) => void;
  reject: (error: Error) => void;
};
type Slot = {
  worker: Worker;
  job?: Job;
  finishing?: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
const fingerprint = (info: { size: number; mtimeMs: number }) =>
  `${info.size}:${info.mtimeMs}`;

export class ThumbnailService {
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private slots: Slot[] = [];
  private closed = false;
  constructor(
    private directory: string,
    private workerFile: string,
    private concurrency = 2,
  ) {
    mkdirSync(directory, { recursive: true });
  }
  async get(
    source: string,
    asset: Asset,
    edge: 512 | 1600,
    signal?: AbortSignal,
  ): Promise<Output> {
    if (this.closed || signal?.aborted) throw new Error("Preview cancelled");
    if (asset.kind !== "image")
      throw new Error("Only registered images have previews");
    const info = await stat(source);
    if (
      info.size !== asset.bytes ||
      Math.abs(info.mtimeMs - asset.modifiedMs) > 2
    )
      throw new Error("Source image changed; refresh or reimport it");
    const stamp = fingerprint(info);
    const key = createHash("sha256")
      .update(`v1:${source}:${asset.sha256}:${stamp}:${edge}`)
      .digest("hex");
    const destination = path.join(this.directory, `${key}.webp`);
    const cached = await stat(destination).catch(() => null);
    if (cached?.isFile() && cached.size > 0)
      return { file: destination, etag: `"${key}"`, cached: true };
    // Recheck after the async disk lookup so simultaneous requests share a job.
    const existing = this.jobs.get(key);
    if (existing) {
      existing.signals.push(signal);
      return existing.promise;
    }
    if (this.closed) throw new Error("Preview service closed");
    let resolve!: Job["resolve"], reject!: Job["reject"];
    const promise = new Promise<Output>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const job: Job = {
      key,
      source,
      destination,
      temporary: `${destination}.${randomUUID()}.tmp`,
      edge,
      fingerprint: stamp,
      signals: [signal],
      promise,
      resolve,
      reject,
    };
    this.jobs.set(key, job);
    this.queue.push(job);
    this.drain();
    return promise;
  }
  private spawn(): Slot {
    const worker = new Worker(this.workerFile);
    const slot: Slot = { worker };
    worker.on("message", (message: { ok: boolean; error?: string }) => {
      void this.finish(
        slot,
        message.ok ? undefined : new Error(message.error || "Preview failed"),
      );
    });
    worker.on("error", (error) => void this.finish(slot, error, true));
    worker.on("exit", () => {
      if (this.slots.includes(slot))
        void this.finish(slot, new Error("Preview worker exited"), true);
    });
    worker.unref();
    this.slots.push(slot);
    return slot;
  }
  private drain() {
    if (this.closed) return;
    while (this.queue.length) {
      let slot = this.slots.find(
        (candidate) => !candidate.job && !candidate.finishing,
      );
      if (!slot && this.slots.length < this.concurrency) slot = this.spawn();
      if (!slot) return;
      const job = this.queue.shift()!;
      if (job.signals.every((signal) => signal?.aborted)) {
        this.jobs.delete(job.key);
        job.reject(new Error("Preview cancelled"));
        continue;
      }
      slot.job = job;
      slot.worker.ref();
      const activeSlot = slot;
      slot.timer = setTimeout(
        () =>
          void this.finish(activeSlot, new Error("Preview timed out"), true),
        60_000,
      );
      slot.worker.postMessage({
        source: job.source,
        destination: job.temporary,
        edge: job.edge,
      });
    }
  }
  private async finish(slot: Slot, error?: Error, retire = false) {
    if (slot.finishing) return;
    const job = slot.job;
    if (!job) {
      if (retire) {
        this.slots = this.slots.filter((candidate) => candidate !== slot);
        void slot.worker.terminate();
        this.drain();
      }
      return;
    }
    // Keep the slot reserved while committing to avoid exceeding concurrency.
    slot.finishing = true;
    slot.job = undefined;
    clearTimeout(slot.timer);
    if (retire) await slot.worker.terminate();
    try {
      if (error) throw error;
      if (
        this.closed ||
        fingerprint(await stat(job.source)) !== job.fingerprint
      )
        throw new Error("Source changed during preview generation");
      await rename(job.temporary, job.destination);
      job.resolve({
        file: job.destination,
        etag: `"${job.key}"`,
        cached: false,
      });
    } catch (cause) {
      await unlink(job.temporary).catch(() => {});
      job.reject(cause as Error);
    } finally {
      this.jobs.delete(job.key);
      slot.finishing = false;
      if (!retire && !this.closed) {
        slot.worker.unref();
      } else {
        this.slots = this.slots.filter((candidate) => candidate !== slot);
        if (!retire) void slot.worker.terminate();
      }
      this.drain();
    }
  }
  close() {
    this.closed = true;
    for (const job of this.queue.splice(0)) {
      this.jobs.delete(job.key);
      job.reject(new Error("Preview service closed"));
    }
    for (const slot of [...this.slots]) {
      if (slot.job)
        void this.finish(slot, new Error("Preview service closed"), true);
      else {
        this.slots = this.slots.filter((s) => s !== slot);
        void slot.worker.terminate();
      }
    }
  }
}
