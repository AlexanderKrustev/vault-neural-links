/**
 * Desktop-app renderer logic — bundled by esbuild (see esbuild.config.mjs)
 * into renderer/bundle.js, since this is the first piece of the app that
 * needs an npm dependency (@vault-neural-links/render-core) inside the
 * renderer process; everything before this was plain unbundled HTML/JS.
 */
import { ForceSim, Renderer, type NativeEdge } from "@vault-neural-links/render-core";
import type { LinkWeightsFile, SearchHit, ActivatedNote, ActivationTraceEvent } from "@vault-neural-links/core";

interface FolderEdge {
  source: string;
  target: string;
}

interface FolderSummary {
  folderPath: string;
  noteCount: number;
  edgeCount: number;
  notes: { id: string; neighborCount: number }[];
  edges: FolderEdge[];
}

interface LoginResult {
  ok: boolean;
  reason?: string;
}

interface ActivateResponse {
  result: ActivatedNote[];
  events: ActivationTraceEvent[];
}

type SourceType = "okf" | "obsidian";

interface Workspace {
  folderPath: string;
  sourceType: SourceType;
}

interface VnlApi {
  getSession(): Promise<unknown | null>;
  login(email: string, password: string): Promise<LoginResult>;
  logout(): Promise<{ ok: boolean }>;
  getWorkspace(): Promise<Workspace | null>;
  setWorkspace(folderPath: string, sourceType: SourceType): Promise<{ ok: boolean }>;
  pickFolder(): Promise<string | null>;
  loadFolder(folderPath: string, sourceType: SourceType): Promise<FolderSummary>;
  search(folderPath: string, query: string): Promise<SearchHit[]>;
  activate(folderPath: string, note: string, energy?: number): Promise<ActivateResponse>;
  getPrimed(folderPath: string): Promise<string[]>;
}

declare global {
  interface Window {
    vnl: VnlApi;
  }
}

const setupScreen = document.getElementById("setupScreen")!;
const loginScreen = document.getElementById("loginScreen")!;
const appScreen = document.getElementById("appScreen")!;
const emailEl = document.getElementById("email") as HTMLInputElement;
const passwordEl = document.getElementById("password") as HTMLInputElement;
const loginBtn = document.getElementById("loginBtn") as HTMLButtonElement;
const loginErrorEl = document.getElementById("loginError")!;
const logoutBtn = document.getElementById("logoutBtn")!;

const chooseOkfBtn = document.getElementById("chooseOkfBtn")!;
const chooseObsidianBtn = document.getElementById("chooseObsidianBtn")!;
const setupErrorEl = document.getElementById("setupError")!;
const switchSourceBtn = document.getElementById("switchSourceBtn")!;

const folderPathEl = document.getElementById("folderPath")!;
const summaryEl = document.getElementById("summary")!;
const notesEl = document.getElementById("notes")!;
const errorEl = document.getElementById("error")!;
const graphCanvas = document.getElementById("graphCanvas") as HTMLCanvasElement;
const searchInput = document.getElementById("searchInput") as HTMLInputElement;
const searchBtn = document.getElementById("searchBtn") as HTMLButtonElement;
const searchResultsEl = document.getElementById("searchResults")!;
const activationInfoEl = document.getElementById("activationInfo")!;
const primedListEl = document.getElementById("primedList")!;

function showApp() {
  setupScreen.style.display = "none";
  loginScreen.style.display = "none";
  appScreen.style.display = "block";
}

function showLogin() {
  setupScreen.style.display = "none";
  loginScreen.style.display = "block";
  appScreen.style.display = "none";
}

function showSetup() {
  setupScreen.style.display = "block";
  loginScreen.style.display = "none";
  appScreen.style.display = "none";
}

async function attemptLogin() {
  loginErrorEl.textContent = "";
  const email = emailEl.value.trim();
  const password = passwordEl.value;
  if (!email || !password) {
    loginErrorEl.textContent = "Enter both email and password.";
    return;
  }
  loginBtn.disabled = true;
  try {
    const result = await window.vnl.login(email, password);
    if (result.ok) {
      await enterAppOrSetup();
    } else {
      loginErrorEl.textContent = result.reason || "Login failed.";
    }
  } finally {
    loginBtn.disabled = false;
  }
}

loginBtn.addEventListener("click", attemptLogin);
passwordEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") attemptLogin();
});

logoutBtn.addEventListener("click", async () => {
  await window.vnl.logout();
  emailEl.value = "";
  passwordEl.value = "";
  showLogin();
});

(async function initSession() {
  const session = await window.vnl.getSession();
  if (session) {
    await enterAppOrSetup();
  } else {
    showLogin();
  }
})();

function stat(n: number, label: string): HTMLDivElement {
  const div = document.createElement("div");
  div.className = "stat";
  div.innerHTML = `<div class="n">${n}</div><div class="label">${label}</div>`;
  return div;
}

// No usage-weight layer exists yet in the desktop app (that only
// accumulates via MCP tool calls) — an empty LinkWeightsFile means the
// graph renders purely from structural (native) edges, same as a brand-new
// vault with no usage history.
const EMPTY_WEIGHTS: LinkWeightsFile = { version: 1, compactedAt: new Date().toISOString(), edges: {} };

let sim: ForceSim | null = null;
let renderer: Renderer | null = null;
let currentFolderPath: string | null = null;

function renderGraph(result: FolderSummary): void {
  if (!sim) {
    sim = new ForceSim();
    renderer = new Renderer(graphCanvas, sim);
    renderer.start();
    // Clicking a node in the graph is the same "activate from here" action
    // as clicking a search result — both funnel through activateFrom.
    renderer.onNodeClicked((id) => {
      void activateFrom(id);
    });
  }
  const nativeEdges: NativeEdge[] = result.edges.map((e) => ({ source: e.source, target: e.target }));
  sim.setData(
    result.notes.map((n) => n.id),
    EMPTY_WEIGHTS,
    nativeEdges,
  );
}

/** Re-reads the session-buffer file engine:primed exposes and reflects it in both the text chip list and the graph's dashed warm ring. */
async function refreshPrimed(): Promise<void> {
  if (!currentFolderPath) return;
  const primed = await window.vnl.getPrimed(currentFolderPath);
  primedListEl.innerHTML = primed.length > 0 ? primed.map((id) => `<span>${id}</span>`).join("") : "(none yet)";
  renderer?.setPrimedNotes(new Set(primed));
}

const HOP_STAGGER_MS = 350;

/**
 * Runs real spreading activation from `note` via the engine (no mock —
 * the exact same activate() the MCP `activate` tool calls) and animates
 * the result: node/edge pulses staggered by hop so it reads as energy
 * spreading outward, not everything lighting up at once.
 */
async function activateFrom(note: string): Promise<void> {
  if (!currentFolderPath || !sim || !renderer) return;
  activationInfoEl.textContent = `Activating from ${note}…`;

  const { result, events } = await window.vnl.activate(currentFolderPath, note, 10);

  const byHop = new Map<number, ActivationTraceEvent[]>();
  for (const event of events) {
    const list = byHop.get(event.hop) ?? [];
    list.push(event);
    byHop.set(event.hop, list);
  }
  for (const [hop, hopEvents] of byHop) {
    setTimeout(() => {
      for (const event of hopEvents) {
        if (event.type === "node_activated" && event.node) {
          sim!.markNodeActivated(event.node, hop);
        } else if (event.type === "edge_traversed" && event.from && event.to) {
          sim!.markEdgeTraversed(event.from, event.to);
          renderer!.pulseEdgeDirectional(event.from, event.to);
        }
      }
    }, hop * HOP_STAGGER_MS);
  }

  const sorted = [...result].sort((a, b) => a.hops - b.hops || b.energy - a.energy);
  activationInfoEl.textContent =
    sorted.length > 0
      ? `Activated ${sorted.length} note${sorted.length === 1 ? "" : "s"} from ${note}:\n` +
        sorted.map((n) => `  ${n.path}  (hop ${n.hops}, energy ${n.energy.toFixed(2)})`).join("\n")
      : `No notes activated from ${note} (isolated, or below the energy threshold).`;

  await refreshPrimed();
}

function renderSearchResults(hits: SearchHit[]): void {
  searchResultsEl.innerHTML = "";
  if (hits.length === 0) {
    searchResultsEl.innerHTML = "<li>No matches.</li>";
    return;
  }
  for (const hit of hits) {
    const li = document.createElement("li");
    const weightLabel = hit.weight !== undefined ? ` · weight ${hit.weight.toFixed(2)}` : "";
    li.innerHTML = `<span>${hit.path}</span><span class="matched">${hit.matched}${weightLabel}</span>`;
    li.addEventListener("click", () => void activateFrom(hit.path));
    searchResultsEl.appendChild(li);
  }
}

async function doSearch(): Promise<void> {
  if (!currentFolderPath) return;
  const query = searchInput.value.trim();
  if (!query) return;
  const hits = await window.vnl.search(currentFolderPath, query);
  renderSearchResults(hits);
  await refreshPrimed();
}

searchBtn.addEventListener("click", () => void doSearch());
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") void doSearch();
});

/**
 * Loads a folder with the given adapter type and renders everything —
 * summary stats, note list, graph, and a reset of the search/activation
 * panels. Shared by the setup screen's first-time picker and by
 * enterAppOrSetup's silent auto-load of a previously-configured workspace.
 */
async function loadAndShowFolder(folderPath: string, sourceType: SourceType, opts: { persist?: boolean } = {}): Promise<void> {
  errorEl.textContent = "";
  currentFolderPath = folderPath;
  folderPathEl.textContent = `${folderPath}  (${sourceType === "obsidian" ? "Obsidian vault" : "OKF folder"})`;
  summaryEl.innerHTML = "";
  notesEl.innerHTML = "<li>Loading…</li>";

  try {
    const result = await window.vnl.loadFolder(folderPath, sourceType);
    if (opts.persist) {
      // Validate before committing: a folder with no .md files loads "successfully" (0
      // notes, empty graph) rather than throwing, so without this check a first-time pick
      // of the wrong folder — or the right folder but the wrong source type — would get
      // persisted as the workspace and greet the user with an empty app on every relaunch.
      // A silently-resumed workspace (opts.persist unset) is deliberately not re-validated
      // this way — an existing vault that's temporarily empty shouldn't get evicted.
      if (result.noteCount === 0) {
        throw new Error(`No .md files found in "${folderPath}". Pick a folder that contains your notes.`);
      }
      await window.vnl.setWorkspace(folderPath, sourceType);
    }

    summaryEl.innerHTML = "";
    summaryEl.appendChild(stat(result.noteCount, "notes"));
    summaryEl.appendChild(stat(result.edgeCount, "edges"));

    notesEl.innerHTML = "";
    for (const note of result.notes) {
      const li = document.createElement("li");
      li.innerHTML = `<span>${note.id}</span><span class="count">${note.neighborCount} link${note.neighborCount === 1 ? "" : "s"}</span>`;
      notesEl.appendChild(li);
    }
    if (result.notes.length === 0) {
      notesEl.innerHTML = "<li>No .md files found in this folder.</li>";
    }

    renderGraph(result);
    searchResultsEl.innerHTML = "";
    activationInfoEl.textContent = "Click a node in the graph, or a search result, to run spreading activation from it.";
    await refreshPrimed();
    showApp();
  } catch (err) {
    // Surface the failure on the setup screen, not #error inside #appScreen — appScreen is
    // still display:none at this point on a silently-resumed workspace that no longer loads
    // (folder moved/deleted/renamed), which used to leave the user stuck looking at a blank
    // or stale screen with no way to recover. The setup screen is always reachable and its
    // buttons let them pick a new source right away.
    const message = String(err && (err as Error).message ? (err as Error).message : err);
    notesEl.innerHTML = "";
    showSetup();
    setupErrorEl.textContent = `Couldn't load "${folderPath}": ${message}`;
  }
}

/** After login (or on relaunch with an existing session): silently resume the last workspace, or send a first-time user to the setup screen. */
async function enterAppOrSetup(): Promise<void> {
  const workspace = await window.vnl.getWorkspace();
  if (workspace) {
    await loadAndShowFolder(workspace.folderPath, workspace.sourceType);
  } else {
    showSetup();
  }
}

async function chooseSource(sourceType: SourceType): Promise<void> {
  setupErrorEl.textContent = "";
  const folderPath = await window.vnl.pickFolder();
  if (!folderPath) return;
  // Persist the workspace choice only once the load actually succeeds (inside
  // loadAndShowFolder) — persisting it upfront meant a bad pick (wrong adapter for the
  // folder, empty folder, etc.) got written to disk and then silently re-attempted and
  // re-failed on every relaunch via enterAppOrSetup.
  await loadAndShowFolder(folderPath, sourceType, { persist: true });
}

chooseOkfBtn.addEventListener("click", () => void chooseSource("okf"));
chooseObsidianBtn.addEventListener("click", () => void chooseSource("obsidian"));
switchSourceBtn.addEventListener("click", () => showSetup());
