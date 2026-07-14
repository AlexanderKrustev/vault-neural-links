import { activate } from "./activation.js";
import { mostRecentNotes, searchNotes } from "./notes.js";
import type { RecentNote, SearchHit } from "./notes.js";
import type { SessionBuffer } from "./priming.js";
import type { ActivatedNote, ActivationEventSink, SpreadingActivationConfig } from "./types.js";
import { DEFAULT_SPREADING_ACTIVATION_CONFIG } from "./types.js";

const KEYWORD_FALLBACK_TOPK = 10;
const RECENCY_FALLBACK_TOPK = 10;

/** Minimum activated notes to aim for (AIBRAIN-24) before accepting the activation tier's result as final. */
const DEFAULT_MIN_K = 3;
/** Multiplier applied to both thresholds on each relaxation attempt. */
const RELAXATION_FACTOR = 0.5;
/** Caps how many times thresholds get relaxed — an unbounded loop here would defeat the point of a bounded call. */
const MAX_RELAXATION_ATTEMPTS = 3;
/** Thresholds never relax past this — a literal 0 cutoff would let energy propagate forever. */
const THRESHOLD_FLOOR = 0.01;

/** Hard wall-clock budget for a whole retrieveWithFallback call (AIBRAIN-26), including any relaxation retries. */
const DEFAULT_BUDGET_MS = 300;

export interface RetrieveWithFallbackOptions {
  /** Guaranteed minimum result count to aim for via threshold relaxation before falling through tiers (default 3). */
  minK?: number;
  /** Hard time budget in ms for the whole call (default 300) — see AIBRAIN-26. */
  budgetMs?: number;
}

interface RetrievalMeta {
  /** How many times minThreshold/structuralMinThreshold were relaxed trying to reach minK. */
  relaxations: number;
  /** True if the time budget ran out before retrieval could finish normally — results may be partial. */
  timedOut: boolean;
}

export type RetrievalResult =
  | ({ tier: "activation"; notes: ActivatedNote[] } & RetrievalMeta)
  | ({ tier: "keyword"; notes: SearchHit[] } & RetrievalMeta)
  | ({ tier: "recency"; notes: RecentNote[] } & RetrievalMeta);

function relax(config: SpreadingActivationConfig): SpreadingActivationConfig | undefined {
  const minThreshold = Math.max(config.minThreshold * RELAXATION_FACTOR, THRESHOLD_FLOOR);
  const structuralMinThreshold = Math.max(config.structuralMinThreshold * RELAXATION_FACTOR, THRESHOLD_FLOOR);
  if (minThreshold === config.minThreshold && structuralMinThreshold === config.structuralMinThreshold) {
    return undefined; // already at the floor — relaxing further would be a no-op
  }
  return { ...config, minThreshold, structuralMinThreshold };
}

/**
 * Guarantees a retrieval call never comes back empty, and — within a bounded
 * time/attempt budget — tries not to come back thin either. `activate`
 * already blends usage-weighted and structural-only (floor-weight) edges, so
 * most queries resolve there; when it finds fewer than `minK` notes, this
 * progressively relaxes its energy thresholds and retries rather than
 * accepting a sparse result or an empty one (AIBRAIN-24). Only once
 * activation still comes back empty (no edges of any kind — freshly
 * created, or genuinely disconnected) does this fall through to a
 * keyword/title match over the vault, and — as a last resort — to the most
 * recently touched notes.
 *
 * The whole call, including relaxation retries, is bounded by `budgetMs`
 * (AIBRAIN-26): `activate` checks the deadline mid-walk and returns whatever
 * it has accumulated so far rather than blocking past it, and once the
 * budget is spent this skips the (relatively expensive) keyword tier in
 * favor of the cheap recency tier, so a slow vault degrades to a fast
 * partial answer instead of a slow complete one.
 */
export async function retrieveWithFallback(
  vaultDataDir: string,
  vaultPath: string,
  note: string,
  energy: number,
  config?: SpreadingActivationConfig,
  sessionBuffer?: SessionBuffer,
  onEvent?: ActivationEventSink,
  options?: RetrieveWithFallbackOptions,
): Promise<RetrievalResult> {
  const minK = options?.minK ?? DEFAULT_MIN_K;
  const deadline = Date.now() + (options?.budgetMs ?? DEFAULT_BUDGET_MS);

  let cfg = config ?? DEFAULT_SPREADING_ACTIVATION_CONFIG;
  let activated = await activate(vaultDataDir, note, energy, cfg, vaultPath, sessionBuffer, onEvent, deadline);
  let relaxations = 0;

  while (activated.length < minK && relaxations < MAX_RELAXATION_ATTEMPTS && Date.now() < deadline) {
    const relaxed = relax(cfg);
    if (!relaxed) break;
    cfg = relaxed;
    relaxations++;
    activated = await activate(vaultDataDir, note, energy, cfg, vaultPath, sessionBuffer, onEvent, deadline);
  }

  const timedOut = Date.now() >= deadline;

  if (activated.length > 0) {
    return { tier: "activation", notes: activated, relaxations, timedOut };
  }

  if (timedOut) {
    const recent = await mostRecentNotes(vaultPath, RECENCY_FALLBACK_TOPK, note);
    return { tier: "recency", notes: recent, relaxations, timedOut };
  }

  const keyword = note.split("/").pop() ?? note;
  const hits = (
    await searchNotes(vaultPath, keyword, { topK: KEYWORD_FALLBACK_TOPK, vaultDataDir, useWeights: true })
  ).filter((hit) => hit.path !== note);
  if (hits.length > 0) {
    return { tier: "keyword", notes: hits, relaxations, timedOut: Date.now() >= deadline };
  }

  const recent = await mostRecentNotes(vaultPath, RECENCY_FALLBACK_TOPK, note);
  return { tier: "recency", notes: recent, relaxations, timedOut: Date.now() >= deadline };
}
