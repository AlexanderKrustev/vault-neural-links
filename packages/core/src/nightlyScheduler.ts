import { compact } from "./compactor.js";
import { rebuildStructuralIndex } from "./structuralLinks.js";
import { runNightlyConsolidation } from "./consolidation.js";
import { loadNoteImportance, runImportanceComputation } from "./importance.js";
import type { ActivationEventSink } from "./types.js";

export interface NightlyRunResult {
  ran: boolean;
  edgeCount?: number;
  promotedCount?: number;
  structuralEdgeCount?: number;
  noteCount?: number;
  computedAt?: string;
}

/**
 * Runs the same pipeline as bin/vnl-nightly.js, but gated on staleness
 * instead of wall-clock cron — meant to be called (fire-and-forget) once
 * per MCP server process startup, since the server itself is respawned
 * per Claude Code session and travels with the repo, unlike a per-machine
 * Task Scheduler entry or ~/.claude hook. note-importance.json's
 * `computedAt` is the staleness marker because, unlike link-weights.json's
 * `compactedAt`, it's only ever written by this full pipeline — never by
 * the on-demand `compact_weights` tool — so frequent ad-hoc compaction
 * can't mask a stale nightly run.
 */
export async function runNightlyIfStale(
  vaultPath: string,
  vaultDataDir: string,
  staleDays = 1,
  now: Date = new Date(),
  onEvent?: ActivationEventSink,
): Promise<NightlyRunResult> {
  const existing = await loadNoteImportance(vaultDataDir);
  if (existing) {
    const ageDays = (now.getTime() - new Date(existing.computedAt).getTime()) / 86_400_000;
    if (ageDays < staleDays) return { ran: false };
  }

  const compaction = await compact(vaultDataDir, onEvent);
  const consolidation = await runNightlyConsolidation(vaultDataDir, undefined, now);
  const structural = await rebuildStructuralIndex(vaultPath, vaultDataDir);
  const importance = await runImportanceComputation(vaultDataDir, undefined, now);

  return {
    ran: true,
    edgeCount: compaction.edgeCount,
    promotedCount: consolidation.promotedCount,
    structuralEdgeCount: structural.edgeCount,
    noteCount: importance.noteCount,
    computedAt: importance.computedAt,
  };
}
