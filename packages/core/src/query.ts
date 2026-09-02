import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AblationLayers,
  EdgeRecord,
  ImportanceConfig,
  LinkWeightsFile,
  NoteTypeDecayConfig,
  StructuralFallbackConfig,
  WeightedNeighbor,
} from "./types.js";
import { DEFAULT_ABLATION_LAYERS, DEFAULT_IMPORTANCE_CONFIG, DEFAULT_STRUCTURAL_FALLBACK_CONFIG } from "./types.js";
import { decayWeight, resolveHalfLifeDays } from "./decay.js";
import { parseFrontmatter } from "./frontmatter.js";
import { loadNoteImportance } from "./importance.js";
import { primingBonus, type SessionBuffer } from "./priming.js";
import { readSupersession } from "./relations.js";
import { loadStructuralIndex } from "./structuralLinks.js";

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

async function loadWeights(vaultDataDir: string): Promise<LinkWeightsFile | null> {
  try {
    const content = await readFile(join(vaultDataDir, "link-weights.json"), "utf8");
    return JSON.parse(content) as LinkWeightsFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}


async function readNoteType(vaultPath: string, notePath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(vaultPath, `${notePath}.md`), "utf8");
    const { frontmatter } = parseFrontmatter(raw);
    return typeof frontmatter.type === "string" ? frontmatter.type : undefined;
  } catch {
    return undefined;
  }
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
  layers: AblationLayers = DEFAULT_ABLATION_LAYERS,
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
  layers: AblationLayers = DEFAULT_ABLATION_LAYERS,
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
    for (const [key, record] of Object.entries(weights.edges)) {
      const [a, b] = key.split("|");
      const other = a === note ? b : b === note ? a : undefined;
      if (other === undefined) continue;
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
    for (const other of structural?.edges[note] ?? []) {
      if (seen.has(other)) continue;
      candidates.push({ path: other, baseWeight: structuralFallback.floorWeight, lastTouched: structural!.builtAt, source: "structural" });
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

  const neighbors: WeightedNeighbor[] = candidates.map((c) => {
    if (!primed(c.path)) {
      return { path: c.path, weight: withImportance(c.path, c.baseWeight), lastTouched: c.lastTouched, source: c.source };
    }
    const ownWeight = withImportance(c.path, c.baseWeight + primingBonus(c.path, sessionBuffer!));
    const weight = Math.max(ownWeight, unprimedMax + PRIMING_WIN_MARGIN);
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
): Promise<WeightedNeighbor[]> {
  const neighbors = await computeLiveNeighborWeights(vaultDataDir, note, vaultPath, sessionBuffer);

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
): Promise<number | undefined> {
  const weights = await loadWeights(vaultDataDir);
  if (!weights) return undefined;
  const key = [noteA, noteB].sort().join("|");
  const record = weights.edges[key];
  if (!record) return undefined;
  return liveWeight(vaultPath, noteB, record, new Date());
}
