import { randomUUID } from "node:crypto";
import { appendEvent, appendRetrievalLog, appendSearchLog } from "./logger.js";
import { compact } from "./compactor.js";
import { rebuildStructuralIndex } from "./structuralLinks.js";
import { getWeightedNeighbors, computeLiveNeighborWeights } from "./query.js";
import { activate } from "./activation.js";
import { runAblationComparison } from "./ablation.js";
import { retrieveWithFallback, type RetrievalResult, type RetrieveWithFallbackOptions } from "./fallback.js";
import { resolveDataDir } from "./vaultPaths.js";
import { SessionBuffer, persistSessionBuffer } from "./priming.js";
import type {
  AblationDiffResult,
  AblationLayers,
  ActivatedNote,
  ActivationEventSink,
  CompactionResult,
  ReinforceTrigger,
  SpreadingActivationConfig,
  TraversalTrigger,
  WeightedNeighbor,
} from "./types.js";

export * from "./types.js";
export * from "./parser.js";
export * from "./decay.js";
export * from "./priming.js";
export { appendEvent, appendSearchLog } from "./logger.js";
export { compact } from "./compactor.js";
export { buildStructuralIndex, loadStructuralIndex, rebuildStructuralIndex } from "./structuralLinks.js";
export {
  createObsidianAdapter,
  createOkfAdapter,
  type SourceAdapter,
  type SourceNode,
} from "./adapters.js";
export { consolidate, runNightlyConsolidation } from "./consolidation.js";
export { runNightlyIfStale, type NightlyRunResult } from "./nightlyScheduler.js";
export { computePageRank, normalizeImportance, loadNoteImportance, runImportanceComputation } from "./importance.js";
export { runLouvain, loadNoteClusters, runClusterComputation } from "./clustering.js";
export { resolveSupersededBy, readSupersession } from "./relations.js";
export { getWeightedNeighbors, getEdgeWeight, computeLiveNeighborWeights } from "./query.js";
export { activate } from "./activation.js";
export { runAblationComparison } from "./ablation.js";
export { retrieveWithFallback, type RetrievalResult, type RetrieveWithFallbackOptions } from "./fallback.js";
export { resolveDataDir } from "./vaultPaths.js";
export {
  accountSessionPath,
  readAccountSession,
  writeAccountSession,
  clearAccountSession,
  isAccountSessionActive,
  type AccountSession,
} from "./accountSession.js";
export { computeUsageReport } from "./usageReport.js";
export * from "./frontmatter.js";
export * from "./notes.js";
export * from "./autolink.js";
export * from "./changelog.js";

// AIBRAIN-66 fast-follow: lowered from 5. Measured via
// packages/core/scripts/benchmark-reinforcement.mjs: two default-boost
// reinforce_link calls on one edge were enough to rank that note #1 for
// every ground-truth query tried, including a deliberate topically-
// irrelevant distractor. This reduction alone does not fix that (the real
// cause is deeper — see DEFAULT_STRUCTURAL_FALLBACK_CONFIG's doc comment in
// types.ts) but is a real, tested, net-positive reduction in how far a
// couple of clicks can distort ranking on its own.
const DEFAULT_REINFORCE_BOOST = 1.5;
const DEFAULT_ACTIVATION_ENERGY = 10;

/**
 * Boost applied when a note that surfaced in a retrieval result (activate /
 * get_weighted_neighbors) is then actually read (AIBRAIN-71) — a
 * server-computed proxy for "this retrieval result was acted on", sitting
 * between passive traversal's implicit weight_delta (1) and an explicit
 * reinforce_link call's full boost (DEFAULT_REINFORCE_BOOST). Unlike
 * reinforce_link, this fires automatically and needs no LLM to notice and
 * decide to call a tool about it.
 *
 * AIBRAIN-66 fast-follow: lowered from 3 alongside DEFAULT_REINFORCE_BOOST's
 * drop from 5 to 1.5, same reason — see that constant's doc comment.
 */
export const AUTO_REINFORCE_BOOST = 1;

export interface VaultLinkClient {
  /**
   * Session-only priming touch, no persisted weight change — for shallow
   * exposure (e.g. a note surfacing in search results) that shouldn't be
   * mistaken for the deeper engagement logTraversal/reinforce represent.
   */
  touch(...notes: string[]): Promise<void>;
  logTraversal(from: string, to: string, onEvent?: ActivationEventSink, trigger?: TraversalTrigger): Promise<void>;
  /** Appends an unconditional search-log entry (AIBRAIN-70) — no priming, no weight change, just a persisted trace that a search happened. */
  logSearch(query: string, resultCount: number, useWeights: boolean): Promise<void>;
  reinforce(from: string, to: string, boost?: number, onEvent?: ActivationEventSink, trigger?: ReinforceTrigger): Promise<void>;
  getWeightedNeighbors(note: string, topK?: number): Promise<WeightedNeighbor[]>;
  activate(
    note: string,
    energy?: number,
    config?: SpreadingActivationConfig,
    onEvent?: ActivationEventSink,
  ): Promise<ActivatedNote[]>;
  retrieveWithFallback(
    note: string,
    energy?: number,
    config?: SpreadingActivationConfig,
    onEvent?: ActivationEventSink,
    options?: RetrieveWithFallbackOptions,
  ): Promise<RetrievalResult>;
  runAblationComparison(
    note: string,
    disabledLayers: Partial<AblationLayers>,
    energy?: number,
    config?: SpreadingActivationConfig,
  ): Promise<AblationDiffResult>;
  compact(onEvent?: ActivationEventSink): Promise<CompactionResult>;
}

export function initInstance(vaultPath: string, instanceId: string = randomUUID()): VaultLinkClient {
  const vaultDataDir = resolveDataDir(vaultPath);
  const sessionBuffer = new SessionBuffer();

  function touch(...notes: string[]): Promise<void> {
    for (const note of notes) sessionBuffer.touch(note);
    return persistSessionBuffer(vaultDataDir, instanceId, sessionBuffer);
  }

  return {
    touch,

    async logTraversal(from: string, to: string, onEvent?: ActivationEventSink, trigger: TraversalTrigger = "read") {
      await touch(from, to);
      const ts = new Date().toISOString();
      await appendEvent(vaultDataDir, instanceId, {
        ts,
        instance: instanceId,
        type: "traverse",
        from,
        to,
        weight_delta: 1,
        trigger,
      });
      onEvent?.({ type: "edge_traversed", runId: randomUUID(), origin: from, hop: 0, from, to, energy: 1, ts });
    },

    async reinforce(
      from: string,
      to: string,
      boost: number = DEFAULT_REINFORCE_BOOST,
      onEvent?: ActivationEventSink,
      trigger: ReinforceTrigger = "explicit",
    ) {
      await touch(from, to);
      const ts = new Date().toISOString();
      await appendEvent(vaultDataDir, instanceId, {
        ts,
        instance: instanceId,
        type: "reinforce",
        from,
        to,
        weight_delta: boost,
        trigger,
      });
      onEvent?.({ type: "edge_traversed", runId: randomUUID(), origin: from, hop: 0, from, to, energy: boost, ts });
    },

    async logSearch(query: string, resultCount: number, useWeights: boolean) {
      await appendSearchLog(vaultDataDir, instanceId, {
        ts: new Date().toISOString(),
        instance: instanceId,
        query,
        resultCount,
        useWeights,
      });
    },

    async getWeightedNeighbors(note: string, topK = 10) {
      await touch(note);
      const start = Date.now();
      const neighbors = await getWeightedNeighbors(vaultDataDir, note, topK, vaultPath, sessionBuffer);
      await appendRetrievalLog(vaultDataDir, instanceId, {
        ts: new Date().toISOString(),
        instance: instanceId,
        note,
        source: "get_weighted_neighbors",
        resultCount: neighbors.length,
        topK,
        latencyMs: Date.now() - start,
      });
      return neighbors;
    },

    async activate(
      note: string,
      energy: number = DEFAULT_ACTIVATION_ENERGY,
      config?: SpreadingActivationConfig,
      onEvent?: ActivationEventSink,
    ) {
      await touch(note);
      return activate(vaultDataDir, note, energy, config, vaultPath, sessionBuffer, onEvent);
    },

    async retrieveWithFallback(
      note: string,
      energy: number = DEFAULT_ACTIVATION_ENERGY,
      config?: SpreadingActivationConfig,
      onEvent?: ActivationEventSink,
      options?: RetrieveWithFallbackOptions,
    ) {
      await touch(note);
      const start = Date.now();
      const result = await retrieveWithFallback(vaultDataDir, vaultPath, note, energy, config, sessionBuffer, onEvent, options);
      await appendRetrievalLog(vaultDataDir, instanceId, {
        ts: new Date().toISOString(),
        instance: instanceId,
        note,
        source: "activate",
        tier: result.tier,
        resultCount: result.notes.length,
        latencyMs: Date.now() - start,
        timedOut: result.timedOut,
        relaxations: result.relaxations,
      });
      return result;
    },

    async runAblationComparison(
      note: string,
      disabledLayers: Partial<AblationLayers>,
      energy: number = DEFAULT_ACTIVATION_ENERGY,
      config?: SpreadingActivationConfig,
    ) {
      await touch(note);
      return runAblationComparison(vaultDataDir, note, energy, disabledLayers, config, vaultPath, sessionBuffer);
    },

    async compact(onEvent?: ActivationEventSink) {
      const result = await compact(vaultDataDir, onEvent);
      // Cheap enough to refresh on every on-demand compaction too, not just
      // the nightly job — the structural graph only changes when notes are
      // edited, but there's no signal here for "did any note change since
      // the last rebuild," so it's simplest to just always redo it.
      await rebuildStructuralIndex(vaultPath, vaultDataDir);
      return result;
    },
  };
}
