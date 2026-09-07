import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  mkdtemp,
  stat,
  readdir,
  writeFile,
  utimes,
  mkdir,
} from "node:fs/promises";
import sharp from "sharp";
import { ThumbnailService } from "../src/services/thumbnails";
import { fileHash, uuid } from "../src/services/files";
import type { Asset } from "../src/contracts/model";

async function setup() {
  const parent = path.resolve(".local/thumbnail-tests");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(path.join(parent, "run-"));
  const source = path.join(root, "中文 透明图片.png");
  await sharp({
    create: {
      width: 3200,
      height: 2400,
      channels: 4,
      background: { r: 80, g: 125, b: 95, alpha: 0.5 },
    },
  })
    .png({ compressionLevel: 0 })
    .toFile(source);
  const info = await stat(source);
  const asset: Asset = {
    id: uuid(),
    projectId: uuid(),
    name: "中文 透明图片.png",
    kind: "image",
    storageMode: "reference",
    path: source,
    sha256: await fileHash(source),
    bytes: info.size,
    mime: "image/png",
    modifiedMs: info.mtimeMs,
    tags: [],
  };
  const cache = path.join(root, "cache");
  const create = () =>
    new ThumbnailService(cache, path.resolve("dist/main/thumbnail-worker.cjs"));
  return { source, asset, cache, create };
}

test("large images produce bounded previews, share work, and reuse persisted cache after restart", async () => {
  const { source, asset, cache, create } = await setup();
  const service = create();
  try {
    const before = await fileHash(source);
    const outputs = await Promise.all(
      Array.from({ length: 8 }, () => service.get(source, asset, 512)),
    );
    assert.equal(new Set(outputs.map((output) => output.file)).size, 1);
    assert.equal((await readdir(cache)).length, 1);
    const info = await sharp(outputs[0].file).metadata();
    assert.equal(info.width, 512);
    assert.equal(info.height, 384);
    assert.equal(info.hasAlpha, true);
    assert.ok((await stat(outputs[0].file)).size < asset.bytes / 100);
    const detailed = await service.get(source, asset, 1600);
    assert.equal((await sharp(detailed.file).metadata()).width, 1600);
    assert.notEqual(detailed.etag, outputs[0].etag);
    assert.equal(await fileHash(source), before);
    service.close();
    const reopened = create();
    try {
      assert.equal((await reopened.get(source, asset, 512)).cached, true);
    } finally {
      reopened.close();
    }
  } finally {
    service.close();
  }
});

test("changed originals invalidate previews and corrupt inputs cannot poison the queue", async () => {
  const { source, asset, create } = await setup();
  const service = create();
  try {
    const previous = await service.get(source, asset, 512);
    const date = new Date(asset.modifiedMs + 10000);
    await utimes(source, date, date);
    await assert.rejects(service.get(source, asset, 512), /changed/);
    const updated = { ...asset, modifiedMs: (await stat(source)).mtimeMs };
    const next = await service.get(source, updated, 512);
    assert.notEqual(next.etag, previous.etag);
    const invalid = path.join(path.dirname(source), "corrupt.png");
    await writeFile(invalid, "not an image");
    const badInfo = await stat(invalid);
    await assert.rejects(
      service.get(
        invalid,
        {
          ...asset,
          path: invalid,
          bytes: badInfo.size,
          modifiedMs: badInfo.mtimeMs,
        },
        512,
      ),
    );
    assert.equal((await service.get(source, updated, 512)).cached, true);
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      service.get(source, updated, 512, controller.signal),
      /cancelled/,
    );
  } finally {
    service.close();
  }
});
