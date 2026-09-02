import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createObsidianAdapter, createOkfAdapter } from "../src/adapters.js";
import { writeNote } from "../src/notes.js";

describe("createObsidianAdapter", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-adapters-test-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("lists notes as source nodes with body content", async () => {
    await writeNote(vaultPath, "Notes/Foo", { frontmatter: { type: "atomic" }, body: "Hello" });
    const adapter = createObsidianAdapter(vaultPath);
    const nodes = await adapter.listNodes();
    expect(nodes).toEqual([{ id: "Notes/Foo", body: expect.stringContaining("Hello"), aliases: [] }]);
  });

  it("surfaces frontmatter aliases on the source node (AIBRAIN-133)", async () => {
    await writeNote(vaultPath, "Notes/Foo", { frontmatter: { aliases: ["Foo Bar", "FB"] }, body: "Hello" });
    const adapter = createObsidianAdapter(vaultPath);
    const nodes = await adapter.listNodes();
    expect(nodes[0].aliases).toEqual(["Foo Bar", "FB"]);
  });

  it("extracts wikilink targets", () => {
    const adapter = createObsidianAdapter(vaultPath);
    const targets = adapter.extractExplicitLinkTargets({ id: "A", body: "See [[B]].", aliases: [] });
    expect(targets).toEqual(["B"]);
  });

  it("also extracts OKF-style link targets (dual syntax)", () => {
    const adapter = createObsidianAdapter(vaultPath);
    const targets = adapter.extractExplicitLinkTargets({
      id: "A",
      body: "See [[B]] and [C](c.md).",
      aliases: [],
    });
    expect(targets).toEqual(["B", "c"]);
  });
});

describe("createOkfAdapter", () => {
  let rootPath: string;

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), "vnl-okf-adapter-test-"));
  });

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  it("lists OKF notes (plain folder, no Obsidian vault) as source nodes", async () => {
    await writeNote(rootPath, "concepts/foo", {
      frontmatter: { type: "concept" },
      body: "Hello OKF",
    });
    const adapter = createOkfAdapter(rootPath);
    const nodes = await adapter.listNodes();
    expect(nodes).toEqual([
      { id: "concepts/foo", body: expect.stringContaining("Hello OKF"), aliases: [] },
    ]);
  });

  it("extracts OKF-style link targets", () => {
    const adapter = createOkfAdapter(rootPath);
    const targets = adapter.extractExplicitLinkTargets({
      id: "A",
      body: "Related: [Bar](concepts/bar.md).",
      aliases: [],
    });
    expect(targets).toEqual(["concepts/bar"]);
  });

  it("also tolerates wikilinks carried over from an Obsidian import", () => {
    const adapter = createOkfAdapter(rootPath);
    const targets = adapter.extractExplicitLinkTargets({
      id: "A",
      body: "[Bar](bar.md) and [[Legacy]]",
      aliases: [],
    });
    expect(targets).toEqual(["bar", "Legacy"]);
  });

  it("produces the same structural edges from OKF-only and wikilink-only notes", () => {
    const adapter = createOkfAdapter(rootPath);
    const viaOkf = adapter.extractExplicitLinkTargets({ id: "A", body: "[Bar](bar.md)", aliases: [] });
    const viaWikilink = adapter.extractExplicitLinkTargets({ id: "B", body: "[[bar]]", aliases: [] });
    expect(viaOkf).toEqual(["bar"]);
    expect(viaWikilink).toEqual(["bar"]);
  });
});
