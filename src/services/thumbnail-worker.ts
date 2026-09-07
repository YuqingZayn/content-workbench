import { parentPort } from "node:worker_threads";
import sharp from "sharp";

// Each worker handles one image; keep libvips from multiplying CPU/memory usage.
sharp.concurrency(1);
sharp.cache({ memory: 16, files: 0, items: 20 });
parentPort!.on("message", async ({ source, destination, edge }) => {
  try {
    await sharp(source, { sequentialRead: true, limitInputPixels: 512_000_000 })
      .autoOrient()
      .resize(edge, edge, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 2 })
      .timeout({ seconds: 45 })
      .toFile(destination);
    parentPort!.postMessage({ ok: true });
  } catch (error) {
    parentPort!.postMessage({ ok: false, error: (error as Error).message });
  }
});
