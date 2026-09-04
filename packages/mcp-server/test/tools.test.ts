import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent, computeUsageReport } from "@vault-neural-links/core";
import {
  ablationDiffTool,
  activateTool,
  compactWeightsTool,
  createNoteTool,
  getEdgeWeightTool,
  getWeightedNeighborsTool,
  listNotesTool,
  logTraversalTool,
  makeToolContext,
  readNoteTool,
  recallTool,
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
    await ctx.client.reinforce("A", "B");
    await ctx.client.reinforce("A", "C");
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

  it("activate surfaces a two-hop neighbor not directly linked to the origin, with a populated trace", async () => {
    await ctx.client.reinforce("A", "B", 10);
    await ctx.client.reinforce("B", "C", 10);
    await compactWeightsTool.handler(ctx)({});

    // minK: 1 so this only ever activation-run once — the two-hop path here
    // only ever surfaces 2 notes (B, C), which would otherwise be below the
    // default minK=3 and trigger a threshold-relaxation retry (a second
    // activate() run, with its own runId — see the minK relaxation test
    // below for that behavior).
    const { activated, trace } = parseResult(await activateTool.handler(ctx)({ note: "A", minK: 1 }));
    const c = activated.find((n: { path: string }) => n.path === "C");
    expect(c).toBeDefined();
    expect(c.hops).toBe(2);

    expect(trace.length).toBeGreaterThan(0);
    expect(trace.every((e: { runId: string }) => e.runId === trace[0].runId)).toBe(true);
    expect(trace.some((e: { type: string; to?: string }) => e.type === "edge_traversed" && e.to === "B")).toBe(true);
  });

  it("activate respects maxHops override", async () => {
    await ctx.client.reinforce("A", "B", 10);
    await ctx.client.reinforce("B", "C", 10);
    await compactWeightsTool.handler(ctx)({});

    const { activated } = parseResult(await activateTool.handler(ctx)({ note: "A", maxHops: 1 }));
    expect(activated.map((n: { path: string }) => n.path)).toEqual(["B"]);
  });

  it("activate reports which fallback tier served the result", async () => {
    await ctx.client.reinforce("A", "B", 10);
    await compactWeightsTool.handler(ctx)({});

    const { tier } = parseResult(await activateTool.handler(ctx)({ note: "A" }));
    expect(tier).toBe("activation");
  });

  it("activate never throws and reports the recency tier when the origin note has no edges and the vault has no matching notes", async () => {
    const result = parseResult(await activateTool.handler(ctx)({ note: "Isolated" }));
    expect(result.tier).toBe("recency");
    expect(result.activated).toEqual([]);
  });

  it("activate broadcasts every trace event to the activation socket", async () => {
    const broadcast = vi.fn();
    ctx.activationSocket = { host: "127.0.0.1", port: 0, broadcast, close: async () => {} };

    await ctx.client.reinforce("A", "B", 10);
    await compactWeightsTool.handler(ctx)({});
    broadcast.mockClear(); // isolate activate's own broadcasts from reinforce/compact's

    const { trace } = parseResult(await activateTool.handler(ctx)({ note: "A" }));
    expect(broadcast).toHaveBeenCalledTimes(trace.length);
    expect(broadcast.mock.calls[0][0]).toEqual(trace[0]);
  });

  it("ablation_diff shows a promoted edge losing energy when consolidation is disabled", async () => {
    await ctx.client.reinforce("A", "B", 10);
    await ctx.client.reinforce("A", "C", 10);
    await compactWeightsTool.handler(ctx)({});

    const { readFile, writeFile } = await import("node:fs/promises");
    const raw = JSON.parse(await readFile(join(ctx.vaultDataDir, "link-weights.json"), "utf8"));
    raw.edges["A|B"].consolidatedScore = 50;
    await writeFile(join(ctx.vaultDataDir, "link-weights.json"), JSON.stringify(raw), "utf8");

    const result = parseResult(await ablationDiffTool.handler(ctx)({ note: "A", disabledLayers: { consolidation: true } }));

    const baselineB = result.baseline.find((n: { path: string }) => n.path === "B");
    const ablatedB = result.ablated.find((n: { path: string }) => n.path === "B");
    expect(ablatedB.energy).toBeLessThan(baselineB.energy);
    expect(result.diff.some((d: { path: string; status: string }) => d.path === "B" && d.status === "reranked")).toBe(true);
  });

  it("ablation_diff reports a removed note when structuralFallback is disabled", async () => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(ctx.vaultPath, "A.md"), "linked to [[B]]", "utf8");
    await writeFile(join(ctx.vaultPath, "B.md"), "body", "utf8");
    const { rebuildStructuralIndex } = await import("@vault-neural-links/core");
    await rebuildStructuralIndex(ctx.vaultPath, ctx.vaultDataDir);

    const result = parseResult(
      await ablationDiffTool.handler(ctx)({ note: "A", disabledLayers: { structuralFallback: true } }),
    );

    expect(result.ablated.find((n: { path: string }) => n.path === "B")).toBeUndefined();
    expect(result.diff).toContainEqual(expect.objectContaining({ path: "B", status: "removed" }));
  });

  it("log_traversal and client.reinforce each broadcast an edge_traversed event live", async () => {
    const broadcast = vi.fn();
    ctx.activationSocket = { host: "127.0.0.1", port: 0, broadcast, close: async () => {} };

    await logTraversalTool.handler(ctx)({ from: "A", to: "B" });
    // Exercises the same client.reinforce() call shape the (now sole)
    // production caller uses — auto-reinforce, tools.ts's read_note handler
    // — broadcast wiring included, rather than the deleted reinforce_link
    // tool's wrapper.
    await ctx.client.reinforce("A", "B", 3, (event) => ctx.activationSocket?.broadcast(event));

    expect(broadcast).toHaveBeenCalledTimes(2);
    expect(broadcast.mock.calls[0][0]).toMatchObject({ type: "edge_traversed", from: "A", to: "B", energy: 1 });
    expect(broadcast.mock.calls[1][0]).toMatchObject({ type: "edge_traversed", from: "A", to: "B", energy: 3 });
  });

  it("compact_weights broadcasts an edge_traversed event for every edge changed since the last compaction", async () => {
    const broadcast = vi.fn();
    ctx.activationSocket = { host: "127.0.0.1", port: 0, broadcast, close: async () => {} };

    await logTraversalTool.handler(ctx)({ from: "A", to: "B" });
    broadcast.mockClear(); // isolate compact_weights' own broadcasts from log_traversal's

    await compactWeightsTool.handler(ctx)({});
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast.mock.calls[0][0]).toMatchObject({ type: "edge_traversed", from: "A", to: "B" });
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

  it("update_note leaves a hand-written frontmatter block byte-identical (VNL-003)", async () => {
    const frontmatterBlock =
      "---\n" +
      "aliases:\n" +
      "  - First Alias\n" +
      "  - Second Alias\n" +
      "# a comment Obsidian users do write\n" +
      "cssclasses: []\n" +
      "nested:\n" +
      "  a:\n" +
      "    deep: 1\n" +
      "---\n";
    await writeFile(join(vaultPath, "Foo.md"), `${frontmatterBlock}\nv1\n`, "utf8");

    await updateNoteTool.handler(ctx)({ path: "Foo", body: "v2" });

    const onDisk = await readFile(join(vaultPath, "Foo.md"), "utf8");
    expect(onDisk.startsWith(frontmatterBlock)).toBe(true);
    expect(onDisk).toContain("v2");
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

  it("read_note auto-logs traversal between consecutive reads, skipping the first read and re-reads", async () => {
    await createNoteTool.handler(ctx)({ path: "A", frontmatter: {}, body: "" });
    await createNoteTool.handler(ctx)({ path: "B", frontmatter: {}, body: "" });

    await readNoteTool.handler(ctx)({ path: "A" }); // first read: no 'from', nothing logged
    await readNoteTool.handler(ctx)({ path: "B" }); // second, different note: logs A -> B
    await readNoteTool.handler(ctx)({ path: "B" }); // re-reading the same note: no self-edge

    const compactResult = await compactWeightsTool.handler(ctx)({});
    expect(parseResult(compactResult).edgeCount).toBe(1);

    const edge = parseResult(await getEdgeWeightTool.handler(ctx)({ noteA: "A", noteB: "B" }));
    expect(edge.weight).toBeGreaterThan(0);
  });

  it("read_note does not log traversal for a note that doesn't exist", async () => {
    await createNoteTool.handler(ctx)({ path: "A", frontmatter: {}, body: "" });

    await readNoteTool.handler(ctx)({ path: "A" });
    await readNoteTool.handler(ctx)({ path: "Missing" });
    const compactResult = await compactWeightsTool.handler(ctx)({});
    expect(parseResult(compactResult).edgeCount).toBe(0);
  });

  it("list_notes lists created notes and skips Templates/", async () => {
    await createNoteTool.handler(ctx)({ path: "A", frontmatter: {}, body: "" });
    await createNoteTool.handler(ctx)({ path: "Templates/B", frontmatter: {}, body: "" });

    const notes = parseResult(await listNotesTool.handler(ctx)({}));
    expect(notes).toEqual(["A"]);
  });

  it("recall answers a query with snippets and a why per hit (VNL-050)", async () => {
    await createNoteTool.handler(ctx)({
      path: "Kill Process By Port",
      frontmatter: {},
      body: "Use lsof to find the process listening on a port, then kill it.",
    });
    await createNoteTool.handler(ctx)({ path: "Gardening", frontmatter: {}, body: "Tomatoes need water." });

    const result = parseResult(await recallTool.handler(ctx)({ query: "kill process by port" }));

    expect(result.hits[0].path).toBe("Kill Process By Port");
    expect(result.hits[0].snippet).toContain("lsof");
    expect(result.hits[0].why.matchedTerms).toContain("port");
    expect(result.seeds).toContain("Kill Process By Port");
  });

  it("recall credits a graph-expanded hit to the seed it came from, so reading it auto-reinforces", async () => {
    await createNoteTool.handler(ctx)({ path: "Kill Process By Port", frontmatter: {}, body: "lsof and kill." });
    await createNoteTool.handler(ctx)({ path: "Shell Aliases", frontmatter: {}, body: "Nothing in common." });

    await appendEvent(ctx.vaultDataDir, "seed", {
      ts: new Date().toISOString(),
      instance: "seed",
      type: "traverse",
      from: "Kill Process By Port",
      to: "Shell Aliases",
      weight_delta: 10,
    });
    await compactWeightsTool.handler(ctx)({});

    const result = parseResult(await recallTool.handler(ctx)({ query: "kill process by port" }));
    const expanded = result.hits.find((hit: { path: string }) => hit.path === "Shell Aliases");

    expect(expanded.source).toBe("graph");
    expect(expanded.why.via).toBe("Kill Process By Port");
    // The lexical hit has no origin note to credit, so it must not be queued
    // for auto-reinforcement — only the graph-expanded one is.
    expect([...ctx.pendingRetrievals.entries()]).toEqual([["Shell Aliases", "Kill Process By Port"]]);

    await readNoteTool.handler(ctx)({ path: "Shell Aliases" });
    expect(ctx.pendingRetrievals.has("Shell Aliases")).toBe(false);
  });

  it("update_note marks a note superseded without disturbing the rest of its frontmatter (VNL-060)", async () => {
    const raw = [
      "---",
      "type: atomic",
      "created: 2026-08-30",
      "status: active",
      "# a comment the minimal writer cannot reproduce",
      "aliases:",
      "  - the old name",
      "---",
      "",
      "Body text.",
      "",
    ].join("\n");
    await writeFile(join(vaultPath, "Old Decision.md"), raw, "utf8");

    const result = parseResult(
      await updateNoteTool.handler(ctx)({
        path: "Old Decision",
        frontmatter: { status: "superseded", superseded_by: "[[New Decision]]" },
      }),
    );
    expect(result.frontmatterChanged).toEqual(["status", "superseded_by"]);

    const written = await readFile(join(vaultPath, "Old Decision.md"), "utf8");
    expect(written).toContain("status: superseded");
    expect(written).toContain('superseded_by: "[[New Decision]]"');
    // Everything the patch did not name survives verbatim, VNL-003's guarantee.
    expect(written).toContain("# a comment the minimal writer cannot reproduce");
    expect(written).toContain("aliases:\n  - the old name");
    expect(written).toContain("created: 2026-08-30");

    // And it round-trips as the supersession signal recall reads.
    const note = parseResult(await readNoteTool.handler(ctx)({ path: "Old Decision" }));
    expect(note.frontmatter.status).toBe("superseded");
    expect(note.frontmatter.superseded_by).toBe("[[New Decision]]");
  });

  it("update_note without a frontmatter patch still re-emits the block byte for byte", async () => {
    const raw = ["---", "type: atomic", "weird: {a: 1}", "---", "", "Body.", ""].join("\n");
    await writeFile(join(vaultPath, "Untouched.md"), raw, "utf8");

    await updateNoteTool.handler(ctx)({
      path: "Untouched",
      appendUnderHeading: { heading: "## Updates", text: "- something happened" },
    });

    const written = await readFile(join(vaultPath, "Untouched.md"), "utf8");
    expect(written.startsWith(["---", "type: atomic", "weird: {a: 1}", "---"].join("\n"))).toBe(true);
    expect(written).toContain("- something happened");
  });

  it("create_note reinforces a wikilink to a note read this session (VNL-054)", async () => {
    await createNoteTool.handler(ctx)({ path: "Kill Process By Port", frontmatter: {}, body: "lsof and kill." });
    await readNoteTool.handler(ctx)({ path: "Kill Process By Port" });

    const written = parseResult(
      await createNoteTool.handler(ctx)({
        path: "Deploy Runbook",
        frontmatter: {},
        body: "Free the port first — see [[Kill Process By Port]].",
      }),
    );
    expect(written.cited).toEqual(["Kill Process By Port"]);

    const report = await computeUsageReport(ctx.vaultDataDir);
    expect(report.mechanismCounts.reinforce.cited).toBe(1);

    // After the report: compaction folds the event log away into
    // link-weights.json, so the events are no longer there to count.
    await compactWeightsTool.handler(ctx)({});
    const weight = parseResult(
      await getEdgeWeightTool.handler(ctx)({ noteA: "Deploy Runbook", noteB: "Kill Process By Port" }),
    );
    expect(weight.weight).toBeGreaterThan(0);
  });

  it("does not reinforce a wikilink to a note that was never read this session", async () => {
    await createNoteTool.handler(ctx)({ path: "Kill Process By Port", frontmatter: {}, body: "lsof and kill." });

    const written = parseResult(
      await createNoteTool.handler(ctx)({
        path: "Deploy Runbook",
        frontmatter: {},
        body: "See [[Kill Process By Port]].",
      }),
    );

    expect(written.cited).toEqual([]);
    const report = await computeUsageReport(ctx.vaultDataDir);
    expect(report.mechanismCounts.reinforce.cited).toBe(0);
  });

  it("credits a citation once per session however often the note is rewritten", async () => {
    await createNoteTool.handler(ctx)({ path: "Kill Process By Port", frontmatter: {}, body: "lsof and kill." });
    await readNoteTool.handler(ctx)({ path: "Kill Process By Port" });
    await createNoteTool.handler(ctx)({
      path: "Deploy Runbook",
      frontmatter: {},
      body: "See [[Kill Process By Port]].",
    });

    const again = parseResult(
      await updateNoteTool.handler(ctx)({
        path: "Deploy Runbook",
        appendUnderHeading: { heading: "## Updates", text: "Still [[Kill Process By Port]]." },
      }),
    );

    expect(again.cited).toEqual([]);
    const report = await computeUsageReport(ctx.vaultDataDir);
    expect(report.mechanismCounts.reinforce.cited).toBe(1);
  });

  it("search_notes queues term learning for its hits, credited when one is read (VNL-053)", async () => {
    await createNoteTool.handler(ctx)({ path: "Kill Process By Port", frontmatter: {}, body: "lsof and kill the pid" });

    await searchNotesTool.handler(ctx)({ query: "kill process by port" });
    expect(ctx.pendingTermRetrievals.get("Kill Process By Port")).toMatchObject({ trigger: "search-read" });
    expect(ctx.pendingTermRetrievals.get("Kill Process By Port")!.terms).toEqual(
      expect.arrayContaining(["kill", "process", "port"]),
    );

    await readNoteTool.handler(ctx)({ path: "Kill Process By Port" });
    expect(ctx.pendingTermRetrievals.has("Kill Process By Port")).toBe(false);

    await compactWeightsTool.handler(ctx)({});
    const termWeights = JSON.parse(
      await readFile(join(ctx.vaultDataDir, "term-weights.json"), "utf8"),
    ) as { edges: Record<string, unknown> };
    expect(Object.keys(termWeights.edges)).toEqual(
      expect.arrayContaining(["kill|Kill Process By Port", "process|Kill Process By Port", "port|Kill Process By Port"]),
    );
  });

  it("recall queues term learning from a hit's matched terms and credits it on read", async () => {
    await createNoteTool.handler(ctx)({ path: "Kill Process By Port", frontmatter: {}, body: "lsof and kill the pid" });

    const result = parseResult(await recallTool.handler(ctx)({ query: "kill process by port" }));
    const matched = result.hits[0].why.matchedTerms as string[];
    expect(matched.length).toBeGreaterThan(0);
    expect(ctx.pendingTermRetrievals.get("Kill Process By Port")).toEqual({ terms: matched, trigger: "recall-read" });

    await readNoteTool.handler(ctx)({ path: "Kill Process By Port" });
    expect(ctx.pendingTermRetrievals.has("Kill Process By Port")).toBe(false);

    await compactWeightsTool.handler(ctx)({});
    const termWeights = JSON.parse(
      await readFile(join(ctx.vaultDataDir, "term-weights.json"), "utf8"),
    ) as { edges: Record<string, unknown> };
    for (const term of matched) {
      expect(termWeights.edges[`${term}|Kill Process By Port`]).toBeDefined();
    }
  });

  it("crediting a recall hit that surfaced purely through a learned term reinforces that same term, not a text match it doesn't have", async () => {
    await createNoteTool.handler(ctx)({ path: "Kill Process By Port", frontmatter: {}, body: "lsof and kill the pid" });
    await createNoteTool.handler(ctx)({ path: "Unrelated Filler", frontmatter: {}, body: "nothing to do with any of this" });

    // Seed a personal-shorthand association directly (the bootstrap this
    // note could never reach through its own text) rather than through the
    // tool round trip, mirroring core's termWeights coverage.
    await appendEvent(ctx.vaultDataDir, "seed", {
      ts: new Date().toISOString(),
      instance: "seed",
      type: "term",
      from: "kpbp",
      to: "Kill Process By Port",
      weight_delta: 1,
      trigger: "search-read",
    });
    await compactWeightsTool.handler(ctx)({});

    const result = parseResult(await recallTool.handler(ctx)({ query: "kpbp" }));
    expect(result.hits[0]).toMatchObject({ path: "Kill Process By Port", source: "term" });
    expect(ctx.pendingTermRetrievals.get("Kill Process By Port")).toEqual({ terms: ["kpbp"], trigger: "recall-read" });

    await readNoteTool.handler(ctx)({ path: "Kill Process By Port" });
    await compactWeightsTool.handler(ctx)({});

    const termWeights = JSON.parse(
      await readFile(join(ctx.vaultDataDir, "term-weights.json"), "utf8"),
    ) as { edges: Record<string, { traverseCount: number }> };
    // Two term events now: the manually seeded one plus this credit.
    expect(termWeights.edges["kpbp|Kill Process By Port"].traverseCount).toBe(2);
  });

  it("search_notes finds a note by title without weight data", async () => {
    await createNoteTool.handler(ctx)({ path: "Apple Device Tips", frontmatter: {}, body: "" });

    const hits = parseResult(await searchNotesTool.handler(ctx)({ query: "Apple", useWeights: false }));
    expect(hits.map((h: { path: string }) => h.path)).toEqual(["Apple Device Tips"]);
  });

  it("search_notes primes its hits in the session without persisting any weight", async () => {
    await createNoteTool.handler(ctx)({ path: "B", frontmatter: {}, body: "" });
    await createNoteTool.handler(ctx)({ path: "C", frontmatter: {}, body: "" });

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

    // Searching for "B" (an exact title match) should prime it for this
    // session, same as get_weighted_neighbors would — but must not write
    // any traverse/reinforce event of its own.
    await searchNotesTool.handler(ctx)({ query: "B", useWeights: false });

    const compactAfterSearch = await compactWeightsTool.handler(ctx)({});
    expect(parseResult(compactAfterSearch).edgeCount).toBe(2); // unchanged from the 2 seeded edges — search added none

    const neighbors = parseResult(await getWeightedNeighborsTool.handler(ctx)({ note: "A" }));
    const b = neighbors.find((n: { path: string }) => n.path === "B");
    const c = neighbors.find((n: { path: string }) => n.path === "C");
    expect(b.weight).toBeGreaterThan(c.weight);
  });

  it("create_note skips auto-link/changelog for notes under Templates/", async () => {
    const result = parseResult(
      await createNoteTool.handler(ctx)({ path: "Templates/Meeting", frontmatter: {}, body: "Agenda" }),
    );
    expect(result.autoLinked).toEqual([]);

    const readBack = parseResult(await readNoteTool.handler(ctx)({ path: "Templates/Meeting" }));
    expect(readBack.body.trim()).toBe("Agenda");
  });

  // VNL-001: the tool schemas are the first place a prompt-injected traversal
  // is stopped, so the rejection has to hold at the schema, not only in core.
  describe("path argument containment", () => {
    const escapes = ["../outside/Secret", "..\\outside\\Secret", "/etc/passwd", "C:/Windows/secret"];

    it("read_note's schema rejects paths escaping the vault", () => {
      for (const path of escapes) {
        expect(readNoteTool.config.inputSchema.path.safeParse(path).success).toBe(false);
      }
      expect(readNoteTool.config.inputSchema.path.safeParse("MOCs/General").success).toBe(true);
    });

    it("write and traversal tools reject escaping paths too", () => {
      expect(createNoteTool.config.inputSchema.path.safeParse("../outside/Evil").success).toBe(false);
      expect(updateNoteTool.config.inputSchema.path.safeParse("../outside/Evil").success).toBe(false);
      expect(logTraversalTool.config.inputSchema.from.safeParse("../outside/A").success).toBe(false);
      expect(logTraversalTool.config.inputSchema.to.safeParse("../outside/B").success).toBe(false);
      expect(activateTool.config.inputSchema.note.safeParse("../outside/A").success).toBe(false);
      expect(getEdgeWeightTool.config.inputSchema.noteA.safeParse("../outside/A").success).toBe(false);
    });

    it("list_notes rejects a folder outside the vault but stays optional", () => {
      expect(listNotesTool.config.inputSchema.folder.safeParse("../outside").success).toBe(false);
      expect(listNotesTool.config.inputSchema.folder.safeParse(undefined).success).toBe(true);
      expect(listNotesTool.config.inputSchema.folder.safeParse("Notes").success).toBe(true);
    });

    it("no tool accepts a path targeting the data dir or .obsidian/", () => {
      expect(readNoteTool.config.inputSchema.path.safeParse(".vault-neural-links/link-weights").success).toBe(false);
      expect(createNoteTool.config.inputSchema.path.safeParse(".obsidian/workspace").success).toBe(false);
    });

    it("core still rejects an escaping path if a handler is called directly", async () => {
      await expect(readNoteTool.handler(ctx)({ path: "../outside/Secret" })).rejects.toThrow(
        /Invalid vault-relative path/,
      );
    });
  });
});
