import { compact } from "./compactor.js";
import { buildStructuralIndex, rebuildStructuralIndex } from "./structuralLinks.js";
import { buildContentIndex, rebuildContentIndex } from "./contentIndex.js";
import { createObsidianAdapter } from "./adapters.js";
import { runNightlyConsolidation } from "./consolidation.js";
import { loadNoteImportance, runImportanceComputation } from "./importance.js";
import { runClusterComputation } from "./clustering.js";
import { pruneStaleInstanceFiles } from "./sessionFiles.js";
import type { ActivationEventSink } from "./types.js";

export interface NightlyRunResult {
  ran: boolean;
  edgeCount?: number;
  promotedCount?: number;
  structuralEdgeCount?: number;
  noteCount?: number;
  clusterCount?: number;
  contentIndexTokenCount?: number;
  /** Stale per-instance session/socket files and expired logs removed (VNL-009). */
  prunedFileCount?: number;
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

  // AIBRAIN-133: one adapter.listNodes() pass shared between the structural
  // and content indexes, instead of each rebuilding it independently — a
  // real cost at scale (~17s/300k notes, AIBRAIN-131), not worth paying twice
  // in the same pipeline run.
  const adapter = createObsidianAdapter(vaultPath);
  const nodes = await adapter.listNodes();
  const structuralIndex = await buildStructuralIndex(vaultPath, adapter, nodes);
  const structural = await rebuildStructuralIndex(vaultPath, vaultDataDir, adapter, structuralIndex);
  const contentIndex = await buildContentIndex(vaultPath, adapter, nodes);
  const contentIndexResult = await rebuildContentIndex(vaultPath, vaultDataDir, adapter, contentIndex);

  const importance = await runImportanceComputation(vaultDataDir, undefined, now);
  const clustering = await runClusterComputation(vaultDataDir, undefined, now);

  // VNL-009: session buffers and socket registrations belonging to MCP
  // instances that did not exit cleanly, plus log files past their retention
  // window. Nothing else deletes these.
  const prune = await pruneStaleInstanceFiles(vaultDataDir, { now });

  return {
    ran: true,
    edgeCount: compaction.edgeCount,
    promotedCount: consolidation.promotedCount,
    structuralEdgeCount: structural.edgeCount,
    noteCount: importance.noteCount,
    clusterCount: clustering.clusterCount,
    contentIndexTokenCount: contentIndexResult.tokenCount,
    prunedFileCount: Object.values(prune.removed).reduce((sum, n) => sum + n, 0),
    computedAt: importance.computedAt,
  };
}
