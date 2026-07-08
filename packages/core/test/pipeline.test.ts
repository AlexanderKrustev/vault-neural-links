import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "../src/logger.js";
import { compact } from "../src/compactor.js";
import { getEdgeWeight, getWeightedNeighbors } from "../src/query.js";
import type { EventLogEntry } from "../src/types.js";

function event(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    ts: new Date().toISOString(),
    instance: "inst-1",
    type: "traverse",
    from: "A",
    to: "B",
    weight_delta: 1,
    ...overrides,
  };
}

describe("logger + compactor + query pipeline", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("appends events as JSON lines to a per-instance file", async () => {
    await appendEvent(dataDir, "inst-1", event({}));

    const content = await readFile(join(dataDir, "events", "inst-1.jsonl"), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({ from: "A", to: "B", type: "traverse" });
  });

  it("returns an empty neighbor list when no weights file exists yet", async () => {
    expect(await getWeightedNeighbors(dataDir, "A")).toEqual([]);
  });

  it("compacts events into weighted, sorted neighbors", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 1 }));
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "C", weight_delta: 1 }));
    await appendEvent(dataDir, "inst-1", event({ type: "reinforce", from: "A", to: "C", weight_delta: 5 }));

    const result = await compact(dataDir);
    expect(result.edgeCount).toBe(2);

    const neighbors = await getWeightedNeighbors(dataDir, "A");
    expect(neighbors.map((n) => n.path)).toEqual(["C", "B"]);

    const weight = await getEdgeWeight(dataDir, "A", "C");
    expect(weight).toBeGreaterThan(0);
  });

  it("collapses A->B and B->A into a single undirected edge", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B" }));
    await appendEvent(dataDir, "inst-1", event({ from: "B", to: "A" }));

    const result = await compact(dataDir);
    expect(result.edgeCount).toBe(1);
  });

  it("merges events across multiple instance log files", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B" }));
    await appendEvent(dataDir, "inst-2", event({ from: "A", to: "B" }));

    await compact(dataDir);
    const weight = await getEdgeWeight(dataDir, "A", "B");
    expect(weight).toBeCloseTo(2, 5);
  });

  it("decays weight for edges untouched since the last compaction", async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", ts: old, weight_delta: 10 }));

    await compact(dataDir);
    const weight = await getEdgeWeight(dataDir, "A", "B");
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThan(10);
    expect(weight).toBeCloseTo(5, 0);
  });
});
