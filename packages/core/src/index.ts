import { randomUUID } from "node:crypto";
import { appendEvent } from "./logger.js";
import { compact } from "./compactor.js";
import { getWeightedNeighbors } from "./query.js";
import { resolveDataDir } from "./vaultPaths.js";
import { SessionBuffer, persistSessionBuffer } from "./priming.js";
import type { CompactionResult, WeightedNeighbor } from "./types.js";

export * from "./types.js";
export * from "./parser.js";
export * from "./decay.js";
export * from "./priming.js";
export { appendEvent } from "./logger.js";
export { compact } from "./compactor.js";
export { getWeightedNeighbors, getEdgeWeight } from "./query.js";
export { resolveDataDir } from "./vaultPaths.js";
export * from "./frontmatter.js";
export * from "./notes.js";
export * from "./autolink.js";
export * from "./changelog.js";

const DEFAULT_REINFORCE_BOOST = 5;

export interface VaultLinkClient {
  logTraversal(from: string, to: string): Promise<void>;
  reinforce(from: string, to: string, boost?: number): Promise<void>;
  getWeightedNeighbors(note: string, topK?: number): Promise<WeightedNeighbor[]>;
  compact(): Promise<CompactionResult>;
}

export function initInstance(vaultPath: string, instanceId: string = randomUUID()): VaultLinkClient {
  const vaultDataDir = resolveDataDir(vaultPath);
  const sessionBuffer = new SessionBuffer();

  function touch(...notes: string[]): Promise<void> {
    for (const note of notes) sessionBuffer.touch(note);
    return persistSessionBuffer(vaultDataDir, instanceId, sessionBuffer);
  }

  return {
    async logTraversal(from: string, to: string) {
      await touch(from, to);
      await appendEvent(vaultDataDir, instanceId, {
        ts: new Date().toISOString(),
        instance: instanceId,
        type: "traverse",
        from,
        to,
        weight_delta: 1,
      });
    },

    async reinforce(from: string, to: string, boost: number = DEFAULT_REINFORCE_BOOST) {
      await touch(from, to);
      await appendEvent(vaultDataDir, instanceId, {
        ts: new Date().toISOString(),
        instance: instanceId,
        type: "reinforce",
        from,
        to,
        weight_delta: boost,
      });
    },

    async getWeightedNeighbors(note: string, topK = 10) {
      await touch(note);
      return getWeightedNeighbors(vaultDataDir, note, topK, vaultPath, sessionBuffer);
    },

    async compact() {
      return compact(vaultDataDir);
    },
  };
}
