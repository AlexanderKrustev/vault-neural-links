import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildStructuralIndex, loadStructuralIndex, rebuildStructuralIndex } from "../src/structuralLinks.js";
import type { SourceAdapter, SourceNode } from "../src/adapters.js";

describe("buildStructuralIndex", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-structural-vault-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("builds a bidirectional edge from a one-directional wikilink", async () => {
    await writeFile(join(vaultPath, "A.md"), "body linking to [[B]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "no links here", "utf8");

    const index = await buildStructuralIndex(vaultPath);

    expect(index.edges["A"]).toEqual(["B"]);
    expect(index.edges["B"]).toEqual(["A"]);
  });

  it("resolves an aliased wikilink to its target note", async () => {
    await writeFile(join(vaultPath, "A.md"), "see [[B|the other note]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "body", "utf8");

    const index = await buildStructuralIndex(vaultPath);
    expect(index.edges["A"]).toEqual(["B"]);
  });

  it("skips a wikilink target that ambiguously matches multiple notes by title", async () => {
    await writeFile(join(vaultPath, "A.md"), "see [[Index]]", "utf8");
    await mkdtempSubdir(vaultPath, "Folder1");
    await mkdtempSubdir(vaultPath, "Folder2");
    await writeFile(join(vaultPath, "Folder1", "Index.md"), "body", "utf8");
    await writeFile(join(vaultPath, "Folder2", "Index.md"), "body", "utf8");

    const index = await buildStructuralIndex(vaultPath);
    expect(index.edges["A"] ?? []).toEqual([]);
  });

  it("does not link a note to itself", async () => {
    await writeFile(join(vaultPath, "A.md"), "self-reference [[A]]", "utf8");

    const index = await buildStructuralIndex(vaultPath);
    expect(index.edges["A"] ?? []).toEqual([]);
  });
});

describe("rebuildStructuralIndex + loadStructuralIndex", () => {
  let vaultPath: string;
  let dataDir: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-structural-vault2-"));
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-structural-data-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it("persists the built index to disk and loads it back", async () => {
    await writeFile(join(vaultPath, "A.md"), "[[B]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "body", "utf8");

    const result = await rebuildStructuralIndex(vaultPath, dataDir);
    expect(result.noteCount).toBe(2);
    expect(result.edgeCount).toBe(1);

    const loaded = await loadStructuralIndex(dataDir);
    expect(loaded?.edges["A"]).toEqual(["B"]);

    const raw = JSON.parse(await readFile(join(dataDir, "structural-links.json"), "utf8"));
    expect(raw.edges["A"]).toEqual(["B"]);
  });

  it("returns null when no structural index has been built yet", async () => {
    expect(await loadStructuralIndex(dataDir)).toBeNull();
  });
});

async function mkdtempSubdir(vaultPath: string, name: string): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(join(vaultPath, name), { recursive: true });
}

describe("buildStructuralIndex with a non-Obsidian SourceAdapter (AIBRAIN-33)", () => {
  it("builds edges from a synthetic adapter with no filesystem involved", async () => {
    const nodes: SourceNode[] = [
      { id: "page-1", body: "references page-2", aliases: [] },
      { id: "page-2", body: "no outgoing references", aliases: [] },
    ];
    const adapter: SourceAdapter = {
      async listNodes() {
        return nodes;
      },
      extractExplicitLinkTargets(node) {
        // Stand-in for a Confluence/Azure-Wiki-style explicit reference
        // syntax, distinct from Obsidian's [[wikilinks]] — proves the
        // structural-index builder has no wikilink-specific assumptions.
        return node.body.includes("references page-2") ? ["page-2"] : [];
      },
    };

    // vaultPath is unused when a custom adapter is supplied — a dummy
    // value confirms buildStructuralIndex doesn't fall back to reading
    // the filesystem itself once an adapter is given.
    const index = await buildStructuralIndex("/nonexistent/dummy/path", adapter);

    expect(index.edges["page-1"]).toEqual(["page-2"]);
    expect(index.edges["page-2"]).toEqual(["page-1"]);
  });

  it("drops an unresolvable link target instead of guessing", async () => {
    const nodes: SourceNode[] = [{ id: "page-1", body: "", aliases: [] }];
    const adapter: SourceAdapter = {
      async listNodes() {
        return nodes;
      },
      extractExplicitLinkTargets() {
        return ["page-does-not-exist"];
      },
    };

    const index = await buildStructuralIndex("/nonexistent/dummy/path", adapter);
    expect(index.edges["page-1"] ?? []).toEqual([]);
  });
});
