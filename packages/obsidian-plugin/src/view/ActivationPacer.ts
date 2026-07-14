import type { ActivationTraceEvent } from "@vault-neural-links/core";

const STUDY_MIN_GAP_MS = 150;
const STUDY_MAX_GAP_MS = 300;

export type PlaybackMode = "live" | "study";

/**
 * The only place Live/Study timing logic lives — kept out of ForceSim and
 * Renderer, which only ever see events at the pace they're fed. Live passes
 * events straight through; Study queues them and drains one at a time with
 * a randomized 150-300ms gap, purely for how the animation is paced. Engine
 * timing itself (activate()'s own event ordering) is never touched — this
 * only affects when a caller's onEmit is invoked.
 */
export class ActivationPacer {
  private mode: PlaybackMode = "live";
  private queue: ActivationTraceEvent[] = [];
  private drainHandle: ReturnType<typeof setTimeout> | null = null;
  private onEmit: ((event: ActivationTraceEvent) => void) | null = null;

  setMode(mode: PlaybackMode): void {
    this.mode = mode;
  }

  start(onEmit: (event: ActivationTraceEvent) => void): void {
    this.onEmit = onEmit;
  }

  stop(): void {
    if (this.drainHandle !== null) {
      clearTimeout(this.drainHandle);
      this.drainHandle = null;
    }
    this.queue = [];
    this.onEmit = null;
  }

  feed(event: ActivationTraceEvent): void {
    if (this.mode === "live") {
      this.onEmit?.(event);
      return;
    }
    this.queue.push(event);
    this.scheduleDrain();
  }

  private scheduleDrain(): void {
    if (this.drainHandle !== null) return;
    const gap = STUDY_MIN_GAP_MS + Math.random() * (STUDY_MAX_GAP_MS - STUDY_MIN_GAP_MS);
    this.drainHandle = setTimeout(() => {
      this.drainHandle = null;
      const next = this.queue.shift();
      if (next) this.onEmit?.(next);
      if (this.queue.length > 0) this.scheduleDrain();
    }, gap);
  }
}
