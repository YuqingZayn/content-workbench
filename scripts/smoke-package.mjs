import { _electron as electron } from "@playwright/test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import path from "node:path";
const executablePath = path.resolve(
  process.argv[2] || "release/win-unpacked/Content Workbench.exe",
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
    }),
  );
} finally {
  await app.close();
}
