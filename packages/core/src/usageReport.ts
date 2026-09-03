import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { loadNoteImportance } from "./importance.js";
import type {
  EventLogEntry,
  RetrievalLogEntry,
  SearchLogEntry,
  UsageReport,
  UsageReportNoteTouch,
  UsageReportSession,
} from "./types.js";

const DEFAULT_TOP_N = 10;

async function readJsonlDir<T>(dir: string): Promise<Map<string, T[]>> {
  const result = new Map<string, T[]>();
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return result;
    throw err;
  }

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const instance = file.slice(0, -".jsonl".length);
    const content = await readFile(join(dir, file), "utf8");
    const entries: T[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        entries.push(JSON.parse(trimmed) as T);
      } catch {
        // Skip a partially-written last line rather than failing the whole report.
      }
    }
    result.set(instance, entries);
  }
  return result;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Reads the append-only events/retrieval/session logs under vaultDataDir and
 * summarizes actual usage back to the user (AIBRAIN-68) — session cadence,
 * which mechanisms fire and how often, and which notes get touched most
 * versus what the engine's own importance scoring considers central.
 * Read-only and side-effect-free; safe to call as often as the caller likes.
 */
export async function computeUsageReport(vaultDataDir: string, topN: number = DEFAULT_TOP_N): Promise<UsageReport> {
  const [eventsByInstance, retrievalByInstance, searchByInstance, importanceFile] = await Promise.all([
    readJsonlDir<EventLogEntry>(join(vaultDataDir, "events")),
    readJsonlDir<RetrievalLogEntry>(join(vaultDataDir, "retrieval")),
    readJsonlDir<SearchLogEntry>(join(vaultDataDir, "search")),
    loadNoteImportance(vaultDataDir),
  ]);

  const instanceIds = new Set<string>([...eventsByInstance.keys(), ...retrievalByInstance.keys(), ...searchByInstance.keys()]);

  const sessions: UsageReportSession[] = [];
  let traverseCount = 0;
  let reinforceExplicitCount = 0;
  let reinforceAutoCount = 0;
  let humanOpenCount = 0;
  let humanEditCount = 0;
  let searchCount = 0;
  let getWeightedNeighborsCount = 0;
  const activateTierCounts = { activation: 0, keyword: 0, recency: 0 };
  const touchCounts = new Map<string, number>();

  for (const instance of instanceIds) {
    const events = eventsByInstance.get(instance) ?? [];
    const retrieval = retrievalByInstance.get(instance) ?? [];
    const search = searchByInstance.get(instance) ?? [];
    searchCount += search.length;
    const timestamps: string[] = [...events.map((e) => e.ts), ...retrieval.map((r) => r.ts), ...search.map((s) => s.ts)].sort();

    sessions.push({
      instance,
      firstEventAt: timestamps[0] ?? null,
      lastEventAt: timestamps[timestamps.length - 1] ?? null,
      durationMinutes:
        timestamps.length >= 2
          ? (new Date(timestamps[timestamps.length - 1]).getTime() - new Date(timestamps[0]).getTime()) / 60_000
          : null,
    });

    for (const event of events) {
      // VNL-052: the plugin's human-navigation events share this log but are
      // counted on their own axis — they are ~100x more numerous and carry a
      // much smaller weight each, so folding them into traverse/reinforce
      // would drown the agent-side numbers this report exists to show.
      if (event.trigger === "human-open") humanOpenCount++;
      else if (event.trigger === "human-edit") humanEditCount++;
      else if (event.type === "traverse") traverseCount++;
      else if (event.type === "reinforce") {
        // Missing trigger means this event predates AIBRAIN-71's field — it can only have come from an explicit reinforce_link call.
        if (event.trigger === "auto-retrieval") reinforceAutoCount++;
        else reinforceExplicitCount++;
      }
      // "decay" is a reserved EventType never actually appended by any live code path.

      touchCounts.set(event.from, (touchCounts.get(event.from) ?? 0) + 1);
      touchCounts.set(event.to, (touchCounts.get(event.to) ?? 0) + 1);
    }

    for (const entry of retrieval) {
      // Missing source means this entry predates AIBRAIN-126's field — it can only have come from activate().
      if ((entry.source ?? "activate") === "get_weighted_neighbors") {
        getWeightedNeighborsCount++;
      } else {
        activateTierCounts[entry.tier ?? "activation"]++;
      }
    }
  }

  sessions.sort((a, b) => (a.firstEventAt ?? "").localeCompare(b.firstEventAt ?? ""));

  const importanceScores = importanceFile?.scores ?? {};
  const topTouchedNotes: UsageReportNoteTouch[] = [...touchCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([path, touches]) => ({ path, touches, importance: importanceScores[path] ?? null }));

  const topImportancePaths = new Set(
    Object.entries(importanceScores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([path]) => path),
  );
  const importanceOverlapPct =
    topTouchedNotes.length > 0 && topImportancePaths.size > 0
      ? (topTouchedNotes.filter((n) => topImportancePaths.has(n.path)).length / topTouchedNotes.length) * 100
      : null;

  const gaps: string[] = [];
  if (searchCount === 0 && (traverseCount > 0 || activateTierCounts.activation > 0)) {
    gaps.push(
      "No search_notes activity recorded — either search hasn't been used, or these sessions predate " +
        "AIBRAIN-70's search logging fix (2026-08-16), before which search_notes left no persisted trace at all.",
    );
  }
  if (reinforceExplicitCount === 0 && reinforceAutoCount === 0 && traverseCount > 0) {
    gaps.push(
      "No reinforcement signal recorded (explicit or automatic) — traversal auto-logging (read_note) is " +
        "carrying all persisted usage weight in practice.",
    );
  } else if (reinforceExplicitCount === 0 && reinforceAutoCount > 0) {
    // AIBRAIN-66/AIBRAIN-69 follow-up (2026-08-21): this is expected now,
    // not a gap to flag as actionable — the explicit reinforce_link MCP
    // tool was removed (zero real invocations ever, per the 2026-08-16
    // decision-delegation audit; also found miscalibrated, see
    // benchmark-reinforcement.mjs), so automatic retrieval-then-read
    // correlation (AIBRAIN-71) is now the *only* live reinforcement path
    // going forward. `explicit` counts above 0 only ever come from
    // historical data logged before the tool's removal.
    gaps.push(
      `All reinforcement signal so far is automatic (${reinforceAutoCount} edge(s), via retrieval-then-read ` +
        "correlation, AIBRAIN-71) — expected, since the explicit reinforce_link tool was removed.",
    );
  }
  if (activateTierCounts.keyword === 0 && activateTierCounts.recency === 0 && activateTierCounts.activation > 0) {
    gaps.push("every logged activate() call resolved via the primary activation tier — the keyword/recency fallback tiers have never fired.");
  }

  return {
    generatedAt: new Date().toISOString(),
    sessionCount: instanceIds.size,
    sessions,
    typicalSessionMinutes: median(sessions.map((s) => s.durationMinutes).filter((d): d is number => d !== null && d > 0)),
    mechanismCounts: {
      traverse: traverseCount,
      reinforce: { explicit: reinforceExplicitCount, autoRetrieval: reinforceAutoCount },
      human: { opens: humanOpenCount, edits: humanEditCount },
      activate: activateTierCounts,
      getWeightedNeighbors: getWeightedNeighborsCount,
      search: searchCount,
    },
    topTouchedNotes,
    importanceOverlapPct,
    gaps,
  };
}
