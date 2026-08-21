export type EventType = "traverse" | "reinforce" | "decay";

/** What actually caused a "traverse" event — read_note's automatic logging, or log_traversal's manual-credit escape hatch (AIBRAIN-72). */
export type TraversalTrigger = "read" | "manual";
/** What actually caused a "reinforce" event — an explicit reinforce_link call, or AIBRAIN-71's automatic retrieval-then-read correlation. */
export type ReinforceTrigger = "explicit" | "auto-retrieval";

export interface EventLogEntry {
  ts: string;
  instance: string;
  type: EventType;
  from: string;
  to: string;
  weight_delta: number;
  /**
   * Absent on events logged before this field existed (2026-08-16) — treat
   * a missing trigger as "read" for traverse events and "explicit" for
   * reinforce events, since that's all that could have produced them then.
   */
  trigger?: TraversalTrigger | ReinforceTrigger;
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
  // AIBRAIN-66 fast-follow: tried raising this to 0.5 to give a highly
  // important structural-only neighbor more room to compete with a single
  // ordinary usage touch — reverted (packages/core/scripts/benchmark-
  // baselines.mjs regressed: found 16/18 -> 15/18, mean rank 3.25 -> 4.6)
  // and it did nothing for the actual problem it was meant to help
  // (benchmark-reinforcement.mjs's distractor still ranked #1 once
  // reinforced). The real fix needs importance to be able to dampen usage
  // weight for topically-irrelevant edges, not just lift this floor —
  // scoped as separate follow-on work, not a constant to keep guessing at.
  floorWeight: 0.1,
};


/**
 * Which optional scoring layers contribute to a retrieval run — everything
 * true reproduces normal retrieval; setting any to false ablates that
 * layer's contribution so a caller can diff "with" vs "without" (AIBRAIN-27).
 * The base layer (usage-weighted decay + multi-hop spreading activation
 * itself) is never ablatable — these are the additive/multiplicative
 * layers stacked on top of it in computeLiveNeighborWeights/liveWeight.
 */
export interface AblationLayers {
  /** Session-buffer priming bonus (priming.ts). */
  priming: boolean;
  /** PageRank-style importance multiplier (importance.ts). */
  importance: boolean;
  /** Undecayed long-term consolidated-tier score (consolidation.ts). */
  consolidation: boolean;
  /** Structural-only (no-usage-history) floor-weight fallback neighbors. */
  structuralFallback: boolean;
}

export const DEFAULT_ABLATION_LAYERS: AblationLayers = {
  priming: true,
  importance: true,
  consolidation: true,
  structuralFallback: true,
};

/** A named layer difference between two ablation runs, for AIBRAIN-27's before/after diff panel. */
export interface AblationDiffEntry {
  path: string;
  /** Present in baseline (full layers), absent once the ablated layer(s) are turned off. */
  status: "removed" | "added" | "reranked";
  baselineEnergy?: number;
  ablatedEnergy?: number;
  baselineHops?: number;
  ablatedHops?: number;
}

export interface AblationDiffResult {
  note: string;
  disabledLayers: Partial<AblationLayers>;
  baseline: ActivatedNote[];
  ablated: ActivatedNote[];
  diff: AblationDiffEntry[];
}

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
  /** Which tool produced this entry (AIBRAIN-126). Missing on entries logged before this field existed — treat as "activate". */
  source?: "activate" | "get_weighted_neighbors";
  /** Set for source: "activate" only — get_weighted_neighbors is a direct lookup, not a tiered fallback pipeline. */
  tier?: "activation" | "keyword" | "recency";
  resultCount: number;
  latencyMs: number;
  /** True if the per-call time budget was exhausted before retrieval finished, so the tier/results served may be partial. Activate-only. */
  timedOut?: boolean;
  /** How many times activation's min/structuralMinThreshold were relaxed to try to reach minK results. Activate-only. */
  relaxations?: number;
  /** Set for source: "get_weighted_neighbors" only — the topK it was called with. */
  topK?: number;
}


/**
 * Persisted trace of a search_notes call (AIBRAIN-70). Previously
 * search_notes only touched the in-memory session buffer and left no trace
 * on disk at all — this closes that gap so search frequency is measurable
 * alongside traverse/reinforce/activate, unconditionally regardless of what
 * the caller does with the results.
 */
export interface SearchLogEntry {
  ts: string;
  instance: string;
  query: string;
  resultCount: number;
  useWeights: boolean;
}


/**
 * Personal usage report (AIBRAIN-68) — summarizes the append-only event/
 * retrieval/session logs back to the user: how often they actually use each
 * mechanism, which notes get touched most, and how that compares to what
 * the engine considers important. Computed on demand from disk, not
 * persisted itself.
 */
export interface UsageReportSession {
  instance: string;
  firstEventAt: string | null;
  lastEventAt: string | null;
  /** Span between firstEventAt and lastEventAt; null if fewer than two timestamped events exist for this instance. */
  durationMinutes: number | null;
}

export interface UsageReportMechanismCounts {
  traverse: number;
  /** Split by trigger (AIBRAIN-71) so the report can tell explicit reinforce_link use apart from automatic retrieval-then-read reinforcement. */
  reinforce: { explicit: number; autoRetrieval: number };
  activate: { activation: number; keyword: number; recency: number };
  /** get_weighted_neighbors() call count (AIBRAIN-126) — previously invisible to this report since the tool logged nothing. */
  getWeightedNeighbors: number;
  search: number;
}

export interface UsageReportNoteTouch {
  path: string;
  /** Times this note appeared as either endpoint of a traverse/reinforce event. */
  touches: number;
  /** PageRank-style importance score (0-1) from note-importance.json, or null if the note isn't scored (e.g. never linked). */
  importance: number | null;
}

export interface UsageReport {
  generatedAt: string;
  sessionCount: number;
  sessions: UsageReportSession[];
  /** Median duration across sessions with a measurable span; null if none. */
  typicalSessionMinutes: number | null;
  mechanismCounts: UsageReportMechanismCounts;
  topTouchedNotes: UsageReportNoteTouch[];
  /** % overlap between the top-touched notes and the top-importance notes (same N); null if either side is empty. */
  importanceOverlapPct: number | null;
  /** Known instrumentation or usage-pattern caveats surfaced alongside the numbers, e.g. mechanisms with no persisted trace. */
  gaps: string[];
}
