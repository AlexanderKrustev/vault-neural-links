import { describe, expect, it } from "vitest";
import { resolveSupersededBy } from "../src/relations.js";

describe("resolveSupersededBy", () => {
  it("resolves a wikilink-form superseded_by when status is superseded", () => {
    const target = resolveSupersededBy({ status: "superseded", superseded_by: "[[New Note Title]]" });
    expect(target).toBe("New Note Title");
  });

  it("resolves an aliased wikilink to its target, not the alias", () => {
    const target = resolveSupersededBy({ status: "superseded", superseded_by: "[[Notes/New|New]]" });
    expect(target).toBe("Notes/New");
  });

  it("accepts a bare path with no wikilink brackets", () => {
    const target = resolveSupersededBy({ status: "superseded", superseded_by: "Notes/New Note" });
    expect(target).toBe("Notes/New Note");
  });

  it("returns undefined when status is not superseded, even if superseded_by is set", () => {
    const target = resolveSupersededBy({ status: "active", superseded_by: "[[New Note]]" });
    expect(target).toBeUndefined();
  });

  it("returns undefined when superseded_by is missing", () => {
    expect(resolveSupersededBy({ status: "superseded" })).toBeUndefined();
  });
});
