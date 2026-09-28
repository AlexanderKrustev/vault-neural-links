import { foldOutcomes, outcomeShift, OUTCOME_HALF_LIFE_DAYS } from "./outcomeLearning.js";
import type { RecallLogEntry, RecallLogHit } from "./types.js";

/**
 * VNL-074 — the test that can see learning.
 *
 * The 70-query benchmark cannot: only 4 of 62 real reads ever touched one of
 * its targets. This replays what actually happened instead. Every logged
 * `recall` call carries the list it showed (VNL-073(A)) and what was then
 * opened. For each week, the outcome model is learned from calls *before*
 * that week only, the week's shown lists are re-ordered by logged score plus
 * `weight × outcome shift`, and the question is whether the notes actually
 * opened move up.
 *
 * Re-ordering the list that was shown keeps the comparison exact — no
 * counterfactual retrieval, no index state to reconstruct — and is also its
 * limit: it can promote within what was shown, never find what was not.
 *
 * The weight is fixed in advance (PREREGISTERED_OUTCOME_WEIGHT). Other
 * weights are reported for exploration, but choosing the best one on the
 * same data would make the verdict measure the choice.
 */

/** Chosen before any data existed; the only weight the gate reads. */
export const PREREGISTERED_OUTCOME_WEIGHT = 0.1;
export const EXPLORATORY_OUTCOME_WEIGHTS = [0.05, 0.1, 0.2, 0.5];
/** Judged calls the pooled held-out result must rest on before the gate may pass. */
export const OUTCOME_GATE_MIN_CALLS = 100;

interface JudgedCall {
  recallId: string;
  ts: string;
  hits: RecallLogHit[];
  opened: Set<string>;
}

export interface ReplayWindow {
  start: string;
  end: string;
  /** Judged calls the model for this window learned from (all strictly earlier). */
  trainCalls: number;
  testCalls: number;
  /** Test calls where at least one shown result had outcome evidence — where re-ordering could change anything. */
  callsWithEvidence: number;
  /** MRR of the first opened result, in the order that was served. */
  servedMrr: number;
  /** Same, after re-ordering at each weight. */
  replayMrr: Record<string, number>;
  /** Calls where, at the preregistered weight, the first opened result moved up / down. */
  improvedCalls: number;
  worsenedCalls: number;
}

export interface ReplayReport {
  windows: ReplayWindow[];
  pooled: Omit<ReplayWindow, "start" | "end" | "trainCalls">;
  weight: number;
  /** PASS only with enough held-out calls behind it and a real improvement. */
  verdict: "pass" | "fail" | "insufficient-data";
  judgedCallsTotal: number;
}

function judgedCalls(entries: readonly RecallLogEntry[]): JudgedCall[] {
  const calls = new Map<string, { ts?: string; hits?: RecallLogHit[]; opened: Set<string> }>();
  for (const entry of entries) {
    const call = calls.get(entry.recallId) ?? { opened: new Set<string>() };
    calls.set(entry.recallId, call);
    if (entry.type === "returned") {
      call.ts = entry.ts;
      call.hits = entry.hits;
    } else if (entry.type === "read") {
      call.opened.add(entry.path);
    }
  }
  const judged: JudgedCall[] = [];
  for (const [recallId, call] of calls) {
    if (!call.ts || !call.hits || call.hits.length === 0) continue;
    if (!call.hits.some((hit) => call.opened.has(hit.path))) continue;
    judged.push({ recallId, ts: call.ts, hits: call.hits, opened: call.opened });
  }
  return judged.sort((a, b) => a.ts.localeCompare(b.ts));
}

function reciprocalRankOfFirstOpened(order: RecallLogHit[], opened: Set<string>): number {
  const index = order.findIndex((hit) => opened.has(hit.path));
  return index === -1 ? 0 : 1 / (index + 1);
}

/** Pure. `entries` is the whole recall log; windows are `windowDays` long from the first judged call. */
export function replayOutcomes(
  entries: readonly RecallLogEntry[],
  opts: { windowDays?: number; weights?: number[]; halfLifeDays?: number; weight?: number } = {},
): ReplayReport {
  const {
    windowDays = 7,
    weights = EXPLORATORY_OUTCOME_WEIGHTS,
    halfLifeDays = OUTCOME_HALF_LIFE_DAYS,
    weight = PREREGISTERED_OUTCOME_WEIGHT,
  } = opts;
  const allWeights = [...new Set([...weights, weight])].sort((a, b) => a - b);
  const calls = judgedCalls(entries);
  const empty = {
    testCalls: 0,
    callsWithEvidence: 0,
    servedMrr: 0,
    replayMrr: {} as Record<string, number>,
    improvedCalls: 0,
    worsenedCalls: 0,
  };
  if (calls.length === 0) {
    return { windows: [], pooled: empty, weight, verdict: "insufficient-data", judgedCallsTotal: 0 };
  }

  // Entries grouped by call, so a training set can include a call's reads and
  // writes even when those lines are timestamped after the window boundary.
  const byCall = new Map<string, RecallLogEntry[]>();
  for (const entry of entries) {
    const list = byCall.get(entry.recallId) ?? [];
    list.push(entry);
    byCall.set(entry.recallId, list);
  }

  const windowMs = windowDays * 86_400_000;
  const first = new Date(calls[0].ts).getTime();
  const windows: ReplayWindow[] = [];
  let pooledTest = 0;
  let pooledEvidence = 0;
  let pooledServed = 0;
  let pooledImproved = 0;
  let pooledWorsened = 0;
  const pooledReplay: Record<string, number> = {};

  // The first window has nothing before it to learn from, so testing starts at the second.
  for (let start = first + windowMs; start <= new Date(calls[calls.length - 1].ts).getTime(); start += windowMs) {
    const end = start + windowMs;
    const train = calls.filter((call) => new Date(call.ts).getTime() < start);
    const test = calls.filter((call) => {
      const t = new Date(call.ts).getTime();
      return t >= start && t < end;
    });
    if (test.length === 0) continue;

    const model = foldOutcomes(
      train.flatMap((call) => byCall.get(call.recallId) ?? []),
      new Date(start),
      halfLifeDays,
    );

    let served = 0;
    let evidence = 0;
    let improved = 0;
    let worsened = 0;
    const replay: Record<string, number> = Object.fromEntries(allWeights.map((w) => [String(w), 0]));
    for (const call of test) {
      served += reciprocalRankOfFirstOpened(call.hits, call.opened);
      const shifts = call.hits.map((hit) => outcomeShift(model, hit));
      if (shifts.some((shift) => shift !== undefined)) evidence++;
      const servedRr = reciprocalRankOfFirstOpened(call.hits, call.opened);
      for (const w of allWeights) {
        const reordered = call.hits
          .map((hit, i) => ({ hit, key: hit.score + w * (shifts[i] ?? 0), rank: hit.rank }))
          // Ties keep the served order, so a zero shift is exactly the served list.
          .sort((a, b) => b.key - a.key || a.rank - b.rank)
          .map((entry) => entry.hit);
        const rr = reciprocalRankOfFirstOpened(reordered, call.opened);
        replay[String(w)] += rr;
        if (w === weight) {
          if (rr > servedRr) improved++;
          else if (rr < servedRr) worsened++;
        }
      }
    }

    windows.push({
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      trainCalls: train.length,
      testCalls: test.length,
      callsWithEvidence: evidence,
      servedMrr: served / test.length,
      replayMrr: Object.fromEntries(Object.entries(replay).map(([w, sum]) => [w, sum / test.length])),
      improvedCalls: improved,
      worsenedCalls: worsened,
    });
    pooledImproved += improved;
    pooledWorsened += worsened;
    pooledTest += test.length;
    pooledEvidence += evidence;
    pooledServed += served;
    for (const [w, sum] of Object.entries(replay)) pooledReplay[w] = (pooledReplay[w] ?? 0) + sum;
  }

  const pooled =
    pooledTest === 0
      ? empty
      : {
          testCalls: pooledTest,
          callsWithEvidence: pooledEvidence,
          servedMrr: pooledServed / pooledTest,
          replayMrr: Object.fromEntries(Object.entries(pooledReplay).map(([w, sum]) => [w, sum / pooledTest])),
          improvedCalls: pooledImproved,
          worsenedCalls: pooledWorsened,
        };
  const verdict =
    pooled.testCalls < OUTCOME_GATE_MIN_CALLS
      ? "insufficient-data"
      : (pooled.replayMrr[String(weight)] ?? 0) > pooled.servedMrr && pooled.improvedCalls > pooled.worsenedCalls
        ? "pass"
        : "fail";

  return { windows, pooled, weight, verdict, judgedCallsTotal: calls.length };
}
