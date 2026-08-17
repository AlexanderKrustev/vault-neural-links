import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("vnl", {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("okf:pick-folder"),
  loadFolder: (folderPath: string) => ipcRenderer.invoke("okf:load-folder", folderPath),
});
