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
});
