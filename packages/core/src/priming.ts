import type { PrimingConfig } from "./types.js";
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
