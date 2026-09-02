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
import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import {
  createOkfAdapter,
  createObsidianAdapter,
  buildStructuralIndex,
  rebuildStructuralIndex,
  initInstance,
  searchNotes,
  computePageRank,
  readNote,
  writeNoteWithAutoLink,
  resolveDataDir,
  sessionBufferFilePath,
  accountSessionPath,
  writeAccountSession,
  clearAccountSession,
  type NoteRef,
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


/**
 * "Bundling the MCP server into the app" (AIBRAIN-63) means: the app ships
 * @vault-neural-links/mcp-server as its own dependency, so an external MCP
 * client (Claude Code, Codex CLI, Gemini CLI, etc.) can register it by
 * pointing at a path that lives inside this app's own install — no
 * separate git-clone/npm-build of this monorepo required. It does NOT
 * change the server's operational model: each registered client still
 * spawns its own stdio subprocess exactly as `claude mcp add` does today
 * (whether a single long-lived process could instead be shared across
 * multiple registered clients is still an open, undecided question per
 * the 2026-08-18 architecture note — not resolved here).
 */
const MCP_VAULT_ENV_VAR = "CLAUDE_VAULT_PATH";

interface McpConnectionInfo {
  /** Absolute path to the bundled mcp-server's compiled entry point. */
  serverPath: string;
  /** Env var the bundled server reads for the vault/OKF folder root — surfaced so the UI's copy-paste command is actually correct, not guessed. */
  envVarName: string;
}

function bundledMcpServerPath(): string {
  // require.resolve only computes the path via Node's CJS resolution
  // algorithm — it never loads/executes the target, so this is safe even
  // though mcp-server itself is an ESM package ("type": "module").
  return require.resolve("@vault-neural-links/mcp-server");
}

interface Workspace {
  folderPath: string;
  sourceType: SourceType;
}
import { loginWithBrowser, refreshTokens, readTokens, writeTokens, clearTokens, type StoredTokens } from "./auth.js";
import { startMockIdp } from "./mockIdp.js";

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
  /** How many of `noteCount` are actually present in `notes`/`edges` below — see MAX_RENDERED_NOTES. */
  renderedNoteCount: number;
  edgeCount: number;
  notes: { id: string; neighborCount: number }[];
  /** Deduped undirected edge list (each pair once, not both directions) — for the renderer's ForceSim/Renderer graph. */
  edges: { source: string; target: string }[];
}

// The note list (one <li> per note) and ForceSim graph are both unbounded,
// synchronous renders — neither is built for more than a few thousand
// nodes. Confirmed live against sample-okf-large (300k OKF notes,
// AIBRAIN-108's scale corpus): the renderer froze for minutes building
// 300k list items, then choked handing 300k nodes to ForceSim. The
// structural-index build itself already handles 300k fine (AIBRAIN-118);
// this cap is purely about what gets rendered, not what's indexed or
// retrievable — search/activate below query the full on-disk index
// unaffected by this cap.
const MAX_RENDERED_NOTES = 500;

function summarize(folderPath: string, index: StructuralLinksFile, noteIds: string[]): FolderSummary {
  const totalEdgeCount = Object.values(index.edges).reduce((sum, n) => sum + n.length, 0) / 2;

  let renderIds = noteIds;
  if (noteIds.length > MAX_RENDERED_NOTES) {
    // Rank by the same PageRank importance score the graph's radial-star
    // layout already uses elsewhere, computed directly off the index
    // already in hand — no extra disk read, and consistent with what
    // "important" means everywhere else in the app.
    const scores = computePageRank(index);
    renderIds = [...noteIds].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0)).slice(0, MAX_RENDERED_NOTES);
  }

  const notes = renderIds
    .map((id) => ({ id, neighborCount: index.edges[id]?.length ?? 0 }))
    .sort((a, b) => a.id.localeCompare(b.id));

  // buildStructuralIndex's adjacency is undirected but stored both ways
  // (a->b and b->a) — dedup to one pair per edge for the renderer. Only
  // edges between two rendered notes make sense to draw; an edge to a
  // note outside the capped set would be a dangling reference in the graph.
  const renderSet = new Set(renderIds);
  const seen = new Set<string>();
  const edges: { source: string; target: string }[] = [];
  for (const [source, neighbors] of Object.entries(index.edges)) {
    if (!renderSet.has(source)) continue;
    for (const target of neighbors) {
      if (!renderSet.has(target)) continue;
      const key = source < target ? `${source}|${target}` : `${target}|${source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target });
    }
  }

  return { folderPath, noteCount: noteIds.length, renderedNoteCount: notes.length, edgeCount: totalEdgeCount, notes, edges };
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

app.whenReady().then(async () => {
  // Dev-only stand-in for AIBRAIN-73's real OAuth endpoint — see mockIdp.ts. Swapping
  // to the real backend later is an authHost change here, not a rewrite of the flow.
  const idp = await startMockIdp();
  const oauthConfig = { authHost: idp.authHost };
  const tokensPath = join(app.getPath("userData"), "tokens.json");

  /**
   * Returns the current tokens if the access token is still fresh, silently refreshes
   * them if it's expired (or about to be), or clears everything and returns null if
   * the refresh token itself is no longer valid — the same three-way outcome Claude
   * Code/Desktop's own token refresh has. Every refresh rewrites the cross-app
   * hand-off file too, so the Obsidian plugin's copy of the access token never goes
   * stale for longer than one refresh cycle.
   */
  async function getValidTokens(): Promise<StoredTokens | null> {
    const tokens = await readTokens(tokensPath);
    if (!tokens) return null;
    if (new Date(tokens.expiresAt).getTime() > Date.now() + 30_000) return tokens;

    try {
      const refreshed = await refreshTokens(oauthConfig, tokens.refreshToken);
      await writeTokens(tokensPath, refreshed);
      await writeAccountSession(accountSessionPath(), {
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
        email: refreshed.email,
        plan: refreshed.plan,
      });
      return refreshed;
    } catch {
      await clearTokens(tokensPath);
      await clearAccountSession(accountSessionPath());
      return null;
    }
  }

  ipcMain.handle("auth:get-session", async () => {
    const tokens = await getValidTokens();
    return tokens ? { email: tokens.email, plan: tokens.plan } : null;
  });

  ipcMain.handle("auth:login", async () => {
    const result = await loginWithBrowser(oauthConfig, (url) => shell.openExternal(url));
    if (result.ok && result.tokens) {
      await writeTokens(tokensPath, result.tokens);
      // Access token only, never the refresh token — see core's accountSession.ts.
      // This app is the single auth surface per the 2026-08-18 architecture decision;
      // this is what a future Obsidian-plugin-side check would read to skip its own
      // license-key login. Not yet consumed by the plugin (AIBRAIN-128); write half only.
      await writeAccountSession(accountSessionPath(), {
        accessToken: result.tokens.accessToken,
        expiresAt: result.tokens.expiresAt,
        email: result.tokens.email,
        plan: result.tokens.plan,
      });
    }
    return { ok: result.ok, reason: result.reason };
  });

  ipcMain.handle("auth:logout", async () => {
    await clearTokens(tokensPath);
    await clearAccountSession(accountSessionPath());
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
      // its structural index persisted before. Pass the index already built
      // above — rebuildStructuralIndex() would otherwise build it a second
      // time from scratch, doubling both the time and peak memory of this
      // handler for nothing (confirmed at 300k-note scale, AIBRAIN-118).
      await rebuildStructuralIndex(folderPath, resolveDataDir(folderPath), adapter, index);

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

  ipcMain.handle("mcp:get-connection-info", async (): Promise<McpConnectionInfo> => {
    return { serverPath: bundledMcpServerPath(), envVarName: MCP_VAULT_ENV_VAR };
  });

  ipcMain.handle("notes:read", async (_event, folderPath: string, notePath: string): Promise<NoteRef | null> => {
    return readNote(folderPath, notePath);
  });

  ipcMain.handle(
    "notes:create",
    async (
      _event,
      folderPath: string,
      notePath: string,
      frontmatter: Record<string, unknown>,
      body: string,
    ): Promise<{ ok: true; path: string; autoLinked: string[] } | { ok: false; error: string }> => {
      const existing = await readNote(folderPath, notePath);
      if (existing) return { ok: false, error: `A note already exists at "${notePath}".` };
      const result = await writeNoteWithAutoLink(folderPath, notePath, frontmatter, body, "create");
      return { ok: true, ...result };
    },
  );

  ipcMain.handle(
    "notes:save",
    async (
      _event,
      folderPath: string,
      notePath: string,
      body: string,
    ): Promise<{ ok: true; path: string; autoLinked: string[] } | { ok: false; error: string }> => {
      // The editor only ever hands back the body — frontmatter isn't
      // user-edited text in this first slice, so it's re-read from disk
      // rather than round-tripped through the renderer.
      const existing = await readNote(folderPath, notePath);
      if (!existing) return { ok: false, error: `No note found at "${notePath}".` };
      const result = await writeNoteWithAutoLink(folderPath, notePath, existing.frontmatter, body, "update");
      return { ok: true, ...result };
    },
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
