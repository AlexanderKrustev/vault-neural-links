import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CompactionResult, EdgeRecord, EventLogEntry, LinkWeightsFile } from "./types.js";

const WEIGHTS_FILE_VERSION = 1;
// Generous upper bound on how long reactivationDays needs to remember —
// must comfortably cover any realistic ConsolidationConfig.windowDays.
const REACTIVATION_RETENTION_DAYS = 90;

function edgeKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/** UTC calendar-day key ("YYYY-MM-DD") for an event timestamp. */
function dayKey(ts: string): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function daysSinceDayKey(day: string, now: Date): number {
  return (now.getTime() - new Date(`${day}T00:00:00.000Z`).getTime()) / 86_400_000;
}

async function readAllEvents(
  eventsDir: string,
): Promise<{ entries: EventLogEntry[]; files: string[] }> {
  let files: string[];
  try {
    files = await readdir(eventsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { entries: [], files: [] };
    throw err;
  }

  const jsonlFiles = files.filter((file) => file.endsWith(".jsonl"));
  const entries: EventLogEntry[] = [];
  for (const file of jsonlFiles) {
    const content = await readFile(join(eventsDir, file), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      entries.push(JSON.parse(trimmed) as EventLogEntry);
    }
  }
  return { entries, files: jsonlFiles };
}

async function readExistingWeights(weightsFilePath: string): Promise<LinkWeightsFile | null> {
  try {
    const content = await readFile(weightsFilePath, "utf8");
    return JSON.parse(content) as LinkWeightsFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Reads all data/events/*.jsonl, folds them onto the edges already recorded in
 * link-weights.json (decayed forward to `compactedAt`), and writes the merged
 * result back atomically (temp file + rename). Event files are only deleted
 * once their contents are safely folded into the weights file, so compaction
 * never loses previously-recorded edges that had no new events this round.
 */
export async function compact(vaultDataDir: string): Promise<CompactionResult> {
  const eventsDir = join(vaultDataDir, "events");
  const weightsFilePath = join(vaultDataDir, "link-weights.json");

  const { entries: events, files: processedFiles } = await readAllEvents(eventsDir);
  const compactedAt = new Date();

  const edges = new Map<string, EdgeRecord>();

  const existing = await readExistingWeights(weightsFilePath);
  if (existing) {
    for (const [key, record] of Object.entries(existing.edges)) {
      // Migrate pre-existing files written before the weight -> baseStrength
      // rename, and before reactivationDays/consolidatedScore existed at
      // all: an edge untouched by any event since either change would
      // otherwise keep missing fields forever, and every reader now expects
      // the full current shape.
      const legacy = record as unknown as {
        weight?: number;
        baseStrength?: number;
        reactivationDays?: string[];
        consolidatedScore?: number;
      };
      edges.set(key, {
        baseStrength: legacy.baseStrength ?? legacy.weight ?? 0,
        lastTouched: record.lastTouched,
        traverseCount: record.traverseCount,
        reinforceCount: record.reinforceCount,
        reactivationDays: legacy.reactivationDays ?? [],
        consolidatedScore: legacy.consolidatedScore ?? 0,
      });
    }
  }

  // Decay is no longer applied here — compaction only folds raw event deltas
  // into baseStrength. Ranking applies decay live at query time, based on
  // elapsed time since lastTouched (see query.ts).
  for (const entry of events) {
    const key = edgeKey(entry.from, entry.to);
    const record = edges.get(key) ?? {
      baseStrength: 0,
      lastTouched: entry.ts,
      traverseCount: 0,
      reinforceCount: 0,
      reactivationDays: [],
      consolidatedScore: 0,
    };

    record.baseStrength += entry.weight_delta;
    if (new Date(entry.ts).getTime() > new Date(record.lastTouched).getTime()) {
      record.lastTouched = entry.ts;
    }
    if (entry.type === "traverse") record.traverseCount += 1;
    if (entry.type === "reinforce") record.reinforceCount += 1;

    const day = dayKey(entry.ts);
    if (!record.reactivationDays.includes(day)) record.reactivationDays.push(day);

    edges.set(key, record);
  }

  // reactivationDays only needs to outlive the widest realistic consolidation
  // window; pruning here (rather than only at nightly-consolidation time)
  // keeps the array from growing unbounded for edges reactivated daily over
  // months or years.
  for (const record of edges.values()) {
    record.reactivationDays = record.reactivationDays.filter(
      (day) => daysSinceDayKey(day, compactedAt) <= REACTIVATION_RETENTION_DAYS,
    );
  }

  const payload: LinkWeightsFile = {
    version: WEIGHTS_FILE_VERSION,
    compactedAt: compactedAt.toISOString(),
    edges: Object.fromEntries(edges),
  };

  await mkdir(vaultDataDir, { recursive: true });
  const tmpPath = join(vaultDataDir, `.link-weights.${randomUUID()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(payload, null, 2), "utf8");
  await rename(tmpPath, weightsFilePath);

  // Only the files whose contents are already folded into link-weights.json are safe to
  // remove — any .jsonl written concurrently by a live session is left for the next run.
  await Promise.all(
    processedFiles.map((file) =>
      unlink(join(eventsDir, file)).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }),
    ),
  );

  return { edgeCount: edges.size, compactedAt: payload.compactedAt };
}
