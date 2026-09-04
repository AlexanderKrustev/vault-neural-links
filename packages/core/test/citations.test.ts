import { describe, expect, it } from "vitest";
import { citedNotes } from "../src/citations.js";

describe("citedNotes (VNL-054)", () => {
  const read = ["Notes/VaultNeuralLinks/Recall Design", "Notes/Shell/Kill Process By Port"];

  it("credits a wikilink to a note read this session, by full path", () => {
    expect(citedNotes("Notes/Summary", "See [[Notes/Shell/Kill Process By Port]] for the command.", read)).toEqual([
      "Notes/Shell/Kill Process By Port",
    ]);
  });

  it("credits a bare [[Title]] link, which is how the vault actually writes links", () => {
    expect(citedNotes("Notes/Summary", "As in [[Recall Design]].", read)).toEqual([
      "Notes/VaultNeuralLinks/Recall Design",
    ]);
  });

  it("ignores a link to a note that was not read this session", () => {
    // The point of the signal is "the agent used what it read" — a link to a
    // note it never opened is structure, which the structural graph covers.
    expect(citedNotes("Notes/Summary", "See [[Some Other Note]].", read)).toEqual([]);
  });

  it("drops an ambiguous bare title rather than guessing which note was meant", () => {
    const ambiguous = ["ProjectA/Index", "ProjectB/Index"];
    expect(citedNotes("Notes/Summary", "See [[Index]].", ambiguous)).toEqual([]);
    // The unambiguous full path still resolves.
    expect(citedNotes("Notes/Summary", "See [[ProjectB/Index]].", ambiguous)).toEqual(["ProjectB/Index"]);
  });

  it("never credits a note for citing itself", () => {
    expect(citedNotes("Notes/Shell/Kill Process By Port", "See [[Kill Process By Port]].", read)).toEqual([]);
  });

  it("credits a repeated citation once per write", () => {
    const text = "[[Recall Design]] and again [[Notes/VaultNeuralLinks/Recall Design]] and [[Recall Design|the design]]";
    expect(citedNotes("Notes/Summary", text, read)).toEqual(["Notes/VaultNeuralLinks/Recall Design"]);
  });

  it("handles alias and heading link forms, and skips embeds", () => {
    expect(citedNotes("Notes/Summary", "[[Recall Design#Seeds|seeding]]", read)).toEqual([
      "Notes/VaultNeuralLinks/Recall Design",
    ]);
    // An embed transcludes the note into this one rather than citing it, and
    // parser.ts already treats the two differently.
    expect(citedNotes("Notes/Summary", "![[Recall Design]]", read)).toEqual([]);
  });

  it("returns nothing when no notes have been read yet", () => {
    expect(citedNotes("Notes/Summary", "[[Recall Design]]", [])).toEqual([]);
  });
});
