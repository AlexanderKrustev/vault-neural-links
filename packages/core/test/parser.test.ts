import { describe, it, expect } from "vitest";
import { extractWikilinks } from "../src/parser.js";

describe("extractWikilinks", () => {
  it("extracts a plain wikilink", () => {
    expect(extractWikilinks("See [[Note A]] for more.")).toEqual([{ target: "Note A" }]);
  });

  it("extracts target and alias", () => {
    expect(extractWikilinks("[[Note A|display text]]")).toEqual([
      { target: "Note A", alias: "display text" },
    ]);
  });

  it("strips heading references", () => {
    expect(extractWikilinks("[[Note A#Heading]]")).toEqual([{ target: "Note A" }]);
  });

  it("strips block references", () => {
    expect(extractWikilinks("[[Note A^abc123]]")).toEqual([{ target: "Note A" }]);
  });

  it("combines heading and alias", () => {
    expect(extractWikilinks("[[Note A#Heading|display]]")).toEqual([
      { target: "Note A", alias: "display" },
    ]);
  });

  it("skips embeds", () => {
    expect(extractWikilinks("![[image.png]]")).toEqual([]);
  });

  it("ignores pure heading self-links", () => {
    expect(extractWikilinks("[[#Heading]]")).toEqual([]);
  });

  it("finds multiple links in one note", () => {
    expect(extractWikilinks("[[A]] links to [[B|b]] and embeds ![[C.png]]")).toEqual([
      { target: "A" },
      { target: "B", alias: "b" },
    ]);
  });

  it("normalizes backslashes and a leading ./", () => {
    expect(extractWikilinks("[[./folder\\Note]]")).toEqual([{ target: "folder/Note" }]);
  });
});
