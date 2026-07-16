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
  /** "usage" when backed by a real traversal/reinforcement edge, "structural" when this is a wikilink-only fallback with no usage history yet (see structuralLinks.ts). */
  source: "usage" | "structural";
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


/**
 * Controls spreading activation: retrieval that follows edges past a note's
 * direct neighbors so indirect (multi-hop) context can surface too, instead
 * of being invisible to callers that only ever asked for direct neighbors.
 */
export interface SpreadingActivationConfig {
  /** Fraction of a node's energy carried forward into the next hop, before being split across its neighbors by relative edge weight. */
  energyEdgeWeightDecayPerHop: number;
  /** Hard cap on hops from the origin note (bounded to 2-3 per the design — unbounded spread would turn a local query into a full-graph walk). */
  maxHops: number;
  /** Energy below this stops both further propagation from a node and inclusion of that node in results. Applied to usage-weighted edges. */
  minThreshold: number;
  /**
   * Same cutoff as `minThreshold` but applied to structural-only (floor-weight,
   * no-usage-history) edges. A note with many wikilinks splits the same starting
   * energy across every neighbor, so any fan-out past a handful of edges pushes
   * each share under a threshold tuned for usage edges and silently kills
   * propagation — this tier gets its own, more forgiving cutoff instead.
   */
  structuralMinThreshold: number;
}

export const DEFAULT_SPREADING_ACTIVATION_CONFIG: SpreadingActivationConfig = {
  energyEdgeWeightDecayPerHop: 0.5,
  maxHops: 3,
  minThreshold: 0.5,
  structuralMinThreshold: 0.05,
};

export interface ActivatedNote {
  path: string;
  energy: number;
  /** Fewest hops from the origin note at which this note was reached. */
  hops: number;
}

/**
 * Emitted by `activate()` as it walks the graph, so a caller (the MCP server,
 * in turn broadcasting to the Obsidian plugin) can animate/audit the
 * traversal instead of only seeing the final ranked result set.
 */
export type ActivationEventType = "node_activated" | "edge_traversed";

/**
 * Persisted bidirectional wikilink adjacency, built by scanning every
 * note's raw content (see structuralLinks.ts) rather than derived from
 * usage events — the structural graph exists independently of whether
 * anyone has ever called log_traversal/reinforce_link on a pair of notes.
 */
export interface StructuralLinksFile {
  version: number;
  builtAt: string;
  /** note path -> directly wikilinked note paths (deduped, sorted, bidirectional) */
  edges: Record<string, string[]>;
}

/**
 * Controls the retrieval fallback tier that treats a plain wikilink as
 * weak-but-real evidence of a relationship, so a note pair with no usage
 * history yet doesn't score identically to two unrelated notes. Only
 * applied when no usage-weighted edge already exists for that pair.
 */
export interface StructuralFallbackConfig {
  floorWeight: number;
}

export const DEFAULT_STRUCTURAL_FALLBACK_CONFIG: StructuralFallbackConfig = {
  floorWeight: 0.1,
};

export interface ActivationTraceEvent {
  type: ActivationEventType;
  /** Groups every event from one activate() call. */
  runId: string;
  /** The note activate() was called on. */
  origin: string;
  hop: number;
  /** Set on "node_activated". */
  node?: string;
  /** Set on "edge_traversed". */
  from?: string;
  /** Set on "edge_traversed". */
  to?: string;
  /** Energy transferred along the edge / arriving at the node. */
  energy: number;
  ts: string;
}

export type ActivationEventSink = (event: ActivationTraceEvent) => void;

/**
 * One line per retrieveWithFallback call, so an operator can catch a whole
 * cluster of queries systematically falling through to a weaker tier (or
 * timing out) before it shows up as a bad session/demo, rather than only
 * finding out after the fact. Appended to retrieval-log.jsonl by logger.ts.
 */
/**
 * Controls periodic (batch, not per-query) PageRank-style importance
 * scoring over the structural (wikilink) graph — deliberately independent
 * of usage/decay, so a genuine hub note stays weighted even during a long
 * stretch with no traversal/reinforce activity.
 */
export interface ImportanceConfig {
  dampingFactor: number;
  iterations: number;
  convergenceTolerance: number;
  /** λ in `final_score = activation_score * (1 + λ * importance)` — blend strength; higher values let hub notes swing retrieval order more. */
  blendLambda: number;
}

export const DEFAULT_IMPORTANCE_CONFIG: ImportanceConfig = {
  dampingFactor: 0.85,
  iterations: 50,
  convergenceTolerance: 1e-6,
  blendLambda: 0.5,
};

/**
 * Persisted, min-max-normalized PageRank-style importance per note (see
 * importance.ts) — the most-linked note in the vault scores 1.0, a leaf
 * note scores 0. Recomputed periodically (see bin/vnl-nightly.js), read at
 * query time rather than computed live.
 */
export interface NoteImportanceFile {
  version: number;
  computedAt: string;
  scores: Record<string, number>;
}

export interface ImportanceResult {
  noteCount: number;
  computedAt: string;
}

/**
 * Controls periodic (batch, not per-query) Louvain-style community
 * detection over the structural (wikilink) graph. Unlike importance, this
 * feeds the visualization layer (node color / cluster grouping) rather than
 * retrieval scoring directly — see clustering.ts.
 */
export interface ClusteringConfig {
  /** Standard Louvain resolution parameter; higher values favor more, smaller communities. */
  resolution: number;
  /** Hard cap on aggregation levels, so a pathological graph can't loop indefinitely. */
  maxLevels: number;
}

export const DEFAULT_CLUSTERING_CONFIG: ClusteringConfig = {
  resolution: 1.0,
  maxLevels: 10,
};

/**
 * Persisted cluster assignment per note (see clustering.ts) — cluster ids
 * are arbitrary stable strings, not meaningful labels. Recomputed
 * periodically (see bin/vnl-nightly.js), read at query time rather than
 * computed live.
 */
export interface NoteClustersFile {
  version: number;
  computedAt: string;
  /** note path -> cluster id */
  clusters: Record<string, string>;
}

export interface ClusteringResult {
  noteCount: number;
  clusterCount: number;
  computedAt: string;
}

export interface RetrievalLogEntry {
  ts: string;
  instance: string;
  note: string;
  tier: "activation" | "keyword" | "recency";
  resultCount: number;
  latencyMs: number;
  /** True if the per-call time budget was exhausted before retrieval finished, so the tier/results served may be partial. */
  timedOut: boolean;
  /** How many times activation's min/structuralMinThreshold were relaxed to try to reach minK results. */
  relaxations: number;
}
