import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { decayWeight } from "./decay.js";
import { loadNoteImportance } from "./importance.js";
import { listNotes, mostRecentNotes } from "./notes.js";
import { readSupersession } from "./relations.js";
import { loadWeights } from "./query.js";

/**
 * VNL-055 — what the vault has to say before anyone asks it anything.
 *
 * Every retrieval path in this engine so far waits to be called. `recall`,
 * `activate` and `search_notes` all require the agent to decide, mid-task,
 * that consulting the vault is worth a tool call — and the measured record on
 * that is poor: `reinforce_link` was invoked zero times in its entire life
 * (AIBRAIN-69), which is why every learning signal since has been made
 * deterministic rather than voluntary. A briefing is the same idea applied to
 * retrieval: it is delivered, not requested. An MCP resource can be attached
 * by a client at session start with no model decision involved at all, and
 * resources are part of the base protocol, so this works on any client — the
 * portability commitment in D3.
 *
 * What goes in it is deliberately narrow. A briefing that tries to summarize
 * the vault is noise at the top of every session; the useful thing is a short
 * answer to "what was I doing here, and what has moved since". So: the notes
 * this project has actually used, the ones it changed most recently, and the
 * ones the vault's own link structure says are central — scoped to one
 * project, because a briefing about somebody else's project is worse than no
 * briefing.
 *
 * Note on "primed" in the plan's wording: at session start the session buffer
 * is empty by definition, so there is nothing primed to report. The durable
 * analogue is what the persisted usage graph says has been touched recently,
 * which is what `recentlyUsed` carries.
 */

/** Notes per section. Small on purpose — this is prepended to a session, not browsed. */
export const DEFAULT_BRIEFING_SECTION_SIZE = 7;

export interface BriefingNote {
  path: string;
  /** Why this note is in the briefing, as a short phrase for the reader. */
  note: string;
  /** Set when the note's frontmatter marks it superseded, so a briefing never recommends a stale decision silently. */
  supersededBy?: string;
}

export interface Briefing {
  /** The project the briefing was scoped to, or null when nothing matched. */
  project: string | null;
  /** How the project was resolved, so a wrong guess is visible rather than mysterious. */
  matchedBy: "explicit" | "cwd" | "none";
  /** Vault path prefixes the project resolved to. Empty when unscoped. */
  scopes: string[];
  /** Notes the persisted usage graph says this project has been working with. */
  recentlyUsed: BriefingNote[];
  /** Notes whose files changed most recently. */
  recentlyChanged: BriefingNote[];
  /** Notes the vault's own link structure ranks as central (PageRank over wikilinks). */
  central: BriefingNote[];
  /** Map-of-content notes matching the project, worth opening first. */
  mocs: string[];
  /** Unprocessed inbox items, if the vault keeps an Inbox folder. */
  inboxCount: number;
  generatedAt: string;
}

export interface BriefingOptions {
  /** Overrides project detection entirely. */
  project?: string;
  /** Working directory whose basename is used when `project` is absent. Defaults to process.cwd(). */
  cwd?: string;
  sectionSize?: number;
  now?: Date;
}

/**
 * Normalizes a name for matching: lowercase, and everything that is not a
 * letter or digit removed. So `vault-neural-link`, `VaultNeuralLinks` and
 * `Vault Neural Link` all collapse to the same key.
 *
 * Deliberately not a fuzzy/edit-distance match. A briefing that silently
 * scopes itself to the wrong project is worse than one that scopes to
 * nothing, because the reader cannot tell the difference from the content —
 * so matching is either obvious or absent, and `matchedBy` says which.
 */
export function normalizeProjectKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Path prefixes in the vault that belong to `project`.
 *
 * A vault's folder names are the user's own taxonomy, not something this
 * engine gets to impose, so this matches whatever segment of a note's path
 * normalizes to the project key — `Notes/VaultNeuralLinks/…`,
 * `02-Projects PPS/Bulstrad/Bunit2/…` and `MOCs/bunit2` all resolve by the
 * same rule. Singular/plural is tolerated because folder naming is rarely
 * consistent about it ("VaultNeuralLinks" vs a repo called
 * "vault-neural-link").
 */
export function scopesForProject(paths: string[], project: string): string[] {
  const key = normalizeProjectKey(project);
  if (key.length < 3) return []; // too short to match anything meaningfully
  const variants = new Set([key, key.endsWith("s") ? key.slice(0, -1) : `${key}s`]);

  const scopes = new Set<string>();
  for (const path of paths) {
    const segments = path.split("/");
    // The last segment is the note's own name; a note is not a scope.
    for (let i = 0; i < segments.length - 1; i++) {
      if (variants.has(normalizeProjectKey(segments[i]))) {
        scopes.add(segments.slice(0, i + 1).join("/"));
      }
    }
  }
  return [...scopes].sort();
}

function inScope(path: string, scopes: string[]): boolean {
  if (scopes.length === 0) return true;
  return scopes.some((scope) => path === scope || path.startsWith(`${scope}/`));
}

/** Days since `iso`, or null if it isn't a usable date. */
function daysSince(iso: string, now: Date): number | null {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.max(0, (now.getTime() - then) / 86_400_000);
}

function agePhrase(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  if (days < 14) return `${Math.round(days)} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

/**
 * Notes this project has actually been used with, ranked by live-decayed
 * usage weight summed per note.
 *
 * Summed across a note's edges rather than taken per edge: the question a
 * briefing answers is "which notes matter here", and a note connected weakly
 * to many things is a better answer than one end of a single strong edge.
 */
async function recentlyUsedNotes(
  vaultDataDir: string,
  scopes: string[],
  sectionSize: number,
  now: Date,
): Promise<{ path: string; weight: number; lastTouched: string }[]> {
  const weights = await loadWeights(vaultDataDir);
  const pending = await readPendingEvents(vaultDataDir);
  if (!weights && pending.length === 0) return [];

  const perNote = new Map<string, { weight: number; lastTouched: string }>();
  for (const [key, edge] of Object.entries(weights?.edges ?? {})) {
    // Decayed with the engine's own default config rather than a
    // briefing-specific half-life, so "recently worked with" here means the
    // same thing it means everywhere else in the engine.
    const age = daysSince(edge.lastTouched, now) ?? 0;
    const live = decayWeight(edge.baseStrength, age) + edge.consolidatedScore;
    if (live <= 0) continue;
    for (const path of key.split("|")) {
      if (!inScope(path, scopes)) continue;
      const existing = perNote.get(path);
      if (existing) {
        existing.weight += live;
        if (edge.lastTouched > existing.lastTouched) existing.lastTouched = edge.lastTouched;
      } else {
        perNote.set(path, { weight: live, lastTouched: edge.lastTouched });
      }
    }
  }

  // Events since the last compaction, which is where *today's* work lives.
  // Without this the briefing reports a note read an hour ago as "last used 7
  // days ago" — usage weights only move when the nightly job folds the log —
  // and a session-start briefing that is a day stale about what you were just
  // doing has lost most of its reason to exist.
  for (const event of pending) {
    for (const path of [event.from, event.to]) {
      if (!path || !inScope(path, scopes)) continue;
      const existing = perNote.get(path);
      if (existing) {
        existing.weight += event.weight;
        if (event.ts > existing.lastTouched) existing.lastTouched = event.ts;
      } else {
        perNote.set(path, { weight: event.weight, lastTouched: event.ts });
      }
    }
  }

  return [...perNote.entries()]
    .map(([path, value]) => ({ path, ...value }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, sectionSize);
}

/**
 * Traversal/reinforcement events not yet folded into `link-weights.json`,
 * read without touching anything.
 *
 * Strictly read-only, and `.compacting` files are skipped: those have been
 * claimed by a live compactor (VNL-004) and are about to become weights, so
 * reading them here would double-count, and writing anything near them would
 * race a process mid-fold. A briefing is the lowest-stakes reader in the
 * system and must never be the thing that corrupts the log.
 *
 * Every failure is swallowed per file and per line, for the same reason the
 * compactor quarantines bad lines rather than aborting: a single malformed
 * event must not cost the whole briefing.
 */
/** Splits a JSONL file into lines, tolerating either line ending. */
function splitLines(content: string): string[] {
  return content.split(/\r?\n/);
}

async function readPendingEvents(
  vaultDataDir: string,
): Promise<{ from?: string; to?: string; ts: string; weight: number }[]> {
  const eventsDir = join(vaultDataDir, "events");
  let files: string[];
  try {
    files = await readdir(eventsDir);
  } catch {
    return [];
  }

  const events: { from?: string; to?: string; ts: string; weight: number }[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    let content: string;
    try {
      content = await readFile(join(eventsDir, file), "utf8");
    } catch {
      continue;
    }
    for (const line of splitLines(content)) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line) as {
          type?: string;
          from?: string;
          to?: string;
          ts?: string;
          weight_delta?: number;
        };
        if (parsed.type !== "traverse" && parsed.type !== "reinforce") continue;
        if (!parsed.ts) continue;
        events.push({
          from: parsed.from,
          to: parsed.to,
          ts: parsed.ts,
          weight: parsed.weight_delta ?? 1,
        });
      } catch {
        // Malformed line: the compactor quarantines these; here it is simply skipped.
      }
    }
  }
  return events;
}

/**
 * Builds the session briefing.
 *
 * Every section degrades to empty rather than throwing: this runs before the
 * agent has done anything, on a vault that may never have had a nightly run,
 * and a briefing that fails is strictly worse than a thin one.
 */
export async function buildBriefing(
  vaultPath: string,
  vaultDataDir: string,
  opts: BriefingOptions = {},
): Promise<Briefing> {
  const { sectionSize = DEFAULT_BRIEFING_SECTION_SIZE, now = new Date() } = opts;

  const cwdName = basename(opts.cwd ?? process.cwd());
  const project = opts.project ?? cwdName;
  const matchedBy: Briefing["matchedBy"] = opts.project ? "explicit" : "cwd";

  const allPaths = await listNotes(vaultPath);
  const scopes = scopesForProject(allPaths, project);
  const resolved = scopes.length > 0;

  const [used, changed, importance] = await Promise.all([
    recentlyUsedNotes(vaultDataDir, scopes, sectionSize, now),
    mostRecentNotes(vaultPath, sectionSize * 4),
    loadNoteImportance(vaultDataDir),
  ]);

  const recentlyChangedInScope = changed.filter((entry) => inScope(entry.path, scopes)).slice(0, sectionSize);

  const central = Object.entries(importance?.scores ?? {})
    .filter(([path]) => inScope(path, scopes))
    .sort((a, b) => b[1] - a[1])
    .slice(0, sectionSize);

  // A superseded note in a briefing is actively harmful — it is read as
  // current by definition of being in the briefing — so every listed note is
  // checked, and the successor travels with it.
  const listedPaths = new Set([
    ...used.map((entry) => entry.path),
    ...recentlyChangedInScope.map((entry) => entry.path),
    ...central.map(([path]) => path),
  ]);
  const supersessions = new Map<string, string>();
  await Promise.all(
    [...listedPaths].map(async (path) => {
      const successor = await readSupersession(vaultPath, path).catch(() => null);
      if (successor) supersessions.set(path, successor);
    }),
  );

  const decorate = (path: string, note: string): BriefingNote => {
    const supersededBy = supersessions.get(path);
    return supersededBy ? { path, note, supersededBy } : { path, note };
  };

  const mocs = allPaths
    .filter((path) => path.startsWith("MOCs/") && (!resolved || inScope(path, scopes) || matchesMoc(path, project)))
    .slice(0, sectionSize);

  const inboxCount = allPaths.filter((path) => path.startsWith("Inbox/")).length;

  return {
    project: resolved ? project : null,
    matchedBy: resolved ? matchedBy : "none",
    scopes,
    recentlyUsed: used.map((entry) => {
      const days = daysSince(entry.lastTouched, now);
      return decorate(entry.path, days === null ? "used recently" : `last used ${agePhrase(days)}`);
    }),
    recentlyChanged: recentlyChangedInScope.map((entry) => {
      const days = daysSince(entry.mtime, now);
      return decorate(entry.path, days === null ? "changed recently" : `changed ${agePhrase(days)}`);
    }),
    central: central.map(([path, score]) => decorate(path, `link-structure rank ${score.toFixed(3)}`)),
    mocs,
    inboxCount,
    generatedAt: now.toISOString(),
  };
}

/** A MOC note whose own name is the project, e.g. `MOCs/bunit2` for "Bunit2". */
function matchesMoc(path: string, project: string): boolean {
  const name = path.split("/").pop() ?? "";
  const key = normalizeProjectKey(project);
  const mocKey = normalizeProjectKey(name);
  return mocKey === key || mocKey === `${key}s` || `${mocKey}s` === key;
}

/**
 * The briefing as text for a model to read.
 *
 * Markdown rather than JSON because the consumer is a language model reading
 * it as context, not code parsing it — and a section that is empty is omitted
 * entirely rather than rendered as an empty heading, since a briefing's whole
 * value is being short enough to actually be read.
 */
export function formatBriefing(briefing: Briefing): string {
  const lines: string[] = [];

  if (briefing.project) {
    lines.push(`# Vault briefing — ${briefing.project}`);
    lines.push("");
    lines.push(
      `Scoped to ${briefing.scopes.map((scope) => `\`${scope}\``).join(", ")}` +
        (briefing.matchedBy === "cwd" ? " (matched from the working directory name)." : "."),
    );
  } else {
    lines.push("# Vault briefing");
    lines.push("");
    lines.push(
      "No vault folder matches this project, so this is the whole vault. " +
        "Pass a project name to scope it.",
    );
  }
  lines.push("");

  const section = (title: string, notes: BriefingNote[]) => {
    if (notes.length === 0) return;
    lines.push(`## ${title}`);
    for (const entry of notes) {
      const stale = entry.supersededBy ? `  ⚠ superseded by ${entry.supersededBy}` : "";
      lines.push(`- [[${entry.path}]] — ${entry.note}${stale}`);
    }
    lines.push("");
  };

  section("Recently worked with", briefing.recentlyUsed);
  section("Recently changed", briefing.recentlyChanged);
  section("Central to this project", briefing.central);

  if (briefing.mocs.length > 0) {
    lines.push("## Maps of content");
    for (const moc of briefing.mocs) lines.push(`- [[${moc}]]`);
    lines.push("");
  }

  if (briefing.inboxCount > 0) {
    lines.push(`## Inbox`);
    lines.push(`${briefing.inboxCount} unprocessed item${briefing.inboxCount === 1 ? "" : "s"} in \`Inbox/\`.`);
    lines.push("");
  }

  if (
    briefing.recentlyUsed.length === 0 &&
    briefing.recentlyChanged.length === 0 &&
    briefing.central.length === 0
  ) {
    lines.push("Nothing to report yet — this vault has no usage history or index for this project.");
    lines.push("");
  }

  lines.push(`_Generated ${briefing.generatedAt}. Use \`recall\` to ask the vault a question._`);
  return lines.join("\n");
}
