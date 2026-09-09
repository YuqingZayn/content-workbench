import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseRange, safePath, uuid, within } from "../src/services/files";
import { JsonLines, findCodex } from "../src/services/codex/connection";
import { variantSchema, platformIdSchema } from "../src/contracts/model";
import { defaultPlatforms } from "../src/contracts/model";
import type { Asset } from "../src/contracts/model";
import {
  coverRuleFor,
  effectiveCoverId,
  selectCover,
} from "../src/contracts/covers";
import {
  composerFor,
  defaultPublishing,
  publicationBody,
  publicationSegments,
  publicationWarnings,
  publishingSchema,
  splitMessages,
} from "../src/contracts/publishing";

test("legacy drafts get isolated publishing defaults and native formats respect project overrides", () => {
  const legacy = {
    id: uuid(),
    platform: "youtube",
    locale: "zh-CN",
    title: "旧稿",
    body: "旧正文",
    tags: [],
    assetIds: [],
    coverId: null,
    segments: [],
    revision: 1,
    bodyHash: "",
    readiness: "draft",
  };
  const first = variantSchema.parse(legacy);
  const second = variantSchema.parse(legacy);
  first.publishing.youtube.format = "shorts";
  assert.equal(second.publishing.youtube.format, "video");
  assert.equal(first.body, "旧正文");
  const definition = defaultPlatforms.find((p) => p.id === "youtube")!;
  assert.equal(composerFor(first, definition), "short_video");
  assert.equal(
    composerFor(first, { ...definition, composer: "article" }),
    "article",
  );
  assert.equal(
    publishingSchema.safeParse({ instagram: { format: "video" } }).success,
    false,
  );
  assert.equal(
    publishingSchema.parse({ youtube: { format: "shorts" } }).wechat.format,
    "message",
  );
});

test("covers follow body order for images, remain independent for videos and respect native format changes", () => {
  const first = { id: uuid(), kind: "image" } as Asset;
  const second = { id: uuid(), kind: "image" } as Asset;
  const video = { id: uuid(), kind: "video" } as Asset;
  const assets = [first, second, video];
  const definition = defaultPlatforms.find((p) => p.id === "xiaohongshu")!;
  let v = variantSchema.parse({
    id: uuid(),
    platform: "xiaohongshu",
    locale: "zh-CN",
    title: "",
    body: "内容",
    tags: [],
    assetIds: [first.id, second.id],
    coverId: second.id,
    segments: [],
    revision: 0,
    bodyHash: "",
    readiness: "draft",
  });
  assert.equal(
    effectiveCoverId(v, definition, assets),
    first.id,
    "stale coverId cannot override body order",
  );
  v = { ...v, ...selectCover(v, coverRuleFor(v, definition), second.id) };
  assert.deepEqual(v.assetIds, [second.id, first.id]);
  assert.equal(effectiveCoverId(v, definition, assets), second.id);
  v.assetIds.reverse();
  assert.equal(effectiveCoverId(v, definition, assets), first.id);
  v.publishing.xiaohongshu.format = "video";
  v.assetIds = [video.id];
  assert.equal(composerFor(v, definition), "video");
  assert.equal(coverRuleFor(v, definition).mode, "independent");
  v = { ...v, ...selectCover(v, coverRuleFor(v, definition), first.id) };
  assert.deepEqual(
    v.assetIds,
    [video.id],
    "selecting an independent cover never adds a body attachment",
  );
  assert.equal(effectiveCoverId(v, definition, assets), first.id);
  assert.equal(
    publicationSegments(v, definition, assets).filter((s) => s.type === "image")
      .length,
    0,
  );
  v.publishing.xiaohongshu.format = "images";
  assert.ok(
    publicationWarnings(v, definition, assets).some((w) =>
      w.includes("仍有关联视频"),
    ),
  );
  assert.equal(
    effectiveCoverId(v, definition, assets),
    null,
    "a video first item is not an image cover",
  );
  assert.equal(
    v.coverId,
    first.id,
    "format switch preserves independent draft cover",
  );

  const wx = defaultPlatforms.find((p) => p.id === "wechat_official")!;
  assert.equal(coverRuleFor(v, wx).mode, "independent");
  v.publishing.wechat_official.format = "images";
  assert.equal(coverRuleFor(v, wx).mode, "first_media");
  const ig = defaultPlatforms.find((p) => p.id === "instagram")!;
  v.publishing.instagram.format = "story";
  assert.equal(effectiveCoverId(v, ig, assets), null);
  const yt = defaultPlatforms.find((p) => p.id === "youtube")!;
  v.publishing.youtube.format = "shorts";
  assert.equal(coverRuleFor(v, yt).mode, "independent");
  assert.match(coverRuleFor(v, yt).note, /分别保存/);
  assert.equal(coverRuleFor(v, { ...yt, composer: "chat" }).mode, "none");
});

test("publication text keeps links, chapters, tags and explicit message order consistent", () => {
  const v = variantSchema.parse({
    id: uuid(),
    platform: "youtube",
    locale: "zh-CN",
    title: "标题",
    body: "介绍",
    tags: ["教程"],
    assetIds: [],
    coverId: null,
    segments: [],
    revision: 1,
    bodyHash: "",
    readiness: "draft",
  });
  const youtube = defaultPlatforms.find((p) => p.id === "youtube")!;
  v.publishing.youtube.chapters = "00:00 开场\n00:30 演示\n02:00 总结";
  assert.equal(
    publicationBody(v, youtube),
    "介绍\n\n00:00 开场\n00:30 演示\n02:00 总结",
  );
  assert.equal(
    publicationWarnings(v, youtube, []).some((w) => w.includes("章节")),
    false,
  );
  v.publishing.youtube.chapters = "00:00 开场\n00:05 太短\n00:02 倒序";
  assert.equal(
    publicationWarnings(v, youtube, []).some((w) => w.includes("章节")),
    true,
  );
  v.publishing.youtube.format = "shorts";
  assert.equal(publicationBody(v, youtube), "介绍");
  const facebook = defaultPlatforms.find((p) => p.id === "facebook")!;
  v.platform = "facebook";
  v.publishing.facebook = {
    format: "link",
    linkUrl: "https://example.com",
    linkTitle: "链接",
    audience: "朋友",
  };
  assert.equal(
    publicationBody(v, facebook),
    "介绍\n\nhttps://example.com\n\n#教程",
  );
  v.body = "介绍 https://example.com";
  assert.equal(
    publicationBody(v, facebook).match(/https:\/\/example.com/g)?.length,
    1,
  );
  const wechat = defaultPlatforms.find((p) => p.id === "wechat")!;
  v.platform = "wechat";
  v.body = "开场\n\n正文";
  v.tags = [];
  v.publishing = defaultPublishing();
  assert.deepEqual(splitMessages(v, wechat, []), [
    { type: "text", text: "开场" },
    { type: "text", text: "正文" },
  ]);
  v.segments = [{ type: "text", text: "独立修改的消息段" }];
  assert.deepEqual(publicationSegments(v, wechat, []), v.segments);
});
test("Range handles full, bounded, suffix, large, and invalid requests", () => {
  assert.equal(parseRange(null, 12), null);
  assert.deepEqual(parseRange("bytes=4-8", 12), { start: 4, end: 8 });
  assert.deepEqual(parseRange("bytes=-5", 12), { start: 7, end: 11 });
  assert.deepEqual(parseRange("bytes=2147483640-", 2147483650), {
    start: 2147483640,
    end: 2147483649,
  });
  assert.deepEqual(parseRange("bytes=0-99", 12), { start: 0, end: 11 });
  for (const range of [
    "bytes=12-",
    "bytes=8-3",
    "bytes=-0",
    "bytes=",
    "bytes=1-2,3-4",
    "bytes=NaN-",
    "bytes=9007199254740992-",
  ])
    assert.throws(() => parseRange(range, 12));
  assert.throws(() => parseRange("bytes=0-", 0));
});
test("path boundary rejects traversal and junctions", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "workbench-path-"));
  const project = path.join(root, "project");
  const other = path.join(root, "other");
  mkdirSync(project);
  mkdirSync(other);
  assert.equal(within(project, project + "-outside"), false);
  assert.throws(() => safePath(project, "../other"));
  symlinkSync(other, path.join(project, "link"), "junction");
  assert.throws(() => safePath(project, "link/private.txt"));
});
test("Codex JSONL decoder handles split UTF-8, multiple lines, duplicate and unknown events", () => {
  const parser = new JsonLines();
  const actual: unknown[] = [];
  parser.on("message", (m) => actual.push(m));
  const messages = [
    { method: "item/agentMessage/delta", params: { delta: "中文" } },
    { method: "new/unknown", params: {} },
    { method: "new/unknown", params: {} },
  ];
  const buffer = Buffer.from(
    messages.map((m) => JSON.stringify(m)).join("\n") + "\n",
  );
  for (let i = 0; i < buffer.length; i += 3)
    parser.push(buffer.subarray(i, i + 3));
  assert.deepEqual(actual, messages);
  let invalid = 0;
  parser.on("invalid", () => invalid++);
  parser.push(Buffer.from("garbled\n"));
  assert.equal(invalid, 1);
});
test("schema permits custom platform IDs but rejects malformed IDs and incomplete variants", () => {
  assert.equal(platformIdSchema.safeParse(`custom_${uuid()}`).success, true);
  for (const id of ["", "../wechat", "has spaces", "a".repeat(65)])
    assert.equal(platformIdSchema.safeParse(id).success, false);
  assert.equal(
    variantSchema.safeParse({ id: uuid(), platform: "unknown" }).success,
    false,
  );
  assert.throws(() => findCodex("C:/missing-codex-app/codex.exe"));
});
test("captured CLI events replay through partial UTF-8 chunks", () => {
  const input = readFileSync(
    new URL("./fixtures/codex-events.jsonl", import.meta.url),
  );
  const expected = input
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const actual: unknown[] = [];
  const parser = new JsonLines();
  parser.on("message", (m) => actual.push(m));
  for (let i = 0; i < input.length; i += 11)
    parser.push(input.subarray(i, i + 11));
  assert.deepEqual(actual, expected);
  assert.ok(expected.some((e) => e.method === "turn/completed"));
});
