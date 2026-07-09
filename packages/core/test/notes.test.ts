import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendUnderHeading, listNotes, readNote, searchNotes, writeNote } from "../src/notes.js";

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
});
