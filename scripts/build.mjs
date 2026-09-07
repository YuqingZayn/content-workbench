import { build as esbuild } from "esbuild";
import { build as vite } from "vite";
await esbuild({
  entryPoints: ["src/main/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron", "sharp"],
  outfile: "dist/main/index.cjs",
  sourcemap: true,
});
await esbuild({
  entryPoints: ["src/services/thumbnail-worker.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["sharp"],
  outfile: "dist/main/thumbnail-worker.cjs",
});
await esbuild({
  entryPoints: ["src/preload/index.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: "dist/preload/index.cjs",
});
await vite({
  base: "./",
  build: { outDir: "dist/renderer", emptyOutDir: true },
});
