import { describe, expect, it } from "vitest";
import { mergeFrontmatterRaw, parseFrontmatter } from "../src/frontmatter.js";

const RAW = [
  "type: atomic",
  "created: 2026-08-30",
  "status: active",
  "domain: VaultNeuralLinks",
  "tags: [vault-neural-links, decision]",
  "aliases:",
  "  - evidence-state taxonomy",
  "  - Memory Trace roadmap",
].join("\n");

describe("mergeFrontmatterRaw (VNL-060)", () => {
  it("changes one key and leaves every other line byte-identical", () => {
    const merged = mergeFrontmatterRaw(RAW, { status: "superseded" });

    expect(merged).toBe(RAW.replace("status: active", "status: superseded"));
  });

  it("appends a key the block does not have yet", () => {
    const merged = mergeFrontmatterRaw(RAW, { superseded_by: "[[New Note]]" });

    expect(merged.split("\n").slice(0, -1).join("\n")).toBe(RAW);
    // Quoted, or the parser would read a bracketed string back as an array.
    expect(merged.endsWith('superseded_by: "[[New Note]]"')).toBe(true);
    expect(parseFrontmatter(`---\n${merged}\n---\nbody`).frontmatter.superseded_by).toBe("[[New Note]]");
  });

  it("returns the block untouched for an empty patch", () => {
    expect(mergeFrontmatterRaw(RAW, {})).toBe(RAW);
  });

  it("preserves comments and unparseable lines it was not asked to change", () => {
    const withComment = ["# keep me", "type: atomic", "weird: {a: 1, b: 2}", "status: active"].join("\n");

    const merged = mergeFrontmatterRaw(withComment, { status: "resolved" });

    expect(merged).toBe(["# keep me", "type: atomic", "weird: {a: 1, b: 2}", "status: resolved"].join("\n"));
  });

  it("replaces a block sequence in place, keeping block style", () => {
    const merged = mergeFrontmatterRaw(RAW, { aliases: ["one", "two"] });

    expect(merged).toBe(
      [
        "type: atomic",
        "created: 2026-08-30",
        "status: active",
        "domain: VaultNeuralLinks",
        "tags: [vault-neural-links, decision]",
        "aliases:",
        "  - one",
        "  - two",
      ].join("\n"),
    );
  });

  it("keeps an inline array inline", () => {
    const merged = mergeFrontmatterRaw(RAW, { tags: ["a", "b"] });

    expect(merged).toContain("tags: [a, b]");
    expect(merged).toContain("aliases:\n  - evidence-state taxonomy");
  });

  it("removes a key and its indented block when the value is null", () => {
    const merged = mergeFrontmatterRaw(RAW, { aliases: null, created: null });

    expect(merged).toBe(
      ["type: atomic", "status: active", "domain: VaultNeuralLinks", "tags: [vault-neural-links, decision]"].join("\n"),
    );
  });

  it("applies several edits in one pass without shifting each other", () => {
    const merged = mergeFrontmatterRaw(RAW, {
      status: "superseded",
      superseded_by: "[[New Note]]",
      aliases: ["only"],
      type: "analysis",
    });

    const parsed = parseFrontmatter(`---\n${merged}\n---\nbody`).frontmatter;
    expect(parsed).toMatchObject({
      type: "analysis",
      created: "2026-08-30",
      status: "superseded",
      domain: "VaultNeuralLinks",
      aliases: ["only"],
      superseded_by: "[[New Note]]",
    });
  });

  it("keeps CRLF line endings when the block uses them", () => {
    const merged = mergeFrontmatterRaw(RAW.replace(/\n/g, "\r\n"), { status: "superseded" });

    expect(merged).toBe(RAW.replace("status: active", "status: superseded").replace(/\n/g, "\r\n"));
  });

  it("writes a whole block for a note that had no frontmatter at all", () => {
    expect(mergeFrontmatterRaw(undefined, { type: "atomic", status: "active" })).toBe("type: atomic\nstatus: active");
    // A removal with nothing to remove contributes no line.
    expect(mergeFrontmatterRaw(undefined, { type: "atomic", status: null })).toBe("type: atomic");
  });

  it("refuses a value containing a line break rather than writing a broken block", () => {
    expect(() => mergeFrontmatterRaw(RAW, { status: "super\nseded" })).toThrow(/line break/);
    expect(() => mergeFrontmatterRaw(RAW, { aliases: ["fine", "not\nfine"] })).toThrow(/line break/);
  });

  it("replaces a nested map wholesale rather than merging into it", () => {
    const nested = ["type: atomic", "metadata:", "  origin: session-a", "  weight: 3", "status: active"].join("\n");

    const merged = mergeFrontmatterRaw(nested, { metadata: { origin: "session-b" } });

    expect(merged).toBe(["type: atomic", "metadata:", "  origin: session-b", "status: active"].join("\n"));
  });
});
