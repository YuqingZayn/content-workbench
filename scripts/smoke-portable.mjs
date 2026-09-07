import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  copyFileSync,
} from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
const listener = createServer();
await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
const port = listener.address().port;
await new Promise((resolve) => listener.close(resolve));
const configuration = JSON.parse(readFileSync("package.json", "utf8"));
const executable = path.resolve(
  configuration.build.directories.output,
  `Content-Workbench-Portable-${configuration.version}-x64.exe`,
);
const portableTemp = path.resolve(".local/portable-runtime");
mkdirSync(portableTemp, { recursive: true });
const env = {
  ...process.env,
  WORKBENCH_USER_DATA: mkdtempSync(path.join(portableTemp, "user-data-")),
  TEMP: portableTemp,
  TMP: portableTemp,
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  executable,
  [`--remote-debugging-port=${port}`, "--remote-debugging-address=127.0.0.1"],
  { env, windowsHide: true, stdio: "ignore" },
);
let browser;
child.on("exit", (code) => console.log("Portable launcher exit:", code));
try {
  const endpoint = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 90; i++) {
    if (child.exitCode !== null)
      throw new Error(`Portable launcher exited early: ${child.exitCode}`);
    try {
      const response = await fetch(endpoint + "/json/version");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* application still extracting */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready)
    throw new Error("Portable application did not expose its renderer in time");
  browser = await chromium.connectOverCDP(endpoint);
  const page = browser.contexts()[0].pages()[0];
  await page.waitForSelector(".welcome");
  const bootstrap = await page.evaluate(() =>
    window.workbench.call("app.bootstrap"),
  );
  if (!Array.isArray(bootstrap.recent))
    throw new Error("Portable preload IPC unavailable");
  const project = mkdtempSync(path.join(portableTemp, "project-"));
  copyFileSync("tests/fixtures/demo-1.png", path.join(project, "image.png"));
  const workspace = await page.evaluate(
    (root) => window.workbench.call("project.open", { path: root }),
    project,
  );
  await page.evaluate(
    ({ projectId, assetId }) =>
      new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(true);
        image.onerror = () =>
          reject(new Error("Portable thumbnail worker unavailable"));
        image.src = `media://thumbnail/${projectId}/${assetId}`;
      }),
    { projectId: workspace.project.id, assetId: workspace.assets[0].id },
  );
  await page.screenshot({ path: ".local/e2e-evidence/portable-welcome.png" });
  writeFileSync(
    ".local/e2e-evidence/portable-smoke.json",
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        selfExtractingPortable: true,
        rendererReady: true,
        preloadIpc: true,
        thumbnailWorkerReady: true,
      },
      null,
      2,
    ),
  );
  console.log("Portable self extraction, renderer and preload IPC passed");
  await page.evaluate(() => window.close());
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) child.kill();
}
