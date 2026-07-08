import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CompactionResult, EdgeRecord, EventLogEntry, LinkWeightsFile } from "./types.js";
import { decayWeight } from "./decay.js";

const WEIGHTS_FILE_VERSION = 1;

function edgeKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

async function readAllEvents(eventsDir: string): Promise<EventLogEntry[]> {
  let files: string[];
  try {
    files = await readdir(eventsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const entries: EventLogEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const content = await readFile(join(eventsDir, file), "utf8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      entries.push(JSON.parse(trimmed) as EventLogEntry);
    }
  }
  return entries;
}

/**
 * Reads all data/events/*.jsonl, folds into an edge map, applies decay
 * relative to compactedAt, and writes link-weights.json atomically
 * (temp file + rename).
 */
export async function compact(vaultDataDir: string): Promise<CompactionResult> {
  const eventsDir = join(vaultDataDir, "events");
  const weightsFilePath = join(vaultDataDir, "link-weights.json");

  const events = await readAllEvents(eventsDir);
  const compactedAt = new Date();

  const edges = new Map<string, EdgeRecord>();

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
  }

  for (const record of edges.values()) {
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

  return { edgeCount: edges.size, compactedAt: payload.compactedAt };
}
