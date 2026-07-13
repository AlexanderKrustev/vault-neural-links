import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "@vault-neural-links/core";
import {
  compactWeightsTool,
  createNoteTool,
  getEdgeWeightTool,
  getWeightedNeighborsTool,
  listNotesTool,
  logTraversalTool,
  makeToolContext,
  readNoteTool,
  reinforceLinkTool,
  searchNotesTool,
  updateNoteTool,
  type ToolContext,
} from "../src/tools.js";

function parseResult(result: { content: { type: "text"; text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

describe("mcp-server tools", () => {
  let vaultPath: string;
  let ctx: ToolContext;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-mcp-vault-"));
    ctx = makeToolContext(vaultPath, "test-instance");
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("get_weighted_neighbors returns [] before any data exists", async () => {
    const result = await getWeightedNeighborsTool.handler(ctx)({ note: "A" });
    expect(parseResult(result)).toEqual([]);
  });

  it("get_edge_weight returns null before any data exists", async () => {
    const result = await getEdgeWeightTool.handler(ctx)({ noteA: "A", noteB: "B" });
    expect(parseResult(result)).toEqual({ noteA: "A", noteB: "B", weight: null });
  });

  it("reinforce_link followed by compact_weights surfaces a non-zero edge weight", async () => {
    await reinforceLinkTool.handler(ctx)({ from: "A", to: "B", boost: 10 });
    const compactResult = await compactWeightsTool.handler(ctx)({});
    expect(parseResult(compactResult).edgeCount).toBe(1);

    const neighbors = parseResult(await getWeightedNeighborsTool.handler(ctx)({ note: "A" }));
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].path).toBe("B");
    expect(neighbors[0].weight).toBeGreaterThan(0);

    const edge = parseResult(await getEdgeWeightTool.handler(ctx)({ noteA: "A", noteB: "B" }));
    expect(edge.weight).toBeGreaterThan(0);
  });

  it("log_traversal followed by compact_weights surfaces a non-zero edge weight", async () => {
    await logTraversalTool.handler(ctx)({ from: "A", to: "B" });
    await logTraversalTool.handler(ctx)({ from: "A", to: "C" });
    const compactResult = await compactWeightsTool.handler(ctx)({});
    expect(parseResult(compactResult).edgeCount).toBe(2);

    const neighbors = parseResult(await getWeightedNeighborsTool.handler(ctx)({ note: "A" }));
    expect(neighbors).toHaveLength(2);
    expect(neighbors.map((n: { path: string }) => n.path).sort()).toEqual(["B", "C"]);
  });

  it("get_weighted_neighbors respects topK", async () => {
    await reinforceLinkTool.handler(ctx)({ from: "A", to: "B" });
    await reinforceLinkTool.handler(ctx)({ from: "A", to: "C" });
    await compactWeightsTool.handler(ctx)({});

    const neighbors = parseResult(await getWeightedNeighborsTool.handler(ctx)({ note: "A", topK: 1 }));
    expect(neighbors).toHaveLength(1);
  });

  it("get_weighted_neighbors gives a session-primed neighbor a boosted score over an equally-weighted one", async () => {
    // Seed edges directly (bypassing the client's tools, which themselves
    // touch the session buffer) so only the later log_traversal call primes B.
    await appendEvent(ctx.vaultDataDir, "seed", {
      ts: new Date().toISOString(),
      instance: "seed",
      type: "reinforce",
      from: "A",
      to: "B",
      weight_delta: 5,
    });
    await appendEvent(ctx.vaultDataDir, "seed", {
      ts: new Date().toISOString(),
      instance: "seed",
      type: "reinforce",
      from: "A",
      to: "C",
      weight_delta: 5,
    });
    await compactWeightsTool.handler(ctx)({});

    // Visiting B this session (via log_traversal) should prime it; C is
    // never independently touched despite having the identical base weight.
    await logTraversalTool.handler(ctx)({ from: "X", to: "B" });

    const neighbors = parseResult(await getWeightedNeighborsTool.handler(ctx)({ note: "A" }));
    const b = neighbors.find((n: { path: string }) => n.path === "B");
    const c = neighbors.find((n: { path: string }) => n.path === "C");
    expect(b.weight).toBeGreaterThan(c.weight);
  });

  it("create_note writes a note and reports autoLinked, then errors on a duplicate create", async () => {
    const result = parseResult(
      await createNoteTool.handler(ctx)({
        path: "Foo",
        frontmatter: { type: "atomic" },
        body: "Hello world",
      }),
    );
    expect(result.created).toBe(true);
    expect(result.path).toBe("Foo");
    expect(Array.isArray(result.autoLinked)).toBe(true);

    const readBack = parseResult(await readNoteTool.handler(ctx)({ path: "Foo" }));
    expect(readBack.frontmatter).toEqual({ type: "atomic" });
    expect(readBack.body.trim()).toBe("Hello world");

    const dup = parseResult(
      await createNoteTool.handler(ctx)({ path: "Foo", frontmatter: {}, body: "again" }),
    );
    expect(dup.error).toMatch(/already exists/);
  });

  it("create_note auto-links a mention of an existing note title", async () => {
    await createNoteTool.handler(ctx)({ path: "Vault Neural Links Project", frontmatter: {}, body: "" });

    const result = parseResult(
      await createNoteTool.handler(ctx)({
        path: "New Note",
        frontmatter: {},
        body: "Discusses the Vault Neural Links Project in depth.",
      }),
    );
    expect(result.autoLinked).toEqual(["Vault Neural Links Project"]);

    const readBack = parseResult(await readNoteTool.handler(ctx)({ path: "New Note" }));
    expect(readBack.body).toContain("[[Vault Neural Links Project]]");
  });

  it("update_note replaces the body and errors when the note doesn't exist", async () => {
    await createNoteTool.handler(ctx)({ path: "Foo", frontmatter: { type: "atomic" }, body: "v1" });

    const updated = parseResult(await updateNoteTool.handler(ctx)({ path: "Foo", body: "v2" }));
    expect(updated.updated).toBe(true);

    const readBack = parseResult(await readNoteTool.handler(ctx)({ path: "Foo" }));
    expect(readBack.body.trim()).toBe("v2");
    expect(readBack.frontmatter).toEqual({ type: "atomic" }); // unchanged

    const missing = parseResult(await updateNoteTool.handler(ctx)({ path: "Nope", body: "x" }));
    expect(missing.error).toMatch(/No note found/);
  });

  it("update_note supports appendUnderHeading, most-recent-first", async () => {
    await createNoteTool.handler(ctx)({
      path: "Foo",
      frontmatter: {},
      body: "# Foo\n\n## Updates\n- old entry\n",
    });

    await updateNoteTool.handler(ctx)({
      path: "Foo",
      appendUnderHeading: { heading: "## Updates", text: "- new entry" },
    });

    const readBack = parseResult(await readNoteTool.handler(ctx)({ path: "Foo" }));
    expect(readBack.body).toContain("## Updates\n- new entry\n- old entry\n");
  });

  it("list_notes lists created notes and skips Templates/", async () => {
    await createNoteTool.handler(ctx)({ path: "A", frontmatter: {}, body: "" });
    await createNoteTool.handler(ctx)({ path: "Templates/B", frontmatter: {}, body: "" });

    const notes = parseResult(await listNotesTool.handler(ctx)({}));
    expect(notes).toEqual(["A"]);
  });

  it("search_notes finds a note by title without weight data", async () => {
    await createNoteTool.handler(ctx)({ path: "Apple Device Tips", frontmatter: {}, body: "" });

    const hits = parseResult(await searchNotesTool.handler(ctx)({ query: "Apple", useWeights: false }));
    expect(hits.map((h: { path: string }) => h.path)).toEqual(["Apple Device Tips"]);
  });

  it("create_note skips auto-link/changelog for notes under Templates/", async () => {
    const result = parseResult(
      await createNoteTool.handler(ctx)({ path: "Templates/Meeting", frontmatter: {}, body: "Agenda" }),
    );
    expect(result.autoLinked).toEqual([]);

    const readBack = parseResult(await readNoteTool.handler(ctx)({ path: "Templates/Meeting" }));
    expect(readBack.body.trim()).toBe("Agenda");
  });
});
