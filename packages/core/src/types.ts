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
  /** Raw accumulated weight from events, undecayed — decay is applied live at query time. Fast-decaying "recent" tier. */
  baseStrength: number;
  lastTouched: string;
  traverseCount: number;
  reinforceCount: number;
  /** Distinct "YYYY-MM-DD" calendar days this edge was reactivated (traverse/reinforce), used to detect repeated reactivation for consolidation promotion. Pruned to a generous retention window during compaction. */
  reactivationDays: string[];
  /** Long-term tier promoted by the nightly consolidation job once reactivationDays crosses its threshold — added undecayed to live weight, so consolidated edges resist the recent tier's decay entirely. */
  consolidatedScore: number;
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
  /** Set when this note's frontmatter marks it `status: superseded` — surfaces its successor even though its usage weight/recency gives no hint it's outdated. */
  supersededBy?: string;
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


/**
 * Per-note-type decay tau (half-life), keyed by frontmatter `type`. Lets
 * situational/client notes fade fast while structural/reference notes stay
 * visible longer, instead of one global half-life for every note.
 */
export interface NoteTypeDecayConfig {
  defaultHalfLifeDays: number;
  byType: Record<string, number>;
}

export const DEFAULT_NOTE_TYPE_DECAY_CONFIG: NoteTypeDecayConfig = {
  defaultHalfLifeDays: 30,
  byType: {
    moc: 90,
    atomic: 30,
    project: 14,
  },
};

/**
 * Controls the session-scoped priming buffer: how many recently-accessed
 * notes it remembers, and how much weight bonus a note in the buffer gets
 * during retrieval.
 */
export interface PrimingConfig {
  bufferSize: number;
  bonus: number;
}

export const DEFAULT_PRIMING_CONFIG: PrimingConfig = {
  bufferSize: 20,
  bonus: 2,
};


/**
 * Persisted snapshot of one MCP server instance's in-memory SessionBuffer,
 * written under `.vault-neural-links/session/<instance>.json` so the
 * Obsidian plugin (a separate process) can render primed-note state.
 */
export interface SessionBufferFile {
  instance: string;
  updatedAt: string;
  notes: string[];
}


/**
 * Controls promotion into the long-term "consolidated" tier: an edge is
 * promoted once it's been reactivated on at least `reactivationThreshold`
 * distinct days within the trailing `windowDays` — modeling spaced
 * repetition rather than a single burst of activity.
 */
export interface ConsolidationConfig {
  reactivationThreshold: number;
  windowDays: number;
  promotionIncrement: number;
}

export const DEFAULT_CONSOLIDATION_CONFIG: ConsolidationConfig = {
  reactivationThreshold: 3,
  windowDays: 7,
  promotionIncrement: 1,
};

export interface ConsolidationResult {
  edgeCount: number;
  promotedCount: number;
  consolidatedAt: string;
}
