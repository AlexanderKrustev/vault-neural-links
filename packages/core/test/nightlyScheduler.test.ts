import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/notes.js";
import { runNightlyIfStale } from "../src/nightlyScheduler.js";
import { loadContentIndex } from "../src/contentIndex.js";
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
});
