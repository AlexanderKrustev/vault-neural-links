import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ActivationEventSink,
  CompactionResult,
  EdgeRecord,
  EventLogEntry,
  LinkWeightsFile,
} from "./types.js";

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

// VNL-004 — durability of the fold from events/*.jsonl into link-weights.json.
const LOCK_FILE = ".compact.lock";
/** A lock older than this is assumed to belong to a crashed compactor. */
const STALE_LOCK_MS = 15 * 60_000;
const CLAIM_SUFFIX = ".compacting";

interface CompactLock {
  release(): Promise<void>;
}

/**
 * Exclusive, cross-process lock for one vault's compaction. Two compactors
 * folding the same event files concurrently would each add the same deltas
 * to the same base weights and the second `rename` would win, so a
 * traversal could be counted twice or lost outright. `wx` gives an atomic
 * create-if-absent on every platform; a lock left behind by a killed
 * process is reclaimed once it is clearly stale rather than blocking
 * compaction forever.
 */
async function acquireLock(vaultDataDir: string): Promise<CompactLock | null> {
  const lockPath = join(vaultDataDir, LOCK_FILE);
  await mkdir(vaultDataDir, { recursive: true });

  const write = async (): Promise<boolean> => {
    try {
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), {
        encoding: "utf8",
        flag: "wx",
      });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw err;
    }
  };

  if (await write()) return { release: () => unlink(lockPath).catch(() => {}) };

  let heldSince = 0;
  try {
    const held = JSON.parse(await readFile(lockPath, "utf8")) as { startedAt?: string };
    heldSince = held.startedAt ? new Date(held.startedAt).getTime() : 0;
  } catch {
    heldSince = 0; // unreadable or malformed: treat as stale
  }
  if (Number.isNaN(heldSince) || Date.now() - heldSince < STALE_LOCK_MS) return null;

  await unlink(lockPath).catch(() => {});
  if (await write()) return { release: () => unlink(lockPath).catch(() => {}) };
  return null;
}

/**
 * Renames every `events/*.jsonl` to `*.jsonl.compacting-<runId>` before a
 * single byte is read. Live sessions append with `appendFile`, which
 * recreates the original name, so everything logged from here on lands in a
 * fresh file and cannot be deleted unread at the end of this run. Files left
 * claimed by a previous crashed run are picked up again here rather than
 * being stranded.
 */
async function claimEventFiles(eventsDir: string, runId: string): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(eventsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const claimed: string[] = files.filter((file) => file.includes(CLAIM_SUFFIX));
  for (const file of files.filter((file) => file.endsWith(".jsonl"))) {
    const claimedName = `${file}${CLAIM_SUFFIX}-${runId}`;
    try {
      await rename(join(eventsDir, file), join(eventsDir, claimedName));
      claimed.push(claimedName);
    } catch (err) {
      // Another compactor claimed it first, or a writer still holds it open
      // (Windows). Either way it is not ours this round; leave it.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  return claimed;
}

function isEventLogEntry(value: unknown): value is EventLogEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<EventLogEntry>;
  return (
    typeof entry.from === "string" &&
    typeof entry.to === "string" &&
    typeof entry.ts === "string" &&
    !Number.isNaN(new Date(entry.ts).getTime()) &&
    typeof entry.weight_delta === "number" &&
    Number.isFinite(entry.weight_delta)
  );
}

/**
 * Reads the claimed files line by line. A single truncated or corrupt line —
 * the normal result of a machine losing power mid-append — used to throw and
 * abort the whole compaction, permanently, since the bad line was never
 * removed. Each bad line is now moved to `events/quarantine/` and the rest of
 * the log is still folded in.
 */
async function readClaimedEvents(
  eventsDir: string,
  claimedFiles: string[],
): Promise<{ entries: EventLogEntry[]; quarantined: string[] }> {
  const entries: EventLogEntry[] = [];
  const quarantined: string[] = [];

  for (const file of claimedFiles) {
    const content = await readFile(join(eventsDir, file), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (!isEventLogEntry(parsed)) throw new Error("not an event log entry");
        entries.push(parsed);
      } catch {
        quarantined.push(trimmed);
      }
    }
  }

  return { entries, quarantined };
}

async function quarantineLines(eventsDir: string, runId: string, lines: string[]): Promise<void> {
  if (lines.length === 0) return;
  const dir = join(eventsDir, "quarantine");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${runId}.jsonl`), `${lines.join("\n")}\n`, "utf8");
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
 * link-weights.json, and writes the merged result back atomically (temp file
 * + rename). Event files are only deleted once their contents are safely
 * folded into the weights file, so compaction never loses previously-recorded
 * edges that had no new events this round.
 *
 * VNL-004: the run holds an exclusive lock, claims its input files by
 * renaming them out of the way of live appenders before reading, and
 * quarantines unparseable lines instead of aborting on them. Returns
 * `skipped: true` without touching anything if another compactor holds the
 * lock.
 */
export async function compact(vaultDataDir: string, onEvent?: ActivationEventSink): Promise<CompactionResult> {
  const eventsDir = join(vaultDataDir, "events");
  const weightsFilePath = join(vaultDataDir, "link-weights.json");

  const lock = await acquireLock(vaultDataDir);
  if (!lock) {
    const existingWeights = await readExistingWeights(weightsFilePath);
    return {
      edgeCount: existingWeights ? Object.keys(existingWeights.edges).length : 0,
      compactedAt: existingWeights?.compactedAt ?? new Date().toISOString(),
      quarantinedLines: 0,
      skipped: true,
    };
  }

  try {
    return await runCompaction(vaultDataDir, eventsDir, weightsFilePath, onEvent);
  } finally {
    await lock.release();
  }
}

async function runCompaction(
  vaultDataDir: string,
  eventsDir: string,
  weightsFilePath: string,
  onEvent?: ActivationEventSink,
): Promise<CompactionResult> {
  const runId = randomUUID();
  const processedFiles = await claimEventFiles(eventsDir, runId);
  const { entries: events, quarantined } = await readClaimedEvents(eventsDir, processedFiles);
  await quarantineLines(eventsDir, runId, quarantined);
  const compactedAt = new Date();

  const edges = new Map<string, EdgeRecord>();
  // Tracks which edges actually changed this compaction round (and by how
  // much), so onEvent only fires for real weight changes rather than every
  // pre-existing edge carried forward unchanged.
  const changed = new Map<string, { from: string; to: string; delta: number }>();

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

    const existingDelta = changed.get(key);
    if (existingDelta) {
      existingDelta.delta += entry.weight_delta;
    } else {
      changed.set(key, { from: entry.from, to: entry.to, delta: entry.weight_delta });
    }
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

  // Only the files this run claimed are removed, and only now that their
  // contents are on disk inside link-weights.json. Anything a live session
  // appended since the claim sits in a freshly created .jsonl and is left
  // for the next run.
  await Promise.all(
    processedFiles.map((file) =>
      unlink(join(eventsDir, file)).catch((err) => {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }),
    ),
  );

  if (onEvent && changed.size > 0) {
    for (const { from, to, delta } of changed.values()) {
      onEvent({
        type: "edge_traversed",
        runId,
        origin: from,
        hop: 0,
        from,
        to,
        energy: delta,
        ts: payload.compactedAt,
      });
    }
  }

  return {
    edgeCount: edges.size,
    compactedAt: payload.compactedAt,
    quarantinedLines: quarantined.length,
  };
}
