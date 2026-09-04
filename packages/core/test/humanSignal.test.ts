import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compact } from "../src/compactor.js";
import { HumanNavigationTracker } from "../src/humanSignal.js";
import { appendEvent } from "../src/logger.js";
import { computeUsageReport } from "../src/usageReport.js";
import { DEFAULT_HUMAN_SIGNAL_CONFIG } from "../src/types.js";

const START = new Date("2026-09-03T10:00:00.000Z");
const at = (minutes: number) => new Date(START.getTime() + minutes * 60_000);

describe("HumanNavigationTracker (VNL-052)", () => {
  it("logs nothing for the first note opened — a single note is not a relationship", () => {
    const tracker = new HumanNavigationTracker("obsidian-1");
    expect(tracker.noteOpened("A", START)).toBeNull();
  });

  it("logs a traverse edge for two notes opened one after the other", () => {
    const tracker = new HumanNavigationTracker("obsidian-1");
    tracker.noteOpened("A", START);

    const event = tracker.noteOpened("B", at(1));

    expect(event).toMatchObject({
      instance: "obsidian-1",
      type: "traverse",
      from: "A",
      to: "B",
      trigger: "human-open",
      weight_delta: DEFAULT_HUMAN_SIGNAL_CONFIG.openWeight,
    });
  });

  it("weights human events well below an agent traversal's 1", () => {
    expect(DEFAULT_HUMAN_SIGNAL_CONFIG.openWeight).toBeLessThan(1);
    expect(DEFAULT_HUMAN_SIGNAL_CONFIG.editWeight).toBeLessThan(1);
    // Editing is deeper engagement than merely opening.
    expect(DEFAULT_HUMAN_SIGNAL_CONFIG.editWeight).toBeGreaterThan(DEFAULT_HUMAN_SIGNAL_CONFIG.openWeight);
  });

  it("does not pair two opens further apart than the co-open window", () => {
    const tracker = new HumanNavigationTracker("obsidian-1");
    tracker.noteOpened("A", START);

    expect(tracker.noteOpened("B", at(11))).toBeNull();
  });

  it("ignores re-opening the note already open", () => {
    const tracker = new HumanNavigationTracker("obsidian-1");
    tracker.noteOpened("A", START);

    expect(tracker.noteOpened("A", at(1))).toBeNull();
  });

  it("throttles flipping back and forth between the same two notes", () => {
    const tracker = new HumanNavigationTracker("obsidian-1");
    tracker.noteOpened("A", START);
    expect(tracker.noteOpened("B", at(0.1))).not.toBeNull();

    // Same pair again moments later: one relationship, not two.
    expect(tracker.noteOpened("A", at(0.2))).toBeNull();
    expect(tracker.noteOpened("B", at(0.3))).toBeNull();

    // Past the throttle it counts again — returning later is real evidence.
    expect(tracker.noteOpened("A", at(2))).not.toBeNull();
  });

  it("still logs genuinely new navigation while another pair is throttled", () => {
    const tracker = new HumanNavigationTracker("obsidian-1");
    tracker.noteOpened("A", START);
    tracker.noteOpened("B", at(0.1));

    expect(tracker.noteOpened("C", at(0.2))).toMatchObject({ from: "B", to: "C" });
  });

  it("credits an edit to the note the user navigated in from", () => {
    const tracker = new HumanNavigationTracker("obsidian-1");
    tracker.noteOpened("A", START);
    tracker.noteOpened("B", at(1));

    const event = tracker.noteModified("B", at(2));

    expect(event).toMatchObject({
      type: "reinforce",
      from: "A",
      to: "B",
      trigger: "human-edit",
      weight_delta: DEFAULT_HUMAN_SIGNAL_CONFIG.editWeight,
    });
  });

  it("ignores a write to a note that isn't the one open — that's the MCP server or a sync client, not the user", () => {
    const tracker = new HumanNavigationTracker("obsidian-1");
    tracker.noteOpened("A", START);
    tracker.noteOpened("B", at(1));

    expect(tracker.noteModified("Some Other Note", at(2))).toBeNull();
  });

  it("logs nothing when the note being edited was the first thing opened", () => {
    const tracker = new HumanNavigationTracker("obsidian-1");
    tracker.noteOpened("A", START);

    expect(tracker.noteModified("A", at(1))).toBeNull();
  });

  it("throttles repeated saves while writing, and stops crediting once the arrival is stale", () => {
    const tracker = new HumanNavigationTracker("obsidian-1");
    tracker.noteOpened("A", START);
    tracker.noteOpened("B", at(1));

    expect(tracker.noteModified("B", at(1.5))).not.toBeNull();
    expect(tracker.noteModified("B", at(2))).toBeNull(); // inside the edit throttle
    expect(tracker.noteModified("B", at(7))).not.toBeNull(); // past it, still within the window of arriving at B

    // An hour of typing in B is not an hour of mounting evidence about A:
    // the window is measured from the arrival at B and never refreshed.
    expect(tracker.noteModified("B", at(70))).toBeNull();
  });

  it("its events fold into link weights through the normal compactor, and count on their own axis", async () => {
    // The point of reusing the existing event log: no other stage of the
    // pipeline needs to know the plugin exists.
    const dataDir = await mkdtemp(join(tmpdir(), "vnl-test-human-signal-"));
    try {
      const tracker = new HumanNavigationTracker("obsidian-1");
      tracker.noteOpened("A", START);
      const open = tracker.noteOpened("B", at(1))!;
      const edit = tracker.noteModified("B", at(2))!;
      await appendEvent(dataDir, "obsidian-1", open);
      await appendEvent(dataDir, "obsidian-1", edit);

      // Before compaction: the usage report reads the raw event logs, and
      // compaction consumes them (pre-existing behaviour — the report is a
      // "since the last fold" view, not a lifetime total).
      const report = await computeUsageReport(dataDir);
      expect(report.mechanismCounts.human).toEqual({ opens: 1, edits: 1 });
      // Human activity must not be mistaken for the agent's own traffic.
      expect(report.mechanismCounts.traverse).toBe(0);
      expect(report.mechanismCounts.reinforce).toEqual({ explicit: 0, autoRetrieval: 0, cited: 0 });

      const result = await compact(dataDir);
      expect(result.edgeCount).toBe(1);

      // Asserted on the stored strength, not getEdgeWeight's live value —
      // the latter has decay applied against the wall clock, which is
      // correct behaviour but says nothing extra about the fold.
      const weights = JSON.parse(await readFile(join(dataDir, "link-weights.json"), "utf8")) as {
        edges: Record<string, { baseStrength: number; traverseCount: number; reinforceCount: number }>;
      };
      expect(weights.edges["A|B"]).toMatchObject({ traverseCount: 1, reinforceCount: 1 });
      expect(weights.edges["A|B"].baseStrength).toBeCloseTo(
        DEFAULT_HUMAN_SIGNAL_CONFIG.openWeight + DEFAULT_HUMAN_SIGNAL_CONFIG.editWeight,
        5,
      );

    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("accepts a config override so the benchmark can sweep the weights", () => {
    const tracker = new HumanNavigationTracker("obsidian-1", {
      ...DEFAULT_HUMAN_SIGNAL_CONFIG,
      openWeight: 0.05,
      coOpenWindowMs: 1000,
    });
    tracker.noteOpened("A", START);

    expect(tracker.noteOpened("B", new Date(START.getTime() + 500))).toMatchObject({ weight_delta: 0.05 });
    tracker.noteOpened("C", new Date(START.getTime() + 5000));
    expect(tracker.noteOpened("D", new Date(START.getTime() + 20000))).toBeNull();
  });
});
