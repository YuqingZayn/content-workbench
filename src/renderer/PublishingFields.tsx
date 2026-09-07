import type { ReactNode } from "react";
import type { Variant, Workspace } from "../contracts/model";
import { getPlatformDefinition } from "../contracts/model";
import {
  defaultPublishing,
  nativePlatform,
  publicationFields,
  publicationWarnings,
  publishingFormats,
  type NativePlatform,
  type Publishing,
} from "../contracts/publishing";

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label>
      {label}
      {multiline ? (
        <textarea
          aria-label={label}
          rows={4}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          aria-label={label}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label>
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </label>
  );
}

export function PublishingFields({
  w,
  draft,
  change,
}: {
  w: Workspace;
  draft: Variant;
  change: (patch: Partial<Variant>) => void;
}) {
  const definition = getPlatformDefinition(w.platforms, draft.platform);
  const platform = nativePlatform(definition);
  const p = draft.publishing ?? defaultPublishing();
  if (!platform) return null;
  const update = <K extends NativePlatform>(
    id: K,
    patch: Partial<Publishing[K]>,
  ) => change({ publishing: { ...p, [id]: { ...p[id], ...patch } } });
  const warnings = publicationWarnings(draft, definition, w.assets);
  return (
    <>
      <div className="publishing-format">
        <Select
          label="发布类型"
          value={p[platform].format}
          onChange={(format) => {
            // Only values from this platform's controlled select reach the schema.
            change({
              publishing: { ...p, [platform]: { ...p[platform], format } },
            });
          }}
        >
          {publishingFormats[platform].map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>
      <section
        className="publishing-options"
        aria-label={`${definition.name} 发布设置`}
      >
        <h3>{definition.name} 发布设置</h3>
        {platform === "youtube" && (
          <>
            <div className="publishing-field-row">
              <Select
                label="视频可见性"
                value={p.youtube.visibility}
                onChange={(visibility) =>
                  update("youtube", {
                    visibility:
                      visibility as Publishing["youtube"]["visibility"],
                  })
                }
              >
                <option value="">发布前选择</option>
                <option value="public">公开</option>
                <option value="unlisted">不公开列出</option>
                <option value="private">私享</option>
              </Select>
              <Select
                label="是否面向儿童"
                value={p.youtube.audience}
                onChange={(audience) =>
                  update("youtube", {
                    audience: audience as Publishing["youtube"]["audience"],
                  })
                }
              >
                <option value="">发布前确认</option>
                <option value="kids">是，面向儿童</option>
                <option value="general">否，非儿童专属内容</option>
              </Select>
            </div>
            <Field
              label="播放列表"
              value={p.youtube.playlist}
              onChange={(playlist) => update("youtube", { playlist })}
              placeholder="选填，如：产品教程"
            />
            {p.youtube.format === "video" && (
              <Field
                label="章节时间轴"
                multiline
                value={p.youtube.chapters}
                onChange={(chapters) => update("youtube", { chapters })}
                placeholder={"00:00 开场\n00:30 第一部分\n02:00 总结"}
              />
            )}
            <p className="hint">
              章节会追加到视频简介。Shorts 使用竖屏预览，标题与关键词独立填写。
            </p>
          </>
        )}
        {platform === "bilibili" && p.bilibili.format === "video" && (
          <>
            <Select
              label="投稿类型"
              value={p.bilibili.copyright}
              onChange={(copyright) =>
                update("bilibili", {
                  copyright: copyright as Publishing["bilibili"]["copyright"],
                })
              }
            >
              <option value="">发布前选择</option>
              <option value="original">自制</option>
              <option value="repost">转载</option>
            </Select>
            {p.bilibili.copyright === "repost" && (
              <Field
                label="转载来源"
                value={p.bilibili.source}
                onChange={(source) => update("bilibili", { source })}
                placeholder="原作者、来源网址或出处"
              />
            )}
            <div className="publishing-field-row">
              <Field
                label="投稿分区"
                value={p.bilibili.category}
                onChange={(category) => update("bilibili", { category })}
                placeholder="在投稿页确认分区"
              />
              <Field
                label="所属合集"
                value={p.bilibili.collection}
                onChange={(collection) => update("bilibili", { collection })}
                placeholder="选填"
              />
            </div>
          </>
        )}
        {platform === "douyin" && (
          <>
            <Field
              label="作品位置"
              value={p.douyin.location}
              onChange={(location) => update("douyin", { location })}
              placeholder="选填，发布时选择对应地点"
            />
            <Field
              label="封面文案"
              value={p.douyin.coverText}
              onChange={(coverText) => update("douyin", { coverText })}
              placeholder="用于制作封面的短句"
            />
            <p className="hint">
              封面文案用于预览与发布备注，原始图片不会被改写。音乐、贴纸在抖音内添加。
            </p>
          </>
        )}
        {platform === "instagram" && (
          <>
            <Field
              label="帖子位置"
              value={p.instagram.location}
              onChange={(location) => update("instagram", { location })}
              placeholder="选填"
            />
            {p.instagram.format === "feed" &&
              draft.assetIds
                .map((id) => w.assets.find((a) => a.id === id))
                .filter((a) => a?.kind === "image")
                .map(
                  (a) =>
                    a && (
                      <Field
                        key={a.id}
                        label={`图片替代文字 · ${a.name}`}
                        value={p.instagram.altText[a.id] ?? ""}
                        onChange={(text) =>
                          update("instagram", {
                            altText: { ...p.instagram.altText, [a.id]: text },
                          })
                        }
                        placeholder="描述画面，供无障碍阅读使用"
                      />
                    ),
                )}
            <p className="hint">
              轮播按素材顺序预览；Story 逐张预览。音乐、贴纸与互动组件在
              Instagram 内添加。
            </p>
          </>
        )}
        {platform === "facebook" && (
          <>
            {p.facebook.format === "link" && (
              <>
                <Field
                  label="分享链接"
                  value={p.facebook.linkUrl}
                  onChange={(linkUrl) => update("facebook", { linkUrl })}
                  placeholder="https://"
                />
                <Field
                  label="链接标题备注"
                  value={p.facebook.linkTitle}
                  onChange={(linkTitle) => update("facebook", { linkTitle })}
                  placeholder="仅供本地预览，实际卡片由网页信息决定"
                />
              </>
            )}
            <Field
              label="预期可见范围"
              value={p.facebook.audience}
              onChange={(audience) => update("facebook", { audience })}
              placeholder="如公开、朋友；发布时以账号可用选项为准"
            />
          </>
        )}
        {platform === "discord" && (
          <p className="hint">
            {p.discord.format === "forum"
              ? "论坛帖有独立标题和标签，正文作为首条消息；标签在目标论坛中选择。"
              : "频道消息支持 Markdown，文字、链接与附件可分段编排。"}
          </p>
        )}
        {platform === "wechat" && p.wechat.format === "announcement" && (
          <p className="hint">
            群公告以正文为主，在群设置中粘贴；附带素材作为补充群消息发送。需要群内相应权限。
          </p>
        )}
        <small className="muted">
          设置随草稿与发布包保存，发布时在平台确认。
        </small>
        {warnings.length > 0 && (
          <ul className="publishing-warnings" aria-label="发布准备提示">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function PublishingSummary({
  w,
  draft,
}: {
  w: Workspace;
  draft: Variant;
}) {
  const definition = getPlatformDefinition(w.platforms, draft.platform);
  const fields = publicationFields(draft, definition).filter(
    ([key]) => key !== "章节时间轴",
  );
  return fields.length ? (
    <dl className="publishing-summary">
      {fields.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  ) : null;
}
