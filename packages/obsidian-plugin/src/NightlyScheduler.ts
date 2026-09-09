import { FileSystemAdapter, type App } from "obsidian";
import { resolveDataDir, runNightlyIfStale, type NightlyRunResult } from "@vault-neural-links/core";

// How often to *check* whether a run is due, not how often a run actually
// happens — runNightlyIfStale itself gates on note-importance.json's
// computedAt being >= staleDays old, so most checks are no-ops.
const CHECK_INTERVAL_MS = 30 * 60 * 1000;
// Give Obsidian's own startup (layout, other plugins) room to settle before
// this does file IO + CPU work (clustering/importance) on the main thread.
const STARTUP_DELAY_MS = 15 * 1000;

/**
 * Obsidian is now the sole scheduler for the nightly compact -> consolidate
 * -> reindex -> importance -> cluster pipeline (see AIBRAIN-46) — no more
 * OS-level Task Scheduler entry, no more Claude Code / MCP-server-startup
 * trigger. Idempotency is delegated entirely to `runNightlyIfStale`
 * (packages/core/src/nightlyScheduler.ts): it gates on note-importance.json's
 * `computedAt` timestamp, a persisted file marker rather than any in-memory
 * plugin state, so it stays correct across Obsidian restarts/crashes and
 * across however many times this class's own checks happen to fire. The
 * `running` flag here only prevents *this plugin instance* from overlapping
 * two of its own concurrent runs (e.g. the startup check and an interval
 * tick landing close together) — since two concurrent calls could otherwise
 * both pass the staleness check before either had written the new marker.
 */
export class NightlyScheduler {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private startupTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  /**
   * `semanticIndexEnabled` is read per tick rather than captured once, so
   * toggling the setting takes effect on the next run instead of at the
   * next Obsidian reload.
   */
  constructor(
    private readonly app: App,
    private readonly semanticIndexEnabled: () => boolean = () => false,
  ) {}

  start(): void {
    this.startupTimeoutHandle = setTimeout(() => void this.tick(), STARTUP_DELAY_MS);
    this.intervalHandle = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.startupTimeoutHandle !== null) {
      clearTimeout(this.startupTimeoutHandle);
      this.startupTimeoutHandle = null;
    }
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return; // desktop-only, same constraint as WeightsWatcher

    this.running = true;
    try {
      const vaultPath = adapter.getBasePath();
      const vaultDataDir = resolveDataDir(vaultPath);
      const result: NightlyRunResult = await runNightlyIfStale(
        vaultPath,
        vaultDataDir,
        undefined,
        undefined,
        undefined,
        // VNL-051: `true` creates the semantic index, undefined only
        // refreshes one that already exists — so switching the setting off
        // stops it being rebuilt without deleting what is there, and
        // switching it on is the opt-in.
        { enabled: this.semanticIndexEnabled() || undefined },
      );
      if (result.ran) {
        console.log(
          `vault-neural-links: nightly pipeline ran — ${result.edgeCount} edges, ` +
            `${result.promotedCount} promoted, ${result.noteCount} notes scored, ` +
            `${result.clusterCount} clusters, at ${result.computedAt}` +
            (result.embeddedNoteCount === undefined
              ? ""
              : `, ${result.embeddedNoteCount} embedded (${result.reembeddedCount} refreshed)`),
        );
      }
    } catch (err) {
      console.error("vault-neural-links: nightly pipeline failed:", err);
    } finally {
      this.running = false;
    }
  }
}
