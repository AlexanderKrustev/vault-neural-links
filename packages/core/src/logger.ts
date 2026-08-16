import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EventLogEntry, RetrievalLogEntry, SearchLogEntry } from "./types.js";

// Serializes appends per file so concurrent calls from the same instance
// can't interleave partial writes (cross-instance safety comes from each
// instance owning its own file, not from locking).
const writeQueues = new Map<string, Promise<void>>();

export function eventsFilePath(vaultDataDir: string, instanceId: string): string {
  return join(vaultDataDir, "events", `${instanceId}.jsonl`);
}

function queueAppend(filePath: string, line: string): Promise<void> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, line, "utf8");
  });

  writeQueues.set(filePath, next);
  return next;
}

export async function appendEvent(
  vaultDataDir: string,
  instanceId: string,
  entry: EventLogEntry,
): Promise<void> {
  return queueAppend(eventsFilePath(vaultDataDir, instanceId), `${JSON.stringify(entry)}\n`);
}

export function retrievalLogFilePath(vaultDataDir: string, instanceId: string): string {
  return join(vaultDataDir, "retrieval", `${instanceId}.jsonl`);
}

/**
 * Appends one retrieval-log line per retrieveWithFallback call (AIBRAIN-26)
 * — separate from appendEvent's traverse/reinforce/decay log since this
 * tracks call-level outcomes (tier, latency, timeouts), not graph edits.
 */
export async function appendRetrievalLog(
  vaultDataDir: string,
  instanceId: string,
  entry: RetrievalLogEntry,
): Promise<void> {
  return queueAppend(retrievalLogFilePath(vaultDataDir, instanceId), `${JSON.stringify(entry)}\n`);
}

export function searchLogFilePath(vaultDataDir: string, instanceId: string): string {
  return join(vaultDataDir, "search", `${instanceId}.jsonl`);
}

/**
 * Appends one search-log line per search_notes call (AIBRAIN-70) —
 * unconditional, unlike the old behavior where a search left no trace at
 * all unless its results happened to get touched/read afterward.
 */
export async function appendSearchLog(
  vaultDataDir: string,
  instanceId: string,
  entry: SearchLogEntry,
): Promise<void> {
  return queueAppend(searchLogFilePath(vaultDataDir, instanceId), `${JSON.stringify(entry)}\n`);
}
