import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initInstance } from "../src/index.js";

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
});
