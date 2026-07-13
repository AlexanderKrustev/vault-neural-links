import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  it("preserves edges from a prior compaction when a later compaction only touches unrelated edges", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 1 }));
    await compact(dataDir);

    const weightAfterFirst = await getEdgeWeight(dataDir, "A", "B");
    expect(weightAfterFirst).toBeCloseTo(1, 5);

    await appendEvent(dataDir, "inst-1", event({ from: "X", to: "Y", weight_delta: 1 }));
    const result = await compact(dataDir);

    expect(result.edgeCount).toBe(2);
    const weightAfterSecond = await getEdgeWeight(dataDir, "A", "B");
    expect(weightAfterSecond).not.toBeNull();
    expect(weightAfterSecond).toBeCloseTo(1, 5);

    const newWeight = await getEdgeWeight(dataDir, "X", "Y");
    expect(newWeight).toBeCloseTo(1, 5);
  });
});


describe("reactivation-day tracking", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-reactivation-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("records a distinct calendar day per compaction and dedupes same-day events", async () => {
    const day1 = new Date("2026-07-10T09:00:00.000Z").toISOString();
    const day1Later = new Date("2026-07-10T18:00:00.000Z").toISOString();
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", ts: day1 }));
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", ts: day1Later }));
    await compact(dataDir);

    const day2 = new Date("2026-07-11T09:00:00.000Z").toISOString();
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", ts: day2 }));
    await compact(dataDir);

    const raw = JSON.parse(await readFile(join(dataDir, "link-weights.json"), "utf8"));
    expect(raw.edges["A|B"].reactivationDays).toEqual(["2026-07-10", "2026-07-11"]);
  });

  it("adds consolidatedScore undecayed to the live weight even for a stale edge", async () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", ts: old, weight_delta: 10 }));
    await compact(dataDir);

    const withoutConsolidation = await getEdgeWeight(dataDir, "A", "B");

    const raw = JSON.parse(await readFile(join(dataDir, "link-weights.json"), "utf8"));
    raw.edges["A|B"].consolidatedScore = 50;
    await writeFile(join(dataDir, "link-weights.json"), JSON.stringify(raw), "utf8");

    const withConsolidation = await getEdgeWeight(dataDir, "A", "B");
    expect(withConsolidation).toBeCloseTo(withoutConsolidation! + 50, 5);
  });
});


describe("legacy weight field migration", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-legacy-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("migrates a pre-rename edge (field `weight`) to `baseStrength` even with no new events touching it", async () => {
    const legacyFile = {
      version: 1,
      compactedAt: new Date().toISOString(),
      edges: {
        "A|B": { weight: 7, lastTouched: new Date().toISOString(), traverseCount: 1, reinforceCount: 0 },
      },
    };
    await writeFile(join(dataDir, "link-weights.json"), JSON.stringify(legacyFile), "utf8");

    await compact(dataDir);

    const weight = await getEdgeWeight(dataDir, "A", "B");
    expect(weight).toBeCloseTo(7, 5);

    const raw = JSON.parse(await readFile(join(dataDir, "link-weights.json"), "utf8"));
    expect(raw.edges["A|B"].baseStrength).toBeCloseTo(7, 5);
    expect(raw.edges["A|B"].weight).toBeUndefined();
    expect(raw.edges["A|B"].reactivationDays).toEqual([]);
    expect(raw.edges["A|B"].consolidatedScore).toBe(0);
  });
});


describe("per-note-type decay tau at query time", () => {
  let dataDir: string;
  let vaultPath: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-data-"));
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-vault-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("decays a moc-type neighbor slower than the global default half-life", async () => {
    await writeFile(join(vaultPath, "Hub.md"), "---\ntype: moc\n---\nbody", "utf8");

    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "Hub", ts: old, weight_delta: 10 }));
    await compact(dataDir);

    const withoutType = await getEdgeWeight(dataDir, "A", "Hub");
    const withType = await getEdgeWeight(dataDir, "A", "Hub", vaultPath);

    expect(withoutType).toBeCloseTo(5, 0); // default 30-day half-life: one half-life elapsed
    expect(withType).toBeGreaterThan(withoutType!); // moc tau (90d) decays slower over the same 30 days
  });
});
