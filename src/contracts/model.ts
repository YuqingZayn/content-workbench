import { z } from "zod";
import { defaultPublishing, publishingSchema } from "./publishing";
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
  "wechat_official",
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
  wechat_official: "微信公众号",
};
export const platformIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
export type Platform = z.infer<typeof platformIdSchema>;
export const composerModes = [
  "post",
  "note",
  "article",
  "chat",
  "video",
  "short_video",
  "photo",
] as const;
export const composerModeSchema = z.enum(composerModes);
export type ComposerMode = z.infer<typeof composerModeSchema>;
export const composerNames: Record<ComposerMode, string> = {
  post: "帖子：正文 + 附件",
  note: "图文笔记：封面 + 标题 + 话题",
  article: "长文章：标题 + 作者 + 摘要",
  chat: "群聊 / 频道：消息段",
  video: "视频投稿：视频 + 标题 + 简介",
  short_video: "短视频：竖屏视频 + 描述",
  photo: "图片动态：图片 + 配文",
};
export const platformDetailsSchema = z.object({
  name: z.string().trim().min(1, "请输入平台名称").max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "请选择有效的平台颜色"),
  composer: composerModeSchema.optional(),
});
export const platformDefinitionSchema = platformDetailsSchema.extend({
  id: platformIdSchema,
  composer: composerModeSchema.default("post"),
});
export type PlatformDefinition = z.infer<typeof platformDefinitionSchema>;
const defaultColors = [
  "#242629",
  "#5865f2",
  "#ed4946",
  "#2576ee",
  "#21a4d3",
  "#282a31",
  "#ef4658",
  "#b94b87",
  "#32a670",
  "#07a05a",
];
const defaultComposers: ComposerMode[] = [
  "post",
  "chat",
  "video",
  "post",
  "video",
  "short_video",
  "note",
  "photo",
  "chat",
  "article",
];
export const defaultPlatforms: PlatformDefinition[] = platforms.map(
  (id, i) => ({
    id,
    name: platformNames[id],
    color: defaultColors[i],
    composer: defaultComposers[i],
  }),
);
export const getPlatformDefinition = (
  items: PlatformDefinition[],
  id: Platform,
) =>
  items.find((p) => p.id === id) ?? {
    id,
    name: id,
    color: "#628877",
    composer: "post" as const,
  };
export const themeSchema = z.enum(["light", "dark", "system"]);
export type ThemePreference = z.infer<typeof themeSchema>;
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
  platform: platformIdSchema,
  locale: z.string().min(1),
  title: text,
  body: text,
  tags: z.array(z.string()),
  publishing: publishingSchema.default(defaultPublishing),
  article: z
    .object({
      author: z.string().max(100),
      digest: z.string().max(1000),
      sourceUrl: z.union([
        z.literal(""),
        z
          .url()
          .refine(
            (url) => /^https?:\/\//.test(url),
            "原文链接应以 http 或 https 开头",
          ),
      ]),
    })
    .default({ author: "", digest: "", sourceUrl: "" }),
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
  platform: platformIdSchema,
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
  variantId?: string;
  mode?: "draft" | "task";
  access?: "full-access";
  model?: string;
  reasoningEffort?: string;
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
  platforms: PlatformDefinition[];
  profile: { identity: string; facts: string; voice: string };
  contents: Content[];
  assets: Asset[];
  accounts: Account[];
  targets: Target[];
  jobs: Job[];
  runs: AiRun[];
}
export interface CodexStatus {
  account?: { type: string; email?: string | null; planType?: string };
  authState?: "signed-in" | "signed-out" | "expired" | "pending";
  checkedAt?: string;
  loginPending?: boolean;
  state: "disconnected" | "connecting" | "ready" | "error";
  message: string;
  version: string;
  defaultModel?: string;
  defaultReasoningEffort?: string;
  models: {
    id: string;
    label: string;
    supportedReasoningEfforts?: {
      reasoningEffort: string;
      description: string;
    }[];
    defaultReasoningEffort?: string;
  }[];
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
