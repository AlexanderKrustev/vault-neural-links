import { describe, expect, it } from "vitest";
import { OUTCOME_GATE_MIN_CALLS, replayOutcomes } from "../src/outcomeReplay.js";
import type { RecallLogEntry, RecallLogHit } from "../src/types.js";

/**
 * VNL-074. What matters most here is what the replay must NOT do: learn from
 * the week it is testing, reward a model for re-ordering a list it had no
 * evidence about, or pass on too little data.
 */
let seq = 0;
function hit(path: string, rank: number, score: number): RecallLogHit {
  return { path, rank, source: "lexical", score, lexicalScore: score, matchedTerms: ["alpha"] };
}
/** A call that showed [Popular, Useful] and in which Useful was opened. */
function call(day: number): RecallLogEntry[] {
  const recallId = `r${++seq}`;
  const ts = new Date(Date.UTC(2026, 9, 1 + day, 12)).toISOString();
  return [
    {
      ts,
      instance: "i",
      type: "returned",
      recallId,
      query: "alpha",
      resultCount: 2,
      hits: [hit("Popular", 1, 1.0), hit("Useful", 2, 0.95)],
    },
    { ts, instance: "i", type: "read", recallId, path: "Useful" },
  ];
}

describe("replayOutcomes (VNL-074)", () => {
  it("learns from earlier weeks and moves what keeps getting opened up in later ones", () => {
    const entries = Array.from({ length: 21 }, (_, day) => call(day)).flat();

    const report = replayOutcomes(entries, { weights: [0.1] });

    expect(report.windows.length).toBe(2);
    // Served order always put Popular first: reciprocal rank 0.5.
    expect(report.pooled.servedMrr).toBeCloseTo(0.5);
    expect(report.pooled.replayMrr["0.1"]).toBeCloseTo(1);
    expect(report.pooled.improvedCalls).toBe(report.pooled.testCalls);
  });

  it("never lets a week learn from itself", () => {
    // Only one week of data: nothing precedes it, so nothing can be tested.
    const entries = Array.from({ length: 6 }, (_, day) => call(day)).flat();

    const report = replayOutcomes(entries);

    expect(report.windows).toEqual([]);
    expect(report.verdict).toBe("insufficient-data");
  });

  it("the first tested week has only the first week behind it", () => {
    const entries = Array.from({ length: 14 }, (_, day) => call(day)).flat();

    const [first] = replayOutcomes(entries).windows;

    expect(first.trainCalls).toBe(7);
    expect(first.testCalls).toBe(7);
  });

  it("leaves a list without evidence exactly as it was served", () => {
    // Week 2's calls use a different word, so week 1 taught nothing about them.
    const entries = Array.from({ length: 7 }, (_, day) => call(day)).flat();
    for (let day = 7; day < 14; day++) {
      const recallId = `other${day}`;
      const ts = new Date(Date.UTC(2026, 9, 1 + day, 12)).toISOString();
      entries.push(
        {
          ts,
          instance: "i",
          type: "returned",
          recallId,
          query: "beta",
          resultCount: 2,
          hits: [
            { ...hit("X", 1, 1), matchedTerms: ["beta"] },
            { ...hit("Y", 2, 0.9), matchedTerms: ["beta"] },
          ],
        },
        { ts, instance: "i", type: "read", recallId, path: "Y" },
      );
    }

    const report = replayOutcomes(entries, { weights: [0.5] });

    expect(report.pooled.callsWithEvidence).toBe(0);
    expect(report.pooled.replayMrr["0.5"]).toBeCloseTo(report.pooled.servedMrr);
    expect(report.pooled.improvedCalls + report.pooled.worsenedCalls).toBe(0);
  });

  it("does not pass on too little data, however good it looks", () => {
    const entries = Array.from({ length: 21 }, (_, day) => call(day)).flat();

    const report = replayOutcomes(entries);

    expect(report.pooled.testCalls).toBeLessThan(OUTCOME_GATE_MIN_CALLS);
    expect(report.verdict).toBe("insufficient-data");
  });

  it("passes with enough held-out calls that improve", () => {
    const entries: RecallLogEntry[] = [];
    for (let day = 0; day < 28; day++) for (let i = 0; i < 6; i++) entries.push(...call(day));

    const report = replayOutcomes(entries);

    expect(report.pooled.testCalls).toBeGreaterThanOrEqual(OUTCOME_GATE_MIN_CALLS);
    expect(report.verdict).toBe("pass");
  });

  it("ignores calls logged before the shown list was recorded", () => {
    const legacy: RecallLogEntry[] = [
      { ts: "2026-09-15T00:00:00.000Z", instance: "i", type: "returned", recallId: "old", query: "q", resultCount: 5 },
      { ts: "2026-09-15T00:00:00.000Z", instance: "i", type: "read", recallId: "old", path: "A" },
    ];
    expect(replayOutcomes(legacy).judgedCallsTotal).toBe(0);
  });
});
