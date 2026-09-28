import { join } from "node:path";
import type { RecallHit } from "./recall.js";
import type { RecallLogEntry, RecallLogHit, ReadThroughReport } from "./types.js";

/**
 * VNL-057 — the number this project steers by in production.
 *
 * Everything measured so far is measured against a benchmark: VNL-020 asks
 * "does the right note rank first for a question someone wrote down in
 * advance". That is the right question for judging a ranking change and the
 * wrong one for judging whether the thing is useful, because the answer set
 * was chosen by a human who already knew what they wanted. It also cannot be
 * run continuously, on someone else's vault, or without a maintained query
 * set.
 *
 * Read-through can. When `recall` returns ten notes and the agent then opens
 * one of them, that open is an unprompted judgement that the result was worth
 * looking at — the same deterministic-signal discipline the project settled
 * on after `reinforce_link` proved nobody calls a tool voluntarily
 * (AIBRAIN-69). Nothing here asks the model to rate anything.
 *
 * What this can and cannot see. An open means the agent thought a result
 * looked relevant, not that it was: the fetched-versus-useful distinction
 * AIBRAIN-134 draws is real and no MCP server can close it, since the
 * protocol never shows the server the model's answer. A write following a
 * read is the closest observable proxy for "it reached the work", and it is
 * reported separately rather than folded in, because conflating "looked at"
 * with "used" is exactly the error the taxonomy exists to prevent.
 */

export const RECALL_LOG_DIR = "recall";

export function recallLogFilePath(vaultDataDir: string, instanceId: string): string {
  return join(vaultDataDir, RECALL_LOG_DIR, `${instanceId}.jsonl`);
}


/**
 * The shown list, reduced to what outcome learning and replay need
 * (VNL-073(A)). Pure. Scores are rounded to 4 places: the log is kept 90
 * days and nothing downstream distinguishes finer than that.
 */
export function toRecallLogHits(hits: readonly RecallHit[]): RecallLogHit[] {
  const round = (n: number | undefined) => (n === undefined ? undefined : Math.round(n * 1e4) / 1e4);
  return hits.map((hit, index) => {
    const entry: RecallLogHit = {
      path: hit.path,
      rank: index + 1,
      source: hit.source,
      score: round(hit.score) ?? 0,
      lexicalScore: round(hit.why.lexicalScore) ?? 0,
    };
    if (hit.why.graphEnergy !== undefined) entry.graphEnergy = round(hit.why.graphEnergy);
    if (hit.why.termScore !== undefined) entry.termScore = round(hit.why.termScore);
    if (hit.why.semanticScore !== undefined) entry.semanticScore = round(hit.why.semanticScore);
    if (hit.why.via !== undefined) entry.via = hit.why.via;
    if (hit.why.hops !== undefined) entry.hops = hit.why.hops;
    if (hit.why.matchedTerms.length > 0) entry.matchedTerms = hit.why.matchedTerms;
    if (hit.why.learnedTerms && hit.why.learnedTerms.length > 0) entry.learnedTerms = hit.why.learnedTerms;
    return entry;
  });
}

/**
 * Folds recall log lines into read-through metrics.
 *
 * Pure, and takes entries rather than a directory, so the arithmetic can be
 * tested without a filesystem — the same shape as the compactor's fold.
 */
export function computeReadThrough(entries: RecallLogEntry[]): ReadThroughReport {
  const returnedByRecall = new Map<string, { results: number; ts: string }>();
  const readsByRecall = new Map<string, Set<string>>();
  const writesByRecall = new Set<string>();

  for (const entry of entries) {
    if (entry.type === "returned") {
      // Last write wins on a duplicate id, which cannot happen within one
      // instance but could across a log that was concatenated by hand.
      returnedByRecall.set(entry.recallId, { results: entry.resultCount, ts: entry.ts });
    } else if (entry.type === "read") {
      const seen = readsByRecall.get(entry.recallId) ?? new Set<string>();
      seen.add(entry.path);
      readsByRecall.set(entry.recallId, seen);
    } else if (entry.type === "write") {
      writesByRecall.add(entry.recallId);
    }
  }

  let resultsReturned = 0;
  let resultsRead = 0;
  let recallsWithAnyRead = 0;
  let recallsFollowedByWrite = 0;

  for (const [recallId, returned] of returnedByRecall) {
    resultsReturned += returned.results;
    // Reads are counted only against a recall that was actually logged as
    // returning something. A read line whose recall is missing (a log
    // truncated at the front by pruning) is dropped rather than inflating a
    // rate whose denominator is not there.
    const read = readsByRecall.get(recallId)?.size ?? 0;
    resultsRead += Math.min(read, returned.results);
    if (read > 0) recallsWithAnyRead++;
    if (writesByRecall.has(recallId)) recallsFollowedByWrite++;
  }

  const recalls = returnedByRecall.size;
  const timestamps = [...returnedByRecall.values()].map((entry) => entry.ts).sort();

  return {
    recalls,
    resultsReturned,
    resultsRead,
    recallsWithAnyRead,
    recallsFollowedByWrite,
    // Two rates, because "read-through rate" has two defensible readings and
    // picking one silently would decide a gate by accident. `resultReadRate`
    // is the literal one — what share of everything returned got opened —
    // and it is bounded above by 1/topK times the number of notes anyone
    // would open, so a low value here is normal rather than alarming.
    // `usefulRecallRate` is the one that answers "did this call help at
    // all", which is what a person means when they ask.
    resultReadRate: resultsReturned > 0 ? resultsRead / resultsReturned : null,
    usefulRecallRate: recalls > 0 ? recallsWithAnyRead / recalls : null,
    writeFollowRate: recalls > 0 ? recallsFollowedByWrite / recalls : null,
    firstRecallAt: timestamps[0] ?? null,
    lastRecallAt: timestamps[timestamps.length - 1] ?? null,
  };
}
