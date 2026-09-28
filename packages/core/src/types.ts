/**
 * "term" (VNL-053) is the odd one out: its `from` is a query token, not a
 * note path, and it folds into term-weights.json rather than
 * link-weights.json — see termWeights.ts for why the two graphs are kept
 * apart.
 */
export type EventType = "traverse" | "reinforce" | "decay" | "term";

/**
 * What actually caused a "traverse" event — read_note's automatic logging,
 * log_traversal's manual-credit escape hatch (AIBRAIN-72), or the human
 * opening one note after another inside Obsidian (VNL-052).
 */
export type TraversalTrigger = "read" | "manual" | "human-open" | "history-import";
/**
 * What actually caused a "reinforce" event — an explicit reinforce_link call,
 * AIBRAIN-71's automatic retrieval-then-read correlation, the human
 * editing the note they navigated to inside Obsidian (VNL-052), or the agent
 * writing a wikilink to a note it read this session (VNL-054).
 */
export type ReinforceTrigger = "explicit" | "auto-retrieval" | "human-edit" | "cited";
/** What caused a "term" event — which query-driven tool returned the note that was then read (VNL-053). */
export type TermTrigger = "search-read" | "recall-read";

/**
 * Tuning for the Obsidian plugin's human-navigation sensor (VNL-052).
 *
 * The weights are deliberately far below an agent traversal's 1: the human
 * generates on the order of a hundred times more events than the agent does,
 * so at parity the graph would stop being about what was deliberately
 * retrieved and become a heat map of what was clicked. An edit counts for
 * more than an open because writing in a note is the strongest evidence of
 * engagement the plugin can observe without reading content.
 *
 * These are an opening position, not a measurement — VNL-020's benchmark is
 * where they get earned or changed.
 */
export interface HumanSignalConfig {
  /** Two opens further apart than this are separate visits, not one act of navigation. */
  coOpenWindowMs: number;
  /** Minimum gap between two "human-open" events for the same pair of notes. */
  pairThrottleMs: number;
  /** Minimum gap between two "human-edit" events for the same pair of notes. */
  editThrottleMs: number;
  openWeight: number;
  editWeight: number;
}

/**
 * VNL-065: the one-time import of Obsidian's own recently-opened stack
 * (`workspaceHistory.ts`, D9's second half).
 *
 * `importWeight` sits below VNL-052's live `openWeight` of 0.25 because
 * adjacency in a recently-opened stack is a weaker claim than two opens
 * observed ten minutes apart: the stack collapses repeats, reorders on
 * every visit, and carries no timestamps at all. An opening position, not
 * a measurement.
 */
export interface WorkspaceHistoryConfig {
  importWeight: number;
}

export const DEFAULT_WORKSPACE_HISTORY_CONFIG: WorkspaceHistoryConfig = {
  importWeight: 0.15,
};

export const DEFAULT_HUMAN_SIGNAL_CONFIG: HumanSignalConfig = {
  coOpenWindowMs: 10 * 60 * 1000,
  pairThrottleMs: 60 * 1000,
  editThrottleMs: 5 * 60 * 1000,
  openWeight: 0.25,
  editWeight: 0.5,
};

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
  trigger?: TraversalTrigger | ReinforceTrigger | TermTrigger;
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

/**
 * Learned query-token -> note associations (VNL-053), structurally identical
 * to LinkWeightsFile so the same decay and consolidation math applies
 * unchanged — but a separate file, because these edges are not note-to-note
 * and must never appear as neighbors in the note graph (spreading activation
 * would happily walk into a token and back out into every note that ever
 * matched it).
 *
 * Keys are `token|notePath`, unsorted: direction is meaningful here, unlike
 * link-weights.json's undirected note pairs.
 */
export interface TermWeightsFile {
  version: number;
  compactedAt: string;
  edges: Record<string, EdgeRecord>;
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
  /** Event-log lines that could not be parsed and were moved to events/quarantine/ (VNL-004). */
  quarantinedLines: number;
  /** True when another compactor held the lock and this run did nothing (VNL-004). */
  skipped?: boolean;
  /** Learned query-token -> note edges after this fold (VNL-053). */
  termEdgeCount?: number;
}

export interface DecayConfig {
  /** half-life in days */
  halfLifeDays: number;
  /**
   * AIBRAIN-66 fast-follow: optional fast-decay window. For the first
   * `fastWindowDays` after a touch, weight decays using `fastHalfLifeDays`
   * instead of `halfLifeDays`, then continues at the normal `halfLifeDays`
   * rate from whatever's left. Undefined (default) = no fast phase, pure
   * single-half-life decay exactly as before this fast-follow — existing
   * callers that don't set these two fields are unaffected.
   *
   * Why this exists: benchmark-reinforcement.mjs found a single fresh touch
   * (usage-tier weight ~1) unconditionally outranked pure structural
   * signal (~0.1-0.15 ceiling even at max importance) for days at a time,
   * regardless of topical relevance — removing the reinforce_link tool
   * narrowed who could trigger this but didn't change the ranking math
   * itself. Wired into query.ts's liveWeight for the usage tier only: a
   * lone touch now fades back toward the structural floor within ~48h
   * unless reinforced again, while genuine repeated engagement over
   * several days still accumulates (each new touch resets `lastTouched`,
   * restarting the fast phase from the freshly-boosted baseStrength) and
   * wins clearly.
   */
  fastWindowDays?: number;
  fastHalfLifeDays?: number;
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
 * notes it remembers, how much weight bonus a note in the buffer gets
 * during retrieval, and how fast that bonus decays with time since it was
 * touched (AIBRAIN-141) — buffer *membership* alone used to be treated as
 * binary (touched vs not), so a note touched at the start of a long
 * session stayed exactly as "primed" as one touched a second ago, right up
 * until LRU eviction. Reuses decay.ts's existing exponential half-life
 * decay (see priming.ts's primingBonus) rather than inventing a new curve.
 */
export interface PrimingConfig {
  bufferSize: number;
  bonus: number;
  /**
   * Half-life, in minutes, for the priming bonus's decay since the note
   * was last touched. 20 minutes is a first cut, not measured against real
   * session data: short enough that a session's focus genuinely moving on
   * stops force-ranking stale touches within roughly an hour (3 half-lives
   * ~= 1/8 strength), long enough that a note read a few minutes ago for
   * the same task still gets its full intended effect.
   */
  halfLifeMinutes: number;
}

export const DEFAULT_PRIMING_CONFIG: PrimingConfig = {
  bufferSize: 20,
  bonus: 2,
  halfLifeMinutes: 20,
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
 * AIBRAIN-133: persisted inverted index over note titles, frontmatter
 * aliases, and body content, so searchNotes doesn't have to read every
 * note in the vault on every query — a full linear scan measured at
 * 129.5s against a 300k-note corpus even after AIBRAIN-132's crash fix.
 * Same accepted-staleness convention as structural-links.json/
 * note-importance.json: rebuilt by the nightly pipeline, not synchronously
 * on every write. `coveredPaths` lets a reader detect notes created or
 * renamed since the last rebuild and fall back to scanning just those
 * directly, so a stale index can only ever be slower than fully warm,
 * never silently miss a real note.
 */
export interface ContentIndexFile {
  version: number;
  builtAt: string;
  /** Every note path this index covers, sorted — see the staleness note above. */
  coveredPaths: string[];
  /**
   * Lowercased token -> sorted note paths whose title, aliases, or body
   * contain that token at least once. Field-agnostic by design: this only
   * narrows which notes are worth reading at all — searchNotes's matchField
   * still re-derives the real match tier (title/alias/content) and quality
   * from live content for whatever candidate set this produces.
   */
  postings: Record<string, string[]>;
}

/**
 * VNL-051 — one semantic vector per note, written by the nightly job when
 * the optional embedding model is installed. Absent for every vault that
 * has not opted in, which is why every reader of it must treat null as a
 * normal state rather than a missing dependency.
 */
export interface EmbeddingsFile {
  version: number;
  /**
   * Model that produced these vectors. Two models' vector spaces are
   * unrelated, so a stored vector is only ever reused or compared when this
   * matches the live provider — a model change invalidates the whole file.
   */
  model: string;
  /** Vector length (384 for all-MiniLM-L6-v2). 0 only in an index with no notes. */
  dim: number;
  builtAt: string;
  /**
   * Note path -> the hash of the text that was embedded (so an incremental
   * rebuild can skip unchanged notes) and the L2-normalized vector, base64
   * float32. Normalized on write so cosine similarity is a plain dot
   * product at query time.
   */
  notes: Record<string, { hash: string; vector: string }>;
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
 * VNL-021 (D9) cold-start seeding. A vault that has just installed the
 * engine has no usage history at all, so every structural-only neighbor
 * gets the same flat `floorWeight` above and the graph can order nothing —
 * the differentiator cannot differentiate until months of traversals exist.
 * These priors give a wikilink an opening weight derived from evidence that
 * is already on disk on day one: whether the link is reciprocated, how
 * specific the target is, and how recently the target was edited.
 *
 * Three properties are deliberate, and each is a constraint the
 * implementation has to keep:
 *
 * - **A prior is never a measurement.** Seeds live in their own
 *   `seed-weights.json`, never in `link-weights.json`, for the same reason
 *   VNL-053 kept term weights separate: folding a guess into the usage graph
 *   would corrupt every future `zeroUsage` ablation and make VNL-022's
 *   month-6 verdict unanswerable.
 * - **Additive to the floor, never below it.** The seeded weight is
 *   `floorWeight + bonus`, so the worst case is exactly today's behaviour and
 *   the change can only reorder structural-only candidates among themselves.
 *   VNL-058 measured the flat floor as the one load-bearing layer; this must
 *   not be able to erode it.
 * - **Short half-life, so real traversal wins quickly.** A pair that has any
 *   usage edge never consults the seed at all (the usage tier already
 *   shadows the structural one), and the bonus itself fades on a half-life
 *   well under the 30-day usage default, so an untouched guess stops
 *   competing on its own.
 *
 * The numbers below are an opening position, not a measurement — VNL-020 is
 * where they are earned or changed (D6).
 */
export interface ColdStartSeedConfig {
  /**
   * Ceiling for the prior, before specificity and recency scale it down.
   * Set level with `floorWeight`, so the strongest possible seed doubles a
   * structural candidate's weight and the weakest leaves it untouched —
   * still an order of magnitude below a single usage touch (~1), because a
   * prior must never outrank something a human or agent actually did.
   */
  maxBonus: number;
  /**
   * Half-life, in days, of the recency component, measured from the target
   * note's file mtime. Shorter than DEFAULT_DECAY_CONFIG's 30 on purpose:
   * "this area of the vault is being worked on right now" is a claim with a
   * short shelf life.
   */
  halfLifeDays: number;
  /**
   * Multiplier for a link that is not reciprocated. A mutual link is two
   * independent authoring decisions and much stronger evidence of a real
   * relationship than one note mentioning another in passing.
   */
  oneWayFactor: number;
}

export const DEFAULT_COLD_START_SEED_CONFIG: ColdStartSeedConfig = {
  maxBonus: 0.1,
  halfLifeDays: 14,
  oneWayFactor: 0.5,
};

/** One directed prior: what the seed tier is worth when querying `from` and considering `to`. */
export interface SeedRecord {
  /** The undecayed bonus, already scaled by specificity and reciprocity. */
  strength: number;
  /** ISO mtime of the `to` note — the timestamp the bonus decays from. */
  recencyAt: string;
}

/**
 * Cold-start priors over structural (wikilink) edges, rebuilt by the nightly
 * pipeline. Keys are `from|to` and **directional**, unlike
 * link-weights.json's sorted undirected pairs: within one origin note's
 * candidate set every candidate shares the origin, so the only thing that
 * can separate them is the other endpoint — its specificity and its mtime.
 */
export interface SeedWeightsFile {
  version: number;
  builtAt: string;
  edges: Record<string, SeedRecord>;
}


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
  /**
   * VNL-021 cold-start priors on top of that floor (seedWeights.ts). Nested
   * under `structuralFallback` in effect: ablating the floor removes the
   * candidates these priors would have reordered, so this layer can only
   * matter while the floor is on.
   */
  coldStartSeed: boolean;
}

/**
 * Every mechanism enabled. This is the *reference* configuration that
 * `runAblationComparison` measures against, not what the serving path runs —
 * see `HOT_PATH_ABLATION_LAYERS`.
 */
export const DEFAULT_ABLATION_LAYERS: AblationLayers = {
  priming: true,
  importance: true,
  consolidation: true,
  structuralFallback: true,
  coldStartSeed: true,
};

/**
 * What retrieval actually runs (VNL-058 — the mechanism diet).
 *
 * Measured through `recall` against the real 492-note vault with VNL-020's
 * 70-query set, cold. Disabling `importance` and disabling `consolidation`
 * each produced results **bit-identical** to leaving them on — 0.6974 MRR,
 * 41/70 rank-1, 68/70 found, to four decimal places, individually and
 * together. They are not small effects; on this corpus they are no effect.
 *
 * Both stay in the code and stay reachable, because "no effect on this vault
 * today" is not "no effect": consolidation needs three distinct-day
 * reactivations inside a week before it scores anything at all (AIBRAIN-31
 * measured it inert for the same reason two months ago), and importance is a
 * PageRank multiplier that needs a denser link graph than eight weeks of use
 * produces. What changes is that neither is in the path by default, and
 * neither is claimed in the README until a measurement earns it back.
 *
 * `structuralFallback` stays on: it is the only layer whose removal is
 * visible — 0.6835 MRR and 39/70 rank-1, i.e. it is carrying real retrieval,
 * exactly as AIBRAIN-31 found.
 *
 * `priming` is **off**, decided by the founder on 2026-09-09 once the
 * measurement was put plainly. It scores +0.039 MRR in the target-primed
 * condition and **−0.017 in the related-primed one**. The first is the
 * circular case — the buffer already holds the note being searched for, so
 * the engine is being asked whether it can find what it was just told. The
 * second is what real work looks like: you have read *around* a subject and
 * now want the note you have not seen. There priming pushes what you have
 * already read above what you are looking for, which is the opposite of
 * useful. In one sentence: it made the engine repeat itself.
 *
 * This overturns a positioning claim, not just a default — D3 led with
 * "session priming" as one of three headline mechanisms, and that clause is
 * struck from the headline rather than quietly kept while the code stops
 * doing it (see docs/PLAN.md D3 and §9).
 *
 * The mechanism stays implemented and reachable. `why.primed` still reports
 * whether a hit was seen this session, since that is information about the
 * result rather than a thumb on the scale, and VNL-056 still uses it to
 * suppress a staleness warning on a note read minutes ago.
 */
export const HOT_PATH_ABLATION_LAYERS: AblationLayers = {
  priming: false,
  importance: false,
  consolidation: false,
  structuralFallback: true,
  // VNL-021, measured 2026-09-10 and left OFF on the same rule as importance
  // and consolidation above: nothing enters the serving path without a lift.
  //
  // Real 492-note vault, VNL-020's 70 queries, cold, seeds off vs on in one
  // process from one baseline: 0.6977 → 0.6977 (maxBonus 0.1, the shipped
  // calibration), 0.6978 at 0.3 and at 1.0, and 0.6941 at 5.0 — i.e. no
  // effect until the prior is large enough to start doing damage. Repeated
  // against a *simulated fresh install* (the same indexes with all usage
  // history removed, which is the population D9 is about): 0.6998 off,
  // 0.6998 / 0.7001 / 0.7003 on. Two rank-1 counts identical at 41/70
  // throughout.
  //
  // The mechanism works — a mutual, specific, recently-edited link does
  // outrank a one-way link to a hub, and the unit tests hold it to that.
  // It does not matter, because reordering the structural tier reorders
  // candidates whose energy sits far below the lexical and semantic seeds
  // that decide the ranking (VNL-020: embeddings carry the win). A prior
  // over a graph axis that is itself net-neutral cannot be worth more than
  // the axis.
  //
  // Kept, not deleted, and still built nightly: the file is what lets the
  // same question be asked on someone else's vault — a genuinely new user's,
  // with a link graph this one no longer resembles — without a code change,
  // which is exactly what VNL-022's ≥3-vault gate needs.
  coldStartSeed: false,
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
  /** The note the retrieval started from. Absent for source: "recall", which starts from a query — see `query` (VNL-050). */
  note?: string;
  /** The query text, for source: "recall" only. */
  query?: string;
  /** Which tool produced this entry (AIBRAIN-126). Missing on entries logged before this field existed — treat as "activate". */
  source?: "activate" | "get_weighted_neighbors" | "recall";
  /** Set for source: "activate" only — get_weighted_neighbors is a direct lookup, not a tiered fallback pipeline. */
  tier?: "activation" | "keyword" | "recency";
  resultCount: number;
  latencyMs: number;
  /** True if the per-call time budget was exhausted before retrieval finished, so the tier/results served may be partial. Activate-only. */
  timedOut?: boolean;
  /** How many times activation's min/structuralMinThreshold were relaxed to try to reach minK results. Activate-only. */
  relaxations?: number;
  /** Set for source: "get_weighted_neighbors" and "recall" — the topK it was called with. */
  topK?: number;
  /** Set for source: "recall" — how many notes were read and lexically scored for this query (VNL-050). */
  candidatesScored?: number;
}


/**
 * Persisted trace of a search_notes call (AIBRAIN-70). Previously
 * search_notes only touched the in-memory session buffer and left no trace
 * on disk at all — this closes that gap so search frequency is measurable
 * alongside traverse/reinforce/activate, unconditionally regardless of what
 * the caller does with the results.
 */
/**
 * VNL-057 — one line per `recall` call, plus one per result that was
 * subsequently opened, plus one when a write followed a read.
 *
 * A separate log from `search/` and `retrieval/` on purpose: those record
 * call-level outcomes (tier, latency, result count), while this records a
 * *relationship over time* between one call and what the agent did next, and
 * folding the two would make both harder to read.
 */
export type RecallLogEntry =
  | {
      ts: string;
      instance: string;
      type: "returned";
      /** Unique per recall call — what `read`/`write` lines attribute back to. */
      recallId: string;
      query: string;
      resultCount: number;
      /**
       * VNL-073(A): the list as it was shown, in order. Absent on lines
       * written before 2026-09-28. Without it a skipped result cannot be
       * told from one that was never looked at, and no call can be
       * replayed (VNL-074).
       */
      hits?: RecallLogHit[];
    }
  | { ts: string; instance: string; type: "read"; recallId: string; path: string }
  | { ts: string; instance: string; type: "write"; recallId: string; path: string };

/**
 * One shown result, as logged (VNL-073(A)). Carries what outcome learning
 * needs to credit the link that *delivered* the result — `via` for a graph
 * hit, the matched or learned terms otherwise — plus every axis' score, so
 * VNL-074 can re-rank the shown list offline without re-running retrieval.
 */
export interface RecallLogHit {
  path: string;
  /** 1-based position in the list the caller saw. */
  rank: number;
  source: string;
  score: number;
  lexicalScore: number;
  graphEnergy?: number;
  termScore?: number;
  semanticScore?: number;
  via?: string;
  hops?: number;
  matchedTerms?: string[];
  learnedTerms?: string[];
  /** VNL-073 shadow score (log-odds shift from the vault's open rate); absent when no route had evidence. */
  outcomeScore?: number;
}

/**
 * The production usefulness metric (VNL-057) — what share of what `recall`
 * returned was actually opened, and how often a recall was followed by real
 * work. Replaces "rank 1 of a pre-seeded target" as the number the project
 * steers by; see recallLog.ts for what it can and cannot observe.
 */
export interface ReadThroughReport {
  recalls: number;
  resultsReturned: number;
  resultsRead: number;
  /** Recalls where at least one returned note was opened afterwards. */
  recallsWithAnyRead: number;
  /** Recalls where a note was written after one of their results was read. */
  recallsFollowedByWrite: number;
  /**
   * Results read / results returned. The literal reading of "read-through
   * rate", and structurally small: an agent that opens two of ten results
   * scores 0.2 while having been served perfectly.
   */
  resultReadRate: number | null;
  /** Recalls with any read / recalls — "did this call help at all". */
  usefulRecallRate: number | null;
  /** Recalls followed by a write / recalls — the closest observable proxy for "it reached the work". */
  writeFollowRate: number | null;
  firstRecallAt: string | null;
  lastRecallAt: string | null;
}

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
  /** Agent-side traversals only (read_note auto-logging and log_traversal) — see `human` for the plugin's. */
  traverse: number;
  /**
   * Split by trigger (AIBRAIN-71) so the report can tell explicit
   * reinforce_link use apart from automatic retrieval-then-read
   * reinforcement, and both apart from `cited` — VNL-054's write-back
   * signal, the only one of the three that observes the agent *using* a
   * note rather than opening it.
   */
  reinforce: { explicit: number; autoRetrieval: number; cited: number };
  /**
   * Events contributed by the human moving around Obsidian (VNL-052), kept
   * apart from the agent's counts above: the two have different volumes and
   * different per-event weights, and mixing them would make both unreadable.
   */
  /** VNL-052 live navigation, and VNL-065's one-time import of Obsidian's recently-opened stack kept separate from it — imported adjacency is weaker evidence than an open this machine watched happen. */
  human: { opens: number; edits: number; historyImported: number };
  /**
   * Term-to-note learning events (VNL-053) — a query's selective terms
   * credited to a note that was read right after search_notes/recall
   * returned it. Split by which tool produced the query, not by weight
   * tier: both are the same deterministic signal.
   */
  termLearn: { searchRead: number; recallRead: number };
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
  /**
   * Production usefulness (VNL-057) — what share of what `recall` returned
   * was actually opened afterwards. The number this project steers by, in
   * place of rank-1 against a pre-seeded target.
   */
  readThrough: ReadThroughReport;
  /** Semantic-index coverage of the indexed vault (VNL-071); null when the vault has no semantic index. */
  embeddings: import("./embeddings.js").EmbeddingCoverage | null;
  /** Known instrumentation or usage-pattern caveats surfaced alongside the numbers, e.g. mechanisms with no persisted trace. */
  gaps: string[];
}
