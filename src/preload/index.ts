import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { Result, WorkbenchApi, AppEvent } from "../contracts/model";
const api: WorkbenchApi = {
  async call<T>(method: string, input?: unknown) {
    const r = (await ipcRenderer.invoke("workbench:call", {
      method,
      input,
    })) as Result<T>;
    if (!r.ok) {
      const error = Object.assign(new Error(r.error.message), r.error);
      throw error;
    }
    return r.data;
  },
  onEvent(callback) {
    const handler = (_event: unknown, event: AppEvent) => callback(event);
    ipcRenderer.on("workbench:event", handler);
    return () => ipcRenderer.removeListener("workbench:event", handler);
  },
  filePaths(files) {
    return files.map((f) => webUtils.getPathForFile(f)).filter(Boolean);
  },
};
contextBridge.exposeInMainWorld("workbench", api);
