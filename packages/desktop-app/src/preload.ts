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

  readNote: (folderPath: string, notePath: string) => ipcRenderer.invoke("notes:read", folderPath, notePath),
  createNote: (folderPath: string, notePath: string, frontmatter: Record<string, unknown>, body: string) =>
    ipcRenderer.invoke("notes:create", folderPath, notePath, frontmatter, body),
  saveNote: (folderPath: string, notePath: string, body: string) =>
    ipcRenderer.invoke("notes:save", folderPath, notePath, body),
});
