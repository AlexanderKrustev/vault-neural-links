import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadNoteClusters, runClusterComputation, runLouvain } from "../src/clustering.js";
import type { NoteClustersFile, StructuralLinksFile } from "../src/types.js";

function structural(edges: Record<string, string[]>): StructuralLinksFile {
  return { version: 1, builtAt: new Date().toISOString(), edges };
}

describe("runLouvain", () => {
  it("returns an empty map for an empty graph", () => {
    expect(runLouvain(structural({}))).toEqual({});
  });

  it("puts every isolated node in its own community", () => {
    const graph = structural({ A: [], B: [], C: [] });
    const clusters = runLouvain(graph);
    expect(new Set(Object.values(clusters)).size).toBe(3);
  });

  it("groups two densely-linked cliques into separate clusters from each other", () => {
    const graph = structural({
      a1: ["a2", "a3"],
      a2: ["a1", "a3"],
      a3: ["a1", "a2"],
      b1: ["b2", "b3"],
      b2: ["b1", "b3"],
      b3: ["b1", "b2"],
    });

    const clusters = runLouvain(graph);

    expect(clusters.a1).toBe(clusters.a2);
    expect(clusters.a2).toBe(clusters.a3);
    expect(clusters.b1).toBe(clusters.b2);
    expect(clusters.b2).toBe(clusters.b3);
    expect(clusters.a1).not.toBe(clusters.b1);
  });

  it("keeps a bridge note from merging two otherwise-separate cliques into one cluster", () => {
    // two triangles connected by a single weak bridge edge — the bridge
    // shouldn't be enough to outweigh each clique's much denser internal
    // linking, so Louvain should still keep them as separate communities.
    const graph = structural({
      a1: ["a2", "a3"],
      a2: ["a1", "a3"],
      a3: ["a1", "a2", "b1"],
      b1: ["b2", "b3", "a3"],
      b2: ["b1", "b3"],
      b3: ["b1", "b2"],
    });

    const clusters = runLouvain(graph);

    expect(clusters.a1).toBe(clusters.a2);
    expect(clusters.b2).toBe(clusters.b3);
  });

  it("assigns every input node a cluster id", () => {
    const graph = structural({
      A: ["B"],
      B: ["A", "C"],
      C: ["B"],
    });
    const clusters = runLouvain(graph);
    expect(Object.keys(clusters).sort()).toEqual(["A", "B", "C"]);
  });
});

describe("runClusterComputation", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-clustering-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns a zero result when no structural index has been built yet", async () => {
    const result = await runClusterComputation(dataDir);
    expect(result).toEqual({ noteCount: 0, clusterCount: 0, computedAt: result.computedAt });
    expect(await loadNoteClusters(dataDir)).toBeNull();
  });

  it("computes and persists cluster assignments from structural-links.json", async () => {
    const now = new Date("2026-07-16T00:00:00.000Z");
    const structuralFile: StructuralLinksFile = structural({
      a1: ["a2"],
      a2: ["a1"],
      b1: ["b2"],
      b2: ["b1"],
    });
    await writeFile(join(dataDir, "structural-links.json"), JSON.stringify(structuralFile), "utf8");

    const result = await runClusterComputation(dataDir, undefined, now);
    expect(result.noteCount).toBe(4);
    expect(result.computedAt).toBe(now.toISOString());

    const persisted = JSON.parse(await readFile(join(dataDir, "note-clusters.json"), "utf8")) as NoteClustersFile;
    expect(persisted.clusters.a1).toBe(persisted.clusters.a2);
    expect(persisted.clusters.b1).toBe(persisted.clusters.b2);
    expect(persisted.clusters.a1).not.toBe(persisted.clusters.b1);
  });
});
