import { describe, it, expect } from "vitest";
import { extractWikilinks, extractOkfLinks } from "../src/parser.js";

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


describe("extractOkfLinks", () => {
  it("extracts a plain markdown link", () => {
    expect(extractOkfLinks("See [note-a](note-a.md) for more.")).toEqual([{ target: "note-a" }]);
  });

  it("keeps the label as alias when it differs from the bare filename", () => {
    expect(extractOkfLinks("[display text](note-a.md)")).toEqual([
      { target: "note-a", alias: "display text" },
    ]);
  });

  it("omits alias when the label matches the bare filename", () => {
    expect(extractOkfLinks("[note-a](note-a.md)")).toEqual([{ target: "note-a" }]);
  });

  it("strips the .md extension and resolves nested paths", () => {
    expect(extractOkfLinks("[Sub](folder/sub-note.md)")).toEqual([
      { target: "folder/sub-note", alias: "Sub" },
    ]);
  });

  it("works without a .md extension", () => {
    expect(extractOkfLinks("[Note A](note-a)")).toEqual([{ target: "note-a", alias: "Note A" }]);
  });

  it("skips images", () => {
    expect(extractOkfLinks("![alt text](image.png)")).toEqual([]);
  });

  it("skips in-page anchors", () => {
    expect(extractOkfLinks("[Heading](#heading)")).toEqual([]);
  });

  it("skips external links", () => {
    expect(
      extractOkfLinks(
        "[site](https://example.com) [mail](mailto:a@b.com) [ftp](ftp://host/file)",
      ),
    ).toEqual([]);
  });

  it("drops an optional title attribute", () => {
    expect(extractOkfLinks('[Note A](note-a.md "A title")')).toEqual([
      { target: "note-a", alias: "Note A" },
    ]);
  });

  it("finds multiple links in one note", () => {
    expect(extractOkfLinks("[A](a.md) links to [B](b.md) and embeds ![C](c.png)")).toEqual([
      { target: "a" },
      { target: "b" },
    ]);
  });

  it("normalizes backslashes and a leading ./", () => {
    expect(extractOkfLinks("[Note](./folder\\note.md)")).toEqual([{ target: "folder/note" }]);
  });
});
