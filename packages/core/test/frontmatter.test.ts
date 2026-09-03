import { describe, expect, it } from "vitest";
import { parseFrontmatter, serializeNote, stringifyFrontmatter } from "../src/frontmatter.js";

describe("frontmatter", () => {
  it("round-trips booleans and numbers as their real types, not strings", () => {
    const serialized = serializeNote({ frontmatter: { pinned: true, archived: false, count: 3 }, body: "body" });
    const { frontmatter } = parseFrontmatter(serialized);

    expect(frontmatter.pinned).toBe(true);
    expect(frontmatter.archived).toBe(false);
    expect(frontmatter.count).toBe(3);
  });

  it("keeps a quoted value as a string even if it looks like a number or boolean", () => {
    const content = '---\nid: "3"\nflag: "true"\n---\nbody';
    const { frontmatter } = parseFrontmatter(content);

    expect(frontmatter.id).toBe("3");
    expect(frontmatter.flag).toBe("true");
  });

  it("round-trips an array item containing a comma as a single item", () => {
    const serialized = serializeNote({ frontmatter: { aliases: ["Smith, John", "other"] }, body: "" });
    const { frontmatter } = parseFrontmatter(serialized);

    expect(frontmatter.aliases).toEqual(["Smith, John", "other"]);
  });

  it("parses a plain string array unaffected by comma-quoting logic", () => {
    const content = "---\ntags: [a, b, c]\n---\nbody";
    const { frontmatter } = parseFrontmatter(content);

    expect(frontmatter.tags).toEqual(["a", "b", "c"]);
  });

  it("stringifyFrontmatter quotes an array item containing a comma", () => {
    const result = stringifyFrontmatter({ aliases: ["Smith, John"] });
    expect(result).toContain('aliases: ["Smith, John"]');
  });

  it("parses an Obsidian block-list aliases: into an array (VNL-003)", () => {
    const content = "---\naliases:\n  - First Alias\n  - Second Alias\ntype: atomic\n---\nbody";
    const { frontmatter } = parseFrontmatter(content);

    expect(frontmatter.aliases).toEqual(["First Alias", "Second Alias"]);
    expect(frontmatter.type).toBe("atomic");
  });

  it("parses a block list written flush with its key, as Obsidian also emits it", () => {
    const content = "---\ntags:\n- one\n- two\nstatus: open\n---\nbody";
    const { frontmatter } = parseFrontmatter(content);

    expect(frontmatter.tags).toEqual(["one", "two"]);
    expect(frontmatter.status).toBe("open");
  });

  it("parses a nested map", () => {
    const content = "---\nmetadata:\n  type: project\n  pinned: true\nid: 7\n---\nbody";
    const { frontmatter } = parseFrontmatter(content);

    expect(frontmatter.metadata).toEqual({ type: "project", pinned: true });
    expect(frontmatter.id).toBe(7);
  });

  it("re-emits the frontmatter block verbatim on a body-only write (VNL-003)", () => {
    const content =
      "---\naliases:\n  - First Alias\n# a comment the parser knows nothing about\nnested:\n  a:\n    deep: 1\n---\nold body\n";
    const parsed = parseFrontmatter(content);

    const rewritten = serializeNote({ ...parsed, body: "\nnew body\n" });

    expect(rewritten).toBe(
      "---\naliases:\n  - First Alias\n# a comment the parser knows nothing about\nnested:\n  a:\n    deep: 1\n---\n\nnew body\n",
    );
  });

  it("uses the supplied frontmatter when raw is dropped, i.e. frontmatter was edited", () => {
    const parsed = parseFrontmatter("---\ntype: atomic\n---\nbody");
    const rewritten = serializeNote({ frontmatter: { type: "moc" }, body: parsed.body });

    expect(rewritten).toBe("---\ntype: moc\n---\n\nbody");
  });

  it("stringifies a nested map as a block map", () => {
    expect(stringifyFrontmatter({ metadata: { type: "project" }, id: 7 })).toBe(
      "---\nmetadata:\n  type: project\nid: 7\n---\n",
    );
  });

  it("round-trips a wikilink-shaped string value instead of misparsing it as an array", () => {
    const serialized = serializeNote({ frontmatter: { superseded_by: "[[New Note]]" }, body: "" });
    const { frontmatter } = parseFrontmatter(serialized);

    expect(frontmatter.superseded_by).toBe("[[New Note]]");
  });
});
