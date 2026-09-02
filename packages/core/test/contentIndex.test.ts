import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeNote } from "../src/notes.js";
import {
  buildContentIndex,
  candidatesFromIndex,
  loadContentIndex,
  rebuildContentIndex,
} from "../src/contentIndex.js";

describe("buildContentIndex", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-content-index-vault-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("indexes title tokens", async () => {
    await writeNote(vaultPath, "Apple Device Tips", { frontmatter: {}, body: "" });
    const index = await buildContentIndex(vaultPath);
    expect(index.postings["apple"]).toEqual(["Apple Device Tips"]);
    expect(index.postings["device"]).toEqual(["Apple Device Tips"]);
  });

  it("indexes frontmatter alias tokens", async () => {
    await writeNote(vaultPath, "Other", { frontmatter: { aliases: ["banana split"] }, body: "" });
    const index = await buildContentIndex(vaultPath);
    expect(index.postings["banana"]).toEqual(["Other"]);
    expect(index.postings["split"]).toEqual(["Other"]);
  });

  it("indexes body tokens", async () => {
    await writeNote(vaultPath, "Third", { frontmatter: {}, body: "mentions apple somewhere" });
    const index = await buildContentIndex(vaultPath);
    expect(index.postings["somewhere"]).toEqual(["Third"]);
  });

  it("dedupes multiple occurrences of the same token in one note to one posting entry", async () => {
    await writeNote(vaultPath, "Repeats", { frontmatter: {}, body: "apple apple apple" });
    const index = await buildContentIndex(vaultPath);
    expect(index.postings["apple"]).toEqual(["Repeats"]);
  });

  it("unions postings across multiple notes sharing a token", async () => {
    await writeNote(vaultPath, "A", { frontmatter: {}, body: "shared word" });
    await writeNote(vaultPath, "B", { frontmatter: {}, body: "shared word" });
    const index = await buildContentIndex(vaultPath);
    expect(index.postings["shared"]).toEqual(["A", "B"]);
  });

  it("records every note path in coveredPaths", async () => {
    await writeNote(vaultPath, "A", { frontmatter: {}, body: "" });
    await writeNote(vaultPath, "B", { frontmatter: {}, body: "" });
    const index = await buildContentIndex(vaultPath);
    expect(index.coveredPaths).toEqual(["A", "B"]);
  });
});

describe("loadContentIndex / rebuildContentIndex", () => {
  let vaultPath: string;
  let dataDir: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-content-index-vault-"));
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-content-index-data-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns null when no index has been persisted yet", async () => {
    expect(await loadContentIndex(dataDir)).toBeNull();
  });

  it("rebuilds and persists an index that can be loaded back", async () => {
    await writeNote(vaultPath, "A", { frontmatter: {}, body: "hello world" });
    const result = await rebuildContentIndex(vaultPath, dataDir);
    expect(result.noteCount).toBe(1);

    const loaded = await loadContentIndex(dataDir);
    expect(loaded?.postings["hello"]).toEqual(["A"]);
  });
});

describe("candidatesFromIndex", () => {
  it("returns the intersection of postings for every query token", () => {
    const index = {
      version: 1,
      builtAt: "2026-01-01T00:00:00.000Z",
      coveredPaths: ["A", "B", "C"],
      postings: {
        alpha: ["A", "B"],
        beta: ["B", "C"],
      },
    };
    expect(candidatesFromIndex(index, ["alpha", "beta"])).toEqual(new Set(["B"]));
  });

  it("returns an empty set when a token has no postings at all", () => {
    const index = { version: 1, builtAt: "2026-01-01T00:00:00.000Z", coveredPaths: [], postings: {} };
    expect(candidatesFromIndex(index, ["nonexistent"])).toEqual(new Set());
  });

  it("returns an empty set (not null) for an empty token list", () => {
    const index = { version: 1, builtAt: "2026-01-01T00:00:00.000Z", coveredPaths: [], postings: {} };
    expect(candidatesFromIndex(index, [])).toEqual(new Set());
  });
});
