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
import { readFile, writeFile } from "node:fs/promises";
import {
  createOkfAdapter,
  createObsidianAdapter,
  buildStructuralIndex,
  rebuildStructuralIndex,
  initInstance,
  searchNotes,
  resolveDataDir,
  sessionBufferFilePath,
  type SourceAdapter,
  type StructuralLinksFile,
  type VaultLinkClient,
  type ActivationTraceEvent,
} from "@vault-neural-links/core";

/**
 * "obsidian" reuses the exact same adapter/dual-syntax-link behavior the
 * plugin gets — pointing this app at an existing Obsidian vault instead of
 * migrating to OKF is a first-class, equally-supported choice, not a
 * lesser fallback. More sources (Confluence, Azure Wiki, Word — AIBRAIN-34)
 * land in later versions; the setup screen shows them as coming soon.
 */
type SourceType = "okf" | "obsidian";

function createAdapter(folderPath: string, sourceType: SourceType): SourceAdapter {
  return sourceType === "obsidian" ? createObsidianAdapter(folderPath) : createOkfAdapter(folderPath);
}

interface Workspace {
  folderPath: string;
  sourceType: SourceType;
}
import { createMockValidator, readSession, writeSession, clearSession } from "./auth.js";

/**
 * Fixed instance id (rather than initInstance's default random UUID) so the
 * session-buffer file it persists to `.vault-neural-links/session/` has a
 * predictable path — engine:primed reads that same file back to show the
 * UI what's currently primed. One shared engine session for whichever
 * folder is currently open; the desktop app only ever has one open at a
 * time (unlike the MCP server, which serves concurrent sessions).
 */
const ENGINE_INSTANCE_ID = "desktop-app";

interface EngineSession {
  folderPath: string;
  client: VaultLinkClient;
}

let currentSession: EngineSession | null = null;

function getSession(folderPath: string): EngineSession {
  if (!currentSession || currentSession.folderPath !== folderPath) {
    currentSession = { folderPath, client: initInstance(folderPath, ENGINE_INSTANCE_ID) };
  }
  return currentSession;
}

interface FolderSummary {
  folderPath: string;
  noteCount: number;
  edgeCount: number;
  notes: { id: string; neighborCount: number }[];
  /** Deduped undirected edge list (each pair once, not both directions) — for the renderer's ForceSim/Renderer graph. */
  edges: { source: string; target: string }[];
}

function summarize(folderPath: string, index: StructuralLinksFile, noteIds: string[]): FolderSummary {
  const notes = noteIds
    .map((id) => ({ id, neighborCount: index.edges[id]?.length ?? 0 }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edgeCount = Object.values(index.edges).reduce((sum, n) => sum + n.length, 0) / 2;

  // buildStructuralIndex's adjacency is undirected but stored both ways
  // (a->b and b->a) — dedup to one pair per edge for the renderer.
  const seen = new Set<string>();
  const edges: { source: string; target: string }[] = [];
  for (const [source, neighbors] of Object.entries(index.edges)) {
    for (const target of neighbors) {
      const key = source < target ? `${source}|${target}` : `${target}|${source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target });
    }
  }

  return { folderPath, noteCount: noteIds.length, edgeCount, notes, edges };
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

  const workspacePath = join(app.getPath("userData"), "workspace.json");

  ipcMain.handle("workspace:get", async (): Promise<Workspace | null> => {
    try {
      return JSON.parse(await readFile(workspacePath, "utf8")) as Workspace;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  });

  ipcMain.handle("workspace:set", async (_event, folderPath: string, sourceType: SourceType) => {
    await writeFile(workspacePath, JSON.stringify({ folderPath, sourceType } satisfies Workspace, null, 2), "utf8");
    return { ok: true };
  });

  ipcMain.handle("workspace:pick-folder", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle(
    "workspace:load-folder",
    async (_event, folderPath: string, sourceType: SourceType): Promise<FolderSummary> => {
      const adapter = createAdapter(folderPath, sourceType);
      const nodes = await adapter.listNodes();
      const index = await buildStructuralIndex(folderPath, adapter);

      // Persist structural-links.json with the *chosen* adapter — activate()/
      // getWeightedNeighbors's structural-fallback tier reads this file from
      // disk, it doesn't take an in-memory index. Without this, spreading
      // activation silently returns nothing for any folder that's never had
      // its structural index persisted before.
      await rebuildStructuralIndex(folderPath, resolveDataDir(folderPath), adapter);

      return summarize(
        folderPath,
        index,
        nodes.map((n) => n.id),
      );
    },
  );

  ipcMain.handle("engine:search", async (_event, folderPath: string, query: string) => {
    const session = getSession(folderPath);
    const vaultDataDir = resolveDataDir(folderPath);
    const hits = await searchNotes(folderPath, query, { vaultDataDir, useWeights: true, topK: 10 });
    // Searching primes the hits (session-only touch, no persisted weight
    // change) and logs the search happened — same as the MCP search_notes
    // tool's behavior, just called directly instead of through an AI client.
    if (hits.length > 0) await session.client.touch(...hits.map((h) => h.path));
    await session.client.logSearch(query, hits.length, true);
    return hits;
  });

  ipcMain.handle("engine:activate", async (_event, folderPath: string, note: string, energy: number = 10) => {
    const session = getSession(folderPath);
    const events: ActivationTraceEvent[] = [];
    const result = await session.client.activate(note, energy, undefined, (e) => events.push(e));
    return { result, events };
  });

  ipcMain.handle("engine:primed", async (_event, folderPath: string): Promise<string[]> => {
    const vaultDataDir = resolveDataDir(folderPath);
    const filePath = sessionBufferFilePath(vaultDataDir, ENGINE_INSTANCE_ID);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as { notes: string[] };
      return parsed.notes;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
