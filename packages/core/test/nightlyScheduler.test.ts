import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/notes.js";
import { runNightlyIfStale } from "../src/nightlyScheduler.js";
import { loadContentIndex } from "../src/contentIndex.js";
import { loadEmbeddings, type EmbeddingProvider } from "../src/embeddings.js";
import { loadStructuralIndex } from "../src/structuralLinks.js";

describe("runNightlyIfStale", () => {
  let vaultPath: string;
  let dataDir: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-nightly-vault-"));
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-nightly-data-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  // AIBRAIN-133: the content index joins structural-links.json and
  // note-importance.json as a nightly-rebuilt artifact, sharing one
  // adapter.listNodes() pass with the structural index rather than
  // re-scanning the vault a second time.
  it("builds and persists a content index alongside the structural index", async () => {
    await writeNote(vaultPath, "Apple Device Tips", { frontmatter: {}, body: "iOS notes" });

    const result = await runNightlyIfStale(vaultPath, dataDir);
    expect(result.ran).toBe(true);
    expect(result.contentIndexTokenCount).toBeGreaterThan(0);

    const contentIndex = await loadContentIndex(dataDir);
    expect(contentIndex?.postings["apple"]).toEqual(["Apple Device Tips"]);

    const structural = await loadStructuralIndex(dataDir);
    expect(structural?.builtAt).toBeDefined();
  });

  it("does not re-run within staleDays of the last run", async () => {
    await writeNote(vaultPath, "A", { frontmatter: {}, body: "" });
    const first = await runNightlyIfStale(vaultPath, dataDir);
    expect(first.ran).toBe(true);

    const second = await runNightlyIfStale(vaultPath, dataDir);
    expect(second.ran).toBe(false);
  });

  // VNL-051. The embedding index is the one nightly artifact that is opt-in,
  // because it needs a package the user installs separately and a model
  // download. The tri-state is what makes "opt in once" work.
  describe("semantic index (VNL-051)", () => {
    function provider(): EmbeddingProvider & { calls: number } {
      return {
        model: "test-model",
        dim: 2,
        calls: 0,
        async embed(texts: string[]) {
          this.calls += texts.length;
          return texts.map(() => Float32Array.from([1, 0]));
        },
      };
    }

    it("does not create one by default, so an existing vault gains no new file", async () => {
      await writeNote(vaultPath, "A", { frontmatter: {}, body: "text" });
      const embeddingProvider = provider();

      const result = await runNightlyIfStale(vaultPath, dataDir, 1, new Date(), undefined, {
        provider: embeddingProvider,
      });

      expect(result.ran).toBe(true);
      expect(result.embeddedNoteCount).toBeUndefined();
      expect(await loadEmbeddings(dataDir)).toBeNull();
      expect(embeddingProvider.calls).toBe(0);
    });

    it("creates one when explicitly enabled", async () => {
      await writeNote(vaultPath, "A", { frontmatter: {}, body: "text" });
      const embeddingProvider = provider();

      const result = await runNightlyIfStale(vaultPath, dataDir, 1, new Date(), undefined, {
        enabled: true,
        provider: embeddingProvider,
      });

      expect(result.embeddedNoteCount).toBe(1);
      expect(result.embeddingModel).toBe("test-model");
      expect((await loadEmbeddings(dataDir))?.notes["A"]).toBeDefined();
    });

    it("refreshes an index that already exists without being asked again", async () => {
      await writeNote(vaultPath, "A", { frontmatter: {}, body: "text" });
      const embeddingProvider = provider();
      await runNightlyIfStale(vaultPath, dataDir, 1, new Date(), undefined, {
        enabled: true,
        provider: embeddingProvider,
      });

      await writeNote(vaultPath, "B", { frontmatter: {}, body: "another" });
      // A day later, and this time with no `enabled` flag at all.
      const later = new Date(Date.now() + 2 * 86_400_000);
      const result = await runNightlyIfStale(vaultPath, dataDir, 1, later, undefined, {
        provider: embeddingProvider,
      });

      expect(result.ran).toBe(true);
      expect(result.embeddedNoteCount).toBe(2);
      // Only the new note was embedded on the second run.
      expect(result.reembeddedCount).toBe(1);
    });

    it("skips a vault larger than the note limit even when enabled", async () => {
      await writeNote(vaultPath, "A", { frontmatter: {}, body: "text" });
      const embeddingProvider = provider();

      const result = await runNightlyIfStale(vaultPath, dataDir, 1, new Date(), undefined, {
        enabled: true,
        provider: embeddingProvider,
        noteLimit: 0,
      });

      expect(result.ran).toBe(true);
      expect(result.embeddedNoteCount).toBeUndefined();
      expect(embeddingProvider.calls).toBe(0);
    });

    it("still completes the rest of the pipeline when the model fails", async () => {
      await writeNote(vaultPath, "A", { frontmatter: {}, body: "text" });

      const result = await runNightlyIfStale(vaultPath, dataDir, 1, new Date(), undefined, {
        enabled: true,
        provider: {
          model: "test-model",
          dim: 2,
          async embed() {
            throw new Error("onnxruntime exploded");
          },
        },
      });

      expect(result.ran).toBe(true);
      expect(result.embeddedNoteCount).toBeUndefined();
      expect(result.contentIndexTokenCount).toBeGreaterThan(0);
      expect(await loadContentIndex(dataDir)).not.toBeNull();
    });
  });
});
