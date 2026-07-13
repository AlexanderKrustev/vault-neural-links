import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PrimingConfig, SessionBufferFile } from "./types.js";
import { DEFAULT_PRIMING_CONFIG } from "./types.js";

/**
 * In-memory LRU of the last N notes accessed this session (no persistence,
 * no decay math — resets when the MCP server instance restarts). Backs
 * primingBonus() so retrieval favors notes related to what the session has
 * already been looking at.
 */
export class SessionBuffer {
  private readonly order: string[] = [];
  private readonly capacity: number;

  constructor(capacity: number = DEFAULT_PRIMING_CONFIG.bufferSize) {
    this.capacity = capacity;
  }

  touch(note: string): void {
    const idx = this.order.indexOf(note);
    if (idx !== -1) this.order.splice(idx, 1);
    this.order.push(note);
    if (this.order.length > this.capacity) this.order.shift();
  }

  has(note: string): boolean {
    return this.order.includes(note);
  }

  entries(): readonly string[] {
    return this.order;
  }
}

/**
 * Flat bonus applied to a note's retrieval score when it's in the session
 * buffer — deliberately not weighted by recency-within-buffer, matching the
 * ticket's framing as the lightest-lift of the priming mechanisms.
 */
export function primingBonus(
  note: string,
  buffer: SessionBuffer,
  config: PrimingConfig = DEFAULT_PRIMING_CONFIG,
): number {
  return buffer.has(note) ? config.bonus : 0;
}


export function sessionBufferFilePath(vaultDataDir: string, instanceId: string): string {
  return join(vaultDataDir, "session", `${instanceId}.json`);
}

/**
 * Writes the session buffer to disk so out-of-process consumers (the
 * Obsidian plugin's graph view) can render "primed" notes — the buffer
 * itself never leaves memory otherwise, since it's scoped to this MCP
 * server instance. One file per instance, overwritten on every touch;
 * consumers should treat files whose `updatedAt` is stale (session likely
 * ended) as no longer primed, since there's no clean-shutdown hook to
 * delete them.
 */
export async function persistSessionBuffer(
  vaultDataDir: string,
  instanceId: string,
  buffer: SessionBuffer,
): Promise<void> {
  const filePath = sessionBufferFilePath(vaultDataDir, instanceId);
  const payload: SessionBufferFile = {
    instance: instanceId,
    updatedAt: new Date().toISOString(),
    notes: [...buffer.entries()],
  };
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(payload), "utf8");
}
