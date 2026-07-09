import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CompactionResult, EdgeRecord, EventLogEntry, LinkWeightsFile } from "./types.js";
import { decayWeight } from "./decay.js";

const WEIGHTS_FILE_VERSION = 1;

function edgeKey(a: string, b: string): string {
  return [a, b].sort().join("|");
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
    const prevCompactedAt = new Date(existing.compactedAt);
    const daysSincePrevCompaction =
      (compactedAt.getTime() - prevCompactedAt.getTime()) / (1000 * 60 * 60 * 24);
    for (const [key, record] of Object.entries(existing.edges)) {
      edges.set(key, {
        ...record,
        weight: decayWeight(record.weight, daysSincePrevCompaction),
      });
    }
  }

  const touchedKeys = new Set<string>();
  for (const entry of events) {
    const key = edgeKey(entry.from, entry.to);
    const record = edges.get(key) ?? {
      weight: 0,
      lastTouched: entry.ts,
      traverseCount: 0,
      reinforceCount: 0,
    };

    record.weight += entry.weight_delta;
    if (new Date(entry.ts).getTime() > new Date(record.lastTouched).getTime()) {
      record.lastTouched = entry.ts;
    }
    if (entry.type === "traverse") record.traverseCount += 1;
    if (entry.type === "reinforce") record.reinforceCount += 1;

    edges.set(key, record);
    touchedKeys.add(key);
  }

  // Edges carried over from the existing file with no new events this round were
  // already decayed forward to `compactedAt` above; only re-decay edges that got
  // fresh events, relative to their (possibly just-updated) lastTouched.
  for (const key of touchedKeys) {
    const record = edges.get(key)!;
    const daysSince =
      (compactedAt.getTime() - new Date(record.lastTouched).getTime()) / (1000 * 60 * 60 * 24);
    record.weight = decayWeight(record.weight, daysSince);
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
