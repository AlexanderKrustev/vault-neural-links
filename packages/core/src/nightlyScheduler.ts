import { compact } from "./compactor.js";
import { rebuildStructuralIndex } from "./structuralLinks.js";
import { runNightlyConsolidation } from "./consolidation.js";
import { loadNoteImportance, runImportanceComputation } from "./importance.js";
import { runClusterComputation } from "./clustering.js";
import type { ActivationEventSink } from "./types.js";

export interface NightlyRunResult {
  ran: boolean;
  edgeCount?: number;
  promotedCount?: number;
  structuralEdgeCount?: number;
  noteCount?: number;
  clusterCount?: number;
  computedAt?: string;
}

/**
 * Runs the same pipeline as bin/vnl-nightly.js, but gated on staleness
 * instead of wall-clock cron. Called from the Obsidian plugin's
 * NightlyScheduler (packages/obsidian-plugin/src/NightlyScheduler.ts) on
 * startup and on a periodic check while Obsidian is open — the sole
 * trigger for this pipeline as of AIBRAIN-46 (no OS scheduled task, no
 * Claude Code / MCP-server-startup trigger). note-importance.json's
 * `computedAt` is the staleness marker because, unlike link-weights.json's
 * `compactedAt`, it's only ever written by this full pipeline — never by
 * the on-demand `compact_weights` tool — so frequent ad-hoc compaction
 * can't mask a stale run, and because it's a persisted file (not
 * in-memory plugin state) the gate survives Obsidian restarts/crashes too.
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
  const clustering = await runClusterComputation(vaultDataDir, undefined, now);

  return {
    ran: true,
    edgeCount: compaction.edgeCount,
    promotedCount: consolidation.promotedCount,
    structuralEdgeCount: structural.edgeCount,
    noteCount: importance.noteCount,
    clusterCount: clustering.clusterCount,
    computedAt: importance.computedAt,
  };
}
