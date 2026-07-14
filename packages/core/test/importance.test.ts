import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computePageRank, loadNoteImportance, normalizeImportance, runImportanceComputation } from "../src/importance.js";
import type { NoteImportanceFile, StructuralLinksFile } from "../src/types.js";

function structural(edges: Record<string, string[]>): StructuralLinksFile {
  return { version: 1, builtAt: new Date().toISOString(), edges };
}

describe("computePageRank", () => {
  it("ranks a hub note above its leaves in a star graph", () => {
    // hub linked to 4 leaves, leaves link to nothing else
    const graph = structural({
      hub: ["leaf1", "leaf2", "leaf3", "leaf4"],
      leaf1: ["hub"],
      leaf2: ["hub"],
      leaf3: ["hub"],
      leaf4: ["hub"],
    });

    const scores = computePageRank(graph);

    expect(scores.hub).toBeGreaterThan(scores.leaf1);
    expect(scores.hub).toBeGreaterThan(scores.leaf2);
    expect(scores.hub).toBeGreaterThan(scores.leaf3);
    expect(scores.hub).toBeGreaterThan(scores.leaf4);
  });

  it("gives every node equal score in a symmetric ring graph", () => {
    const graph = structural({
      A: ["B", "D"],
      B: ["A", "C"],
      C: ["B", "D"],
      D: ["C", "A"],
    });

    const scores = computePageRank(graph);

    expect(scores.A).toBeCloseTo(scores.B, 5);
    expect(scores.B).toBeCloseTo(scores.C, 5);
    expect(scores.C).toBeCloseTo(scores.D, 5);
  });

  it("returns an empty map for an empty graph", () => {
    expect(computePageRank(structural({}))).toEqual({});
  });

  it("scores sum to approximately 1 (a valid probability distribution)", () => {
    const graph = structural({
      A: ["B"],
      B: ["A", "C"],
      C: ["B"],
    });

    const scores = computePageRank(graph);
    const total = Object.values(scores).reduce((sum, v) => sum + v, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});

describe("normalizeImportance", () => {
  it("min-max scales so the highest score is 1 and the lowest is 0", () => {
    const normalized = normalizeImportance({ a: 0.1, b: 0.5, c: 0.9 });
    expect(normalized.a).toBeCloseTo(0, 5);
    expect(normalized.c).toBeCloseTo(1, 5);
    expect(normalized.b).toBeCloseTo(0.5, 5);
  });

  it("returns all zeros when every raw score is identical", () => {
    expect(normalizeImportance({ a: 0.3, b: 0.3 })).toEqual({ a: 0, b: 0 });
  });

  it("returns an empty map for an empty input", () => {
    expect(normalizeImportance({})).toEqual({});
  });
});

describe("runImportanceComputation", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-importance-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns a zero result when no structural index has been built yet", async () => {
    const result = await runImportanceComputation(dataDir);
    expect(result).toEqual({ noteCount: 0, computedAt: result.computedAt });
    expect(await loadNoteImportance(dataDir)).toBeNull();
  });

  it("computes and persists normalized scores from structural-links.json", async () => {
    const now = new Date("2026-07-14T00:00:00.000Z");
    const structuralFile: StructuralLinksFile = structural({
      hub: ["leaf1", "leaf2"],
      leaf1: ["hub"],
      leaf2: ["hub"],
    });
    await writeFile(join(dataDir, "structural-links.json"), JSON.stringify(structuralFile), "utf8");

    const result = await runImportanceComputation(dataDir, undefined, now);
    expect(result).toEqual({ noteCount: 3, computedAt: now.toISOString() });

    const persisted = JSON.parse(await readFile(join(dataDir, "note-importance.json"), "utf8")) as NoteImportanceFile;
    expect(persisted.scores.hub).toBeCloseTo(1, 5);
    expect(persisted.scores.leaf1).toBeLessThan(persisted.scores.hub);
  });
});
