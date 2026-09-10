import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  AblationLayers,
  ColdStartSeedConfig,
  EdgeRecord,
  ImportanceConfig,
  LinkWeightsFile,
  NoteTypeDecayConfig,
  StructuralFallbackConfig,
  WeightedNeighbor,
} from "./types.js";
import {
  DEFAULT_COLD_START_SEED_CONFIG,
  DEFAULT_IMPORTANCE_CONFIG,
  DEFAULT_PRIMING_CONFIG,
  DEFAULT_STRUCTURAL_FALLBACK_CONFIG,
  HOT_PATH_ABLATION_LAYERS,
} from "./types.js";
import { decayWeight, resolveHalfLifeDays } from "./decay.js";
import { parseFrontmatter } from "./frontmatter.js";
import { loadNoteImportance } from "./importance.js";
import { derived, loadCachedJson } from "./indexCache.js";
import { primingBonus, type SessionBuffer } from "./priming.js";
import { readSupersession } from "./relations.js";
import { liveSeedBonus, loadSeedWeights, seedKey } from "./seedWeights.js";
import { loadStructuralIndex } from "./structuralLinks.js";
import { resolveNoteFile } from "./vaultPaths.js";

// AIBRAIN-66 fast-follow: see DecayConfig's doc comment in types.ts for the
// full rationale. Tuned empirically against benchmark-reinforcement.mjs
// (does a lone recent touch stop dominating the distractor case) and
// benchmark-baselines.mjs / eval-retrieval.mjs (does it regress the main
// engine-vs-baseline numbers) together, not picked blind.
const USAGE_FAST_DECAY_WINDOW_DAYS = 2;
const USAGE_FAST_DECAY_HALF_LIFE_DAYS = 0.5;
// An edge needs this many total touches (traverse + reinforce, combined)
// before it's treated as "established" and exempted from the fast-decay
// window above.
const USAGE_ESTABLISHED_TOUCH_COUNT = 3;

/**
 * Frontmatter `type` per note file, keyed by absolute path and validated
 * by mtime+size (VNL-030). Separate from indexCache's JSON cache because
 * these are the user's own notes rather than nightly-built indexes: many
 * more of them, changing far more often, and holding only a short string
 * each rather than a parsed index.
 */
const noteTypeCache = new Map<string, { signature: string; noteType: string | undefined }>();

/** Drops the per-note frontmatter-type cache. For tests, and for a process that has just rewritten many notes. */
export function clearNoteTypeCache(): void {
  noteTypeCache.clear();
}

export async function loadWeights(vaultDataDir: string): Promise<LinkWeightsFile | null> {
  return loadCachedJson<LinkWeightsFile>(join(vaultDataDir, "link-weights.json"));
}

/**
 * `note -> [[neighbour, edge]]`, built once per loaded weights file
 * (VNL-030). The edge keys are undirected sorted pairs, so finding one
 * note's neighbours used to mean splitting and testing **every** key in
 * the graph on every call — O(E) per note, paid again for each seed of
 * each `recall`, and again at each hop of spreading activation. This makes
 * it O(degree) after one O(E) pass that the cache then keeps for as long
 * as the file is unchanged.
 */
function adjacencyOf(weights: LinkWeightsFile): Map<string, [string, EdgeRecord][]> {
  return derived(weights, "adjacency", (file) => {
    const adjacency = new Map<string, [string, EdgeRecord][]>();
    for (const [key, record] of Object.entries(file.edges)) {
      const [a, b] = key.split("|");
      if (a === undefined || b === undefined) continue;
      if (!adjacency.has(a)) adjacency.set(a, []);
      adjacency.get(a)!.push([b, record]);
      if (b === a) continue;
      if (!adjacency.has(b)) adjacency.set(b, []);
      adjacency.get(b)!.push([a, record]);
    }
    return adjacency;
  });
}


async function readNoteType(vaultPath: string, notePath: string): Promise<string | undefined> {
  // VNL-030: this is called once per candidate edge, and each call used to
  // read and frontmatter-parse a whole note file just to learn its `type`.
  // Cached against the note's own mtime+size, so a repeat is one stat().
  // A note that cannot be read is cached as "unknown" too — the failure is
  // as repeatable as the success, and re-reading a missing file per
  // candidate is exactly the cost this removes.
  const filePath = resolveNoteFile(vaultPath, notePath);
  let signature: string;
  try {
    const stats = await stat(filePath);
    signature = `${stats.mtimeMs}:${stats.size}`;
  } catch {
    return undefined;
  }

  const cached = noteTypeCache.get(filePath);
  if (cached && cached.signature === signature) return cached.noteType;

  let noteType: string | undefined;
  try {
    const raw = await readFile(filePath, "utf8");
    const { frontmatter } = parseFrontmatter(raw);
    noteType = typeof frontmatter.type === "string" ? frontmatter.type : undefined;
  } catch {
    noteType = undefined;
  }

  noteTypeCache.set(filePath, { signature, noteType });
  return noteType;
}

function daysSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Applies exponential decay to an edge's baseStrength live, based on time
 * elapsed since it was last touched — replaces the old approach of decaying
 * forward at each compaction. `notePath` is the neighboring note whose
 * frontmatter `type` determines the decay tau (structural notes decay
 * slower than situational ones); vaultPath is optional so callers without
 * filesystem access to the vault still get the default tau.
 */
async function liveWeight(
  vaultPath: string | undefined,
  notePath: string,
  record: EdgeRecord,
  now: Date,
  decayConfig?: NoteTypeDecayConfig,
  layers: AblationLayers = HOT_PATH_ABLATION_LAYERS,
): Promise<number> {
  const noteType = vaultPath ? await readNoteType(vaultPath, notePath) : undefined;
  const halfLifeDays = resolveHalfLifeDays(noteType, decayConfig);
  // consolidatedScore is added undecayed — that's the whole point of the
  // long-term tier: once promoted, it resists the recent tier's decay
  // entirely rather than just decaying more slowly.
  const consolidated = layers.consolidation ? record.consolidatedScore : 0;
  // Fast-decay only applies to edges that haven't proven themselves yet
  // (fewer than USAGE_ESTABLISHED_TOUCH_COUNT touches total) — an edge with
  // real repeated engagement across several sessions decays at the normal
  // rate, same as always. Gating on touch count rather than applying the
  // fast phase unconditionally to every edge matters: unconditional would
  // also crush the eventual decayed weight of old, well-established edges
  // (confirmed against pipeline.test.ts — an edge touched once 30 days ago
  // and never since SHOULD fade hard, but one touched repeatedly shouldn't
  // pay that same penalty just because 30 days have passed since).
  const established = record.traverseCount + record.reinforceCount >= USAGE_ESTABLISHED_TOUCH_COUNT;
  return (
    decayWeight(record.baseStrength, daysSince(record.lastTouched, now), {
      halfLifeDays,
      ...(established
        ? {}
        : { fastWindowDays: USAGE_FAST_DECAY_WINDOW_DAYS, fastHalfLifeDays: USAGE_FAST_DECAY_HALF_LIFE_DAYS }),
    }) + consolidated
  );
}

/**
 * Reads link-weights.json and returns top-K neighbors for a note,
 * sorted by weight descending.
 */
/**
 * All of a note's direct neighbors with live-decayed weight applied, in no
 * particular order and with no topK cutoff or supersession lookup — the
 * shared building block for both single-hop retrieval (getWeightedNeighbors)
 * and multi-hop spreading activation (activation.ts), which each need a
 * different slice/decoration of the same raw edge scan.
 */
export async function computeLiveNeighborWeights(
  vaultDataDir: string,
  note: string,
  vaultPath?: string,
  sessionBuffer?: SessionBuffer,
  structuralFallback: StructuralFallbackConfig = DEFAULT_STRUCTURAL_FALLBACK_CONFIG,
  importanceConfig: ImportanceConfig = DEFAULT_IMPORTANCE_CONFIG,
  layers: AblationLayers = HOT_PATH_ABLATION_LAYERS,
  seedConfig: ColdStartSeedConfig = DEFAULT_COLD_START_SEED_CONFIG,
): Promise<WeightedNeighbor[]> {
  const weights = await loadWeights(vaultDataDir);
  const importance = layers.importance ? await loadNoteImportance(vaultDataDir) : null;
  const now = new Date();
  const seen = new Set<string>();

  // AIBRAIN-21: final_score = activation_score * (1 + λ * importance) — a
  // neighbor's own PageRank-style hub score boosts its weight regardless of
  // usage recency, so a genuine hub note stays weighted even during a long
  // stretch with no traversal/reinforce activity. No-op (multiplier of 1)
  // until runImportanceComputation has actually populated note-importance.json,
  // or when the importance layer is ablated (AIBRAIN-27).
  function withImportance(path: string, weight: number): number {
    if (!layers.importance) return weight;
    const score = importance?.scores[path] ?? 0;
    return weight * (1 + importanceConfig.blendLambda * score);
  }

  interface Candidate {
    path: string;
    baseWeight: number;
    lastTouched: string;
    source: "usage" | "structural";
  }
  const candidates: Candidate[] = [];

  if (weights) {
    for (const [other, record] of adjacencyOf(weights).get(note) ?? []) {
      const baseWeight = await liveWeight(vaultPath, other, record, now, undefined, layers);
      candidates.push({ path: other, baseWeight, lastTouched: record.lastTouched, source: "usage" });
      seen.add(other);
    }
  }

  // Fallback tier: a real wikilink with no usage history yet is still real
  // evidence of a relationship, so it gets a small floor weight rather than
  // being invisible to retrieval — only for pairs with no usage-weighted
  // edge already, so real usage always outranks structural-only presence.
  // Ablatable as a whole (AIBRAIN-27): skipped entirely when
  // layers.structuralFallback is false.
  if (layers.structuralFallback) {
    const structural = await loadStructuralIndex(vaultDataDir);
    const structuralNeighbors = structural?.edges[note] ?? [];
    // VNL-021: on a vault with no traversal history every one of these
    // candidates has the identical floor weight, so the graph orders
    // nothing until months of usage exist. The seed tier adds a prior on
    // top of the floor — reciprocity, target specificity, target recency —
    // and can only ever raise a candidate, never push one below the floor
    // VNL-058 measured as load-bearing. Loaded only when the layer is on
    // and there is something for it to reorder.
    const seeds =
      layers.coldStartSeed && structuralNeighbors.length > 0 ? await loadSeedWeights(vaultDataDir) : null;
    for (const other of structuralNeighbors) {
      if (seen.has(other)) continue;
      const bonus = seeds ? liveSeedBonus(seeds.edges[seedKey(note, other)], now, seedConfig) : 0;
      candidates.push({
        path: other,
        baseWeight: structuralFallback.floorWeight + bonus,
        lastTouched: structural!.builtAt,
        source: "structural",
      });
    }
  }

  const primed = (path: string) => Boolean(sessionBuffer && layers.priming && sessionBuffer.has(path));

  // AIBRAIN-130: priming used to add a flat bonus (PrimingConfig.bonus) on
  // top of raw usage weight. That bonus reliably beat the structural floor
  // (which is why the zero-usage condition ranked well) but had no
  // relationship to real usage weight, which isn't bounded anywhere near
  // it — a generic hub note traversed from many unrelated sessions could
  // (and did, reproducibly) permanently outrank a note the current session
  // had just touched, for any query sharing that hub's neighborhood.
  //
  // Fix: a primed neighbor's final weight is floored at "the strongest
  // UNPRIMED neighbor in this same set, plus a small margin" — just enough
  // to reliably win the local comparison — rather than an arbitrary large
  // constant. A large constant would work for simple ranking but this
  // function is also activate()'s per-hop energy-share basis (weight /
  // totalWeight), where an unbounded boost would make a primed neighbor
  // swallow ~100% of a hop's outgoing energy instead of just winning the
  // comparison, distorting multi-hop spreading far beyond what fixing the
  // rank-1 regression requires.
  const unprimedFinal = candidates.filter((c) => !primed(c.path)).map((c) => withImportance(c.path, c.baseWeight));
  const unprimedMax = unprimedFinal.length > 0 ? Math.max(...unprimedFinal) : 0;
  const PRIMING_WIN_MARGIN = 0.01;

  // AIBRAIN-141: the floor above used to apply in full the instant a note
  // entered the buffer and stayed in full until LRU eviction — buffer
  // membership was binary. primingBonus() now decays with time since the
  // touch (see priming.ts), so the floor is interpolated by how much of
  // that bonus remains: `strength` 1.0 (just touched) applies the floor in
  // full, same as before this ticket; strength decaying toward 0 fades the
  // note back down to its own bare (unboosted) weight — i.e. back to
  // ranking exactly like an unprimed neighbor once priming has genuinely
  // worn off, instead of an eviction-cliff staying at full strength until
  // the buffer happens to fill up.
  const neighbors: WeightedNeighbor[] = candidates.map((c) => {
    const bareWeight = withImportance(c.path, c.baseWeight);
    if (!primed(c.path)) {
      return { path: c.path, weight: bareWeight, lastTouched: c.lastTouched, source: c.source };
    }
    const bonus = primingBonus(c.path, sessionBuffer!, DEFAULT_PRIMING_CONFIG, now);
    const strength = DEFAULT_PRIMING_CONFIG.bonus > 0 ? bonus / DEFAULT_PRIMING_CONFIG.bonus : 0;
    const fullFloorWeight = Math.max(withImportance(c.path, c.baseWeight + bonus), unprimedMax + PRIMING_WIN_MARGIN);
    const weight = bareWeight + strength * (fullFloorWeight - bareWeight);
    return { path: c.path, weight, lastTouched: c.lastTouched, source: c.source };
  });

  return neighbors;
}

/**
 * Reads link-weights.json and returns top-K neighbors for a note,
 * sorted by weight descending.
 */
export async function getWeightedNeighbors(
  vaultDataDir: string,
  note: string,
  topK = 10,
  vaultPath?: string,
  sessionBuffer?: SessionBuffer,
  layers: AblationLayers = HOT_PATH_ABLATION_LAYERS,
): Promise<WeightedNeighbor[]> {
  const neighbors = await computeLiveNeighborWeights(
    vaultDataDir,
    note,
    vaultPath,
    sessionBuffer,
    undefined,
    undefined,
    layers,
  );

  neighbors.sort((x, y) => y.weight - x.weight);
  const topNeighbors = neighbors.slice(0, topK);

  // Only checked for the final topK slice, not every candidate edge — a
  // note's usage weight/recency gives no hint it's outdated, so this is the
  // one signal that has to be looked up regardless of how fresh the edge is.
  if (vaultPath) {
    await Promise.all(
      topNeighbors.map(async (neighbor) => {
        neighbor.supersededBy = await readSupersession(vaultPath, neighbor.path);
      }),
    );
  }

  return topNeighbors;
}

export async function getEdgeWeight(
  vaultDataDir: string,
  noteA: string,
  noteB: string,
  vaultPath?: string,
  layers: AblationLayers = HOT_PATH_ABLATION_LAYERS,
): Promise<number | undefined> {
  const weights = await loadWeights(vaultDataDir);
  if (!weights) return undefined;
  const key = [noteA, noteB].sort().join("|");
  const record = weights.edges[key];
  if (!record) return undefined;
  return liveWeight(vaultPath, noteB, record, new Date(), undefined, layers);
}
