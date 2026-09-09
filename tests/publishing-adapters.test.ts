import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";
import sharp from "sharp";
import {
  DiscordAdapter,
  XAdapter,
  InstagramAdapter,
  FacebookAdapter,
  HttpMediaStore,
} from "../src/services/publishing/platforms";
import {
  Http,
  PublishError,
  type AdapterContext,
  type SnapshotInput,
  type Transport,
} from "../src/services/publishing/adapter";
import { defaultPublishing } from "../src/contracts/publishing";
import type { Prepared, PublishConnection } from "../src/contracts/automation";
const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
async function fixture(provider: "discord" | "x" | "instagram" | "facebook") {
  const folder = mkdtempSync(path.join(os.tmpdir(), "adapter-test-"));
  const file = path.join(folder, "合成.jpg");
  await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#447766" },
  })
    .jpeg()
    .toFile(file);
  const c: AdapterContext = {
    connection: {
      provider,
      remoteId: "123",
      graphVersion: "v24.0",
      mediaEndpoint: "https://gateway.example.test",
      clientId: "public-client",
    } as PublishConnection,
    secrets: {
      token: "test-token",
      refreshToken: "test-refresh",
      mediaToken: "gateway-token",
      webhook: "https://discord.com/api/webhooks/123/fixture",
    },
    saveSecrets: () => {},
    persistPrepared: () => {},
  };
  const input = {
    account: {
      accountType:
        provider === "facebook"
          ? "page"
          : provider === "instagram"
            ? "professional"
            : "profile",
    },
    target: {
      kind:
        provider === "discord"
          ? "channel"
          : provider === "facebook"
            ? "page"
            : "profile",
    },
    job: { id: "test-job", execution: { attempt: 1 } },
    variant: { segments: [], publishing: defaultPublishing() },
    text: "合成测试 @everyone",
    media: [{ id: "a", file, mime: "image/jpeg", sha256: "fixture-hash" }],
  } as unknown as SnapshotInput;
  return { c, input };
}

test("image-only automatic adapters do not silently discard an independent cover", async () => {
  const { input } = await fixture("x");
  input.variant.coverId = "independent-cover";
  await assert.rejects(new XAdapter().validate(input), /尚不支持单独提交封面/);
  input.variant.coverId = input.media[0].id;
  await new XAdapter().validate(input);
});
test("Discord requires a matching channel receipt, disables mentions and marks timeout unknown", async () => {
  const { c, input } = await fixture("discord");
  let count = 0;
  const a = new DiscordAdapter(async (url, init) => {
    if (!init?.method) return json({ channel_id: "123" });
    count++;
    assert.match(url, /wait=true/);
    assert.ok(init.body instanceof FormData);
    const payload = JSON.parse(init.body.get("payload_json") as string);
    assert.deepEqual(payload.allowed_mentions, {
      parse: [],
      users: [],
      roles: [],
      replied_user: false,
    });
    assert.equal(payload.attachments.length, 1);
    assert.ok(init.body.get("files[0]") instanceof Blob);
    return json({ id: "456", channel_id: "123", guild_id: "789" });
  });
  assert.equal((await a.check(c)).remoteId, "123");
  await a.validate(input);
  assert.equal((await a.submit(input, c)).state, "published");
  assert.equal(count, 1);
  const broken = new DiscordAdapter(async () => {
    throw Error("network token=must-not-leak");
  });
  await assert.rejects(
    () => broken.submit(input, c),
    (e: PublishError) => e.ambiguous && !e.message.includes("token="),
  );
  assert.equal((await a.reconcile(input, c, {}, undefined)).state, "unknown");
});
test("X refreshes only safe requests and binds ordered upload IDs to one post", async () => {
  const { c, input } = await fixture("x");
  let refresh = 0,
    check = 0,
    post = 0;
  let saved = false;
  c.saveSecrets = () => {
    saved = true;
  };
  const a = new XAdapter(async (url, init) => {
    if (url.endsWith("/users/me")) {
      if (check++ === 0) return json({}, 401);
      return json({ data: { id: "123" } });
    }
    if (url.endsWith("/oauth2/token")) {
      refresh++;
      assert.equal(
        (init?.body as URLSearchParams).get("grant_type"),
        "refresh_token",
      );
      return json({ access_token: "new-token", refresh_token: "new-refresh" });
    }
    if (url.endsWith("/media/upload")) {
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get("media_category"), "tweet_image");
      return json({ data: { id: "media1" } });
    }
    if (url.endsWith("/tweets")) {
      post++;
      assert.deepEqual(JSON.parse(init!.body as string).media, {
        media_ids: ["media1"],
      });
      return json({ data: { id: "post1" } }, 201);
    }
    throw Error(url);
  });
  await a.check(c);
  assert.equal(refresh, 1);
  assert.equal(saved, true);
  await a.validate(input);
  const p = await a.prepare(input, c, {});
  assert.equal((await a.submit(input, c, p)).state, "published");
  assert.equal(post, 1);
  const rejected = new XAdapter(async () => json({}, 401));
  await assert.rejects(
    () => rejected.submit(input, c, p),
    (e: PublishError) => e.authError,
  );
  assert.equal(refresh, 1);
});
test("Facebook uploads unpublished photos, submits to Page feed, and waits for publish evidence", async () => {
  const { c, input } = await fixture("facebook");
  const a = new FacebookAdapter(async (url, init) => {
    if (url.includes("/photos")) {
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get("published"), "false");
      assert.ok(init.body.get("source") instanceof Blob);
      return json({ id: "photo1" });
    }
    if (url.endsWith("/feed")) {
      assert.deepEqual(JSON.parse(init!.body as string).attached_media, [
        { media_fbid: "photo1" },
      ]);
      return json({ id: "123_456" });
    }
    if (url.includes("is_published"))
      return json({
        id: "123_456",
        from: { id: "123" },
        is_published: true,
        permalink_url: "https://facebook.com/123/posts/456",
      });
    return json({ id: "123", category: "Test Page" });
  });
  assert.equal((await a.check(c)).remoteId, "123");
  await assert.rejects(
    () => new FacebookAdapter(async () => json({ id: "123" })).check(c),
    /Page/,
  );
  await a.validate(input);
  const p = await a.prepare(input, c, {});
  const r = await a.submit(input, c, p);
  assert.equal(r.state, "accepted");
  assert.equal((await a.reconcile(input, c, p, r)).state, "published");
  input.account.accountType = "profile";
  await assert.rejects(() => a.validate(input), /Page/);
});
test("Instagram preserves carousel order, polls containers, verifies final media, then cleans objects", async () => {
  const { c, input } = await fixture("instagram");
  input.media.push({ ...input.media[0], id: "b" });
  let uploads = 0,
    children = 0,
    publishes = 0,
    cleanup = 0;
  let pending = true;
  const fetch: Transport = async (url, init) => {
    if (url.endsWith("/objects")) {
      uploads++;
      return json({
        id: `obj${uploads}`,
        uploadUrl: `https://storage.example.test/put${uploads}`,
        url: `https://storage.example.test/public${uploads}`,
        expiresAt: new Date(Date.now() + 86400000).toISOString(),
      });
    }
    if (url.includes("storage.example.test"))
      return new Response(null, { status: 200 });
    if (init?.method === "DELETE") {
      cleanup++;
      return new Response(null, { status: 204 });
    }
    if (url.includes("/media_publish")) {
      publishes++;
      return json({ id: "final" });
    }
    if (url.endsWith("/media")) {
      const payload = JSON.parse(init!.body as string);
      if (payload.media_type === "CAROUSEL") {
        assert.equal(payload.children, "child1,child2");
        return json({ id: "parent" });
      }
      children++;
      assert.equal(
        payload.image_url,
        `https://storage.example.test/public${children}`,
      );
      assert.equal(payload.is_carousel_item, true);
      return json({ id: `child${children}` });
    }
    if (url.includes("status_code"))
      return json({ status_code: pending ? "IN_PROGRESS" : "FINISHED" });
    if (url.includes("permalink"))
      return json({
        id: "final",
        permalink: "https://instagram.com/p/fixture",
      });
    return json({ user_id: "123" });
  };
  const a = new InstagramAdapter(fetch);
  await a.validate(input, c);
  let p = await a.prepare(input, c, {});
  assert.equal(p.ready, false);
  assert.equal(publishes, 0);
  pending = false;
  p = await a.prepare(input, c, p);
  assert.equal(p.ready, true);
  assert.equal(uploads, 2);
  assert.equal(children, 2);
  const r = await a.submit(input, c, p);
  assert.equal(r.state, "accepted");
  assert.equal((await a.reconcile(input, c, p, r)).state, "published");
  await a.cleanup(c, p);
  assert.equal(cleanup, 2);
  await a.cleanup(c, p);
  assert.equal(cleanup, 2);
});
test("expired or unreachable IG media blocks publish and never leaks gateway token to public URLs", async () => {
  const { c, input } = await fixture("instagram");
  let calls = 0;
  const media = new HttpMediaStore(
    new Http(async (url, init) => {
      calls++;
      if (url.endsWith("/objects"))
        return json({
          id: "obj",
          uploadUrl: "https://storage.example.test/upload",
          url: "https://storage.example.test/public",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        });
      assert.equal(
        (init?.headers as Record<string, string>)?.Authorization,
        undefined,
      );
      return new Response(null, {
        status: init?.method === "HEAD" ? 404 : 200,
      });
    }),
  );
  await assert.rejects(() => media.upload(input, c, {}), /不可达/);
  assert.equal(calls, 3);
  const p: Prepared = {
    temporary: [
      {
        id: "expired",
        url: "https://storage.example.test/public",
        expiresAt: new Date(0).toISOString(),
      },
    ],
  };
  await assert.rejects(() => media.upload(input, c, p), /过期/);
});
test("HTTP submit errors distinguish definitive rejection, rate limit, and uncertain server failure", async () => {
  for (const code of [400, 401, 408, 429, 500]) {
    const h = new Http(async () =>
      json({ error: { message: "secret must not be stored" } }, code, {
        "Retry-After": "20",
      }),
    );
    await assert.rejects(
      () => h.post("https://api.example.test/post", {}, "secret", true),
      (e: PublishError) => {
        assert.equal(e.ambiguous, code === 500 || code === 408);
        assert.equal(e.retryable, code === 429);
        assert.equal(e.authError, code === 401);
        assert.equal(e.retryAfterMs, 20000);
        assert.ok(!e.message.includes("secret"));
        return true;
      },
    );
  }
  await assert.rejects(
    () =>
      new Http(async () => json({}, 429, { "Retry-After": "invalid" })).post(
        "https://api.example.test/post",
        {},
        undefined,
        true,
      ),
    (e: PublishError) => e.retryable && e.retryAfterMs === undefined,
  );
});
