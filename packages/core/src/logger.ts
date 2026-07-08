import { mkdir, appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EventLogEntry } from "./types.js";

// Serializes appends per file so concurrent calls from the same instance
// can't interleave partial writes (cross-instance safety comes from each
// instance owning its own file, not from locking).
const writeQueues = new Map<string, Promise<void>>();

export function eventsFilePath(vaultDataDir: string, instanceId: string): string {
  return join(vaultDataDir, "events", `${instanceId}.jsonl`);
}

export async function appendEvent(
  vaultDataDir: string,
  instanceId: string,
  entry: EventLogEntry,
): Promise<void> {
  const filePath = eventsFilePath(vaultDataDir, instanceId);
  const line = `${JSON.stringify(entry)}\n`;

  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    await mkdir(dirname(filePath), { recursive: true });
    await appendFile(filePath, line, "utf8");
  });

  writeQueues.set(filePath, next);
  return next;
}
