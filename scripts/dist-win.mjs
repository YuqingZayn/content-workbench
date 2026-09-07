import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
const temporary = path.resolve(".local/build-temp");
mkdirSync(temporary, { recursive: true });
const child = spawn(
  process.execPath,
  [
    "node_modules/electron-builder/cli.js",
    "--win",
    "nsis",
    "portable",
    "--x64",
    "--publish",
    "never",
  ],
  {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, TEMP: temporary, TMP: temporary },
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
