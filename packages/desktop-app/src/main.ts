/**
 * Desktop-app shell (AIBRAIN-62/63 first slice) — proves the core
 * architectural bet before anything else gets built on top of it:
 * `@vault-neural-links/core` (Node/TS, real fs/path/crypto usage) runs
 * unmodified inside an Electron main process via plain `require`, the
 * same property `AblationPanel.ts` already relies on in the Obsidian
 * plugin. No chat, no owned API key, no bundled MCP server yet — this is
 * just "open an OKF folder, run the real engine against it, render the
 * result" end to end.
 */
import { app, BrowserWindow, ipcMain, dialog } from "electron";
import { join } from "node:path";
import {
  createOkfAdapter,
  buildStructuralIndex,
  type StructuralLinksFile,
} from "@vault-neural-links/core";
import { createMockValidator, readSession, writeSession, clearSession } from "./auth.js";

interface FolderSummary {
  folderPath: string;
  noteCount: number;
  edgeCount: number;
  notes: { id: string; neighborCount: number }[];
}

function summarize(folderPath: string, index: StructuralLinksFile, noteIds: string[]): FolderSummary {
  const notes = noteIds
    .map((id) => ({ id, neighborCount: index.edges[id]?.length ?? 0 }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edgeCount = Object.values(index.edges).reduce((sum, n) => sum + n.length, 0) / 2;
  return { folderPath, noteCount: noteIds.length, edgeCount, notes };
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    title: "Vault Neural Links",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(join(__dirname, "..", "renderer", "index.html"));
}

app.whenReady().then(() => {
  const validator = createMockValidator();
  const sessionPath = join(app.getPath("userData"), "session.json");

  ipcMain.handle("auth:get-session", async () => readSession(sessionPath));

  ipcMain.handle("auth:login", async (_event, email: string, password: string) => {
    const result = await validator.login(email, password);
    if (result.ok && result.session) await writeSession(sessionPath, result.session);
    return result;
  });

  ipcMain.handle("auth:logout", async () => {
    await clearSession(sessionPath);
    return { ok: true };
  });

  ipcMain.handle("okf:pick-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("okf:load-folder", async (_event, folderPath: string): Promise<FolderSummary> => {
    const adapter = createOkfAdapter(folderPath);
    const nodes = await adapter.listNodes();
    const index = await buildStructuralIndex(folderPath, adapter);
    return summarize(
      folderPath,
      index,
      nodes.map((n) => n.id),
    );
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
