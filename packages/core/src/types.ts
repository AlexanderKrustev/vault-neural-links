export type EventType = "traverse" | "reinforce" | "decay";

export interface EventLogEntry {
  ts: string;
  instance: string;
  type: EventType;
  from: string;
  to: string;
  weight_delta: number;
}

export interface EdgeRecord {
  weight: number;
  lastTouched: string;
  traverseCount: number;
  reinforceCount: number;
}

export interface LinkWeightsFile {
  version: number;
  compactedAt: string;
  edges: Record<string, EdgeRecord>;
}

export interface WeightedNeighbor {
  path: string;
  weight: number;
  lastTouched: string;
}

export interface CompactionResult {
  edgeCount: number;
  compactedAt: string;
}

export interface DecayConfig {
  /** half-life in days */
  halfLifeDays: number;
}

export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  halfLifeDays: 30,
};
