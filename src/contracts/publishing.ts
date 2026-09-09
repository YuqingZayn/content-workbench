import { z } from "zod";
import type {
  Asset,
  ComposerMode,
  PlatformDefinition,
  Segment,
  Variant,
} from "./model";

const field = z.string().max(2000).default("");
const group = <T extends z.ZodRawShape>(shape: T) => {
  const schema = z.object(shape);
  // Every field in these groups has its own default; prefault still parses them.
  return schema.prefault({} as z.input<typeof schema>);
};
export const publishingSchema = z.object({
  xiaohongshu: group({ format: z.enum(["images", "video"]).default("images") }),
  wechat_official: group({
    format: z.enum(["article", "images"]).default("article"),
  }),
  youtube: group({
    format: z.enum(["video", "shorts"]).default("video"),
    visibility: z.enum(["", "public", "unlisted", "private"]).default(""),
    audience: z.enum(["", "kids", "general"]).default(""),
    playlist: field,
    chapters: z.string().max(20000).default(""),
  }),
  bilibili: group({
    format: z.enum(["video", "dynamic"]).default("video"),
    copyright: z.enum(["", "original", "repost"]).default(""),
    source: field,
    category: field,
    collection: field,
  }),
  douyin: group({
    format: z.enum(["video", "images"]).default("video"),
    location: field,
    coverText: field,
  }),
  instagram: group({
    format: z.enum(["feed", "reel", "story"]).default("feed"),
    location: field,
    altText: z.record(z.uuid(), z.string().max(2000)).default({}),
  }),
  facebook: group({
    format: z.enum(["post", "link", "reel"]).default("post"),
    linkUrl: field,
    linkTitle: field,
    audience: field,
  }),
  discord: group({ format: z.enum(["message", "forum"]).default("message") }),
  wechat: group({
    format: z.enum(["message", "announcement"]).default("message"),
  }),
});
export type Publishing = z.infer<typeof publishingSchema>;
export type NativePlatform = keyof Publishing;
export const defaultPublishing = () => publishingSchema.parse({});
type Format = { value: string; label: string; composer: ComposerMode };
export const publishingFormats: Record<NativePlatform, Format[]> = {
  xiaohongshu: [
    { value: "images", label: "图文笔记", composer: "note" },
    { value: "video", label: "视频笔记", composer: "video" },
  ],
  wechat_official: [
    { value: "article", label: "长文章（图文消息）", composer: "article" },
    { value: "images", label: "图片消息", composer: "photo" },
  ],
  youtube: [
    { value: "video", label: "视频投稿", composer: "video" },
    { value: "shorts", label: "Shorts", composer: "short_video" },
  ],
  bilibili: [
    { value: "video", label: "视频投稿", composer: "video" },
    { value: "dynamic", label: "图文动态", composer: "post" },
  ],
  douyin: [
    { value: "video", label: "短视频", composer: "short_video" },
    { value: "images", label: "图文作品", composer: "photo" },
  ],
  instagram: [
    { value: "feed", label: "帖子 / 轮播", composer: "photo" },
    { value: "reel", label: "Reel", composer: "short_video" },
    { value: "story", label: "Story", composer: "photo" },
  ],
  facebook: [
    { value: "post", label: "图文帖子", composer: "post" },
    { value: "link", label: "链接帖子", composer: "post" },
    { value: "reel", label: "视频 / Reel", composer: "short_video" },
  ],
  discord: [
    { value: "message", label: "频道消息", composer: "chat" },
    { value: "forum", label: "论坛帖子", composer: "chat" },
  ],
  wechat: [
    { value: "message", label: "群消息", composer: "chat" },
    { value: "announcement", label: "群公告", composer: "chat" },
  ],
};

// An explicit project-level composer override takes priority over native presets.
export function nativePlatform(
  definition: PlatformDefinition,
): NativePlatform | undefined {
  const id = definition.id as NativePlatform;
  return Object.hasOwn(publishingFormats, id) &&
    definition.composer === publishingFormats[id][0].composer
    ? id
    : undefined;
}
export function publicationFormat(v: Variant, definition: PlatformDefinition) {
  const platform = nativePlatform(definition);
  const settings = v.publishing ?? defaultPublishing();
  return platform
    ? publishingFormats[platform].find(
        (f) => f.value === settings[platform].format,
      )!
    : undefined;
}
export const composerFor = (
  v: Variant,
  definition: PlatformDefinition,
): ComposerMode =>
  publicationFormat(v, definition)?.composer ?? definition.composer;

export function publicationBody(v: Variant, definition: PlatformDefinition) {
  const platform = nativePlatform(definition);
  const p = v.publishing ?? defaultPublishing();
  const parts = [v.body];
  if (
    platform === "youtube" &&
    p.youtube.format === "video" &&
    p.youtube.chapters.trim()
  )
    parts.push(p.youtube.chapters.trim());
  if (
    platform === "facebook" &&
    p.facebook.format === "link" &&
    p.facebook.linkUrl.trim() &&
    !v.body.includes(p.facebook.linkUrl.trim())
  )
    parts.push(p.facebook.linkUrl.trim());
  if (
    v.tags.length &&
    !["video", "article"].includes(composerFor(v, definition)) &&
    platform !== "youtube" &&
    !(platform === "discord" && p.discord.format === "forum")
  )
    parts.push(v.tags.map((tag) => "#" + tag.replace(/^#/, "")).join(" "));
  return parts.filter((part) => part.trim()).join("\n\n");
}
export function publicationSegments(
  v: Variant,
  definition: PlatformDefinition,
  assets: Asset[],
): Segment[] {
  if (v.segments.length) return v.segments;
  const body = publicationBody(v, definition);
  return [
    ...(body ? [{ type: "text" as const, text: body }] : []),
    ...v.assetIds.flatMap((id) => {
      const asset = assets.find((a) => a.id === id);
      return asset ? [{ type: asset.kind, assetId: id }] : [];
    }),
  ];
}
export function splitMessages(
  v: Variant,
  definition: PlatformDefinition,
  assets: Asset[],
): Segment[] {
  return publicationSegments(v, definition, assets).flatMap(
    (segment): Segment[] =>
      segment.type === "text"
        ? segment.text
            .split(/\n\s*\n/)
            .filter((text) => text.trim())
            .map((text) => ({ type: "text", text }))
        : [segment],
  );
}

export function publicationFields(
  v: Variant,
  definition: PlatformDefinition,
): [string, string][] {
  const platform = nativePlatform(definition);
  const p = v.publishing ?? defaultPublishing();
  const format = publicationFormat(v, definition);
  const fields: [string, string][] = format ? [["发布类型", format.label]] : [];
  switch (platform) {
    case "youtube":
      fields.push(
        [
          "可见性",
          {
            "": "待选择",
            public: "公开",
            unlisted: "不公开列出",
            private: "私享",
          }[p.youtube.visibility],
        ],
        [
          "是否面向儿童",
          { "": "待确认", kids: "是", general: "否" }[p.youtube.audience],
        ],
        ["播放列表", p.youtube.playlist],
      );
      if (p.youtube.format === "video")
        fields.push(["章节时间轴", p.youtube.chapters]);
      break;
    case "bilibili":
      if (p.bilibili.format === "video") {
        fields.push(
          [
            "投稿类型",
            { "": "待选择", original: "自制", repost: "转载" }[
              p.bilibili.copyright
            ],
          ],
          ["分区", p.bilibili.category],
          ["合集", p.bilibili.collection],
        );
        if (p.bilibili.copyright === "repost")
          fields.push(["转载来源", p.bilibili.source]);
      }
      break;
    case "douyin":
      fields.push(
        ["位置", p.douyin.location],
        ["封面文案", p.douyin.coverText],
      );
      break;
    case "instagram":
      fields.push(["位置", p.instagram.location]);
      break;
    case "facebook":
      fields.push(["可见范围", p.facebook.audience]);
      if (p.facebook.format === "link")
        fields.push(
          ["链接", p.facebook.linkUrl],
          ["链接标题（备注）", p.facebook.linkTitle],
        );
      break;
    case "discord":
      if (p.discord.format === "forum")
        fields.push(["论坛标题", v.title], ["论坛标签", v.tags.join(" · ")]);
      break;
  }
  return fields.filter(([, value]) => value.trim());
}

export function publicationWarnings(
  v: Variant,
  definition: PlatformDefinition,
  assets: Asset[],
): string[] {
  const platform = nativePlatform(definition);
  if (!platform) return [];
  const p = v.publishing ?? defaultPublishing();
  const mode = composerFor(v, definition);
  const bound = assets.filter((a) => v.assetIds.includes(a.id));
  const warnings: string[] = [];
  if (
    ((platform === "xiaohongshu" && p.xiaohongshu.format === "images") ||
      (platform === "wechat_official" &&
        p.wechat_official.format === "images")) &&
    bound.some((a) => a.kind === "video")
  )
    warnings.push(
      "当前为图片类型，仍有关联视频。切换类型会保留素材，请检查正文图片与视频的用途。",
    );
  if (["video", "short_video"].includes(mode)) {
    if (!bound.some((a) => a.kind === "video"))
      warnings.push("尚未选择视频。图片可用作封面，不能代替视频投稿。");
    if (bound.filter((a) => a.kind === "video").length > 1)
      warnings.push(
        "关联了多个视频：预览显示首个视频，发布时请选择要上传的文件。",
      );
  }
  if (
    platform === "douyin" &&
    p.douyin.format === "images" &&
    bound.some((a) => a.kind === "video")
  )
    warnings.push(
      "图文作品中仍有关联视频，请检查素材或切回短视频。切换类型会保留素材。",
    );
  if (platform === "instagram" && !bound.length)
    warnings.push("请选择图片或视频作为帖子媒体。");
  if (
    platform === "facebook" &&
    p.facebook.format === "link" &&
    !/^https?:\/\/[^\s]+$/i.test(p.facebook.linkUrl)
  )
    warnings.push("请填写完整的 http / https 链接。");
  if (
    platform === "bilibili" &&
    p.bilibili.format === "video" &&
    p.bilibili.copyright === "repost" &&
    !p.bilibili.source.trim()
  )
    warnings.push("转载投稿请补充来源，便于发布时填写。");
  if (platform === "discord" && p.discord.format === "forum" && !v.title.trim())
    warnings.push("论坛帖子需要一个标题。");
  if (
    platform === "youtube" &&
    p.youtube.format === "video" &&
    p.youtube.chapters.trim()
  ) {
    const times = p.youtube.chapters
      .trim()
      .split("\n")
      .map((line) => {
        const match = line.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})\s+\S/);
        return match && +match[2] < 60 && +match[3] < 60
          ? +(match[1] ?? 0) * 3600 + +match[2] * 60 + +match[3]
          : NaN;
      });
    if (
      times.length < 3 ||
      times[0] !== 0 ||
      times.some(
        (time, i) =>
          !Number.isFinite(time) || (i > 0 && time - times[i - 1] < 10),
      )
    )
      warnings.push(
        "章节请从 00:00 开始，至少三行，每行填写时间与名称，相邻章节至少间隔 10 秒。最后一章时长需在视频中确认。",
      );
  }
  return warnings;
}
