import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vnl", {
  getSession: () => ipcRenderer.invoke("auth:get-session"),
  login: (email: string, password: string) => ipcRenderer.invoke("auth:login", email, password),
  logout: () => ipcRenderer.invoke("auth:logout"),

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("okf:pick-folder"),
  loadFolder: (folderPath: string) => ipcRenderer.invoke("okf:load-folder", folderPath),

  search: (folderPath: string, query: string) => ipcRenderer.invoke("engine:search", folderPath, query),
  activate: (folderPath: string, note: string, energy?: number) =>
    ipcRenderer.invoke("engine:activate", folderPath, note, energy),
  getPrimed: (folderPath: string) => ipcRenderer.invoke("engine:primed", folderPath),
});
