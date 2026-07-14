import { randomUUID } from "node:crypto";
import { appendEvent, appendRetrievalLog } from "./logger.js";
import { compact } from "./compactor.js";
import { rebuildStructuralIndex } from "./structuralLinks.js";
import { getWeightedNeighbors, computeLiveNeighborWeights } from "./query.js";
import { activate } from "./activation.js";
import { retrieveWithFallback, type RetrievalResult, type RetrieveWithFallbackOptions } from "./fallback.js";
import { resolveDataDir } from "./vaultPaths.js";
import { SessionBuffer, persistSessionBuffer } from "./priming.js";
import type {
  ActivatedNote,
  ActivationEventSink,
  CompactionResult,
  SpreadingActivationConfig,
  WeightedNeighbor,
} from "./types.js";

export * from "./types.js";
export * from "./parser.js";
export * from "./decay.js";
export * from "./priming.js";
export { appendEvent } from "./logger.js";
export { compact } from "./compactor.js";
export { buildStructuralIndex, loadStructuralIndex, rebuildStructuralIndex } from "./structuralLinks.js";
export { consolidate, runNightlyConsolidation } from "./consolidation.js";
export { computePageRank, normalizeImportance, loadNoteImportance, runImportanceComputation } from "./importance.js";
export { resolveSupersededBy, readSupersession } from "./relations.js";
export { getWeightedNeighbors, getEdgeWeight, computeLiveNeighborWeights } from "./query.js";
export { activate } from "./activation.js";
export { retrieveWithFallback, type RetrievalResult, type RetrieveWithFallbackOptions } from "./fallback.js";
export { resolveDataDir } from "./vaultPaths.js";
export * from "./frontmatter.js";
export * from "./notes.js";
export * from "./autolink.js";
export * from "./changelog.js";

const DEFAULT_REINFORCE_BOOST = 5;
const DEFAULT_ACTIVATION_ENERGY = 10;

export interface VaultLinkClient {
  logTraversal(from: string, to: string, onEvent?: ActivationEventSink): Promise<void>;
  reinforce(from: string, to: string, boost?: number, onEvent?: ActivationEventSink): Promise<void>;
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
    async logTraversal(from: string, to: string, onEvent?: ActivationEventSink) {
      await touch(from, to);
      const ts = new Date().toISOString();
      await appendEvent(vaultDataDir, instanceId, {
        ts,
        instance: instanceId,
        type: "traverse",
        from,
        to,
        weight_delta: 1,
      });
      onEvent?.({ type: "edge_traversed", runId: randomUUID(), origin: from, hop: 0, from, to, energy: 1, ts });
    },

    async reinforce(from: string, to: string, boost: number = DEFAULT_REINFORCE_BOOST, onEvent?: ActivationEventSink) {
      await touch(from, to);
      const ts = new Date().toISOString();
      await appendEvent(vaultDataDir, instanceId, {
        ts,
        instance: instanceId,
        type: "reinforce",
        from,
        to,
        weight_delta: boost,
      });
      onEvent?.({ type: "edge_traversed", runId: randomUUID(), origin: from, hop: 0, from, to, energy: boost, ts });
    },

    async getWeightedNeighbors(note: string, topK = 10) {
      await touch(note);
      return getWeightedNeighbors(vaultDataDir, note, topK, vaultPath, sessionBuffer);
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
        tier: result.tier,
        resultCount: result.notes.length,
        latencyMs: Date.now() - start,
        timedOut: result.timedOut,
        relaxations: result.relaxations,
      });
      return result;
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
