import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { initInstance } from "../src/index.js";
import { appendEvent } from "../src/logger.js";
import { sessionBufferFilePath } from "../src/priming.js";
import type { ActivationTraceEvent, EventLogEntry, SessionBufferFile } from "../src/types.js";

function event(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    ts: new Date().toISOString(),
    instance: "seed",
    type: "traverse",
    from: "A",
    to: "B",
    weight_delta: 1,
    ...overrides,
  };
}

describe("initInstance", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-vault-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("logs traversals and reinforcements, compacts, and queries neighbors", async () => {
    const client = initInstance(vaultPath, "test-instance");

    await client.logTraversal("A", "B");
    await client.reinforce("A", "B", 10);
    await client.compact();

    const neighbors = await client.getWeightedNeighbors("A");
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].path).toBe("B");
    expect(neighbors[0].weight).toBeGreaterThan(0);
  });

  it("auto-generates an instance id when none is supplied", async () => {
    const client = initInstance(vaultPath);
    await client.logTraversal("A", "B");
    const result = await client.compact();
    expect(result.edgeCount).toBe(1);
  });

  it("gives a session-primed neighbor a higher score than an equally-weighted one that hasn't been touched this session", async () => {
    const vaultDataDir = join(vaultPath, ".vault-neural-links");
    // Seed both edges directly (bypassing the client) so seeding itself
    // doesn't touch the session buffer.
    await appendEvent(vaultDataDir, "seed", event({ from: "A", to: "B", weight_delta: 1 }));
    await appendEvent(vaultDataDir, "seed", event({ from: "A", to: "C", weight_delta: 1 }));

    const client = initInstance(vaultPath, "test-instance");
    await client.compact();

    // Only B is visited this session; C has identical base weight but is
    // never touched, so only B should carry the priming bonus.
    await client.logTraversal("X", "B");

    const neighbors = await client.getWeightedNeighbors("A");
    const b = neighbors.find((n) => n.path === "B")!;
    const c = neighbors.find((n) => n.path === "C")!;
    expect(b.weight).toBeGreaterThan(c.weight);
  });

  it("emits an edge_traversed event on logTraversal and reinforce, not just activate", async () => {
    const client = initInstance(vaultPath, "test-instance");
    const events: ActivationTraceEvent[] = [];

    await client.logTraversal("A", "B", (e) => events.push(e));
    await client.reinforce("A", "B", 7, (e) => events.push(e));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "edge_traversed", from: "A", to: "B", energy: 1 });
    expect(events[1]).toMatchObject({ type: "edge_traversed", from: "A", to: "B", energy: 7 });
  });

  it("emits an edge_traversed event per changed edge on compact", async () => {
    const client = initInstance(vaultPath, "test-instance");
    await client.logTraversal("A", "B");
    await client.logTraversal("C", "D");

    const events: ActivationTraceEvent[] = [];
    await client.compact((e) => events.push(e));

    expect(events).toHaveLength(2);
    const pairs = events.map((e) => [e.from, e.to].sort());
    expect(pairs).toContainEqual(["A", "B"]);
    expect(pairs).toContainEqual(["C", "D"]);
  });

  it("does not re-emit compact events for edges unchanged since the last compaction", async () => {
    const client = initInstance(vaultPath, "test-instance");
    await client.logTraversal("A", "B");
    await client.compact();

    const events: ActivationTraceEvent[] = [];
    await client.compact((e) => events.push(e));

    expect(events).toHaveLength(0);
  });

  it("persists the session buffer to disk so out-of-process consumers can read it", async () => {
    const client = initInstance(vaultPath, "test-instance");
    await client.logTraversal("A", "B");

    const vaultDataDir = join(vaultPath, ".vault-neural-links");
    const raw = await readFile(sessionBufferFilePath(vaultDataDir, "test-instance"), "utf8");
    const parsed = JSON.parse(raw) as SessionBufferFile;
    expect(parsed.instance).toBe("test-instance");
    expect(parsed.notes).toEqual(["A", "B"]);
  });
});
