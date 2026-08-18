import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vnl", {
  getSession: () => ipcRenderer.invoke("auth:get-session"),
  login: () => ipcRenderer.invoke("auth:login"),
  logout: () => ipcRenderer.invoke("auth:logout"),

  getWorkspace: () => ipcRenderer.invoke("workspace:get"),
  setWorkspace: (folderPath: string, sourceType: string) =>
    ipcRenderer.invoke("workspace:set", folderPath, sourceType),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("workspace:pick-folder"),
  loadFolder: (folderPath: string, sourceType: string) =>
    ipcRenderer.invoke("workspace:load-folder", folderPath, sourceType),

  search: (folderPath: string, query: string) => ipcRenderer.invoke("engine:search", folderPath, query),
  activate: (folderPath: string, note: string, energy?: number) =>
    ipcRenderer.invoke("engine:activate", folderPath, note, energy),
  getPrimed: (folderPath: string) => ipcRenderer.invoke("engine:primed", folderPath),
});
