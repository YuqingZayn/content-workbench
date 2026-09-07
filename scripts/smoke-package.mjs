import { _electron as electron } from "@playwright/test";
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
} from "node:fs";
import path from "node:path";
const configuration = JSON.parse(readFileSync("package.json", "utf8"));
const executablePath = path.resolve(
  process.argv[2] ||
    path.join(
      configuration.build.directories.output,
      "win-unpacked/Content Workbench.exe",
    ),
);
const temporary = path.resolve(".local/package-smoke-runtime");
mkdirSync(temporary, { recursive: true });
mkdirSync(".local/e2e-evidence", { recursive: true });
const env = {
  ...process.env,
  WORKBENCH_USER_DATA: mkdtempSync(path.join(temporary, "user-data-")),
  TEMP: temporary,
  TMP: temporary,
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath,
  args: [],
  env,
  timeout: 45000,
});
try {
  const page = await app.firstWindow();
  await page.waitForSelector(".welcome");
  const project = mkdtempSync(path.join(temporary, "project-"));
  copyFileSync("tests/fixtures/demo-1.png", path.join(project, "image.png"));
  const workspace = await page.evaluate(
    (root) => window.workbench.call("project.open", { path: root }),
    project,
  );
  const preview = await app.evaluate(
    async ({ net }, { projectId, assetId }) => {
      const response = await net.fetch(
        `media://thumbnail/${projectId}/${assetId}`,
      );
      return {
        status: response.status,
        type: response.headers.get("content-type"),
        bytes: (await response.arrayBuffer()).byteLength,
      };
    },
    { projectId: workspace.project.id, assetId: workspace.assets[0].id },
  );
  if (preview.status !== 200 || preview.type !== "image/webp" || !preview.bytes)
    throw new Error(
      "Packaged thumbnail worker or native Sharp runtime unavailable",
    );
  const result = await app.evaluate(({ app, BrowserWindow }) => ({
    packaged: app.isPackaged,
    name: app.getName(),
    version: app.getVersion(),
    node: process.versions.node,
    electron: process.versions.electron,
    webPreferences:
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(),
  }));
  if (
    !result.packaged ||
    !result.webPreferences.contextIsolation ||
    result.webPreferences.nodeIntegration
  )
    throw new Error("Packaged app settings invalid");
  await page.screenshot({ path: ".local/e2e-evidence/packaged-welcome.png" });
  writeFileSync(
    ".local/e2e-evidence/package-smoke.json",
    JSON.stringify(
      { verifiedAt: new Date().toISOString(), ...result },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      packaged: result.packaged,
      name: result.name,
      version: result.version,
      node: result.node,
      electron: result.electron,
      rendererReady: true,
      thumbnailWorkerReady: true,
    }),
  );
} finally {
  await app.close();
}
