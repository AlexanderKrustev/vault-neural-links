import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "../src/logger.js";
import { compact } from "../src/compactor.js";
import { getEdgeWeight, getWeightedNeighbors } from "../src/query.js";
import { rebuildStructuralIndex } from "../src/structuralLinks.js";
import { runImportanceComputation } from "../src/importance.js";
import { SessionBuffer } from "../src/priming.js";
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
    // Not ~5 (plain one-half-life decay) — this edge has only 1 touch, so
    // it's still "unestablished" and goes through USAGE_FAST_DECAY_WINDOW_DAYS's
    // steeper initial decay before continuing at the normal 30-day half-life
    // (see query.ts's liveWeight doc comment, AIBRAIN-66 fast-follow).
    expect(weight).toBeCloseTo(0.3272794128563236, 5);
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


describe("supersession surfacing in getWeightedNeighbors", () => {
  let dataDir: string;
  let vaultPath: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-supersede-data-"));
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-supersede-vault-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("flags a fresh, heavily-weighted neighbor that is marked superseded", async () => {
    await writeFile(
      join(vaultPath, "Old ADR.md"),
      '---\nstatus: superseded\nsuperseded_by: "[[New ADR]]"\n---\nbody',
      "utf8",
    );
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "Old ADR", weight_delta: 10 }));
    await compact(dataDir);

    const neighbors = await getWeightedNeighbors(dataDir, "A", 10, vaultPath);
    const oldAdr = neighbors.find((n) => n.path === "Old ADR")!;
    expect(oldAdr.supersededBy).toBe("New ADR");
    // Still fresh/heavily-weighted despite being outdated — recency alone wouldn't have flagged it.
    expect(oldAdr.weight).toBeGreaterThan(0);
  });

  it("does not set supersededBy for a note without that frontmatter", async () => {
    await writeFile(join(vaultPath, "Current.md"), "---\nstatus: active\n---\nbody", "utf8");
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "Current", weight_delta: 10 }));
    await compact(dataDir);

    const neighbors = await getWeightedNeighbors(dataDir, "A", 10, vaultPath);
    expect(neighbors.find((n) => n.path === "Current")!.supersededBy).toBeUndefined();
  });

  it("does not check supersession when no vaultPath is given", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await compact(dataDir);

    const neighbors = await getWeightedNeighbors(dataDir, "A");
    expect(neighbors[0].supersededBy).toBeUndefined();
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


describe("structural-link floor-weight fallback", () => {
  let dataDir: string;
  let vaultPath: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-structural-fallback-data-"));
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-structural-fallback-vault-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("surfaces a wikilinked note with no usage history at the floor weight", async () => {
    await writeFile(join(vaultPath, "A.md"), "linked to [[B]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "body", "utf8");
    await rebuildStructuralIndex(vaultPath, dataDir);

    const neighbors = await getWeightedNeighbors(dataDir, "A", 10, vaultPath);
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]).toMatchObject({ path: "B", weight: 0.1, source: "structural" });
  });

  it("prefers the real usage-weighted edge over the structural floor for the same pair", async () => {
    await writeFile(join(vaultPath, "A.md"), "linked to [[B]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "body", "utf8");
    await rebuildStructuralIndex(vaultPath, dataDir);

    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 5 }));
    await compact(dataDir);

    const neighbors = await getWeightedNeighbors(dataDir, "A", 10, vaultPath);
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].source).toBe("usage");
    expect(neighbors[0].weight).toBeCloseTo(5, 5);
  });

  it("ranks a real usage neighbor above a structural-only neighbor for the same note", async () => {
    await writeFile(join(vaultPath, "A.md"), "linked to [[B]] and [[C]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "body", "utf8");
    await writeFile(join(vaultPath, "C.md"), "body", "utf8");
    await rebuildStructuralIndex(vaultPath, dataDir);

    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 1 }));
    await compact(dataDir);

    const neighbors = await getWeightedNeighbors(dataDir, "A", 10, vaultPath);
    expect(neighbors.map((n) => n.path)).toEqual(["B", "C"]);
    expect(neighbors.find((n) => n.path === "C")!.source).toBe("structural");
  });

  it("returns no structural fallback when the structural index hasn't been built", async () => {
    await writeFile(join(vaultPath, "A.md"), "linked to [[B]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "body", "utf8");

    const neighbors = await getWeightedNeighbors(dataDir, "A", 10, vaultPath);
    expect(neighbors).toEqual([]);
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

    // Not ~5 — single-touch edge, still "unestablished", goes through the
    // fast-decay window first (see the other test's comment for detail).
    expect(withoutType).toBeCloseTo(0.3272794130313644, 5);
    expect(withType).toBeGreaterThan(withoutType!); // moc tau (90d) decays slower over the same 30 days
  });
});

describe("AIBRAIN-21: PageRank importance blended into retrieval weight", () => {
  let dataDir: string;
  let vaultPath: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-importance-data-"));
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-importance-vault-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("ranks an equally-weighted hub neighbor above a non-hub neighbor once importance has been computed", async () => {
    // Hub is heavily wikilinked (by Other1/Other2/Other3); Leaf has no other incoming links.
    await writeFile(join(vaultPath, "A.md"), "linked to [[Hub]] and [[Leaf]]", "utf8");
    await writeFile(join(vaultPath, "Hub.md"), "body", "utf8");
    await writeFile(join(vaultPath, "Leaf.md"), "body", "utf8");
    await writeFile(join(vaultPath, "Other1.md"), "linked to [[Hub]]", "utf8");
    await writeFile(join(vaultPath, "Other2.md"), "linked to [[Hub]]", "utf8");
    await writeFile(join(vaultPath, "Other3.md"), "linked to [[Hub]]", "utf8");
    await rebuildStructuralIndex(vaultPath, dataDir);
    await runImportanceComputation(dataDir);

    // Give both A->Hub and A->Leaf the exact same usage weight, so any
    // ranking difference is attributable only to importance blending.
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "Hub", weight_delta: 3 }));
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "Leaf", weight_delta: 3 }));
    await compact(dataDir);

    const neighbors = await getWeightedNeighbors(dataDir, "A", 10, vaultPath);
    const hub = neighbors.find((n) => n.path === "Hub")!;
    const leaf = neighbors.find((n) => n.path === "Leaf")!;

    expect(hub.weight).toBeGreaterThan(leaf.weight);
    expect(neighbors[0].path).toBe("Hub");
  });

  it("leaves weights unchanged when note-importance.json hasn't been computed yet", async () => {
    await writeFile(join(vaultPath, "A.md"), "linked to [[B]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "body", "utf8");
    await rebuildStructuralIndex(vaultPath, dataDir);
    // deliberately not calling runImportanceComputation

    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 5 }));
    await compact(dataDir);

    const neighbors = await getWeightedNeighbors(dataDir, "A", 10, vaultPath);
    expect(neighbors[0].weight).toBeCloseTo(5, 5);
  });
});

// AIBRAIN-130: real accumulated usage weight was making rank-1 accuracy
// WORSE than a zeroed-usage baseline (9/18 vs 15/18 on the live vault's
// ground-truth query set). Root cause: priming added a flat bonus
// (PrimingConfig.bonus, +2) that reliably beat the structural floor (0.1)
// but not real usage weight, which isn't bounded anywhere near it — a
// generic hub note with real accumulated weight could permanently outrank
// a note the current session had just touched. Fix: a primed neighbor's
// weight is floored at "the strongest unprimed neighbor in this same set,
// plus a small margin" instead of a flat additive bonus.
describe("AIBRAIN-130: primed neighbor beats a stronger unprimed hub", () => {
  let dataDir: string;
  let vaultPath: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-priming-tier-data-"));
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-priming-tier-vault-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("ranks a primed neighbor above an unprimed neighbor with far more real usage weight", async () => {
    // Hub accumulates real usage weight ~9 (repeated traversal, no
    // reinforcement to keep it simple) — well above priming's flat +2.
    for (let i = 0; i < 9; i++) {
      await appendEvent(dataDir, "inst-1", event({ from: "Origin", to: "Hub", weight_delta: 1 }));
    }
    // Target has a small amount of its own usage weight, but far less than Hub's.
    await appendEvent(dataDir, "inst-1", event({ from: "Origin", to: "Target", weight_delta: 1 }));
    await compact(dataDir);

    const withoutPriming = await getWeightedNeighbors(dataDir, "Origin", 10);
    expect(withoutPriming[0].path).toBe("Hub"); // confirms the setup: Hub genuinely outweighs Target pre-priming

    const buffer = new SessionBuffer();
    buffer.touch("Target"); // "the session already read Target"
    const primed = await getWeightedNeighbors(dataDir, "Origin", 10, undefined, buffer);
    expect(primed[0].path).toBe("Target");
    expect(primed.find((n) => n.path === "Target")!.weight).toBeGreaterThan(
      primed.find((n) => n.path === "Hub")!.weight,
    );
  });

  it("does not inflate a primed neighbor's weight beyond what's needed to beat local competition", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "Origin", to: "Hub", weight_delta: 3 }));
    await appendEvent(dataDir, "inst-1", event({ from: "Origin", to: "Target", weight_delta: 1 }));
    await compact(dataDir);

    const buffer = new SessionBuffer();
    buffer.touch("Target");
    const neighbors = await getWeightedNeighbors(dataDir, "Origin", 10, undefined, buffer);
    const target = neighbors.find((n) => n.path === "Target")!;
    const hub = neighbors.find((n) => n.path === "Hub")!;

    expect(target.weight).toBeGreaterThan(hub.weight);
    // The margin over Hub should be small (a deliberate local floor, not an
    // arbitrary large constant) — otherwise activate()'s proportional
    // energy-share math would let a primed neighbor swallow ~100% of a
    // hop's outgoing energy instead of just winning the comparison.
    expect(target.weight - hub.weight).toBeLessThan(1);
  });

  it("leaves ranking unchanged when nothing in the neighbor set is primed", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "Origin", to: "Hub", weight_delta: 9 }));
    await appendEvent(dataDir, "inst-1", event({ from: "Origin", to: "Target", weight_delta: 1 }));
    await compact(dataDir);

    const neighbors = await getWeightedNeighbors(dataDir, "Origin", 10, undefined, new SessionBuffer());
    expect(neighbors[0].path).toBe("Hub");
  });
});

// AIBRAIN-141: AIBRAIN-130's fix floors a primed neighbor above the
// strongest unprimed competitor, but buffer membership itself used to be
// binary — a touch from the very start of a long session stayed at full
// priming strength forever (until LRU eviction), which meant it would go
// on permanently outranking a genuinely stronger unrelated hub long after
// the session had moved on to a different topic. primingBonus() now
// decays with time since the touch, and computeLiveNeighborWeights
// interpolates the AIBRAIN-130 floor by how much of that bonus remains.
describe("AIBRAIN-141: priming's force-rank fades as the touch grows stale", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-priming-decay-data-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("a note touched many priming half-lives ago no longer force-outranks a stronger unprimed hub", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "Origin", to: "Hub", weight_delta: 9 }));
    await appendEvent(dataDir, "inst-1", event({ from: "Origin", to: "Target", weight_delta: 1 }));
    await compact(dataDir);

    // Default halfLifeMinutes is 20; touching 3 hours (9 half-lives) in the
    // past leaves the bonus at roughly bonus/512 — negligible.
    const buffer = new SessionBuffer();
    buffer.touch("Target", new Date(Date.now() - 3 * 60 * 60 * 1000));

    const neighbors = await getWeightedNeighbors(dataDir, "Origin", 10, undefined, buffer);
    // Back to ranking exactly like an unprimed neighbor: Hub's real weight wins.
    expect(neighbors[0].path).toBe("Hub");
  });

  it("a note touched moments ago still force-outranks a stronger unprimed hub (AIBRAIN-130 behavior intact)", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "Origin", to: "Hub", weight_delta: 9 }));
    await appendEvent(dataDir, "inst-1", event({ from: "Origin", to: "Target", weight_delta: 1 }));
    await compact(dataDir);

    const buffer = new SessionBuffer();
    buffer.touch("Target");

    const neighbors = await getWeightedNeighbors(dataDir, "Origin", 10, undefined, buffer);
    expect(neighbors[0].path).toBe("Target");
  });
});
