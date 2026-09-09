import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SourceNode } from "../src/adapters.js";
import {
  DEFAULT_EMBEDDING_MODEL,
  EMBEDDINGS_FILE_NAME,
  buildEmbeddingIndex,
  cosine,
  decodeVector,
  embeddingHash,
  embeddingText,
  encodeVector,
  loadEmbeddings,
  loadTransformersProvider,
  rebuildEmbeddings,
  semanticScores,
  type EmbeddingProvider,
} from "../src/embeddings.js";
import type { EmbeddingsFile } from "../src/types.js";

/**
 * A deterministic stand-in for the real model: it hashes each text into a
 * fixed vector, so "similar" is whatever the test declares it to be. The
 * point is to verify the index format, the incremental rebuild and the
 * scoring — none of which should depend on which model produced the
 * numbers, and none of which should require a 23 MB download in CI.
 */
function fakeProvider(
  vectors: Record<string, number[]>,
  model = DEFAULT_EMBEDDING_MODEL,
): EmbeddingProvider & { calls: string[][] } {
  const dim = Object.values(vectors)[0]?.length ?? 3;
  return {
    model,
    dim,
    calls: [] as string[][],
    async embed(texts: string[]) {
      this.calls.push(texts);
      return texts.map((text) => {
        const found = Object.entries(vectors).find(([key]) => text.includes(key));
        const raw = found ? found[1] : new Array(dim).fill(0).map((_, i) => (i === 0 ? 1 : 0));
        return normalize(Float32Array.from(raw));
      });
    },
  };
}

function normalize(vector: Float32Array): Float32Array {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const length = Math.sqrt(sum) || 1;
  return vector.map((value) => value / length) as Float32Array;
}

function node(id: string, body: string, aliases: string[] = []): SourceNode {
  return { id, body, aliases };
}

describe("embeddings", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-embeddings-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  describe("vector encoding", () => {
    it("round-trips a vector through base64 without losing precision", () => {
      const vector = normalize(Float32Array.from([0.25, -0.5, 0.125, 0.75]));
      const decoded = decodeVector(encodeVector(vector));
      expect(decoded).not.toBeNull();
      expect([...decoded!]).toEqual([...vector]);
    });

    it("rejects a payload that isn't a whole number of floats instead of returning garbage", () => {
      // Five bytes: a truncated write, or a hand-edited file. Reading it as
      // floats would silently produce a shorter vector that still scores.
      expect(decodeVector(Buffer.from([1, 2, 3, 4, 5]).toString("base64"))).toBeNull();
      expect(decodeVector("")).toBeNull();
    });

    it("scores cosine 1 for identical vectors, 0 for orthogonal ones, and 0 for a length mismatch", () => {
      const a = normalize(Float32Array.from([1, 1, 0]));
      const b = normalize(Float32Array.from([1, 1, 0]));
      const orthogonal = normalize(Float32Array.from([0, 0, 1]));
      expect(cosine(a, b)).toBeCloseTo(1, 6);
      expect(cosine(a, orthogonal)).toBeCloseTo(0, 6);
      // A stale index from another model: nonsense, but it would still sort.
      expect(cosine(a, Float32Array.from([1, 1]))).toBe(0);
    });
  });

  describe("embeddingText", () => {
    it("leads with the title, then aliases, then body", () => {
      const text = embeddingText(node("Notes/Kill Process By Port.md", "lsof and kill", ["port killer"]));
      expect(text.startsWith("Kill Process By Port")).toBe(true);
      expect(text).toContain("port killer");
      expect(text).toContain("lsof and kill");
    });

    it("truncates a long note so the model isn't fed text past its window", () => {
      const text = embeddingText(node("Long.md", "x".repeat(50_000)));
      expect(text.length).toBeLessThanOrEqual(1200);
    });

    it("changes its hash when the note's text changes, and not otherwise", () => {
      const before = embeddingHash(embeddingText(node("A.md", "one")));
      expect(embeddingHash(embeddingText(node("A.md", "one")))).toBe(before);
      expect(embeddingHash(embeddingText(node("A.md", "two")))).not.toBe(before);
    });
  });

  describe("buildEmbeddingIndex", () => {
    it("embeds every note on a first build and records the model and dimension", async () => {
      const provider = fakeProvider({ Alpha: [1, 0, 0], Beta: [0, 1, 0] });
      const index = await buildEmbeddingIndex([node("Alpha.md", "a"), node("Beta.md", "b")], provider);

      expect(Object.keys(index.notes).sort()).toEqual(["Alpha.md", "Beta.md"]);
      expect(index.model).toBe(DEFAULT_EMBEDDING_MODEL);
      expect(index.dim).toBe(3);
      expect(provider.calls.flat()).toHaveLength(2);
    });

    it("re-embeds only the notes whose text changed", async () => {
      const provider = fakeProvider({ Alpha: [1, 0, 0], Beta: [0, 1, 0] });
      const first = await buildEmbeddingIndex([node("Alpha.md", "a"), node("Beta.md", "b")], provider);

      const second = await buildEmbeddingIndex(
        [node("Alpha.md", "a"), node("Beta.md", "b — rewritten")],
        provider,
        { existing: first },
      );

      // Only the changed note reaches the model; the unchanged one keeps the
      // vector it already had, byte for byte.
      expect(provider.calls[1]).toHaveLength(1);
      expect(provider.calls[1][0]).toContain("rewritten");
      expect(second.notes["Alpha.md"].vector).toBe(first.notes["Alpha.md"].vector);
    });

    it("drops notes that no longer exist rather than accumulating dead vectors", async () => {
      const provider = fakeProvider({ Alpha: [1, 0, 0], Beta: [0, 1, 0] });
      const first = await buildEmbeddingIndex([node("Alpha.md", "a"), node("Beta.md", "b")], provider);

      const second = await buildEmbeddingIndex([node("Alpha.md", "a")], provider, { existing: first });

      expect(Object.keys(second.notes)).toEqual(["Alpha.md"]);
    });

    it("re-embeds everything when the model changed, since two models' vectors aren't comparable", async () => {
      const oldProvider = fakeProvider({ Alpha: [1, 0, 0] }, "old-model");
      const first = await buildEmbeddingIndex([node("Alpha.md", "a")], oldProvider);

      const newProvider = fakeProvider({ Alpha: [0, 1, 0] }, "new-model");
      const second = await buildEmbeddingIndex([node("Alpha.md", "a")], newProvider, { existing: first });

      expect(newProvider.calls.flat()).toHaveLength(1);
      expect(second.model).toBe("new-model");
      expect(second.notes["Alpha.md"].vector).not.toBe(first.notes["Alpha.md"].vector);
    });
  });

  describe("persistence", () => {
    it("writes an index that loads back identically", async () => {
      const provider = fakeProvider({ Alpha: [1, 0, 0] });
      const result = await rebuildEmbeddings(dataDir, [node("Alpha.md", "a")], provider);

      expect(result.noteCount).toBe(1);
      expect(result.embeddedCount).toBe(1);

      const loaded = await loadEmbeddings(dataDir);
      expect(loaded?.notes["Alpha.md"]).toBeDefined();
      expect(loaded?.model).toBe(DEFAULT_EMBEDDING_MODEL);
    });

    it("leaves no temp file behind", async () => {
      const provider = fakeProvider({ Alpha: [1, 0, 0] });
      await rebuildEmbeddings(dataDir, [node("Alpha.md", "a")], provider);

      const { readdir } = await import("node:fs/promises");
      const entries = await readdir(dataDir);
      expect(entries).toEqual([EMBEDDINGS_FILE_NAME]);
    });

    it("returns null for an absent index rather than throwing", async () => {
      expect(await loadEmbeddings(dataDir)).toBeNull();
    });

    it("treats a corrupt index as no index — an optional axis must not take retrieval down", async () => {
      await writeFile(join(dataDir, EMBEDDINGS_FILE_NAME), "{ this is not json", "utf8");
      expect(await loadEmbeddings(dataDir)).toBeNull();
    });

    it("ignores an index written by a future version", async () => {
      await writeFile(
        join(dataDir, EMBEDDINGS_FILE_NAME),
        JSON.stringify({ version: 99, model: "x", dim: 3, builtAt: "", notes: {} }),
        "utf8",
      );
      expect(await loadEmbeddings(dataDir)).toBeNull();
    });

    it("persists compactly — no pretty-printing for a machine-written file", async () => {
      const provider = fakeProvider({ Alpha: [1, 0, 0] });
      await rebuildEmbeddings(dataDir, [node("Alpha.md", "a")], provider);
      const raw = await readFile(join(dataDir, EMBEDDINGS_FILE_NAME), "utf8");
      expect(raw).not.toContain("\n");
    });
  });

  describe("semanticScores", () => {
    async function indexOf(vectors: Record<string, number[]>): Promise<EmbeddingsFile> {
      const provider = fakeProvider(vectors);
      return buildEmbeddingIndex(
        Object.keys(vectors).map((key) => node(`${key}.md`, key)),
        provider,
      );
    }

    it("ranks the closest note first", async () => {
      const index = await indexOf({ Alpha: [1, 0, 0], Beta: [0.9, 0.1, 0], Gamma: [0, 1, 0] });
      const scores = semanticScores(index, normalize(Float32Array.from([1, 0, 0])), { floor: 0 });

      const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([path]) => path);
      expect(ranked[0]).toBe("Alpha.md");
      expect(ranked[1]).toBe("Beta.md");
    });

    it("drops notes below the absolute floor, so a query matching nothing returns nothing", async () => {
      const index = await indexOf({ Alpha: [1, 0, 0], Gamma: [0, 1, 0] });
      const scores = semanticScores(index, normalize(Float32Array.from([0, 1, 0.05])), {
        floor: 0.35,
        relativeCut: 0,
      });

      // Gamma is the closest note in the vault, but "closest" is not "close".
      expect(scores.has("Alpha.md")).toBe(false);
      expect(scores.size).toBe(1);
      expect(scores.get("Gamma.md")).toBeGreaterThan(0.35);
    });

    // The case that shipped broken for one afternoon: against the real vault
    // every cosine, right answer and wrong answer alike, sits between 0.19
    // and 0.46 — because a short query against a long note is an asymmetric
    // comparison. A fixed threshold either admits that whole band or rejects
    // it whole. What identifies the right note is its distance above the
    // rest of its own distribution.
    it("keeps a clear winner inside a compressed distribution, and drops the pack behind it", async () => {
      const index = await indexOf({
        Right: [1, 0, 0],
        Near1: [0.55, 0.84, 0],
        Near2: [0.5, 0.87, 0],
      });
      // Cosines land at roughly 1.0 / 0.55 / 0.5 — the real vault's
      // 0.446-vs-0.244 shape.
      const scores = semanticScores(index, normalize(Float32Array.from([1, 0, 0])), {
        floor: 0.2,
        relativeCut: 0.6,
      });

      expect([...scores.keys()]).toEqual(["Right.md"]);
    });

    it("keeps every near-equal note when nothing stands out", async () => {
      const index = await indexOf({ A: [1, 0, 0], B: [0.99, 0.14, 0], C: [0.98, 0.2, 0] });
      const scores = semanticScores(index, normalize(Float32Array.from([1, 0, 0])), {
        floor: 0.2,
        relativeCut: 0.6,
      });

      // A genuine three-way tie is a real answer, not a failure to
      // discriminate — the cut only removes what the best result outclasses.
      expect(scores.size).toBe(3);
    });

    it("admits a match the old fixed 0.35 floor would have rejected outright", async () => {
      // Cosine ~0.30: below the floor this shipped with, and the only thing
      // in its query's distribution. Two of four real queries looked exactly
      // like this, and returned nothing at all.
      const index = await indexOf({ Only: [1, 0, 0], Far: [0, 1, 0] });
      const query = normalize(Float32Array.from([0.3, 0, 0.954]));

      expect(semanticScores(index, query, { floor: 0.35 }).size).toBe(0);
      expect(semanticScores(index, query, { floor: 0.2, relativeCut: 0.6 }).size).toBe(1);
    });

    it("disables the relative cut at 0", async () => {
      const index = await indexOf({ Right: [1, 0, 0], Near: [0.55, 0.84, 0] });
      const scores = semanticScores(index, normalize(Float32Array.from([1, 0, 0])), {
        floor: 0,
        relativeCut: 0,
      });

      expect(scores.size).toBe(2);
    });

    it("caps how many notes may enter the blend", async () => {
      const index = await indexOf({ Alpha: [1, 0, 0], Beta: [0.99, 0.01, 0], Delta: [0.98, 0.02, 0] });
      const scores = semanticScores(index, normalize(Float32Array.from([1, 0, 0])), { floor: 0, topN: 2 });

      expect(scores.size).toBe(2);
    });

    it("skips an entry whose stored vector can't be decoded", async () => {
      const index = await indexOf({ Alpha: [1, 0, 0] });
      // Five bytes — not a whole number of floats.
      index.notes["Broken.md"] = { hash: "x", vector: Buffer.from([1, 2, 3, 4, 5]).toString("base64") };

      const scores = semanticScores(index, normalize(Float32Array.from([1, 0, 0])), { floor: 0 });
      expect(scores.has("Broken.md")).toBe(false);
    });

    it("skips a vector of the wrong dimension instead of scoring it 0 and taking a slot", async () => {
      const index = await indexOf({ Alpha: [1, 0, 0] });
      // A leftover from a different model. cosine() scores it 0, which a
      // floor of 0 admits — so the dimension check, not the score, has to
      // exclude it.
      index.notes["Stale.md"] = { hash: "x", vector: encodeVector(Float32Array.from([1, 0])) };

      const scores = semanticScores(index, normalize(Float32Array.from([1, 0, 0])), { floor: 0 });
      expect(scores.has("Stale.md")).toBe(false);
      expect(scores.has("Alpha.md")).toBe(true);
    });
  });

  describe("loadTransformersProvider", () => {
    it("returns null when the optional package isn't installed, rather than throwing", async () => {
      expect(await loadTransformersProvider(undefined, "@vnl/definitely-not-installed")).toBeNull();
    });
  });
});
