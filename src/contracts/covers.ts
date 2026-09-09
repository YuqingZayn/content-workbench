import type { Asset, PlatformDefinition, Variant, Workspace } from "./model";
import { composerFor, defaultPublishing, nativePlatform } from "./publishing";

export const coverCheckedAt = "2026-09-09";
type CoverMode =
  | "independent"
  | "first_media"
  | "none"
  | "generated"
  | "review";
export type CoverRule = {
  key: string;
  platform: string;
  format: string;
  mode: CoverMode;
  summary: string;
  note: string;
  sizing: string;
  source: string;
};
export const coverModeLabels: Record<CoverMode, string> = {
  independent: "可单独准备封面",
  first_media: "使用正文首图 / 首个媒体",
  none: "无独立封面",
  generated: "平台生成链接预览",
  review: "封面上传入口待核实",
};
const xhs = "https://agora.xiaohongshu.com/doc/harmony";
const yt = "https://support.google.com/youtube/answer/72431?hl=en";
const wx =
  "https://developers.weixin.qq.com/doc/service/en/api/draftbox/draftmanage/api_draft_add.html";
const ig =
  "https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/";
const dy =
  "https://open.douyin.com/platform/resource/docs/ability/content-management/douyin-share-solution";
const dc =
  "https://support.discord.com/hc/en-us/articles/6208479917079-Forum-Channels-FAQ";
const bili =
  "https://open.bilibili.com/doc/4/f7fc57dd-55a1-5cb1-cba4-61fb2994bf0f";
const same =
  "封面也属于正文媒体。选择新图片会把它加入正文并移到首位；移动正文顺序后，封面随之变化。";
const separate =
  "封面与正文媒体分别保存。可使用另外制作的图片，也可复用正文图片或素材库中的视频关键帧；不会自动加入正文。";
const make = (
  key: string,
  platform: string,
  format: string,
  mode: CoverMode,
  summary: string,
  note: string,
  source: string,
  sizing = "比例与裁切以实际发布入口为准；本地保留原图。",
): CoverRule => ({
  key,
  platform,
  format,
  mode,
  summary,
  note,
  source,
  sizing,
});

export const coverRules: CoverRule[] = [
  make(
    "xiaohongshu.images",
    "小红书",
    "图文笔记",
    "first_media",
    "按图文图片列表准备首图；官方分享 SDK 未提供独立图文封面字段。",
    same +
      " 客户端封面编辑与裁切需在发布时检查，SDK 字段不能代表所有客户端入口。",
    xhs,
  ),
  make(
    "xiaohongshu.video",
    "小红书",
    "视频笔记",
    "independent",
    "视频与封面分别传入，封面可选。",
    separate,
    xhs,
  ),
  make(
    "youtube.video",
    "YouTube",
    "视频",
    "independent",
    "可使用自动缩略图，也可在账号验证后上传自定义图片。",
    separate,
    yt,
    "官方建议 16:9、3840 × 2160，最小宽 640；JPG / PNG。桌面上传上限 50 MB，移动端视频封面 2 MB。",
  ),
  make(
    "youtube.shorts",
    "YouTube",
    "Shorts",
    "independent",
    "最新官方说明支持在电脑端 YouTube Studio 上传 Shorts 自定义封面，需验证账号。",
    separate + " 也可使用平台建议帧；各展示位置可能裁切。",
    yt,
    "官方建议 9:16、2160 × 3840，最小高 640；JPG / PNG，桌面上传上限 50 MB。",
  ),
  make(
    "bilibili.video",
    "B站",
    "视频投稿",
    "independent",
    "视频稿件的 cover 字段使用单独上传的封面地址。",
    separate,
    bili,
  ),
  make(
    "bilibili.dynamic",
    "B站",
    "图文动态",
    "none",
    "按正文附件准备图片；未核实普通图文动态的独立封面上传入口。",
    "视频投稿的封面能力不能直接套用到图文动态。",
    bili,
  ),
  make(
    "douyin.video",
    "抖音",
    "短视频",
    "review",
    "可在本地单独准备候选封面；本次公开资料未完整核实各发布入口的自定义封面上传条件。",
    separate + " 发布时检查选帧、自定义图片和横竖封面入口。",
    dy,
  ),
  make(
    "douyin.images",
    "抖音",
    "图文作品",
    "first_media",
    "按图片列表准备首图；独立图文封面上传能力待实际发布入口核实。",
    same + " 本地首图策略不代表平台所有入口仅支持首图。",
    dy,
  ),
  make(
    "instagram.feed",
    "Instagram",
    "帖子 / 轮播",
    "first_media",
    "按正文首个媒体准备展示图；图片轮播没有 Reel 的独立 cover_url 字段。",
    same,
    ig,
  ),
  make(
    "instagram.reel",
    "Instagram",
    "Reel",
    "independent",
    "可指定独立封面图片，也可指定视频帧；两者同时设置时优先使用封面图片。",
    separate + " 主页网格与 Reels 展示可能有不同裁切。",
    ig,
  ),
  make(
    "instagram.story",
    "Instagram",
    "Story",
    "none",
    "Story 本身就是图片或视频，没有此发布类型的独立封面字段。",
    "精选集封面属于另一个功能。",
    ig,
  ),
  make(
    "facebook.post",
    "Facebook",
    "图文帖子",
    "none",
    "使用帖子照片及其排序；本地不把附件当作独立封面上传。",
    "链接预览与视频封面分别处理。",
    "https://www.facebook.com/help/174641285926169",
  ),
  make(
    "facebook.link",
    "Facebook",
    "链接帖子",
    "generated",
    "链接卡片由 Facebook 读取网页元信息生成，附加图片不等于替换网页封面。",
    "要调整网页分享图，应修改有权管理的网页元信息并检查抓取结果。",
    "https://developers.facebook.com/docs/sharing/webmasters/images/",
  ),
  make(
    "facebook.reel",
    "Facebook",
    "视频 / Reel",
    "review",
    "官方电脑端流程允许选择封面；是否能上传外部图片需按账号及入口核实。",
    separate + " 候选图片供发布时使用。",
    "https://www.facebook.com/help/2862139500770200/",
  ),
  make(
    "wechat_official.article",
    "微信公众号",
    "长文章（图文消息）",
    "independent",
    "文章封面与正文独立，可上传另一张图片；不要求来自正文首图。",
    separate + " 是否把封面展示在正文中，需要单独安排正文配图。",
    wx,
    "官方提供同一封面图的 2.35:1 与 1:1 裁切参数；请为两种展示保留主体安全区域。",
  ),
  make(
    "wechat_official.images",
    "微信公众号",
    "图片消息",
    "first_media",
    "图片消息与长文章不同：官方指定图片列表第一张为封面。",
    same,
    wx,
  ),
  make(
    "x.post",
    "X",
    "普通图文帖子",
    "none",
    "照片属于帖子内容；普通图文没有独立封面操作。",
    "网页卡片图片由链接信息决定。",
    "https://help.x.com/en/using-x/how-to-post",
  ),
  make(
    "x.video",
    "X",
    "视频（Media Studio）",
    "independent",
    "Media Studio 支持选视频帧或从电脑上传封面；需具备该入口的使用资格。",
    separate +
      " 此规则不等同于普通发帖框或当前自动发布连接的能力；Safari 不支持该自定义图片操作。",
    "https://help.x.com/en/using-x/media-studio-faqs",
    "官方要求自定义封面比例与视频内容一致。",
  ),
  make(
    "discord.message",
    "Discord",
    "频道消息",
    "none",
    "图片和视频是消息附件；普通消息无独立帖子封面。",
    "Embed 缩略图属于另外的富媒体消息能力。",
    dc,
  ),
  make(
    "discord.forum",
    "Discord",
    "论坛帖子",
    "none",
    "论坛缩略图来自加入原帖的媒体，图片仍是帖内内容。",
    "官方允许通过回复图片并选择 Add to Post 添加缩略图；在本地消息段中安排该图片。",
    dc,
  ),
  make(
    "wechat.message",
    "微信群",
    "消息 / 公告",
    "none",
    "图片和视频作为群消息内容准备；本地不提供独立群消息封面。",
    "链接卡片由对应链接或小程序提供；不等于微信公众号文章封面。",
    "",
  ),
];

export function coverRuleFor(
  v: Variant,
  definition: PlatformDefinition,
  assets: Asset[] = [],
): CoverRule {
  const native = nativePlatform(definition);
  const p = v.publishing ?? defaultPublishing();
  let key = native ? `${native}.${p[native].format}` : "";
  if (native === "wechat") key = "wechat.message";
  if (definition.id === "x" && definition.composer === "post")
    key = assets.some((a) => a.kind === "video" && v.assetIds.includes(a.id))
      ? "x.video"
      : "x.post";
  const found = coverRules.find((r) => r.key === key);
  if (found) return found;
  const mode = composerFor(v, definition);
  return make(
    "custom",
    definition.name,
    "自定义编辑方式",
    ["note", "photo"].includes(mode)
      ? "first_media"
      : ["article", "video", "short_video"].includes(mode)
        ? "review"
        : "none",
    "采用当前项目的编辑方式；平台原生封面规则需另行核实。",
    ["note", "photo"].includes(mode) ? same : separate,
    "",
  );
}

export function effectiveCoverId(
  v: Variant,
  definition: PlatformDefinition,
  assets: Asset[],
): string | null {
  const rule = coverRuleFor(v, definition, assets);
  if (rule.mode === "first_media") {
    const first = assets.find((a) => a.id === v.assetIds[0]);
    return first?.kind === "image" ? first.id : null;
  }
  return ["independent", "review"].includes(rule.mode) ? v.coverId : null;
}

export function selectCover(
  v: Variant,
  rule: CoverRule,
  assetId: string,
): Partial<Variant> {
  if (rule.mode === "first_media")
    return {
      assetIds: [assetId, ...v.assetIds.filter((id) => id !== assetId)],
    };
  return ["independent", "review"].includes(rule.mode)
    ? { coverId: assetId }
    : {};
}

export function coverUsageMap(w: Workspace): Map<string, string[]> {
  const usages = new Map<string, string[]>();
  for (const c of w.contents)
    for (const v of c.variants) {
      const definition = w.platforms.find((p) => p.id === v.platform);
      if (!definition) continue;
      const active = effectiveCoverId(v, definition, w.assets);
      for (const id of new Set([active, v.coverId])) {
        if (!id) continue;
        const entries = usages.get(id) ?? [];
        entries.push(
          `${c.title || "未命名主题"} · ${definition.name} · ${v.locale}${active === id ? "" : "（保留的封面）"}`,
        );
        usages.set(id, entries);
      }
    }
  return usages;
}

export function coverFields(
  v: Variant,
  definition: PlatformDefinition,
  assets: Asset[],
): [string, string][] {
  const rule = coverRuleFor(v, definition, assets);
  return [
    ["封面用途", coverModeLabels[rule.mode]],
    ["封面规则", rule.summary],
    ["封面准备说明", rule.note],
    ["封面比例与规格", rule.sizing],
    ["封面资料核查日期", coverCheckedAt],
    ...(rule.source ? [["封面规则来源", rule.source] as [string, string]] : []),
  ];
}
