import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer as createSocketServer, createConnection } from "node:net";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "vite";
import electron from "electron";

const root = realpathSync(process.cwd());
const id = createHash("sha256")
  .update(process.platform === "win32" ? root.toLowerCase() : root)
  .digest("hex")
  .slice(0, 20);
const endpoint =
  process.platform === "win32"
    ? `\\\\.\\pipe\\content-workbench-dev-${id}`
    : path.join(os.tmpdir(), `content-workbench-dev-${id}.sock`);
let child;
const instance = createSocketServer((socket) => {
  socket.on("error", () => {});
  // The private local channel only activates the existing application.
  if (child?.connected) child.send({ type: "workbench:focus" });
  socket.end(
    "Content Workbench DEV is already running. Activated existing window.\n",
  );
});
try {
  await new Promise((resolve, reject) => {
    instance.once("error", reject);
    instance.listen(endpoint, resolve);
  });
} catch (error) {
  if (error.code !== "EADDRINUSE") throw error;
  await new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    socket.setTimeout(5000, () =>
      socket.destroy(new Error("Existing DEV instance did not respond.")),
    );
    socket.on("data", (data) => process.stdout.write(data));
    socket.on("end", resolve);
    socket.on("error", reject);
  });
  process.exit(0);
}
let server;
try {
  await import("./build.mjs");
  server = await createServer({
    server: { host: "127.0.0.1", port: 5173, strictPort: false },
  });
  await server.listen();
  server.printUrls();
  const address = server.httpServer.address();
  const env = {
    ...process.env,
    WORKBENCH_DEV_URL: `http://127.0.0.1:${address.port}`,
    WORKBENCH_AUTO_CONNECT_CODEX: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  child = spawn(electron, ["."], {
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    windowsHide: true,
    env,
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  process.exitCode = code;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await server?.close();
  instance.close();
}
