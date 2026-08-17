/**
 * Desktop-app renderer logic — bundled by esbuild (see esbuild.config.mjs)
 * into renderer/bundle.js, since this is the first piece of the app that
 * needs an npm dependency (@vault-neural-links/render-core) inside the
 * renderer process; everything before this was plain unbundled HTML/JS.
 */
import { ForceSim, Renderer, type NativeEdge } from "@vault-neural-links/render-core";
import type { LinkWeightsFile } from "@vault-neural-links/core";

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

interface VnlApi {
  getSession(): Promise<unknown | null>;
  login(email: string, password: string): Promise<LoginResult>;
  logout(): Promise<{ ok: boolean }>;
  pickFolder(): Promise<string | null>;
  loadFolder(folderPath: string): Promise<FolderSummary>;
}

declare global {
  interface Window {
    vnl: VnlApi;
  }
}

const loginScreen = document.getElementById("loginScreen")!;
const appScreen = document.getElementById("appScreen")!;
const emailEl = document.getElementById("email") as HTMLInputElement;
const passwordEl = document.getElementById("password") as HTMLInputElement;
const loginBtn = document.getElementById("loginBtn") as HTMLButtonElement;
const loginErrorEl = document.getElementById("loginError")!;
const logoutBtn = document.getElementById("logoutBtn")!;

const openBtn = document.getElementById("openBtn")!;
const folderPathEl = document.getElementById("folderPath")!;
const summaryEl = document.getElementById("summary")!;
const notesEl = document.getElementById("notes")!;
const errorEl = document.getElementById("error")!;
const graphCanvas = document.getElementById("graphCanvas") as HTMLCanvasElement;

function showApp() {
  loginScreen.style.display = "none";
  appScreen.style.display = "block";
}

function showLogin() {
  loginScreen.style.display = "block";
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
      showApp();
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
    showApp();
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

function renderGraph(result: FolderSummary): void {
  if (!sim) {
    sim = new ForceSim();
    renderer = new Renderer(graphCanvas, sim);
    renderer.start();
  }
  const nativeEdges: NativeEdge[] = result.edges.map((e) => ({ source: e.source, target: e.target }));
  sim.setData(
    result.notes.map((n) => n.id),
    EMPTY_WEIGHTS,
    nativeEdges,
  );
}

openBtn.addEventListener("click", async () => {
  errorEl.textContent = "";
  const folderPath = await window.vnl.pickFolder();
  if (!folderPath) return;

  folderPathEl.textContent = folderPath;
  summaryEl.innerHTML = "";
  notesEl.innerHTML = "<li>Loading…</li>";

  try {
    const result = await window.vnl.loadFolder(folderPath);
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
  } catch (err) {
    errorEl.textContent = String(err && (err as Error).message ? (err as Error).message : err);
    notesEl.innerHTML = "";
  }
});
