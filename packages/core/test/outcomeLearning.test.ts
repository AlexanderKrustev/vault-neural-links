import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rebuildContentIndex } from "../src/contentIndex.js";
import { writeNote } from "../src/notes.js";
import { foldOutcomes, outcomeRoutes, outcomeShift, type OutcomeModel } from "../src/outcomeLearning.js";
import { recall } from "../src/recall.js";
import type { RecallLogEntry, RecallLogHit } from "../src/types.js";

/**
 * VNL-073. The rules here decide what the engine learns is a good link, so
 * each one is pinned by a test: reward only on an open, weaken only what was
 * skipped *above* an open, stay silent where the log cannot tell, and score a
 * rate so that being shown often is never the same as being useful.
 */
const NOW = new Date("2026-10-01T00:00:00.000Z");
let seq = 0;

function hit(path: string, rank: number, extra: Partial<RecallLogHit> = {}): RecallLogHit {
  return { path, rank, source: "lexical", score: 1, lexicalScore: 1, matchedTerms: ["alpha"], ...extra };
}
function call(
  hits: RecallLogHit[],
  opened: string[],
  opts: { wrote?: boolean; ts?: string } = {},
): RecallLogEntry[] {
  const recallId = `r${++seq}`;
  const ts = opts.ts ?? "2026-09-30T00:00:00.000Z";
  return [
    { ts, instance: "i", type: "returned", recallId, query: "alpha", resultCount: hits.length, hits },
    ...opened.map((path): RecallLogEntry => ({ ts, instance: "i", type: "read", recallId, path })),
    ...(opts.wrote ? [{ ts, instance: "i", type: "write", recallId, path: "Notes/Out" } as RecallLogEntry] : []),
  ];
}

describe("outcome routes", () => {
  it("credits the seed link and every word that delivered the result", () => {
    expect(outcomeRoutes({ path: "B", via: "A", matchedTerms: ["x"], learnedTerms: ["x", "y"] })).toEqual([
      "note:A|B",
      "term:x|B",
      "term:y|B",
    ]);
  });

  it("gives a result that arrived by meaning alone no route", () => {
    expect(outcomeRoutes({ path: "B" })).toEqual([]);
  });
});

describe("foldOutcomes", () => {
  it("rewards what was opened and weakens what was skipped above it", () => {
    const model = foldOutcomes(call([hit("A", 1), hit("B", 2), hit("C", 3)], ["B"]), NOW);

    expect(model.routes["term:alpha|B"].successes).toBeGreaterThan(0);
    expect(model.routes["term:alpha|A"].failures).toBeGreaterThan(0);
    expect(model.routes["term:alpha|A"].successes).toBe(0);
    // Below the lowest opened result nobody can say it was even looked at.
    expect(model.routes["term:alpha|C"]).toBeUndefined();
    expect(model.callsJudged).toBe(1);
  });

  it("learns nothing from a call where nothing was opened — the snippet may have been enough", () => {
    const model = foldOutcomes(call([hit("A", 1), hit("B", 2)], []), NOW);

    expect(model.routes).toEqual({});
    expect(model.priorRate).toBeNull();
  });

  it("learns nothing from lines logged before the shown list was recorded", () => {
    const old: RecallLogEntry[] = [
      { ts: "2026-09-20T00:00:00.000Z", instance: "i", type: "returned", recallId: "old", query: "q", resultCount: 3 },
      { ts: "2026-09-20T00:00:00.000Z", instance: "i", type: "read", recallId: "old", path: "A" },
    ];

    expect(foldOutcomes(old, NOW).callsJudged).toBe(0);
  });

  it("counts a result that reached the work twice as strongly as one that was only opened", () => {
    const opened = foldOutcomes(call([hit("A", 1)], ["A"]), NOW);
    const used = foldOutcomes(call([hit("A", 1)], ["A"], { wrote: true }), NOW);

    expect(used.routes["term:alpha|A"].successes).toBeCloseTo(2 * opened.routes["term:alpha|A"].successes);
  });

  it("lets old evidence fade on the half-life", () => {
    const recent = foldOutcomes(call([hit("A", 1)], ["A"], { ts: "2026-09-30T00:00:00.000Z" }), NOW);
    const monthOld = foldOutcomes(call([hit("A", 1)], ["A"], { ts: "2026-08-31T00:00:00.000Z" }), NOW);

    expect(monthOld.routes["term:alpha|A"].successes).toBeCloseTo(recent.routes["term:alpha|A"].successes / 2, 1);
  });

  it("accepts lines in any order, as several instances' logs interleave", () => {
    const lines = call([hit("A", 1), hit("B", 2)], ["B"]);
    expect(foldOutcomes([...lines].reverse(), NOW)).toEqual(foldOutcomes(lines, NOW));
  });
});

describe("outcomeShift", () => {
  function model(): OutcomeModel {
    const entries: RecallLogEntry[] = [];
    // "Good" is opened every time it is shown; "Popular" is shown above an
    // opened result ten times and skipped nine.
    for (let i = 0; i < 10; i++) {
      entries.push(...call([hit("Popular", 1), hit("Good", 2)], i === 0 ? ["Popular", "Good"] : ["Good"]));
    }
    return foldOutcomes(entries, NOW);
  }

  it("is positive for a link that keeps paying off and negative for one that keeps being skipped", () => {
    const m = model();
    expect(outcomeShift(m, { path: "Good", matchedTerms: ["alpha"] })).toBeGreaterThan(0);
    expect(outcomeShift(m, { path: "Popular", matchedTerms: ["alpha"] })).toBeLessThan(0);
  });

  it("does not reward being shown often — it is a rate, not a count", () => {
    // Popular was shown exactly as often as Good; appearing is not evidence.
    const m = model();
    expect(outcomeShift(m, { path: "Popular", matchedTerms: ["alpha"] })!).toBeLessThan(
      outcomeShift(m, { path: "Good", matchedTerms: ["alpha"] })!,
    );
  });

  it("is undefined, not zero, for a link with no evidence", () => {
    expect(outcomeShift(model(), { path: "Never Shown", matchedTerms: ["alpha"] })).toBeUndefined();
  });

  it("does not treat one success out of one as certainty", () => {
    const single = foldOutcomes([...call([hit("A", 1), hit("B", 2)], ["B"]), ...call([hit("C", 1), hit("D", 2)], ["D"])], NOW);
    // Prior 50% (two opened, two skipped); B is 1/1 but smoothed well below the cap.
    expect(outcomeShift(single, { path: "B", matchedTerms: ["alpha"] })!).toBeLessThan(1);
  });

  it("is bounded", () => {
    const entries: RecallLogEntry[] = [];
    for (let i = 0; i < 200; i++) entries.push(...call([hit("Skipped", 1), hit("Opened", 2)], ["Opened"], { wrote: true }));
    const m = foldOutcomes(entries, NOW);
    expect(Math.abs(outcomeShift(m, { path: "Skipped", matchedTerms: ["alpha"] })!)).toBeLessThanOrEqual(2);
    expect(Math.abs(outcomeShift(m, { path: "Opened", matchedTerms: ["alpha"] })!)).toBeLessThanOrEqual(2);
  });
});

describe("shadow mode in recall", () => {
  let vaultPath: string;
  let dataDir: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-outcome-vault-"));
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-outcome-data-"));
    await writeNote(vaultPath, "Kill Process By Port", { frontmatter: {}, body: "kill the process on a port with lsof" });
    await writeNote(vaultPath, "Port Forwarding", { frontmatter: {}, body: "forward a port over ssh, the process stays" });
    await rebuildContentIndex(vaultPath, dataDir);
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it("scores hits for the log without changing the ranking", async () => {
    const without = await recall(vaultPath, dataDir, "kill process port", { outcome: false, embeddings: false });
    const top = without.hits[0].path;
    const other = without.hits[1].path;
    // A model that strongly prefers whatever ranked second.
    const entries: RecallLogEntry[] = [];
    for (let i = 0; i < 20; i++) {
      entries.push(...call([hit(top, 1, { matchedTerms: ["port"] }), hit(other, 2, { matchedTerms: ["port"] })], [other]));
    }
    const shadow = await recall(vaultPath, dataDir, "kill process port", {
      outcome: foldOutcomes(entries, NOW),
      embeddings: false,
    });

    expect(shadow.hits.map((h) => h.path)).toEqual(without.hits.map((h) => h.path));
    expect(shadow.shadowOutcome?.[other]).toBeGreaterThan(0);
    expect(shadow.shadowOutcome?.[top]).toBeLessThan(0);
    // Kept out of `why`, which is what the model reads.
    expect(JSON.stringify(shadow.hits)).not.toContain("outcome");
  });

  it("adds nothing when there is no evidence yet", async () => {
    const result = await recall(vaultPath, dataDir, "kill process port", { embeddings: false });
    expect(result.shadowOutcome).toBeUndefined();
  });
});
