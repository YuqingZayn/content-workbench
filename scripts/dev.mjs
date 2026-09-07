import { spawn } from "node:child_process";
import { createServer } from "vite";
import electron from "electron";
await import("./build.mjs");
const server = await createServer({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
});
await server.listen();
server.printUrls();
const env = {
  ...process.env,
  WORKBENCH_DEV_URL: "http://127.0.0.1:5173",
  WORKBENCH_AUTO_CONNECT_CODEX: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], {
  stdio: "inherit",
  windowsHide: true,
  env,
});
child.on("error", async (error) => {
  console.error(error.message);
  await server.close();
  process.exitCode = 1;
});
child.on("exit", async (code) => {
  await server.close();
  process.exit(code ?? 1);
});
