import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { autoLinkScan } from "../src/autolink.js";
import { writeNote } from "../src/notes.js";

describe("autoLinkScan", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-autolink-test-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("adds a Related (auto-linked) section for a literal title mention", async () => {
    await writeNote(vaultPath, "Vault Neural Links Project", { frontmatter: {}, body: "" });

    const result = await autoLinkScan(
      vaultPath,
      "New Note",
      "Some text about the Vault Neural Links Project and its design.",
    );

    expect(result.added).toEqual(["Vault Neural Links Project"]);
    expect(result.content).toContain("## Related (auto-linked)");
    expect(result.content).toContain("- [[Vault Neural Links Project]]");
  });

  it("does not duplicate a link that's already present anywhere in the file", async () => {
    await writeNote(vaultPath, "Target", { frontmatter: {}, body: "" });

    const content = "Already linked: [[Target]]. Mentions Target again in prose.";
    const result = await autoLinkScan(vaultPath, "New Note", content);

    expect(result.added).toEqual([]);
    expect(result.content).toBe(content);
  });

  it("matches on frontmatter aliases as well as titles", async () => {
    await writeNote(vaultPath, "Real Title", { frontmatter: { aliases: ["nickname"] }, body: "" });

    const result = await autoLinkScan(vaultPath, "New Note", "Referring to the nickname here.");

    expect(result.added).toEqual(["Real Title"]);
  });

  it("skips terms shorter than 4 characters", async () => {
    await writeNote(vaultPath, "abc", { frontmatter: {}, body: "" });

    const result = await autoLinkScan(vaultPath, "New Note", "mentions abc in passing");

    expect(result.added).toEqual([]);
  });

  it("inserts new links into an existing Related (auto-linked) section without duplicating prior ones", async () => {
    await writeNote(vaultPath, "First Match", { frontmatter: {}, body: "" });
    await writeNote(vaultPath, "Second Match", { frontmatter: {}, body: "" });

    const content = "Mentions First Match and Second Match.\n\n## Related (auto-linked)\n- [[First Match]]\n";
    const result = await autoLinkScan(vaultPath, "New Note", content);

    expect(result.added).toEqual(["Second Match"]);
    expect(result.content).toBe(
      "Mentions First Match and Second Match.\n\n## Related (auto-linked)\n- [[Second Match]]\n- [[First Match]]\n",
    );
  });

  it("does not duplicate a link already present as an aliased wikilink", async () => {
    await writeNote(vaultPath, "Target", { frontmatter: {}, body: "" });

    const content = "Already linked via alias: [[Target|nickname]]. Mentions Target again in prose.";
    const result = await autoLinkScan(vaultPath, "New Note", content);

    expect(result.added).toEqual([]);
  });

  it("does not duplicate a link already present with a heading reference", async () => {
    await writeNote(vaultPath, "Target", { frontmatter: {}, body: "" });

    const content = "Already linked: [[Target#Some Section]]. Mentions Target again in prose.";
    const result = await autoLinkScan(vaultPath, "New Note", content);

    expect(result.added).toEqual([]);
  });

  it("does not duplicate a link already present with different casing", async () => {
    await writeNote(vaultPath, "Target Note", { frontmatter: {}, body: "" });

    const content = "Already linked: [[target note]]. Mentions Target Note again in prose.";
    const result = await autoLinkScan(vaultPath, "New Note", content);

    expect(result.added).toEqual([]);
  });

  it("inserts into an existing Related heading even mid-file, not into unrelated prose containing the same text", async () => {
    await writeNote(vaultPath, "Target", { frontmatter: {}, body: "" });

    const content =
      "This note explains the '## Related (auto-linked)' convention in prose.\n\n" +
      "Mentions Target here.\n\n## Related (auto-linked)\n";
    const result = await autoLinkScan(vaultPath, "New Note", content);

    expect(result.added).toEqual(["Target"]);
    // The link must land under the real heading (end of file), not spliced
    // into the prose sentence describing the heading.
    expect(result.content.endsWith("## Related (auto-linked)\n- [[Target]]\n")).toBe(true);
    expect(result.content).toContain("'## Related (auto-linked)' convention in prose.\n");
  });
});
