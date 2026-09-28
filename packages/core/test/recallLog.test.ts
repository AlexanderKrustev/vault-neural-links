import { describe, expect, it } from "vitest";
import { computeReadThrough, toRecallLogHits } from "../src/recallLog.js";
import type { RecallHit } from "../src/recall.js";
import type { RecallLogEntry } from "../src/types.js";

/**
 * VNL-057. The fold is pure and tested without a filesystem, the same shape
 * as the compactor's, because the arithmetic is the part that decides what
 * number the project steers by — and a rate computed slightly wrong is worse
 * than no rate, since it still looks like a measurement.
 */
function returned(recallId: string, resultCount: number, ts = "2026-09-09T10:00:00.000Z"): RecallLogEntry {
  return { ts, instance: "i1", type: "returned", recallId, query: "q", resultCount };
}
function read(recallId: string, path: string): RecallLogEntry {
  return { ts: "2026-09-09T10:01:00.000Z", instance: "i1", type: "read", recallId, path };
}
function wrote(recallId: string, path = "Notes/Written"): RecallLogEntry {
  return { ts: "2026-09-09T10:02:00.000Z", instance: "i1", type: "write", recallId, path };
}

describe("read-through (VNL-057)", () => {
  it("reports nothing rather than zero when no recall has been logged", () => {
    const report = computeReadThrough([]);

    // A rate of 0 would read as "nothing is ever useful"; null says "not
    // measured yet", which is the true state of a fresh vault.
    expect(report.recalls).toBe(0);
    expect(report.resultReadRate).toBeNull();
    expect(report.usefulRecallRate).toBeNull();
    expect(report.writeFollowRate).toBeNull();
  });

  it("counts opened results against what was returned", () => {
    const report = computeReadThrough([
      returned("r1", 10),
      read("r1", "A"),
      read("r1", "B"),
      returned("r2", 5),
      read("r2", "C"),
    ]);

    expect(report.recalls).toBe(2);
    expect(report.resultsReturned).toBe(15);
    expect(report.resultsRead).toBe(3);
    expect(report.resultReadRate).toBeCloseTo(3 / 15, 6);
  });

  it("separates 'did this call help at all' from 'what share was opened'", () => {
    // Both recalls were useful; only 2 of 20 returned notes were opened.
    // Reporting one number would make a good session look like a bad one.
    const report = computeReadThrough([
      returned("r1", 10),
      read("r1", "A"),
      returned("r2", 10),
      read("r2", "B"),
    ]);

    expect(report.usefulRecallRate).toBe(1);
    expect(report.resultReadRate).toBeCloseTo(0.1, 6);
  });

  it("counts a note opened twice once", () => {
    const report = computeReadThrough([returned("r1", 5), read("r1", "A"), read("r1", "A")]);

    expect(report.resultsRead).toBe(1);
  });

  it("never reports more results read than were returned", () => {
    // A malformed or hand-concatenated log could claim more reads than
    // results; a rate above 1 would be nonsense presented as a measurement.
    const report = computeReadThrough([
      returned("r1", 2),
      read("r1", "A"),
      read("r1", "B"),
      read("r1", "C"),
    ]);

    expect(report.resultsRead).toBe(2);
    expect(report.resultReadRate).toBe(1);
  });

  it("drops reads whose recall is missing from the log", () => {
    // Pruning trims the front of a log, so a read can outlive the call it
    // belongs to. Counting it would add to the numerator with nothing in the
    // denominator.
    const report = computeReadThrough([returned("r2", 4), read("r1", "A"), read("r2", "B")]);

    expect(report.recalls).toBe(1);
    expect(report.resultsReturned).toBe(4);
    expect(report.resultsRead).toBe(1);
  });

  it("tracks writes that followed a recall, separately from reads", () => {
    const report = computeReadThrough([
      returned("r1", 4),
      read("r1", "A"),
      wrote("r1"),
      returned("r2", 4),
      read("r2", "B"),
    ]);

    expect(report.recallsWithAnyRead).toBe(2);
    expect(report.recallsFollowedByWrite).toBe(1);
    expect(report.writeFollowRate).toBe(0.5);
  });

  it("reports the window the numbers cover", () => {
    const report = computeReadThrough([
      returned("r1", 1, "2026-09-01T00:00:00.000Z"),
      returned("r2", 1, "2026-09-09T00:00:00.000Z"),
    ]);

    expect(report.firstRecallAt).toBe("2026-09-01T00:00:00.000Z");
    expect(report.lastRecallAt).toBe("2026-09-09T00:00:00.000Z");
  });
});

describe("shown-list logging (VNL-073(A))", () => {
  function hit(path: string, why: Partial<RecallHit["why"]>, source: RecallHit["source"] = "lexical"): RecallHit {
    return { path, score: 0.123456789, source, snippet: "s", why: { matchedTerms: [], lexicalScore: 0, ...why } };
  }

  it("keeps the order shown as a 1-based rank, and what delivered each hit", () => {
    const logged = toRecallLogHits([
      hit("Notes/A", { matchedTerms: ["alpha"], lexicalScore: 2.5 }),
      hit("Notes/B", { via: "Notes/A", hops: 1, graphEnergy: 0.4 }, "graph"),
      hit("Notes/C", { learnedTerms: ["alpha"], termScore: 0.7 }, "term"),
    ]);

    expect(logged.map((h) => [h.path, h.rank])).toEqual([["Notes/A", 1], ["Notes/B", 2], ["Notes/C", 3]]);
    // The link outcome learning credits: seed -> hit for a graph hit,
    // query token -> hit otherwise.
    expect(logged[1]).toMatchObject({ via: "Notes/A", hops: 1, source: "graph" });
    expect(logged[0].matchedTerms).toEqual(["alpha"]);
    expect(logged[2].learnedTerms).toEqual(["alpha"]);
  });

  it("rounds scores and leaves absent axes out rather than logging zeros", () => {
    const [only] = toRecallLogHits([hit("Notes/A", { lexicalScore: 1.234567 })]);

    expect(only.score).toBe(0.1235);
    expect(only.lexicalScore).toBe(1.2346);
    // Absent means "this axis did not reach the note", which a 0 would blur.
    expect(only).not.toHaveProperty("semanticScore");
    expect(only).not.toHaveProperty("via");
    expect(only).not.toHaveProperty("matchedTerms");
  });

  it("still folds old lines that carry no hit list", () => {
    const report = computeReadThrough([returned("r1", 3), read("r1", "Notes/A")]);
    expect(report.recalls).toBe(1);
    expect(report.resultsRead).toBe(1);
  });
});
