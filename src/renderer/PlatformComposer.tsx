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
import { AssetPreview, previewUrl } from "./AssetPreview";

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
  const mode = getPlatformDefinition(w.platforms, draft.platform).composer;
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
      {mode === "article"
        ? "文章标题"
        : mode === "video"
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
      {mode === "video" ? "视频关键词" : "话题标签"}
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
      {showsTitle(mode) && title}
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
      <label>
        {bodyLabels[mode]}
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
      {showsTitle(mode) && mode !== "article" && tags}
      {mode === "photo" || mode === "short_video" ? tags : null}
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
      {!showsTitle(mode) && (
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
}: {
  asset: Asset;
  w: Workspace;
  cover?: Asset;
}) {
  return asset.kind === "image" ? (
    <AssetPreview projectId={w.project.id} asset={asset} alt={asset.name} />
  ) : (
    <video
      src={`media://asset/${w.project.id}/${asset.id}?revision=${asset.sha256}`}
      poster={cover ? previewUrl(w.project.id, cover) : undefined}
      controls
      preload="none"
    />
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
  const mode = definition.composer;
  const [index, setIndex] = useState(0);
  const cover = w.assets.find(
    (a) => a.id === draft.coverId && a.kind === "image",
  );
  const ordered =
    cover && ["note", "photo", "article"].includes(mode)
      ? [cover, ...bindings.filter((a) => a.id !== cover.id)]
      : bindings;
  const currentIndex = Math.min(index, Math.max(0, ordered.length - 1));
  const media = ordered[currentIndex];
  const video = bindings.find((a) => a.kind === "video");
  const hashtags = draft.tags.map((t) => "#" + t).join(" ");
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
        <PreviewMedia asset={media} w={w} cover={cover} />
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
          {bindings
            .filter((a) => a.id !== cover?.id)
            .map((a) => (
              <div className="article-inline-media" key={a.id}>
                <PreviewMedia asset={a} w={w} />
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
    const segments = draft.segments.length
      ? draft.segments
      : [
          ...(draft.body || hashtags
            ? [
                {
                  type: "text" as const,
                  text: [draft.body, hashtags].filter(Boolean).join("\n\n"),
                },
              ]
            : []),
          ...bindings.map((a) => ({ type: a.kind, assetId: a.id })),
        ];
    return (
      <div className="post-preview chat-preview" data-preview="chat">
        {account}
        <div className="chat-messages">
          {segments.length ? (
            segments.map((s, i) => (
              <div className="chat-bubble" key={i}>
                {s.type === "text"
                  ? s.text
                  : s.type === "link"
                    ? `${s.label}\n${s.url}`
                    : (() => {
                        const a = w.assets.find((a) => a.id === s.assetId);
                        return a ? (
                          <PreviewMedia asset={a} w={w} />
                        ) : (
                          "素材不可用"
                        );
                      })()}
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
          <p>{draft.body || "帖子正文会显示在这里。"}</p>
          <div className="hashtags">{hashtags}</div>
        </div>
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
          <MessageCircle size={17} />
          <Repeat2 size={17} />
          <Heart size={17} />
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
        </div>
        <div className="preview-copy">
          {mode === "video" && <h3>{draft.title || "视频标题"}</h3>}
          <small className="muted">{w.project.name}</small>
          <p>{draft.body || "视频描述会显示在这里。"}</p>
          <div className="hashtags">{draft.tags.join(" · ")}</div>
        </div>
      </div>
    );
  return (
    <div
      className={`post-preview note-preview ${mode === "photo" ? "photo-preview" : ""}`}
      data-preview={mode}
    >
      {mode === "photo" && account}
      {carousel}
      {mode === "note" && account}
      <div className="preview-copy">
        {mode === "note" && <h3>{draft.title || "笔记标题"}</h3>}
        <p>{draft.body || "配文会显示在这里。"}</p>
        <div className="hashtags">{hashtags}</div>
      </div>
    </div>
  );
}
