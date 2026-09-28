import { refreshEmbeddings, type NightlyRunResult } from "@vault-neural-links/core";

type RefreshFn = (vaultPath: string, vaultDataDir: string) => Promise<Partial<NightlyRunResult>>;

export interface EmbeddingRefresherOptions {
  /** Quiet period after the last note write before re-embedding. */
  debounceMs?: number;
  /** Injected in tests. */
  refresh?: RefreshFn;
  /** Where one-line status goes; stderr by default, since stdout is the MCP transport. */
  log?: (line: string) => void;
}

/** A burst of writes in one working session re-embeds once, not per note. */
export const DEFAULT_EMBEDDING_DEBOUNCE_MS = 30_000;

/**
 * VNL-071: keeps the semantic index current from the one process that can
 * load the embedding model. The Obsidian plugin's nightly job cannot (the
 * optional peer does not resolve from inside a bundled plugin), which left
 * the index frozen from 2026-09-09 while notes kept being written.
 *
 * Runs once at startup and again after note writes, debounced. The refresh
 * is incremental by content hash, so an unchanged vault costs a read of
 * every note and no model calls. Single-flight: a refresh requested while
 * one is running is folded into one follow-up run, never run concurrently,
 * because both would write the same index file.
 *
 * Several MCP server processes (one per session) may each refresh; the index
 * is written by atomic rename and every writer embeds the whole current
 * vault, so the last writer wins with a complete file.
 */
export class EmbeddingRefresher {
  private readonly debounceMs: number;
  private readonly refresh: RefreshFn;
  private readonly log: (line: string) => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | undefined;
  private rerun = false;
  private closed = false;
  private reportedSkip: string | undefined;

  constructor(
    private readonly vaultPath: string,
    private readonly vaultDataDir: string,
    options: EmbeddingRefresherOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? DEFAULT_EMBEDDING_DEBOUNCE_MS;
    this.refresh = options.refresh ?? ((vault, dataDir) => refreshEmbeddings(vault, dataDir));
    this.log = options.log ?? ((line) => console.error(line));
  }

  /** Re-embed after a quiet period; repeated calls push the deadline back. */
  scheduleSoon(): void {
    if (this.closed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runNow();
    }, this.debounceMs);
    // Never the reason a finished session's process stays alive.
    this.timer.unref?.();
  }

  /** Refresh now, or once more after the refresh already running. */
  runNow(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = this.runLoop().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async runLoop(): Promise<void> {
    do {
      this.rerun = false;
      const result = await this.refresh(this.vaultPath, this.vaultDataDir).catch(
        (): Partial<NightlyRunResult> => ({ embeddingSkipped: "failed" }),
      );
      this.report(result);
    } while (this.rerun && !this.closed);
  }

  private report(result: Partial<NightlyRunResult>): void {
    if (result.embeddingSkipped) {
      // "not-enabled" is the normal state of a vault that never opted in.
      if (result.embeddingSkipped === "not-enabled") return;
      // Said once per process, not after every write.
      if (this.reportedSkip === result.embeddingSkipped) return;
      this.reportedSkip = result.embeddingSkipped;
      this.log(`vault-neural-link: semantic index not refreshed (${result.embeddingSkipped}).`);
      return;
    }
    this.reportedSkip = undefined;
    if ((result.reembeddedCount ?? 0) > 0) {
      this.log(
        `vault-neural-link: semantic index refreshed — ${result.reembeddedCount} note(s) embedded, ` +
          `${result.embeddedNoteCount} total.`,
      );
    }
  }
}
