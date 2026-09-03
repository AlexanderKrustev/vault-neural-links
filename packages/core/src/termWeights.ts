import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { decayWeight } from "./decay.js";
import { loadContentIndex } from "./contentIndex.js";
import { tokenize } from "./tokenize.js";
import type { EventLogEntry, TermTrigger, TermWeightsFile } from "./types.js";

/**
 * VNL-053 — term-to-note learning.
 *
 * Search queries were already logged, and reading a result right after a
 * search was already treated as "that result was acted on" for note edges
 * (AIBRAIN-71). What was thrown away was the query itself: the fact that for
 * *this* user, "kill process by port" means that one note. No static ranking
 * can know that; it is exactly the kind of thing a usage graph should learn.
 *
 * These edges live in their own file rather than in link-weights.json. A
 * token is not a note, and putting `kill -> Some Note` in the note graph
 * would let spreading activation walk into a token and back out into every
 * note that ever matched it, silently connecting unrelated notes through
 * shared vocabulary. The record shape is identical, so decay (decay.ts) and
 * consolidation (consolidation.ts) apply unchanged.
 */

export const TERM_WEIGHTS_FILE_NAME = "term-weights.json";

/**
 * Weight of one "the user searched this, then read that note" event. Equal
 * to AUTO_REINFORCE_BOOST: it is the same deterministic signal, just
 * credited to the query's terms instead of to a note pair.
 */
export const TERM_LEARN_WEIGHT = 1;

/**
 * Half-life for learned term edges. Shorter than a structural note's decay:
 * what a word means to someone tracks what they are working on, and a term
 * association nobody has confirmed in two months should stop steering
 * results. Not measured — VNL-020's benchmark is where this gets earned.
 */
export const TERM_HALF_LIFE_DAYS = 21;

/** `token|notePath` — unsorted, because direction is meaningful here. */
export function termEdgeKey(token: string, notePath: string): string {
  return `${token}|${notePath}`;
}

export function parseTermEdgeKey(key: string): { token: string; notePath: string } | null {
  const at = key.indexOf("|");
  if (at <= 0 || at === key.length - 1) return null;
  return { token: key.slice(0, at), notePath: key.slice(at + 1) };
}

export function isTermEvent(entry: EventLogEntry): boolean {
  return entry.type === "term";
}

/**
 * The query terms worth learning from. Reuses the content index's document
 * frequencies to drop the function words a natural-language query is mostly
 * made of — learning that "the" means some note would be worse than useless,
 * since it would attach to every query the user ever types.
 *
 * Deliberately the same idea as recall's own selectivity filter, applied
 * here too because search_notes has no such filter of its own.
 */
export async function learnableQueryTerms(
  vaultDataDir: string,
  query: string,
  minIdfRatio = 0.25,
): Promise<string[]> {
  const tokens = [...new Set(tokenize(query))];
  if (tokens.length === 0) return [];

  const index = await loadContentIndex(vaultDataDir);
  if (!index) return tokens; // no corpus statistics yet: learn from everything, decay sorts it out

  const totalNotes = Math.max(index.coveredPaths.length, 1);
  const idf = (token: string) => {
    const df = Math.max(index.postings[token]?.length ?? 0, 1);
    return Math.log(1 + (totalNotes - df + 0.5) / (df + 0.5));
  };
  const idfs = tokens.map(idf);
  const maxIdf = Math.max(...idfs);
  const selective = tokens.filter((_, i) => idfs[i] >= minIdfRatio * maxIdf);
  return selective.length > 0 ? selective : tokens;
}

/** One event per learned term, all crediting the same note. */
export function termEvents(
  instanceId: string,
  terms: string[],
  notePath: string,
  trigger: TermTrigger,
  now: Date = new Date(),
): EventLogEntry[] {
  return terms.map((token) => ({
    ts: now.toISOString(),
    instance: instanceId,
    type: "term" as const,
    from: token,
    to: notePath,
    weight_delta: TERM_LEARN_WEIGHT,
    trigger,
  }));
}

export async function loadTermWeights(vaultDataDir: string): Promise<TermWeightsFile | null> {
  try {
    const content = await readFile(join(vaultDataDir, TERM_WEIGHTS_FILE_NAME), "utf8");
    return JSON.parse(content) as TermWeightsFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export interface TermScore {
  /** Summed live-decayed weight across every query term that has learned this note. */
  score: number;
  /** Which of the query's terms contributed, best first — this is the `why`. */
  terms: string[];
}

/**
 * Live-decayed scores for the notes this query's terms have learned, keyed
 * by note path. Consolidated score is added undecayed, exactly as note edges
 * do it, so a term association confirmed on many separate days resists decay.
 */
export async function liveTermScores(
  vaultDataDir: string,
  tokens: string[],
  now: Date = new Date(),
): Promise<Map<string, TermScore>> {
  const scores = new Map<string, TermScore>();
  if (tokens.length === 0) return scores;

  const weights = await loadTermWeights(vaultDataDir);
  if (!weights) return scores;

  const wanted = new Set(tokens);
  const perNote = new Map<string, { total: number; contributions: { token: string; weight: number }[] }>();

  for (const [key, record] of Object.entries(weights.edges)) {
    const parsed = parseTermEdgeKey(key);
    if (!parsed || !wanted.has(parsed.token)) continue;

    const ageDays = (now.getTime() - new Date(record.lastTouched).getTime()) / 86_400_000;
    const weight =
      decayWeight(record.baseStrength, ageDays, { halfLifeDays: TERM_HALF_LIFE_DAYS }) + record.consolidatedScore;
    if (weight <= 0) continue;

    const entry = perNote.get(parsed.notePath) ?? { total: 0, contributions: [] };
    entry.total += weight;
    entry.contributions.push({ token: parsed.token, weight });
    perNote.set(parsed.notePath, entry);
  }

  for (const [notePath, { total, contributions }] of perNote) {
    contributions.sort((a, b) => b.weight - a.weight);
    scores.set(notePath, { score: total, terms: contributions.map((c) => c.token) });
  }
  return scores;
}
