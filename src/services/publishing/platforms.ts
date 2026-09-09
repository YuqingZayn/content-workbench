import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { defaultPublishing } from "../../contracts/publishing";
import type { Prepared, PublishResult } from "../../contracts/automation";
import {
  Http,
  httpsUrl,
  PublishError,
  resultId,
  type AdapterContext,
  type PublisherAdapter,
  type SnapshotInput,
  type Transport,
} from "./adapter";
const token = (c: AdapterContext) => {
  if (!c.secrets.token) throw new PublishError("请先填写访问令牌", false, true);
  return c.secrets.token;
};
const auth = (c: AdapterContext) => ({ Authorization: `Bearer ${token(c)}` });
const remote = (c: AdapterContext) => {
  if (!/^\d+$/.test(c.connection.remoteId))
    throw new PublishError("请填写真实数字账号 / 目标 ID");
  return c.connection.remoteId;
};
const unknown = (): PublishResult => ({
  state: "unknown",
  message: "缺少可查询的平台 ID，请在平台核实，禁止自动重发",
});
async function images(
  input: SnapshotInput,
  max: number,
  maxBytes = 10 * 1024 * 1024,
) {
  if (input.variant.segments.length)
    throw new PublishError(
      "自动连接仅使用单条正文和有序媒体，请先清除自定义消息段或使用辅助包",
    );
  if (
    input.variant.coverId &&
    !input.media.some((file) => file.id === input.variant.coverId)
  )
    throw new PublishError(
      "此自动连接尚不支持单独提交封面，请清除保留的独立封面或使用辅助发布包",
    );
  if (input.media.length > max)
    throw new PublishError(
      `此连接最多发送 ${max} 张图片，请拆分版本或使用辅助包`,
    );
  for (const file of input.media) {
    const size = (await stat(file.file)).size;
    if (size > maxBytes)
      throw new PublishError("图片超过本连接的大小限制，请另存压缩副本");
    const meta = await sharp(file.file)
      .metadata()
      .catch(() => null);
    if (
      !meta ||
      !["png", "jpeg", "webp"].includes(meta.format ?? "") ||
      (meta.pages ?? 1) > 1
    )
      throw new PublishError(
        "此自动连接仅支持静态 PNG / JPEG / WebP 图片，视频和动图请使用辅助包",
      );
  }
}
export class DiscordAdapter implements PublisherAdapter {
  http: Http;
  constructor(fetch?: Transport) {
    this.http = new Http(fetch);
  }
  endpoint(c: AdapterContext) {
    const u = httpsUrl(c.secrets.webhook ?? "");
    if (
      u.hostname !== "discord.com" ||
      !/^\/api(?:\/v10)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(u.pathname)
    )
      throw new PublishError("请填写 discord.com 官方 Webhook 地址");
    u.search = "";
    u.hash = "";
    return u.href;
  }
  async check(c: AdapterContext) {
    const r = await this.http.json(this.endpoint(c));
    if (!resultId(r.channel_id))
      throw new PublishError("Webhook 未返回频道 ID");
    return {
      remoteId: r.channel_id,
      message: `已读取 Webhook 的频道身份；发送权限待实际回执验证`,
    };
  }
  async validate(input: SnapshotInput) {
    await images(input, 10);
    if (input.target.kind !== "channel")
      throw new PublishError("Webhook 需要频道目标");
    if (input.text.length > 2000)
      throw new PublishError(
        "Discord 单条消息超过 2000 字符，请拆分或使用辅助包",
      );
    if (
      (input.variant.publishing ?? defaultPublishing()).discord.format !==
      "message"
    )
      throw new PublishError("此连接先支持普通频道消息，论坛请使用辅助包");
  }
  async prepare(_i: SnapshotInput, _c: AdapterContext, p: Prepared) {
    return p;
  }
  async submit(i: SnapshotInput, c: AdapterContext): Promise<PublishResult> {
    const r = await this.http.multipart(
      this.endpoint(c) + "?wait=true",
      {
        payload_json: JSON.stringify({
          content: i.text,
          allowed_mentions: {
            parse: [],
            users: [],
            roles: [],
            replied_user: false,
          },
          attachments: i.media.map((f, n) => ({
            id: n,
            filename: path.basename(f.file),
          })),
        }),
      },
      i.media,
      undefined,
      true,
    );
    const id = resultId(r.id);
    if (!id) return unknown();
    if (r.channel_id !== c.connection.remoteId)
      return { state: "unknown", id, message: "回执频道不匹配，请人工核实" };
    return {
      state: "published",
      id,
      url: r.guild_id
        ? `https://discord.com/channels/${r.guild_id}/${r.channel_id}/${id}`
        : undefined,
      message: "Discord 返回消息回执",
    };
  }
  async reconcile(
    _i: SnapshotInput,
    c: AdapterContext,
    _p: Prepared,
    result?: PublishResult,
  ): Promise<PublishResult> {
    if (!result?.id) return unknown();
    const r = await this.http.json(`${this.endpoint(c)}/messages/${result.id}`);
    return r.id === result.id && r.channel_id === c.connection.remoteId
      ? { ...result, state: "published", message: "已查询到该频道的消息" }
      : unknown();
  }
}
export class XAdapter implements PublisherAdapter {
  http: Http;
  constructor(fetch?: Transport) {
    this.http = new Http(fetch);
  }
  async request(
    c: AdapterContext,
    url: string,
    init: RequestInit = {},
    submitting = false,
  ): Promise<any> {
    try {
      return await this.http.json(
        url,
        { ...init, headers: { ...init.headers, ...auth(c) } },
        submitting,
      );
    } catch (e) {
      if (
        !(e instanceof PublishError) ||
        !e.authError ||
        submitting ||
        !c.secrets.refreshToken ||
        !c.connection.clientId
      )
        throw e;
      const form = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: c.secrets.refreshToken,
        client_id: c.connection.clientId,
      });
      const refreshed = await this.http.json(
        "https://api.x.com/2/oauth2/token",
        {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: form,
        },
      );
      if (!refreshed.access_token)
        throw new PublishError("X 令牌更新失败，请重新授权", false, true);
      c.secrets = {
        ...c.secrets,
        token: refreshed.access_token,
        refreshToken: refreshed.refresh_token ?? c.secrets.refreshToken,
      };
      c.saveSecrets(c.secrets);
      return this.http.json(
        url,
        { ...init, headers: { ...init.headers, ...auth(c) } },
        submitting,
      );
    }
  }
  async check(c: AdapterContext) {
    const r = await this.request(c, "https://api.x.com/2/users/me");
    if (!resultId(r.data?.id)) throw new PublishError("X 未返回授权用户 ID");
    return {
      remoteId: r.data.id,
      message: "已读取授权用户身份；写权限、费用与额度需在开发者后台确认",
    };
  }
  async validate(i: SnapshotInput) {
    await images(i, 4, 5 * 1024 * 1024);
    if (i.target.kind !== "profile")
      throw new PublishError("X 连接只支持账号主页");
  }
  async prepare(i: SnapshotInput, c: AdapterContext, p: Prepared) {
    p.mediaIds ??= [];
    for (const f of i.media.slice(p.mediaIds.length)) {
      const form = new FormData();
      form.set(
        "media",
        await openAsBlob(f.file, { type: f.mime }),
        path.basename(f.file),
      );
      form.set("media_category", "tweet_image");
      const r = await this.request(c, "https://api.x.com/2/media/upload", {
        method: "POST",
        body: form,
      });
      const id = resultId(r.data?.id);
      if (!id) throw new PublishError("X 未返回媒体 ID");
      p.mediaIds.push(id);
      c.persistPrepared(p);
    }
    return p;
  }
  async submit(
    i: SnapshotInput,
    c: AdapterContext,
    p: Prepared,
  ): Promise<PublishResult> {
    const r = await this.request(
      c,
      "https://api.x.com/2/tweets",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: i.text,
          ...(p.mediaIds?.length ? { media: { media_ids: p.mediaIds } } : {}),
        }),
      },
      true,
    );
    const id = resultId(r.data?.id);
    return id
      ? {
          state: "published",
          id,
          url: `https://x.com/i/web/status/${id}`,
          message: "X 返回帖子 ID",
        }
      : unknown();
  }
  async reconcile(
    _i: SnapshotInput,
    c: AdapterContext,
    _p: Prepared,
    r?: PublishResult,
  ): Promise<PublishResult> {
    if (!r?.id) return unknown();
    const post = await this.request(
      c,
      `https://api.x.com/2/tweets/${r.id}?tweet.fields=author_id`,
    );
    return post.data?.id === r.id &&
      post.data?.author_id === c.connection.remoteId
      ? { ...r, state: "published", message: "已核对帖子及作者" }
      : unknown();
  }
}
export class FacebookAdapter implements PublisherAdapter {
  http: Http;
  constructor(fetch?: Transport) {
    this.http = new Http(fetch);
  }
  base(c: AdapterContext) {
    return `https://graph.facebook.com/${c.connection.graphVersion}`;
  }
  async check(c: AdapterContext) {
    const r = await this.http.json(
      `${this.base(c)}/me?fields=id,name,category`,
      {
        headers: auth(c),
      },
    );
    if (!resultId(r.id) || typeof r.category !== "string" || !r.category)
      throw new PublishError(
        "令牌未确认 Page 身份，请使用目标 Page 的访问令牌",
      );
    return {
      remoteId: r.id,
      message: "已读取令牌所属 Page；发布权限与应用上线状态待验证",
    };
  }
  async validate(i: SnapshotInput) {
    await images(i, 10);
    if (i.account.accountType !== "page" || i.target.kind !== "page")
      throw new PublishError("只支持 Facebook Page");
    const fields = (i.variant.publishing ?? defaultPublishing()).facebook;
    if (fields.audience || fields.linkTitle)
      throw new PublishError(
        "自定义受众或链接标题需使用辅助发布，避免丢失字段",
      );
    if (fields.format === "link" && (i.media.length || !fields.linkUrl))
      throw new PublishError(
        "链接帖子需要链接地址且不能同时附加图片，请调整或使用辅助包",
      );
    if (fields.format === "link") httpsUrl(fields.linkUrl);
    if (
      (i.variant.publishing ?? defaultPublishing()).facebook.format === "reel"
    )
      throw new PublishError("Reel 自动发布尚未实现，请使用辅助包");
  }
  async prepare(i: SnapshotInput, c: AdapterContext, p: Prepared) {
    p.mediaIds ??= [];
    for (const f of i.media.slice(p.mediaIds.length)) {
      const r = await this.http.multipart(
        `${this.base(c)}/${remote(c)}/photos`,
        { published: "false", __single: "1" },
        [f],
        token(c),
      );
      const id = resultId(r.id);
      if (!id) throw new PublishError("Facebook 未返回未发布图片 ID");
      p.mediaIds.push(id);
      c.persistPrepared(p);
    }
    return p;
  }
  async submit(
    i: SnapshotInput,
    c: AdapterContext,
    p: Prepared,
  ): Promise<PublishResult> {
    const publishing = i.variant.publishing ?? defaultPublishing();
    const r = await this.http.post(
      `${this.base(c)}/${remote(c)}/feed`,
      {
        message: i.text,
        ...(p.mediaIds?.length
          ? { attached_media: p.mediaIds.map((media_fbid) => ({ media_fbid })) }
          : publishing.facebook.format === "link"
            ? { link: publishing.facebook.linkUrl }
            : {}),
        published: true,
      },
      token(c),
      true,
    );
    const id = resultId(r.id);
    return id
      ? { state: "accepted", id, message: "Facebook 已接收，等待查询公开状态" }
      : unknown();
  }
  async reconcile(
    _i: SnapshotInput,
    c: AdapterContext,
    _p: Prepared,
    r?: PublishResult,
  ): Promise<PublishResult> {
    if (!r?.id) return unknown();
    const post = await this.http.json(
      `${this.base(c)}/${r.id}?fields=id,is_published,permalink_url,from`,
      { headers: auth(c) },
    );
    if (post.id !== r.id || post.from?.id !== c.connection.remoteId)
      return unknown();
    return {
      ...r,
      state: post.is_published === true ? "published" : "accepted",
      url:
        typeof post.permalink_url === "string" ? post.permalink_url : undefined,
      message:
        post.is_published === true
          ? "已核对 Page 帖子发布状态"
          : "平台尚未确认公开",
    };
  }
}
// The media gateway is explicitly configured by the owner. It stores only snapshot media.
// POST /objects -> {id,uploadUrl,url,expiresAt}; PUT uploadUrl; DELETE /objects/:id.
export class HttpMediaStore {
  constructor(public http: Http) {}
  base(c: AdapterContext) {
    if (!c.connection.mediaEndpoint)
      throw new PublishError("未配置媒体出口，请在连接中填写或使用辅助包");
    return httpsUrl(c.connection.mediaEndpoint).href.replace(/\/$/, "");
  }
  async upload(i: SnapshotInput, c: AdapterContext, p: Prepared) {
    p.temporary ??= [];
    for (const f of i.media.slice(p.temporary.length)) {
      const object = await this.http.post(
        this.base(c) + "/objects",
        {
          name: path.basename(f.file),
          sha256: f.sha256,
          contentType: f.mime,
          bytes: (await stat(f.file)).size,
          expiresInSeconds: 86400,
        },
        c.secrets.mediaToken,
      );
      if (
        !resultId(object.id) ||
        !Number.isFinite(Date.parse(object.expiresAt)) ||
        Date.parse(object.expiresAt) < Date.now() + 300000
      )
        throw new PublishError("媒体出口未返回有效对象或有效期不足 5 分钟");
      const uploadUrl = httpsUrl(object.uploadUrl).href;
      const url = httpsUrl(object.url).href;
      // Public media URLs must not contain credentials or signed query strings in project data.
      if (new URL(url).search)
        throw new PublishError(
          "媒体公开地址不能含令牌或签名参数，请配置无查询参数的临时公开对象",
        );
      let response: Response;
      try {
        response = await this.http.fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": f.mime },
          body: await openAsBlob(f.file, { type: f.mime }),
        });
      } catch {
        throw new PublishError("快照媒体上传失败", true);
      }
      if (!response.ok) throw new PublishError("快照媒体上传失败", true);
      p.temporary.push({ id: object.id, url, expiresAt: object.expiresAt });
      c.persistPrepared(p);
    }
    for (const object of p.temporary) {
      if (Date.parse(object.expiresAt) < Date.now() + 60000)
        throw new PublishError("临时媒体地址即将过期，请重新准备或使用辅助包");
      let r: Response;
      try {
        r = await this.http.fetch(object.url, { method: "HEAD" });
      } catch {
        throw new PublishError("临时媒体不可达，未提交最终发布", true);
      }
      if (!r.ok) throw new PublishError("临时媒体不可达，未提交最终发布", true);
    }
    return p;
  }
  async cleanup(c: AdapterContext, p: Prepared) {
    if (p.cleanupDone) return;
    for (const o of p.temporary ?? []) {
      const response = await this.http.fetch(
        `${this.base(c)}/objects/${o.id}`,
        {
          method: "DELETE",
          headers: c.secrets.mediaToken
            ? { Authorization: `Bearer ${c.secrets.mediaToken}` }
            : {},
        },
      );
      if (!response.ok && response.status !== 404)
        throw new PublishError("媒体出口清理失败", true);
    }
    p.cleanupDone = true;
    c.persistPrepared(p);
  }
}
export class InstagramAdapter implements PublisherAdapter {
  http: Http;
  media: HttpMediaStore;
  constructor(fetch?: Transport) {
    this.http = new Http(fetch);
    this.media = new HttpMediaStore(this.http);
  }
  base(c: AdapterContext) {
    return `https://graph.instagram.com/${c.connection.graphVersion}`;
  }
  async check(c: AdapterContext) {
    const r = await this.http.json(
      `${this.base(c)}/me?fields=user_id,username`,
      { headers: auth(c) },
    );
    const id = resultId(r.user_id ?? r.id);
    if (!id) throw new PublishError("Instagram 未返回专业账号 ID");
    this.media.base(c);
    return {
      remoteId: id,
      message: "已读取 Instagram Login 身份，内容发布权限及媒体出口待发布验证",
    };
  }
  async validate(i: SnapshotInput, c: AdapterContext) {
    await images(i, 10, 8 * 1024 * 1024);
    const fields = (i.variant.publishing ?? defaultPublishing()).instagram;
    if (fields.location || Object.values(fields.altText).some(Boolean))
      throw new PublishError(
        "地点或替代文本的自动提交尚未验证，请使用辅助发布保留这些字段",
      );
    if (!i.media.length) throw new PublishError("Instagram 至少需要一张图片");
    if (
      !["professional", "business", "creator"].includes(i.account.accountType)
    )
      throw new PublishError("Instagram 需要专业账号");
    if (
      (i.variant.publishing ?? defaultPublishing()).instagram.format !== "feed"
    )
      throw new PublishError("仅支持单图或轮播，Reel / Story 请使用辅助包");
    for (const f of i.media) {
      const m = await sharp(f.file).metadata();
      if (m.format !== "jpeg")
        throw new PublishError(
          "Instagram 图片接口需要 JPEG，请先另存 JPEG 副本",
        );
    }
    this.media.base(c);
  }
  async status(c: AdapterContext, id: string) {
    return this.http.json(`${this.base(c)}/${id}?fields=status_code`, {
      headers: auth(c),
    });
  }
  async prepare(i: SnapshotInput, c: AdapterContext, p: Prepared) {
    await this.media.upload(i, c, p);
    p.childIds ??= [];
    if (!p.containerId) {
      for (const o of p.temporary!.slice(p.childIds.length)) {
        const r = await this.http.post(
          `${this.base(c)}/${remote(c)}/media`,
          {
            image_url: o.url,
            ...(i.media.length > 1
              ? { is_carousel_item: true }
              : { caption: i.text }),
          },
          token(c),
        );
        const id = resultId(r.id);
        if (!id) throw new PublishError("Instagram 未返回媒体容器 ID");
        p.childIds.push(id);
        c.persistPrepared(p);
      }
      for (const id of p.childIds) {
        const r = await this.status(c, id);
        if (["ERROR", "EXPIRED"].includes(r.status_code))
          throw new PublishError("Instagram 媒体容器失败或过期，请重新准备");
        if (r.status_code !== "FINISHED") {
          p.ready = false;
          return p;
        }
      }
      if (i.media.length === 1) p.containerId = p.childIds[0];
      else {
        const r = await this.http.post(
          `${this.base(c)}/${remote(c)}/media`,
          {
            media_type: "CAROUSEL",
            children: p.childIds.join(","),
            caption: i.text,
          },
          token(c),
        );
        p.containerId = resultId(r.id);
        if (!p.containerId)
          throw new PublishError("Instagram 未返回轮播容器 ID");
      }
      c.persistPrepared(p);
    }
    const status = await this.status(c, p.containerId);
    if (["ERROR", "EXPIRED"].includes(status.status_code))
      throw new PublishError("Instagram 容器错误或过期");
    p.ready = status.status_code === "FINISHED";
    return p;
  }
  async submit(
    _i: SnapshotInput,
    c: AdapterContext,
    p: Prepared,
  ): Promise<PublishResult> {
    if (!p.ready || !p.containerId) throw new PublishError("媒体尚未准备完成");
    const r = await this.http.post(
      `${this.base(c)}/${remote(c)}/media_publish`,
      { creation_id: p.containerId },
      token(c),
      true,
    );
    const id = resultId(r.id);
    return id
      ? { state: "accepted", id, message: "Instagram 已返回媒体 ID，等待核对" }
      : unknown();
  }
  async reconcile(
    _i: SnapshotInput,
    c: AdapterContext,
    p: Prepared,
    r?: PublishResult,
  ): Promise<PublishResult> {
    if (r?.id) {
      const m = await this.http.json(
        `${this.base(c)}/${r.id}?fields=id,permalink`,
        { headers: auth(c) },
      );
      return m.id === r.id && typeof m.permalink === "string"
        ? {
            ...r,
            state: "published",
            url: m.permalink,
            message: "已核对 Instagram 媒体和链接",
          }
        : { ...r, state: "accepted" };
    }
    if (p.containerId) {
      const s = await this.status(c, p.containerId);
      return {
        state: "unknown",
        message:
          s.status_code === "PUBLISHED"
            ? "容器显示已发布，但没有媒体 ID；请人工核实，不可重发"
            : "未获得确定发布回执，请人工核实",
      };
    }
    return unknown();
  }
  async cleanup(c: AdapterContext, p: Prepared) {
    await this.media.cleanup(c, p);
  }
}
export function officialAdapters(fetch?: Transport) {
  return {
    discord: new DiscordAdapter(fetch),
    x: new XAdapter(fetch),
    facebook: new FacebookAdapter(fetch),
    instagram: new InstagramAdapter(fetch),
  };
}
