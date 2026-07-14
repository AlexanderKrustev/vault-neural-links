import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "../src/logger.js";
import { compact } from "../src/compactor.js";
import { activate } from "../src/activation.js";
import { rebuildStructuralIndex } from "../src/structuralLinks.js";
import type { ActivationTraceEvent, EventLogEntry } from "../src/types.js";

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

describe("activate (spreading activation)", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-activation-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns nothing when the origin note has no edges", async () => {
    const result = await activate(dataDir, "A", 10);
    expect(result).toEqual([]);
  });

  it("activates a direct neighbor at hop 1", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await compact(dataDir);

    const result = await activate(dataDir, "A", 10);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ path: "B", hops: 1 });
    expect(result[0].energy).toBeGreaterThan(0);
  });

  it("surfaces a two-hop neighbor not directly linked to the origin", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await appendEvent(dataDir, "inst-1", event({ from: "B", to: "C", weight_delta: 10 }));
    await compact(dataDir);

    const result = await activate(dataDir, "A", 10);
    const c = result.find((n) => n.path === "C");
    expect(c).toBeDefined();
    expect(c!.hops).toBe(2);
  });

  it("does not propagate past minThreshold", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await appendEvent(dataDir, "inst-1", event({ from: "B", to: "C", weight_delta: 10 }));
    await compact(dataDir);

    // Tiny starting energy plus aggressive per-hop decay means even the
    // direct neighbor should fall under a high threshold.
    const result = await activate(dataDir, "A", 1, { energyEdgeWeightDecayPerHop: 0.1, maxHops: 3, minThreshold: 5 });
    expect(result).toEqual([]);
  });

  it("does not propagate past maxHops", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await appendEvent(dataDir, "inst-1", event({ from: "B", to: "C", weight_delta: 10 }));
    await appendEvent(dataDir, "inst-1", event({ from: "C", to: "D", weight_delta: 10 }));
    await compact(dataDir);

    const result = await activate(dataDir, "A", 10, { energyEdgeWeightDecayPerHop: 0.9, maxHops: 1, minThreshold: 0.001 });
    expect(result.map((n) => n.path)).toEqual(["B"]);
  });

  it("accumulates energy from multiple indirect paths to the same note", async () => {
    // Both B and C link directly to D, so D is reachable via two separate
    // two-hop paths from A and should accumulate energy from both.
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "C", weight_delta: 10 }));
    await appendEvent(dataDir, "inst-1", event({ from: "B", to: "D", weight_delta: 10 }));
    await appendEvent(dataDir, "inst-1", event({ from: "C", to: "D", weight_delta: 10 }));
    await compact(dataDir);

    const viaOnePath = await activate(dataDir, "A", 10, { energyEdgeWeightDecayPerHop: 0.9, maxHops: 2, minThreshold: 0.001 });
    const d = viaOnePath.find((n) => n.path === "D")!;

    // Remove one of the two paths and compare — D should get strictly less
    // energy when reachable through only one route.
    const singlePathDataDir = await mkdtemp(join(tmpdir(), "vnl-test-activation-single-"));
    await appendEvent(singlePathDataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await appendEvent(singlePathDataDir, "inst-1", event({ from: "B", to: "D", weight_delta: 10 }));
    await compact(singlePathDataDir);
    const viaSinglePath = await activate(singlePathDataDir, "A", 10, {
      energyEdgeWeightDecayPerHop: 0.9,
      maxHops: 2,
      minThreshold: 0.001,
    });
    const dSingle = viaSinglePath.find((n) => n.path === "D")!;

    expect(d.energy).toBeGreaterThan(dSingle.energy);
    await rm(singlePathDataDir, { recursive: true, force: true });
  });

  it("does not include the origin note itself in results", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await appendEvent(dataDir, "inst-1", event({ from: "B", to: "A", weight_delta: 10 }));
    await compact(dataDir);

    const result = await activate(dataDir, "A", 10);
    expect(result.find((n) => n.path === "A")).toBeUndefined();
  });

  it("spreads through a structural-only (no usage history) edge via the floor-weight fallback", async () => {
    const vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-activation-vault-"));
    await writeFile(join(vaultPath, "A.md"), "linked to [[B]] which links to [[C]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "linked to [[C]]", "utf8");
    await writeFile(join(vaultPath, "C.md"), "body", "utf8");
    await rebuildStructuralIndex(vaultPath, dataDir);

    const result = await activate(dataDir, "A", 10, undefined, vaultPath);
    expect(result.find((n) => n.path === "B")).toBeDefined();

    await rm(vaultPath, { recursive: true, force: true });
  });

  it("emits ordered edge_traversed/node_activated events with a stable runId", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await appendEvent(dataDir, "inst-1", event({ from: "B", to: "C", weight_delta: 10 }));
    await compact(dataDir);

    const events: ActivationTraceEvent[] = [];
    await activate(dataDir, "A", 10, { energyEdgeWeightDecayPerHop: 0.9, maxHops: 2, minThreshold: 0.001 }, undefined, undefined, (e) =>
      events.push(e),
    );

    expect(events.map((e) => e.type)).toEqual(["edge_traversed", "node_activated", "edge_traversed", "node_activated"]);

    const [edge1, node1, edge2, node2] = events;
    expect(edge1).toMatchObject({ from: "A", to: "B", hop: 1 });
    expect(node1).toMatchObject({ node: "B", hop: 1 });
    expect(edge2).toMatchObject({ from: "B", to: "C", hop: 2 });
    expect(node2).toMatchObject({ node: "C", hop: 2 });

    const runIds = new Set(events.map((e) => e.runId));
    expect(runIds.size).toBe(1);
  });
});
