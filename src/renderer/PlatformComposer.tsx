import { useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Repeat2,
  Heart,
  Play,
} from "lucide-react";
import {
  getPlatformDefinition,
  type ComposerMode,
  type Variant,
  type Workspace,
  type Asset,
} from "../contracts/model";
import {
  composerFor,
  defaultPublishing,
  nativePlatform,
  publicationBody,
  publicationSegments,
} from "../contracts/publishing";
import { AssetPreview, previewUrl } from "./AssetPreview";
import { effectiveCoverId } from "../contracts/covers";

export const composerHeadings: Record<ComposerMode, string> = {
  post: "编辑帖子",
  note: "编辑图文笔记",
  article: "编辑公众号 / 长文章",
  chat: "编辑消息",
  video: "准备视频投稿",
  short_video: "准备短视频",
  photo: "编辑图片动态",
};
const bodyLabels: Record<ComposerMode, string> = {
  post: "帖子正文",
  note: "笔记正文",
  article: "文章正文",
  chat: "消息正文",
  video: "视频简介",
  short_video: "作品描述",
  photo: "图片配文",
};
const placeholders: Record<ComposerMode, string> = {
  post: "有什么新鲜事？支持 @提及、链接与 #话题…",
  note: "分享你的体验、发现或实用建议…",
  article: "从引言开始，使用 ## 小标题组织文章…",
  chat: "写下要发到群或频道的消息，也可以在下方编排多个消息段…",
  video: "介绍视频内容，可加入章节时间、相关链接和补充说明…",
  short_video: "为这条短视频写一段描述…",
  photo: "为图片写下配文…",
};
const showsTitle = (mode: ComposerMode) =>
  ["note", "article", "video"].includes(mode);

export function PlatformFields({
  w,
  draft,
  change,
}: {
  w: Workspace;
  draft: Variant;
  change: (patch: Partial<Variant>) => void;
}) {
  const definition = getPlatformDefinition(w.platforms, draft.platform);
  const mode = composerFor(draft, definition);
  const platform = nativePlatform(definition);
  const publishing = draft.publishing ?? defaultPublishing();
  const forum = platform === "discord" && publishing.discord.format === "forum";
  const publicTitle =
    showsTitle(mode) ||
    platform === "youtube" ||
    platform === "wechat_official" ||
    forum;
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const format = (before: string, after = "") => {
    const area = bodyRef.current;
    if (!area) return;
    const start = area.selectionStart,
      end = area.selectionEnd;
    change({
      body:
        draft.body.slice(0, start) +
        before +
        draft.body.slice(start, end) +
        after +
        draft.body.slice(end),
    });
    requestAnimationFrame(() => {
      area.focus();
      area.setSelectionRange(start + before.length, end + before.length);
    });
  };
  const title = (
    <label>
      {forum
        ? "论坛标题"
        : mode === "article"
          ? "文章标题"
          : platform === "wechat_official"
            ? "图片消息标题"
            : platform === "xiaohongshu"
              ? "笔记标题"
              : mode === "video" || platform === "youtube"
                ? "视频标题"
                : "笔记标题"}
      <input
        aria-label="版本标题"
        value={draft.title}
        onChange={(e) => change({ title: e.target.value })}
      />
    </label>
  );
  const tags = (
    <label>
      {forum
        ? "论坛标签"
        : platform !== "xiaohongshu" &&
            (mode === "video" || platform === "youtube")
          ? "视频关键词"
          : "话题标签"}
      <input
        value={draft.tags.join(" ")}
        onChange={(e) =>
          change({
            tags: e.target.value
              .split(/\s+/)
              .map((t) => t.replace(/^#/, ""))
              .filter(Boolean),
          })
        }
        placeholder="用空格分隔"
      />
    </label>
  );
  return (
    <div className="compose-text">
      {publicTitle && title}
      {mode === "article" && (
        <div className="article-metadata">
          <label>
            作者（选填）
            <input
              value={draft.article.author}
              maxLength={100}
              onChange={(e) =>
                change({
                  article: { ...draft.article, author: e.target.value },
                })
              }
            />
          </label>
          <label>
            摘要（选填）
            <textarea
              rows={2}
              value={draft.article.digest}
              maxLength={1000}
              placeholder="用于文章列表中的简短介绍"
              onChange={(e) =>
                change({
                  article: { ...draft.article, digest: e.target.value },
                })
              }
            />
          </label>
        </div>
      )}
      {mode === "article" && (
        <div className="article-toolbar" aria-label="文章排版工具">
          <button type="button" onClick={() => format("\n## ")}>
            小标题
          </button>
          <button type="button" onClick={() => format("**", "**")}>
            加粗
          </button>
          <button type="button" onClick={() => format("\n> ")}>
            引用
          </button>
          <button type="button" onClick={() => format("\n- ")}>
            列表
          </button>
        </div>
      )}
      {platform === "discord" && (
        <div className="article-toolbar" aria-label="Discord 排版工具">
          <button type="button" onClick={() => format("**", "**")}>
            加粗
          </button>
          <button type="button" onClick={() => format("`", "`")}>
            行内代码
          </button>
          <button type="button" onClick={() => format("\n```\n", "\n```\n")}>
            代码块
          </button>
          <button type="button" onClick={() => format("||", "||")}>
            剧透遮罩
          </button>
          <button type="button" onClick={() => format("\n> ")}>
            引用
          </button>
        </div>
      )}
      <label>
        {platform === "wechat" && publishing.wechat.format === "announcement"
          ? "群公告正文"
          : platform === "instagram" && publishing.instagram.format === "story"
            ? "Story 配字备注"
            : bodyLabels[mode]}
        <textarea
          ref={bodyRef}
          className={`body-editor body-${mode}`}
          aria-label="版本正文"
          value={draft.body}
          onChange={(e) => change({ body: e.target.value })}
          placeholder={placeholders[mode]}
        />
      </label>
      <div className="field-footer">
        <span>
          {mode === "article"
            ? "Markdown 草稿 · 右侧查看排版"
            : mode === "post"
              ? "单条帖子 · 正文在前，附件在后"
              : "当前平台独立保存"}
        </span>
        <span>{[...draft.body].length} 字符</span>
      </div>
      {publicTitle && mode !== "article" && tags}
      {!publicTitle && (mode === "photo" || mode === "short_video")
        ? tags
        : null}
      {mode === "article" && (
        <label>
          原文链接（选填）
          <input
            type="url"
            value={draft.article.sourceUrl}
            placeholder="https://"
            onChange={(e) =>
              change({
                article: { ...draft.article, sourceUrl: e.target.value },
              })
            }
          />
        </label>
      )}
      {!publicTitle && (
        <details className="composer-extra">
          <summary>
            内部名称{mode === "post" || mode === "chat" ? "与话题" : ""}
          </summary>
          <label>
            内部名称（用于内容管理）
            <input
              aria-label="版本标题"
              value={draft.title}
              onChange={(e) => change({ title: e.target.value })}
            />
          </label>
          {(mode === "post" || mode === "chat") && tags}
        </details>
      )}
    </div>
  );
}

function PreviewMedia({
  asset,
  w,
  cover,
  alt,
}: {
  asset: Asset;
  w: Workspace;
  cover?: Asset;
  alt?: string;
}) {
  const [playing, setPlaying] = useState(false);
  return asset.kind === "image" ? (
    <AssetPreview
      projectId={w.project.id}
      asset={asset}
      alt={alt || asset.name}
    />
  ) : !playing ? (
    <button
      type="button"
      className="preview-video-button"
      aria-label={`播放预览 ${asset.name}`}
      onClick={() => setPlaying(true)}
    >
      {cover && (
        <AssetPreview projectId={w.project.id} asset={cover} alt="视频封面" />
      )}
      <span>
        <Play size={30} />
        点击播放视频
      </span>
    </button>
  ) : (
    <video
      src={`media://asset/${w.project.id}/${asset.id}?revision=${asset.sha256}`}
      poster={cover ? previewUrl(w.project.id, cover) : undefined}
      controls
      autoPlay
      preload="metadata"
    />
  );
}

function DiscordText({ text }: { text: string }) {
  return (
    <div className="discord-markdown">
      {text
        .split(/(```[\s\S]*?```|`[^`\n]+`|\|\|[\s\S]*?\|\||\*\*[^*]+\*\*)/)
        .map((part, index) => {
          if (part.startsWith("```"))
            return (
              <pre key={index}>
                <code>{part.slice(3, -3).replace(/^\w*\n/, "")}</code>
              </pre>
            );
          if (part.startsWith("`"))
            return <code key={index}>{part.slice(1, -1)}</code>;
          if (part.startsWith("||"))
            return (
              <details className="discord-spoiler" key={index}>
                <summary>剧透 · 点击展开</summary>
                {part.slice(2, -2)}
              </details>
            );
          if (part.startsWith("**"))
            return <strong key={index}>{part.slice(2, -2)}</strong>;
          return <span key={index}>{part}</span>;
        })}
    </div>
  );
}

function ArticleText({ text }: { text: string }) {
  const inline = (line: string) =>
    line
      .split(/(\*\*[^*]+\*\*)/)
      .map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          part
        ),
      );
  return (
    <div className="article-preview-body">
      {text.split("\n").map((line, i) => {
        if (/^#{1,3} /.test(line))
          return <h3 key={i}>{inline(line.replace(/^#{1,3} /, ""))}</h3>;
        if (line.startsWith("> "))
          return <blockquote key={i}>{inline(line.slice(2))}</blockquote>;
        if (line.startsWith("- "))
          return (
            <p className="article-list-line" key={i}>
              • {inline(line.slice(2))}
            </p>
          );
        return <p key={i}>{inline(line) || <br />}</p>;
      })}
    </div>
  );
}

export function PlatformPreview({
  w,
  draft,
  bindings,
}: {
  w: Workspace;
  draft: Variant;
  bindings: Asset[];
}) {
  const definition = getPlatformDefinition(w.platforms, draft.platform);
  const mode = composerFor(draft, definition);
  const platform = nativePlatform(definition);
  const p = draft.publishing ?? defaultPublishing();
  const isStory = platform === "instagram" && p.instagram.format === "story";
  const body = publicationBody(draft, definition);
  const [index, setIndex] = useState(0);
  const coverId = effectiveCoverId(draft, definition, w.assets);
  const cover = w.assets.find((a) => a.id === coverId && a.kind === "image");
  // Carousel order is always the actual body order, including after a reorder.
  const ordered = bindings;
  const currentIndex = Math.min(index, Math.max(0, ordered.length - 1));
  const media = ordered[currentIndex];
  const video = bindings.find((a) => a.kind === "video");
  const account = (
    <div className="preview-account">
      <div className="avatar small">{w.project.name.trim().slice(0, 1)}</div>
      <div>
        <strong>{w.project.name}</strong>
        <small>{definition.name} · 草稿预览</small>
      </div>
    </div>
  );
  const carousel = (
    <div className={`preview-media carousel ${media ? "" : "carousel-empty"}`}>
      {media ? (
        <PreviewMedia
          asset={media}
          w={w}
          cover={cover}
          alt={
            platform === "instagram" && p.instagram.format === "feed"
              ? p.instagram.altText[media.id]
              : undefined
          }
        />
      ) : (
        <span>选择图片后显示预览</span>
      )}
      {ordered.length > 1 && (
        <div className="carousel-controls">
          <button
            type="button"
            aria-label="上一张预览"
            disabled={currentIndex === 0}
            onClick={() => setIndex(currentIndex - 1)}
          >
            <ChevronLeft size={16} />
          </button>
          <span>
            {currentIndex + 1} / {ordered.length}
          </span>
          <button
            type="button"
            aria-label="下一张预览"
            disabled={currentIndex === ordered.length - 1}
            onClick={() => setIndex(currentIndex + 1)}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
  if (mode === "article")
    return (
      <article className="post-preview article-preview" data-preview="article">
        {cover && (
          <div className="article-cover">
            <AssetPreview
              projectId={w.project.id}
              asset={cover}
              alt="文章封面"
            />
          </div>
        )}
        <div className="preview-copy">
          <h2>{draft.title || "文章标题"}</h2>
          <p className="article-byline">
            {draft.article.author || w.project.name}
          </p>
          {draft.article.digest && (
            <div className="article-digest">{draft.article.digest}</div>
          )}
          <ArticleText text={draft.body || "文章正文会显示在这里。"} />
          {bindings.map((a) => (
            <div className="article-inline-media" key={a.id}>
              <PreviewMedia asset={a} w={w} cover={cover} />
            </div>
          ))}
          {draft.article.sourceUrl && (
            <p className="article-source">
              阅读原文 · {draft.article.sourceUrl}
            </p>
          )}
        </div>
      </article>
    );
  if (mode === "chat") {
    const segments = publicationSegments(draft, definition, w.assets);
    return (
      <div
        className={`post-preview chat-preview ${platform === "discord" ? "discord-preview" : ""}`}
        data-preview="chat"
      >
        {platform === "discord" && (
          <div className="channel-heading">
            {p.discord.format === "forum" ? "论坛 · 讨论帖" : "# 频道消息"}
          </div>
        )}
        {platform === "wechat" && p.wechat.format === "announcement" && (
          <div className="channel-heading">群公告</div>
        )}
        {account}
        {platform === "discord" && p.discord.format === "forum" && (
          <div className="forum-heading">
            <h3>{draft.title || "论坛标题"}</h3>
            <div className="forum-tags">
              {draft.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          </div>
        )}
        <div className="chat-messages">
          {segments.length ? (
            segments.map((s, i) => (
              <div className="chat-bubble" key={i}>
                {s.type === "text" ? (
                  platform === "discord" ? (
                    <DiscordText text={s.text} />
                  ) : (
                    s.text
                  )
                ) : s.type === "link" ? (
                  `${s.label}\n${s.url}`
                ) : (
                  (() => {
                    const a = w.assets.find((a) => a.id === s.assetId);
                    return a ? <PreviewMedia asset={a} w={w} /> : "素材不可用";
                  })()
                )}
              </div>
            ))
          ) : (
            <p className="hint">消息预览会显示在这里</p>
          )}
        </div>
      </div>
    );
  }
  if (mode === "post")
    return (
      <div className="post-preview timeline-preview" data-preview="post">
        {account}
        <div className="preview-copy">
          <p>{body || "帖子正文会显示在这里。"}</p>
        </div>
        {platform === "facebook" && p.facebook.format === "link" && (
          <div className="facebook-link-card">
            <small>{p.facebook.linkUrl || "分享链接"}</small>
            <strong>{p.facebook.linkTitle || "链接卡片"}</strong>
            <small>卡片标题与封面以网页信息为准</small>
          </div>
        )}
        {bindings.length > 0 && (
          <div
            className={`post-media-grid ${bindings.length === 1 ? "single" : ""}`}
          >
            {bindings.map((a) => (
              <div key={a.id}>
                <PreviewMedia asset={a} w={w} />
              </div>
            ))}
          </div>
        )}
        <div className="post-preview-actions" aria-hidden="true">
          {platform === "facebook" ? (
            <>
              <span>赞</span>
              <span>评论</span>
              <span>分享</span>
            </>
          ) : platform === "bilibili" ? (
            <>
              <span>转发</span>
              <span>评论</span>
              <span>点赞</span>
            </>
          ) : (
            <>
              <MessageCircle size={17} />
              <Repeat2 size={17} />
              <Heart size={17} />
            </>
          )}
        </div>
      </div>
    );
  if (mode === "video" || mode === "short_video")
    return (
      <div
        className={`post-preview video-preview ${mode === "short_video" ? "vertical" : ""}`}
        data-preview={mode}
      >
        <div className="video-stage">
          {video ? (
            <PreviewMedia asset={video} w={w} cover={cover} />
          ) : cover ? (
            <AssetPreview
              projectId={w.project.id}
              asset={cover}
              alt="视频封面"
            />
          ) : (
            <div>
              <Play size={36} />
              <p>选择视频后显示预览</p>
            </div>
          )}
          {platform === "douyin" && p.douyin.coverText && (
            <div className="cover-caption">{p.douyin.coverText}</div>
          )}
        </div>
        <div className="preview-copy">
          {(mode === "video" || platform === "youtube") && (
            <h3>{draft.title || "视频标题"}</h3>
          )}
          <small className="muted">{w.project.name}</small>
          <p>{body || "视频描述会显示在这里。"}</p>
          {(mode === "video" || platform === "youtube") && (
            <div className="hashtags">
              {platform === "xiaohongshu" ? "话题（发布时选择）：" : "关键词："}
              {draft.tags.join(" · ")}
            </div>
          )}
        </div>
      </div>
    );
  return (
    <div
      className={`post-preview note-preview ${mode === "photo" ? "photo-preview" : ""} ${isStory ? "story-preview" : ""} ${platform === "douyin" ? "douyin-images-preview" : ""}`}
      data-preview={mode}
    >
      {mode === "photo" && account}
      {isStory && (
        <div className="story-progress" aria-hidden="true">
          {ordered.map((a, i) => (
            <span key={a.id} className={i <= currentIndex ? "active" : ""} />
          ))}
        </div>
      )}
      {carousel}
      {platform === "douyin" && p.douyin.coverText && (
        <div className="image-cover-caption">{p.douyin.coverText}</div>
      )}
      {mode === "note" && account}
      <div className="preview-copy">
        {(mode === "note" || platform === "wechat_official") && (
          <h3>
            {draft.title ||
              (platform === "wechat_official" ? "图片消息标题" : "笔记标题")}
          </h3>
        )}
        <p>{body || "配文会显示在这里。"}</p>
      </div>
    </div>
  );
}
