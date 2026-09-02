import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendUnderHeading, listNotes, readNote, searchNotes, writeNote } from "../src/notes.js";
import { rebuildContentIndex } from "../src/contentIndex.js";

describe("notes", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-notes-test-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("writes a new note and reports created: true", async () => {
    const result = await writeNote(vaultPath, "Notes/Foo", {
      frontmatter: { type: "atomic", tags: ["a", "b"] },
      body: "Hello world",
    });
    expect(result.created).toBe(true);

    const note = await readNote(vaultPath, "Notes/Foo");
    expect(note?.frontmatter).toEqual({ type: "atomic", tags: ["a", "b"] });
    expect(note?.body.trim()).toBe("Hello world");
  });

  it("reports created: false on a second write to the same path", async () => {
    await writeNote(vaultPath, "Notes/Foo", { frontmatter: { type: "atomic" }, body: "v1" });
    const result = await writeNote(vaultPath, "Notes/Foo", { frontmatter: { type: "atomic" }, body: "v2" });
    expect(result.created).toBe(false);
  });

  it("returns null reading a note that doesn't exist", async () => {
    expect(await readNote(vaultPath, "Nope")).toBeNull();
  });

  it("lists notes recursively and skips Templates/", async () => {
    await writeNote(vaultPath, "A", { frontmatter: {}, body: "" });
    await writeNote(vaultPath, "Sub/B", { frontmatter: {}, body: "" });
    await writeNote(vaultPath, "Templates/C", { frontmatter: {}, body: "" });

    expect(await listNotes(vaultPath)).toEqual(["A", "Sub/B"]);
  });

  it("appendUnderHeading inserts most-recent-first under an existing heading", () => {
    const body = "# Title\n\n## Updates\n- old entry\n";
    const result = appendUnderHeading(body, { heading: "## Updates", text: "- new entry" });
    expect(result).toBe("# Title\n\n## Updates\n- new entry\n- old entry\n");
  });

  it("appendUnderHeading matches a heading line with trailing whitespace instead of creating a duplicate", () => {
    const body = "# Title\n\n## Updates \n- old entry\n";
    const result = appendUnderHeading(body, { heading: "## Updates", text: "- new entry" });
    expect(result).toBe("# Title\n\n## Updates \n- new entry\n- old entry\n");
    expect(result.match(/## Updates/g)).toHaveLength(1);
  });

  it("appendUnderHeading creates the heading if absent", () => {
    const body = "# Title\n\nSome text\n";
    const result = appendUnderHeading(body, { heading: "## Updates", text: "- first entry" });
    expect(result).toBe("# Title\n\nSome text\n\n## Updates\n- first entry\n");
  });

  it("searchNotes matches by title, alias, and content", async () => {
    await writeNote(vaultPath, "Apple Device Tips", { frontmatter: {}, body: "iOS tips" });
    await writeNote(vaultPath, "Other", { frontmatter: { aliases: ["banana"] }, body: "nothing relevant" });
    await writeNote(vaultPath, "Third", { frontmatter: {}, body: "mentions apple somewhere" });

    const byTitle = await searchNotes(vaultPath, "Apple Device", { useWeights: false });
    expect(byTitle.map((h) => h.path)).toContain("Apple Device Tips");

    const byAlias = await searchNotes(vaultPath, "banana", { useWeights: false });
    expect(byAlias.map((h) => h.path)).toEqual(["Other"]);

    const byContent = await searchNotes(vaultPath, "somewhere", { useWeights: false });
    expect(byContent.map((h) => h.path)).toEqual(["Third"]);
  });

  it("searchNotes flags a superseded hit with its successor, matched by title alone", async () => {
    await writeNote(vaultPath, "Old ADR", {
      frontmatter: { status: "superseded", superseded_by: "[[New ADR]]" },
      body: "old decision",
    });

    const hits = await searchNotes(vaultPath, "Old ADR", { useWeights: false });
    expect(hits.find((h) => h.path === "Old ADR")!.supersededBy).toBe("New ADR");
  });

  // AIBRAIN-138: a query used to be one literal contiguous substring, so
  // words present in the note but not contiguous (or out of order) returned
  // no hits at all — indistinguishable from the note not existing.
  it("searchNotes finds a note by tokens that are all present but not contiguous or in order", async () => {
    await writeNote(vaultPath, "MCP Tool Decision-Delegation Audit and Deterministic Logging Plan", {
      frontmatter: {},
      body: "audit of tool decisions",
    });

    const hits = await searchNotes(vaultPath, "decision delegation audit deterministic logging", {
      useWeights: false,
    });
    expect(hits.map((h) => h.path)).toContain(
      "MCP Tool Decision-Delegation Audit and Deterministic Logging Plan",
    );
  });

  it("searchNotes returns nothing when only some query tokens are present", async () => {
    await writeNote(vaultPath, "Unrelated Note", { frontmatter: {}, body: "nothing to do with it" });

    const hits = await searchNotes(vaultPath, "decision delegation audit deterministic logging", {
      useWeights: false,
    });
    expect(hits).toEqual([]);
  });

  // AIBRAIN-139: ranking used to be `weight` alone, so an exact title match
  // could rank behind an unrelated note that merely mentioned the query text
  // in passing, if that note had more accumulated usage weight.
  it("searchNotes ranks an exact title match above a heavier-weighted incidental content mention", async () => {
    await writeNote(vaultPath, "Notes/Target Note", { frontmatter: {}, body: "the actual answer" });
    await writeNote(vaultPath, "Notes/Unrelated Hub", {
      frontmatter: {},
      body: "in passing, this mentions Target Note without being about it",
    });

    const hits = await searchNotes(vaultPath, "Target Note", { useWeights: false });
    expect(hits[0].path).toBe("Notes/Target Note");
    expect(hits[0].matched).toBe("title");
  });

  it("searchNotes lets a small usage-weight difference break ties within the same match tier, never across tiers", async () => {
    await writeNote(vaultPath, "Notes/A Content Match", { frontmatter: {}, body: "mentions widget once" });
    await writeNote(vaultPath, "Notes/Widget", { frontmatter: {}, body: "widget widget widget" });

    // Without weights: exact title match ("Widget") beats a content-only match.
    const hits = await searchNotes(vaultPath, "widget", { useWeights: false });
    expect(hits[0].path).toBe("Notes/Widget");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });
});

// AIBRAIN-133: a persisted content index narrows which notes searchNotes
// actually has to read, instead of scanning every note in the vault on
// every query. It must be purely a performance optimization — same
// results whether or not an index exists — and must never silently miss
// a note created after the index was last built.
describe("searchNotes with a content index", () => {
  let vaultPath: string;
  let dataDir: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-notes-index-test-vault-"));
    dataDir = await mkdtemp(join(tmpdir(), "vnl-notes-index-test-data-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it("finds the same results with an index as without one", async () => {
    await writeNote(vaultPath, "Apple Device Tips", { frontmatter: {}, body: "iOS tips" });
    await writeNote(vaultPath, "Other", { frontmatter: { aliases: ["banana"] }, body: "nothing relevant" });
    await writeNote(vaultPath, "Third", { frontmatter: {}, body: "mentions apple somewhere" });
    await rebuildContentIndex(vaultPath, dataDir);

    const withIndex = await searchNotes(vaultPath, "apple", { vaultDataDir: dataDir, useWeights: false });
    const withoutIndex = await searchNotes(vaultPath, "apple", { useWeights: false });
    expect(withIndex.map((h) => h.path).sort()).toEqual(withoutIndex.map((h) => h.path).sort());
  });

  it("still finds a note created after the index was last built (staleness fallback)", async () => {
    await writeNote(vaultPath, "Old Note", { frontmatter: {}, body: "nothing relevant here" });
    await rebuildContentIndex(vaultPath, dataDir);

    // Written after the index snapshot above — not in any posting list.
    await writeNote(vaultPath, "Brand New Note", { frontmatter: {}, body: "zebra unicorn" });

    const hits = await searchNotes(vaultPath, "zebra", { vaultDataDir: dataDir, useWeights: false });
    expect(hits.map((h) => h.path)).toContain("Brand New Note");
  });

  it("falls back to a full scan when no index has been built yet", async () => {
    await writeNote(vaultPath, "Note", { frontmatter: {}, body: "findable text" });
    // No rebuildContentIndex call — dataDir has no content-index.json.
    const hits = await searchNotes(vaultPath, "findable", { vaultDataDir: dataDir, useWeights: false });
    expect(hits.map((h) => h.path)).toContain("Note");
  });

  it("returns no hits via the index for tokens that appear in no note", async () => {
    await writeNote(vaultPath, "Note", { frontmatter: {}, body: "findable text" });
    await rebuildContentIndex(vaultPath, dataDir);

    const hits = await searchNotes(vaultPath, "nonexistentword", { vaultDataDir: dataDir, useWeights: false });
    expect(hits).toEqual([]);
  });
});
