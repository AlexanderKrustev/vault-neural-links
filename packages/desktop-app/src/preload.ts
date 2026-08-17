import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vnl", {
  getSession: () => ipcRenderer.invoke("auth:get-session"),
  login: (email: string, password: string) => ipcRenderer.invoke("auth:login", email, password),
  logout: () => ipcRenderer.invoke("auth:logout"),

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("okf:pick-folder"),
  loadFolder: (folderPath: string) => ipcRenderer.invoke("okf:load-folder", folderPath),
});
