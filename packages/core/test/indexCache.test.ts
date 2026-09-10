import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearIndexCache, derived, invalidateCachedFile, loadCachedJson } from "../src/indexCache.js";
import { loadStructuralIndex, rebuildStructuralIndex } from "../src/structuralLinks.js";
import { computeLiveNeighborWeights } from "../src/query.js";
import { appendEvent } from "../src/logger.js";
import { compact } from "../src/compactor.js";

describe("loadCachedJson", () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "vnl-test-index-cache-"));
    file = join(dir, "index.json");
    clearIndexCache();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the same parsed object while the file is unchanged", async () => {
    await writeFile(file, JSON.stringify({ n: 1 }), "utf8");

    const first = await loadCachedJson<{ n: number }>(file);
    const second = await loadCachedJson<{ n: number }>(file);

    expect(first).toEqual({ n: 1 });
    expect(second).toBe(first);
  });

  it("re-reads once the file's content changes", async () => {
    await writeFile(file, JSON.stringify({ n: 1 }), "utf8");
    const first = await loadCachedJson<{ n: number }>(file);

    await writeFile(file, JSON.stringify({ n: 22 }), "utf8");
    const second = await loadCachedJson<{ n: number }>(file);

    expect(second).not.toBe(first);
    expect(second).toEqual({ n: 22 });
  });

  it("returns null for a file that does not exist, and picks it up once created", async () => {
    expect(await loadCachedJson(file)).toBeNull();

    await writeFile(file, JSON.stringify({ n: 3 }), "utf8");
    expect(await loadCachedJson(file)).toEqual({ n: 3 });
  });

  it("forgets a file that has been deleted rather than serving the last parse", async () => {
    await writeFile(file, JSON.stringify({ n: 4 }), "utf8");
    await loadCachedJson(file);

    await rm(file);
    expect(await loadCachedJson(file)).toBeNull();
  });

  it("still throws on malformed JSON instead of caching the failure", async () => {
    await writeFile(file, "{ not json", "utf8");

    await expect(loadCachedJson(file)).rejects.toThrow();
    await writeFile(file, JSON.stringify({ n: 5 }), "utf8");
    expect(await loadCachedJson(file)).toEqual({ n: 5 });
  });

  it("re-reads after an explicit invalidation, which is what closes the same-tick rewrite gap", async () => {
    await writeFile(file, JSON.stringify({ n: 1 }), "utf8");
    const first = await loadCachedJson(file);

    invalidateCachedFile(file);
    const second = await loadCachedJson(file);

    expect(second).not.toBe(first);
    expect(second).toEqual(first);
  });
});

describe("derived", () => {
  it("builds once per loaded object and hands back the same value", () => {
    const owner = { edges: {} };
    let builds = 0;
    const build = () => {
      builds++;
      return new Map([["a", 1]]);
    };

    const first = derived(owner, "adjacency", build);
    const second = derived(owner, "adjacency", build);

    expect(second).toBe(first);
    expect(builds).toBe(1);
  });

  it("keeps separate values per key and per owner", () => {
    const owner = { edges: {} };
    const other = { edges: {} };

    expect(derived(owner, "a", () => 1)).toBe(1);
    expect(derived(owner, "b", () => 2)).toBe(2);
    expect(derived(other, "a", () => 3)).toBe(3);
  });
});

describe("cache coherence through the real writers", () => {
  let vaultPath: string;
  let dataDir: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-cache-coherence-"));
    dataDir = join(vaultPath, ".vault-neural-links");
    await mkdir(dataDir, { recursive: true });
    clearIndexCache();
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("sees a rebuilt structural index immediately, without waiting on mtime granularity", async () => {
    await writeFile(join(vaultPath, "A.md"), "no links yet", "utf8");
    await writeFile(join(vaultPath, "B.md"), "body", "utf8");
    await rebuildStructuralIndex(vaultPath, dataDir);
    expect((await loadStructuralIndex(dataDir))?.edges["A"] ?? []).toEqual([]);

    // Same tick, and the two index files are within a byte or two of each
    // other in length — exactly the case an mtime+size check alone can miss.
    await writeFile(join(vaultPath, "A.md"), "now links [[B]]", "utf8");
    await rebuildStructuralIndex(vaultPath, dataDir);

    expect((await loadStructuralIndex(dataDir))?.edges["A"]).toEqual(["B"]);
  });

  it("sees newly compacted usage weights on the next query", async () => {
    await writeFile(join(vaultPath, "A.md"), "body", "utf8");
    await writeFile(join(vaultPath, "B.md"), "body", "utf8");

    expect(await computeLiveNeighborWeights(dataDir, "A", vaultPath)).toEqual([]);

    await appendEvent(dataDir, "test", {
      ts: new Date().toISOString(),
      instance: "test",
      type: "traverse",
      from: "A",
      to: "B",
      weight_delta: 1,
    });
    await compact(dataDir);

    const neighbors = await computeLiveNeighborWeights(dataDir, "A", vaultPath);
    expect(neighbors.map((n) => n.path)).toEqual(["B"]);
  });

  it("finds a note's neighbours from either side of an undirected edge key", async () => {
    await writeFile(join(vaultPath, "A.md"), "body", "utf8");
    await writeFile(join(vaultPath, "Z.md"), "body", "utf8");

    // "A|Z" sorts with A first, so Z is only reachable by scanning the far
    // side of the key — the case the adjacency map has to get right.
    await appendEvent(dataDir, "test", {
      ts: new Date().toISOString(),
      instance: "test",
      type: "traverse",
      from: "A",
      to: "Z",
      weight_delta: 1,
    });
    await compact(dataDir);

    expect((await computeLiveNeighborWeights(dataDir, "A", vaultPath)).map((n) => n.path)).toEqual(["Z"]);
    expect((await computeLiveNeighborWeights(dataDir, "Z", vaultPath)).map((n) => n.path)).toEqual(["A"]);
  });
});
