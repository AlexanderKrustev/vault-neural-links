import { describe, expect, it } from "vitest";
import { computeReadThrough } from "../src/recallLog.js";
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
