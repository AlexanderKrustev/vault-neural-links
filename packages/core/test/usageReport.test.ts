import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeUsageReport } from "../src/usageReport.js";
import type { EventLogEntry, NoteImportanceFile, RetrievalLogEntry, SearchLogEntry } from "../src/types.js";

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vnl-usage-report-"));
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

async function writeJsonl(dir: string, file: string, entries: unknown[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, file), entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
}

function event(overrides: Partial<EventLogEntry>): EventLogEntry {
  return { ts: "2026-08-16T12:00:00.000Z", instance: "inst-1", type: "traverse", from: "A", to: "B", weight_delta: 1, ...overrides };
}

function retrieval(overrides: Partial<RetrievalLogEntry>): RetrievalLogEntry {
  return {
    ts: "2026-08-16T12:00:00.000Z",
    instance: "inst-1",
    note: "A",
    tier: "activation",
    resultCount: 3,
    latencyMs: 5,
    timedOut: false,
    relaxations: 0,
    ...overrides,
  };
}

function search(overrides: Partial<SearchLogEntry>): SearchLogEntry {
  return { ts: "2026-08-16T12:00:00.000Z", instance: "inst-1", query: "foo", resultCount: 2, useWeights: true, ...overrides };
}

describe("computeUsageReport", () => {
  it("returns empty-but-valid shape when no logs exist", async () => {
    const report = await computeUsageReport(dataDir);
    expect(report.sessionCount).toBe(0);
    expect(report.sessions).toEqual([]);
    expect(report.typicalSessionMinutes).toBeNull();
    expect(report.mechanismCounts).toEqual({
      traverse: 0,
      reinforce: { explicit: 0, autoRetrieval: 0, cited: 0 },
      human: { opens: 0, edits: 0 },
      termLearn: { searchRead: 0, recallRead: 0 },
      activate: { activation: 0, keyword: 0, recency: 0 },
      getWeightedNeighbors: 0,
      search: 0,
    });
    expect(report.topTouchedNotes).toEqual([]);
    expect(report.importanceOverlapPct).toBeNull();
    expect(report.gaps).toEqual([]);
  });

  it("counts mechanisms and derives session span from one instance's events", async () => {
    await writeJsonl(join(dataDir, "events"), "inst-1.jsonl", [
      event({ ts: "2026-08-16T12:00:00.000Z", type: "traverse", from: "A", to: "B" }),
      event({ ts: "2026-08-16T12:05:00.000Z", type: "reinforce", from: "B", to: "C", weight_delta: 5, trigger: "explicit" }),
    ]);
    await writeJsonl(join(dataDir, "retrieval"), "inst-1.jsonl", [
      retrieval({ source: "activate", tier: "activation" }),
      retrieval({ source: "activate", tier: "keyword" }),
      retrieval({ source: "get_weighted_neighbors", tier: undefined, topK: 10 }),
    ]);
    await writeJsonl(join(dataDir, "search"), "inst-1.jsonl", [search({})]);

    const report = await computeUsageReport(dataDir);

    expect(report.sessionCount).toBe(1);
    expect(report.mechanismCounts.traverse).toBe(1);
    expect(report.mechanismCounts.reinforce).toEqual({ explicit: 1, autoRetrieval: 0, cited: 0 });
    expect(report.mechanismCounts.activate).toEqual({ activation: 1, keyword: 1, recency: 0 });
    expect(report.mechanismCounts.getWeightedNeighbors).toBe(1);
    expect(report.mechanismCounts.search).toBe(1);
    expect(report.sessions[0].durationMinutes).toBe(5);
  });

  it("ranks touched notes by frequency and attaches importance scores", async () => {
    await writeJsonl(join(dataDir, "events"), "inst-1.jsonl", [
      event({ from: "hub", to: "leaf1" }),
      event({ from: "hub", to: "leaf2" }),
      event({ from: "hub", to: "leaf3" }),
    ]);
    const importance: NoteImportanceFile = { version: 1, computedAt: "2026-08-16T00:00:00.000Z", scores: { hub: 0.9, leaf1: 0.1 } };
    await writeFile(join(dataDir, "note-importance.json"), JSON.stringify(importance), "utf8");

    const report = await computeUsageReport(dataDir, 5);

    expect(report.topTouchedNotes[0]).toEqual({ path: "hub", touches: 3, importance: 0.9 });
    const leaf3 = report.topTouchedNotes.find((n) => n.path === "leaf3");
    expect(leaf3?.importance).toBeNull();
  });

  it("flags the no-reinforcement-at-all gap only when traversal happened without any reinforce", async () => {
    await writeJsonl(join(dataDir, "events"), "inst-1.jsonl", [event({ type: "traverse" })]);

    const report = await computeUsageReport(dataDir);

    expect(report.gaps.some((g) => g.includes("No reinforcement signal recorded"))).toBe(true);
  });

  it("distinguishes auto-retrieval reinforcement from explicit and adjusts the gap message", async () => {
    await writeJsonl(join(dataDir, "events"), "inst-1.jsonl", [
      event({ type: "traverse" }),
      event({ type: "reinforce", from: "A", to: "B", weight_delta: 3, trigger: "auto-retrieval" }),
    ]);

    const report = await computeUsageReport(dataDir);

    expect(report.mechanismCounts.reinforce).toEqual({ explicit: 0, autoRetrieval: 1, cited: 0 });
    expect(report.gaps.some((g) => g.includes("All reinforcement signal so far is automatic (1 edge(s)"))).toBe(true);
    expect(report.gaps.some((g) => g.includes("no automatic reinforcement has fired either"))).toBe(false);
  });

  it("flags the no-search-recorded gap only when other activity exists and search logs are absent", async () => {
    await writeJsonl(join(dataDir, "events"), "inst-1.jsonl", [event({ type: "traverse" })]);

    const withoutSearch = await computeUsageReport(dataDir);
    expect(withoutSearch.gaps.some((g) => g.includes("No search_notes activity recorded"))).toBe(true);

    await writeJsonl(join(dataDir, "search"), "inst-1.jsonl", [search({})]);
    const withSearch = await computeUsageReport(dataDir);
    expect(withSearch.gaps.some((g) => g.includes("No search_notes activity recorded"))).toBe(false);
  });

  it("counts term-learning events on their own axis and keeps query tokens out of touched notes (VNL-053)", async () => {
    await writeJsonl(join(dataDir, "events"), "inst-1.jsonl", [
      event({ type: "term", from: "kill", to: "Kill Process By Port", trigger: "search-read" }),
      event({ type: "term", from: "port", to: "Kill Process By Port", trigger: "recall-read" }),
      event({ type: "traverse", from: "A", to: "B" }),
    ]);

    const report = await computeUsageReport(dataDir);

    expect(report.mechanismCounts.termLearn).toEqual({ searchRead: 1, recallRead: 1 });
    // The token "kill"/"port" must never appear as a touched note — only the
    // real note-note traverse above should show up.
    expect(report.topTouchedNotes.map((n) => n.path).sort()).toEqual(["A", "B"]);
    expect(report.mechanismCounts.traverse).toBe(1);
  });

  it("treats a reinforce event with no trigger field as explicit (pre-AIBRAIN-71 data)", async () => {
    const { trigger: _drop, ...legacyReinforce } = event({ type: "reinforce", from: "A", to: "B", weight_delta: 5, trigger: "explicit" });
    await writeJsonl(join(dataDir, "events"), "inst-1.jsonl", [event({ type: "traverse" }), legacyReinforce]);

    const report = await computeUsageReport(dataDir);

    expect(report.mechanismCounts.reinforce).toEqual({ explicit: 1, autoRetrieval: 0, cited: 0 });
  });
});
