import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PrimingConfig, SessionBufferFile } from "./types.js";
import { DEFAULT_PRIMING_CONFIG } from "./types.js";
import { decayWeight } from "./decay.js";

interface BufferEntry {
  note: string;
  touchedAt: number;
}

/**
 * In-memory LRU of the last N notes accessed this session (no
 * cross-restart persistence — resets when the MCP server instance
 * restarts), each remembering when it was touched so primingBonus() can
 * decay its effect over the session instead of treating membership as
 * binary (AIBRAIN-141). Backs primingBonus() so retrieval favors notes
 * related to what the session has recently been looking at.
 */
export class SessionBuffer {
  private readonly order: BufferEntry[] = [];
  private readonly capacity: number;

  constructor(capacity: number = DEFAULT_PRIMING_CONFIG.bufferSize) {
    this.capacity = capacity;
  }

  touch(note: string, now: Date = new Date()): void {
    const idx = this.order.findIndex((e) => e.note === note);
    if (idx !== -1) this.order.splice(idx, 1);
    this.order.push({ note, touchedAt: now.getTime() });
    if (this.order.length > this.capacity) this.order.shift();
  }

  has(note: string): boolean {
    return this.order.some((e) => e.note === note);
  }

  /** When `note` was last touched (epoch ms), or undefined if it isn't in the buffer. */
  touchedAt(note: string): number | undefined {
    return this.order.find((e) => e.note === note)?.touchedAt;
  }

  entries(): readonly string[] {
    return this.order.map((e) => e.note);
  }
}

/**
 * Weight bonus applied to a note's retrieval score when it's in the
 * session buffer, decayed by time since it was touched (AIBRAIN-141) —
 * reuses decay.ts's existing exponential half-life decay (the same
 * function edge weights decay with) rather than inventing a new curve,
 * just parameterized at session timescale (minutes) instead of edge-decay
 * timescale (days). A note touched a moment ago gets close to the full
 * bonus; one touched several half-lives ago gets close to none, exactly
 * like an unprimed note.
 */
export function primingBonus(
  note: string,
  buffer: SessionBuffer,
  config: PrimingConfig = DEFAULT_PRIMING_CONFIG,
  now: Date = new Date(),
): number {
  const touchedAt = buffer.touchedAt(note);
  if (touchedAt === undefined) return 0;
  const ageDays = (now.getTime() - touchedAt) / (1000 * 60 * 60 * 24);
  return decayWeight(config.bonus, ageDays, { halfLifeDays: config.halfLifeMinutes / (24 * 60) });
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
