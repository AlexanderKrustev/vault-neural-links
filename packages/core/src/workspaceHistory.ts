import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { EventLogEntry, WorkspaceHistoryConfig } from "./types.js";
import { DEFAULT_WORKSPACE_HISTORY_CONFIG } from "./types.js";
import { appendEvent } from "./logger.js";

const IMPORT_MARKER_FILE = "workspace-history-imported.json";

/**
 * One-time import of the navigation history Obsidian already keeps
 * (VNL-065, D9's other half). VNL-052 records what the human does *from
 * now on*; this reaches back to what they did before the plugin existed,
 * which on a vault installing the engine today is the only human signal
 * that exists at all.
 *
 * **Be clear about how much history this actually is.** Obsidian's
 * `lastOpenFiles` is a recently-opened stack, not a log: on the vault this
 * was built against it holds **46 paths**, and per-machine
 * `workspace-<host>.json` files add a few dozen more. There are **no
 * timestamps** — only order. So this imports on the order of a hundred
 * one-time edges, not months of behaviour, and it cannot say when any of
 * it happened. That is the honest ceiling on what it can be worth, and it
 * is a good deal less than "the human's navigation is 100x the agent's
 * volume" suggests when read as a claim about *history* rather than about
 * the live sensor VNL-052 already ships.
 *
 * Three consequences follow from the missing timestamps, and each is a
 * deliberate choice rather than a workaround:
 *
 * - **The events are dated at import time, not backdated.** Inventing
 *   plausible timestamps would put fabricated data into the one log the
 *   whole engine folds; being recent-but-weak is a claim the data can
 *   actually support ("these notes were among the last opened"), being
 *   dated is not.
 * - **They carry their own trigger, `history-import`**, so a fold, a usage
 *   report or a later ablation can separate imported history from observed
 *   behaviour. An imported edge is weaker evidence than one this machine
 *   watched happen, and nothing downstream should have to guess which it
 *   is looking at.
 * - **Weight below a live human open** (0.15 vs VNL-052's 0.25), because
 *   adjacency in an MRU stack is a weaker statement than two opens ten
 *   minutes apart: the stack collapses repeats and reorders on every visit.
 */
export interface WorkspaceHistoryImport {
  /** Workspace files that were read (`workspace.json` plus any per-machine ones). */
  sources: string[];
  /** Distinct note pairs credited. */
  pairCount: number;
  /** Events actually appended — pairs minus those already imported by a previous run. */
  eventCount: number;
  /** True when a previous import was found and this run did nothing (unless `force`). */
  alreadyImported: boolean;
  importedAt: string;
}

/**
 * Consecutive pairs from one workspace file's `lastOpenFiles`, in the
 * order Obsidian stores them (most recent first). Pure, so the shape of
 * the signal is testable without a vault.
 *
 * Only `.md` entries count — the stack also holds PDFs, images and
 * canvases, which are not notes and have no place in a note graph. A path
 * is normalised to the vault-relative, extension-less form the rest of the
 * engine uses. Self-pairs and duplicate pairs are dropped: an MRU stack
 * routinely holds the same note twice.
 */
export function historyPairs(lastOpenFiles: unknown): [string, string][] {
  if (!Array.isArray(lastOpenFiles)) return [];

  const notes: string[] = [];
  for (const entry of lastOpenFiles) {
    if (typeof entry !== "string") continue;
    if (!entry.toLowerCase().endsWith(".md")) continue;
    const normalized = entry.replace(/\\/g, "/").replace(/\.md$/i, "");
    if (normalized.length === 0) continue;
    notes.push(normalized);
  }

  const pairs: [string, string][] = [];
  const seen = new Set<string>();
  for (let i = 0; i + 1 < notes.length; i++) {
    const [a, b] = [notes[i], notes[i + 1]];
    if (a === b) continue;
    const key = [a, b].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push([a, b]);
  }
  return pairs;
}

/** `workspace.json` and any `workspace-<machine>.json` beside it, since a synced vault has one per machine. */
async function workspaceFiles(vaultPath: string): Promise<string[]> {
  // Not routed through resolveInsideVault: that helper exists to contain
  // *caller-supplied* paths (VNL-001) and deliberately refuses `.obsidian/`,
  // which is exactly the directory this one constant names. Nothing here
  // comes from a caller or from note content — the vault root is the only
  // input, and the filename pattern below is matched, never interpolated.
  const obsidianDir = join(resolve(vaultPath), ".obsidian");
  let entries: string[];
  try {
    entries = await readdir(obsidianDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return entries
    .filter((name) => /^workspace(-[^/\\]+)?\.json$/i.test(name))
    .sort()
    .map((name) => join(obsidianDir, name));
}

async function readMarker(vaultDataDir: string): Promise<{ importedAt: string; pairs: string[] } | null> {
  try {
    const raw = await readFile(join(vaultDataDir, IMPORT_MARKER_FILE), "utf8");
    return JSON.parse(raw) as { importedAt: string; pairs: string[] };
  } catch {
    return null;
  }
}

export interface ImportWorkspaceHistoryOptions {
  config?: WorkspaceHistoryConfig;
  /** Re-run even though a marker exists; only pairs not already credited are logged. */
  force?: boolean;
  now?: Date;
  instanceId?: string;
}

/**
 * Reads every workspace file in the vault and appends one `traverse` event
 * per consecutive note pair, once. The marker file records which pairs
 * were credited, so a `force` re-run after months of further use imports
 * only what is new rather than paying the whole stack again — the same
 * once-per-pair discipline VNL-054 uses for citations.
 */
export async function importWorkspaceHistory(
  vaultPath: string,
  vaultDataDir: string,
  options: ImportWorkspaceHistoryOptions = {},
): Promise<WorkspaceHistoryImport> {
  const config = options.config ?? DEFAULT_WORKSPACE_HISTORY_CONFIG;
  const now = options.now ?? new Date();
  const instanceId = options.instanceId ?? "workspace-history";
  const importedAt = now.toISOString();

  const marker = await readMarker(vaultDataDir);
  if (marker && !options.force) {
    return { sources: [], pairCount: 0, eventCount: 0, alreadyImported: true, importedAt: marker.importedAt };
  }

  const sources = await workspaceFiles(vaultPath);
  const alreadyCredited = new Set(marker?.pairs ?? []);
  const pairKeys = new Set<string>(alreadyCredited);
  const toLog: [string, string][] = [];

  for (const source of sources) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(source, "utf8"));
    } catch {
      // A workspace file Obsidian is mid-write on, or one from a version
      // that changed the format, must not cost the import the other files.
      continue;
    }
    const lastOpenFiles = (parsed as { lastOpenFiles?: unknown } | null)?.lastOpenFiles;
    for (const [a, b] of historyPairs(lastOpenFiles)) {
      const key = [a, b].sort().join("|");
      if (pairKeys.has(key)) continue;
      pairKeys.add(key);
      toLog.push([a, b]);
    }
  }

  for (const [from, to] of toLog) {
    const entry: EventLogEntry = {
      ts: importedAt,
      instance: instanceId,
      type: "traverse",
      from,
      to,
      weight_delta: config.importWeight,
      trigger: "history-import",
    };
    await appendEvent(vaultDataDir, instanceId, entry);
  }

  await writeFile(
    join(vaultDataDir, IMPORT_MARKER_FILE),
    JSON.stringify({ importedAt, pairs: [...pairKeys].sort() }, null, 2),
    "utf8",
  );

  return {
    sources,
    pairCount: pairKeys.size,
    eventCount: toLog.length,
    alreadyImported: false,
    importedAt,
  };
}
