import { z } from "zod";
export const platforms = [
  "x",
  "discord",
  "youtube",
  "facebook",
  "bilibili",
  "douyin",
  "xiaohongshu",
  "instagram",
  "wechat",
] as const;
export const platformNames: Record<Platform, string> = {
  x: "X",
  discord: "Discord",
  youtube: "YouTube",
  facebook: "Facebook",
  bilibili: "B站",
  douyin: "抖音",
  xiaohongshu: "小红书",
  instagram: "Instagram",
  wechat: "微信群",
};
export type Platform = (typeof platforms)[number];
export const idSchema = z.uuid();
const text = z.string().max(200000);
export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  name: z.string().min(1).max(100),
  identityType: z.enum(["brand", "founder", "custom"]),
  defaultLocale: z.string(),
  timezone: z.string(),
  revision: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Project = z.infer<typeof projectSchema>;
export type ProjectView = Project & {
  root: string;
  readOnly: boolean;
  warning?: string;
};
export const segmentSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text }),
  z.object({ type: z.literal("image"), assetId: idSchema }),
  z.object({ type: z.literal("video"), assetId: idSchema }),
  z.object({ type: z.literal("link"), url: z.url(), label: text }),
]);
export type Segment = z.infer<typeof segmentSchema>;
export const variantSchema = z.object({
  id: idSchema,
  platform: z.enum(platforms),
  locale: z.string().min(1),
  title: text,
  body: text,
  tags: z.array(z.string()),
  assetIds: z.array(idSchema),
  coverId: idSchema.nullable(),
  segments: z.array(segmentSchema),
  revision: z.number().int().nonnegative(),
  bodyHash: z.string(),
  readiness: z.enum(["draft", "ready"]),
});
export type Variant = z.infer<typeof variantSchema>;
export const contentSchema = z.object({
  schemaVersion: z.literal(1),
  id: idSchema,
  projectId: idSchema,
  title: text,
  audience: text,
  objective: text,
  brief: text,
  revision: z.number().int(),
  state: z.enum(["active", "archived"]),
  variants: z.array(variantSchema),
  updatedAt: z.string(),
});
export type Content = z.infer<typeof contentSchema>;
export const assetSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  name: z.string(),
  kind: z.enum(["image", "video"]),
  storageMode: z.enum(["copy", "reference"]),
  path: z.string(),
  sha256: z.string(),
  bytes: z.number(),
  mime: z.string(),
  modifiedMs: z.number(),
  tags: z.array(z.string()),
  derivedFrom: z
    .object({
      assetId: idSchema,
      kind: z.enum(["crop", "frame"]),
      parameters: z.record(z.string(), z.number()),
    })
    .optional(),
});
export type Asset = z.infer<typeof assetSchema> & {
  availability?: "available" | "missing" | "changed";
};
export const accountSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  platform: z.enum(platforms),
  label: z.string().min(1),
  externalId: z.string(),
  accountType: z.string(),
  enabled: z.boolean(),
});
export type Account = z.infer<typeof accountSchema>;
export const targetSchema = z.object({
  id: idSchema,
  projectId: idSchema,
  accountId: idSchema,
  label: z.string().min(1),
  kind: z.enum(["profile", "page", "channel", "group"]),
  enabled: z.boolean(),
});
export type Target = z.infer<typeof targetSchema>;
export type JobStatus =
  | "scheduled"
  | "manual_pending"
  | "partial"
  | "completed"
  | "paused"
  | "cancelled";
export interface Receipt {
  recordedBy: string;
  recordedAt: string;
  result: string;
  url: string;
  completedSegments: number[];
}
export interface Job {
  id: string;
  projectId: string;
  contentId: string;
  variantId: string;
  snapshotId: string;
  accountId: string;
  targetId: string;
  targetLabel: string;
  accountLabel: string;
  title: string;
  platform: Platform;
  mode: "manual_due";
  scheduledAtUtc: string;
  timezone: string;
  status: JobStatus;
  createdAt: string;
  receipt: Receipt | null;
  segmentCount: number;
}
export interface AiRun {
  id: string;
  projectId: string;
  contentId: string;
  variantId: string;
  baseRevision: number;
  threadId?: string;
  turnId?: string;
  status: string;
  prompt: string;
  output: string;
  error?: string;
  createdAt: string;
}
export interface Workspace {
  project: ProjectView;
  profile: { identity: string; facts: string; voice: string };
  contents: Content[];
  assets: Asset[];
  accounts: Account[];
  targets: Target[];
  jobs: Job[];
  runs: AiRun[];
}
export interface CodexStatus {
  state: "disconnected" | "connecting" | "ready" | "error";
  message: string;
  version: string;
  models: { id: string; label: string }[];
  activeRunId?: string;
}
export interface AppEvent {
  type: string;
  projectId?: string;
  runId?: string;
  text?: string;
  message?: string;
}
export type Result<T> =
  | { ok: true; data: T; requestId: string }
  | {
      ok: false;
      error: { code: string; message: string; details?: unknown };
      requestId: string;
    };
export interface WorkbenchApi {
  call<T = unknown>(method: string, input?: unknown): Promise<T>;
  onEvent(callback: (event: AppEvent) => void): () => void;
  filePaths(files: File[]): string[];
}
declare global {
  interface Window {
    workbench: WorkbenchApi;
  }
}
