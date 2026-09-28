import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { RECALL_LOG_DIR } from "./recallLog.js";
import type { RecallLogEntry, RecallLogHit } from "./types.js";

/**
 * VNL-073 — links that learn whether they led somewhere useful.
 *
 * The usage layer this project started with is plain Hebbian learning: a link
 * walked gets stronger, nothing weakens it except time, so whatever is already
 * popular gets more popular. It measured flat five times, which is what that
 * rule predicts. What brains add is a reward factor (co-activation counts only
 * when it paid off), and what OSPF/EIGRP add is a *measured* link quality
 * rather than a count of use. This module is both, over data the engine
 * already has:
 *
 * - **Reward.** In a `recall` call where something was opened, a shown result
 *   that was opened is a success (+1, or +2 when the call was followed by a
 *   write — it reached the work), and a result ranked *above* the lowest opened
 *   one but skipped is a failure. Results below the last opened one, and calls
 *   where nothing was opened, say nothing: the first may never have been
 *   looked at, and in the second the snippet may have been enough.
 * - **Credit goes to the route that delivered the result**: the seed note it
 *   was reached through (`note:seed|hit`), and the query words that matched or
 *   were learned for it (`term:word|hit`). A hit that arrived by meaning alone
 *   has no route and teaches nothing — a deliberate gap, not an oversight.
 * - **The metric is a rate, not a count.** Each route keeps decayed successes
 *   and failures; its score is a success rate smoothed toward the vault's own
 *   average, expressed as a bounded log-odds shift from that average. A route
 *   with no evidence scores exactly 0, one success out of one is nowhere near
 *   certain, and being shown often never raises a rate — so the self-feeding
 *   loop that sank priming cannot form.
 *
 * Derived from the `recall/*.jsonl` logs on read, not folded into a stored
 * file: the logs are kept 90 days, a fold over them is milliseconds, and a
 * derived value can never drift from, or contaminate, anything else.
 *
 * Shadow mode: `recall` computes this per hit and the MCP server logs it, but
 * it does not enter the ranking and is not shown to the model — a model that
 * could see it might open high-scoring notes *because* of the score, and the
 * experiment would measure its own influence. VNL-074 decides whether it is
 * ever switched on.
 */

export const OUTCOME_HALF_LIFE_DAYS = 30;
/** Pseudo-observations pulling a route's rate toward the vault average. */
export const OUTCOME_PRIOR_STRENGTH = 2;
/** Bound on the log-odds shift, so no single route can dominate a blend. */
export const OUTCOME_MAX_SHIFT = 2;
export const OUTCOME_READ_REWARD = 1;
export const OUTCOME_USED_REWARD = 2;

export interface OutcomeRoute {
  /** Decayed reward from calls where this route's result was opened. */
  successes: number;
  /** Decayed count of calls where it was shown above an opened result and skipped. */
  failures: number;
  lastTs: string;
}

export interface OutcomeModel {
  routes: Record<string, OutcomeRoute>;
  /** Decayed share of judged results that were opened; null before any call has been judged. */
  priorRate: number | null;
  /** Calls that carried a shown list and at least one open. */
  callsJudged: number;
}

type RouteSource = Pick<RecallLogHit, "path" | "via" | "matchedTerms" | "learnedTerms">;

/** The links that delivered a result, as route keys. */
export function outcomeRoutes(hit: RouteSource): string[] {
  const routes: string[] = [];
  if (hit.via) routes.push(`note:${hit.via}|${hit.path}`);
  for (const term of new Set([...(hit.matchedTerms ?? []), ...(hit.learnedTerms ?? [])])) {
    routes.push(`term:${term}|${hit.path}`);
  }
  return routes;
}

/** Pure fold over recall log lines. Lines may arrive in any order and from any number of instances. */
export function foldOutcomes(
  entries: readonly RecallLogEntry[],
  now: Date = new Date(),
  halfLifeDays: number = OUTCOME_HALF_LIFE_DAYS,
): OutcomeModel {
  const calls = new Map<string, { ts: string; hits?: RecallLogHit[]; read: Set<string>; wrote: boolean }>();
  const call = (id: string) => {
    let entry = calls.get(id);
    if (!entry) calls.set(id, (entry = { ts: "", read: new Set(), wrote: false }));
    return entry;
  };
  for (const entry of entries) {
    if (entry.type === "returned") {
      const target = call(entry.recallId);
      target.ts = entry.ts;
      target.hits = entry.hits;
    } else if (entry.type === "read") {
      call(entry.recallId).read.add(entry.path);
    } else if (entry.type === "write") {
      call(entry.recallId).wrote = true;
    }
  }

  const routes: Record<string, OutcomeRoute> = {};
  let opened = 0;
  let skipped = 0;
  let callsJudged = 0;

  for (const { ts, hits, read, wrote } of calls.values()) {
    if (!hits || hits.length === 0 || read.size === 0 || !ts) continue;
    const openedRanks = hits.filter((hit) => read.has(hit.path)).map((hit) => hit.rank);
    if (openedRanks.length === 0) continue;
    const lowestOpened = Math.max(...openedRanks);
    callsJudged++;

    const ageDays = Math.max(0, (now.getTime() - new Date(ts).getTime()) / 86_400_000);
    const decay = 0.5 ** (ageDays / halfLifeDays);

    for (const hit of hits) {
      if (hit.rank > lowestOpened) continue;
      const wasOpened = read.has(hit.path);
      if (wasOpened) opened += decay;
      else skipped += decay;
      const reward = wasOpened ? (wrote ? OUTCOME_USED_REWARD : OUTCOME_READ_REWARD) : 0;
      for (const key of outcomeRoutes(hit)) {
        const route = (routes[key] ??= { successes: 0, failures: 0, lastTs: ts });
        if (wasOpened) route.successes += decay * reward;
        else route.failures += decay;
        if (ts > route.lastTs) route.lastTs = ts;
      }
    }
  }

  return {
    routes,
    priorRate: opened + skipped > 0 ? opened / (opened + skipped) : null,
    callsJudged,
  };
}

const clampRate = (rate: number) => Math.min(0.99, Math.max(0.01, rate));
const logit = (rate: number) => Math.log(rate / (1 - rate));

/**
 * Log-odds shift of this result's routes from the vault average, bounded to
 * ±OUTCOME_MAX_SHIFT. Undefined when no route has any evidence — which is
 * not the same as 0 ("evidence, and it is average") and must not be logged
 * as if it were.
 */
export function outcomeShift(model: OutcomeModel, hit: RouteSource): number | undefined {
  if (model.priorRate === null) return undefined;
  const prior = clampRate(model.priorRate);
  const shifts: number[] = [];
  for (const key of outcomeRoutes(hit)) {
    const route = model.routes[key];
    if (!route) continue;
    const rate = (route.successes + OUTCOME_PRIOR_STRENGTH * prior) / (route.successes + route.failures + OUTCOME_PRIOR_STRENGTH);
    shifts.push(logit(clampRate(rate)) - logit(prior));
  }
  if (shifts.length === 0) return undefined;
  const mean = shifts.reduce((sum, shift) => sum + shift, 0) / shifts.length;
  return Math.min(OUTCOME_MAX_SHIFT, Math.max(-OUTCOME_MAX_SHIFT, mean));
}

export async function readRecallLog(vaultDataDir: string): Promise<RecallLogEntry[]> {
  const dir = join(vaultDataDir, RECALL_LOG_DIR);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const entries: RecallLogEntry[] = [];
  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    for (const line of (await readFile(join(dir, file), "utf8")).split("\n")) {
      if (!line.trim()) continue;
      try {
        entries.push(JSON.parse(line) as RecallLogEntry);
      } catch {
        // A partially written last line, from a session that is still running.
      }
    }
  }
  return entries;
}

const OUTCOME_CACHE_MS = 60_000;
const cache = new Map<string, { at: number; model: Promise<OutcomeModel> }>();

/**
 * The model for this vault, rebuilt at most once a minute per process: the
 * logs only grow by a few lines per call, and a minute-old model differs
 * from a fresh one by at most those lines.
 */
export function loadOutcomeModel(vaultDataDir: string, now: Date = new Date()): Promise<OutcomeModel> {
  const cached = cache.get(vaultDataDir);
  if (cached && Date.now() - cached.at < OUTCOME_CACHE_MS) return cached.model;
  const model = readRecallLog(vaultDataDir).then((entries) => foldOutcomes(entries, now));
  cache.set(vaultDataDir, { at: Date.now(), model });
  model.catch(() => cache.delete(vaultDataDir));
  return model;
}
