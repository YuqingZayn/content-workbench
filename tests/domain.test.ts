import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseRange, safePath, uuid, within } from "../src/services/files";
import { JsonLines, findCodex } from "../src/services/codex/connection";
import { variantSchema, platformIdSchema } from "../src/contracts/model";
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
