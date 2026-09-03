import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compact } from "../src/compactor.js";
import { rebuildContentIndex } from "../src/contentIndex.js";
import { appendEvent } from "../src/logger.js";
import { writeNote, toFilePath } from "../src/notes.js";
import { SessionBuffer } from "../src/priming.js";
import { recall } from "../src/recall.js";
import { rebuildStructuralIndex } from "../src/structuralLinks.js";

describe("recall", () => {
  let vaultPath: string;
  let dataDir: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-recall-vault-"));
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-recall-data-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  async function note(path: string, body: string, frontmatter: Record<string, unknown> = {}) {
    await writeNote(vaultPath, path, { frontmatter, body });
  }

  async function traverse(from: string, to: string, weight = 10) {
    await appendEvent(dataDir, "inst-1", {
      ts: new Date().toISOString(),
      instance: "inst-1",
      type: "traverse",
      from,
      to,
      weight_delta: weight,
    });
  }

  it("ranks the note the query is about first, with its matched terms and a snippet", async () => {
    await note("Kill Process By Port", "Use lsof to find the process listening on a port and kill it.");
    await note("Gardening", "Tomatoes need water and sunlight, nothing about processes here.");
    await rebuildContentIndex(vaultPath, dataDir);

    const result = await recall(vaultPath, dataDir, "kill process by port");

    expect(result.hits[0].path).toBe("Kill Process By Port");
    expect(result.hits[0].why.matchedTerms).toEqual(expect.arrayContaining(["kill", "process", "port"]));
    expect(result.hits[0].why.lexicalScore).toBeGreaterThan(0);
    expect(result.hits[0].snippet).toContain("lsof");
    expect(result.seeds[0]).toBe("Kill Process By Port");
  });

  it("surfaces a note no query term matches, via the weighted graph", async () => {
    await note("Kill Process By Port", "lsof and kill.");
    await note("Shell Aliases", "Nothing lexically related to the query at all.");
    await rebuildContentIndex(vaultPath, dataDir);
    await traverse("Kill Process By Port", "Shell Aliases");
    await compact(dataDir);

    const result = await recall(vaultPath, dataDir, "kill process by port");
    const graphHit = result.hits.find((hit) => hit.path === "Shell Aliases");

    expect(graphHit).toBeDefined();
    expect(graphHit!.source).toBe("graph");
    expect(graphHit!.why.via).toBe("Kill Process By Port");
    expect(graphHit!.why.hops).toBe(1);
    expect(graphHit!.why.graphEnergy).toBeGreaterThan(0);
    // The graph expands and re-ranks; it must not outrank the note the query
    // actually matched (DEFAULT_GRAPH_WEIGHT < 1).
    expect(result.hits[0].path).toBe("Kill Process By Port");
  });

  it("counts a note reached from several seeds more strongly than one reached from a single seed", async () => {
    await note("Deploy Runbook", "deploy the service");
    await note("Rollback Runbook", "deploy rollback of the service");
    await note("Shared Incident Log", "unrelated wording entirely");
    await note("Only From One", "unrelated wording entirely");
    await rebuildContentIndex(vaultPath, dataDir);
    await traverse("Deploy Runbook", "Shared Incident Log");
    await traverse("Rollback Runbook", "Shared Incident Log");
    await traverse("Rollback Runbook", "Only From One");
    await compact(dataDir);

    const result = await recall(vaultPath, dataDir, "deploy service");
    const shared = result.hits.find((hit) => hit.path === "Shared Incident Log");
    const single = result.hits.find((hit) => hit.path === "Only From One");

    expect(shared?.why.graphEnergy).toBeGreaterThan(single?.why.graphEnergy ?? 0);
  });

  it("keeps the matching note above a well-connected hub one hop away", async () => {
    // Reproduced against the real 474-note vault: the MOC that links the
    // answer outranked the answer itself, because a seed got no graph score
    // of its own while its neighbors did.
    await note("Windows Find And Kill Process By Port", "netstat, taskkill, and the pid of the listener");
    await note("MOCs/General", "a hub note that links everything and matches nothing in the query");
    for (const other of ["Spare A", "Spare B", "Spare C"]) await note(other, "filler");
    await rebuildContentIndex(vaultPath, dataDir);
    await traverse("Windows Find And Kill Process By Port", "MOCs/General");
    for (const other of ["Spare A", "Spare B", "Spare C"]) await traverse("MOCs/General", other, 20);
    await compact(dataDir);

    const result = await recall(vaultPath, dataDir, "kill process by port");

    expect(result.hits[0].path).toBe("Windows Find And Kill Process By Port");
    expect(result.hits[0].why.graphEnergy).toBeGreaterThan(0);
  });

  it("uses context terms as a tie-breaker without letting them become the query", async () => {
    await note("Backup Notes A", "backup schedule for the database");
    await note("Backup Notes B", "backup schedule for the database, obsidian vault specifics");
    await rebuildContentIndex(vaultPath, dataDir);

    const withoutContext = await recall(vaultPath, dataDir, "backup schedule");
    const withContext = await recall(vaultPath, dataDir, "backup schedule", { context: "obsidian vault" });

    // Without context the shorter note wins on BM25 length normalization;
    // the context terms are what flip the order.
    expect(withoutContext.hits[0].path).toBe("Backup Notes A");
    expect(withContext.hits[0].path).toBe("Backup Notes B");
    // Context only reordered — it did not filter anything out.
    expect(withContext.hits.map((h) => h.path).sort()).toEqual(["Backup Notes A", "Backup Notes B"]);
  });

  it("reports staleness and supersession on the returned hits", async () => {
    await note("Old Runbook", "restart the queue worker", {
      status: "superseded",
      superseded_by: "[[New Runbook]]",
    });
    await rebuildContentIndex(vaultPath, dataDir);
    const long_ago = new Date(Date.now() - 94 * 24 * 60 * 60 * 1000);
    await utimes(toFilePath(vaultPath, "Old Runbook"), long_ago, long_ago);

    const result = await recall(vaultPath, dataDir, "restart queue worker");

    expect(result.hits[0].why.staleDays).toBe(94);
    expect(result.hits[0].why.supersededBy).toBe("New Runbook");
  });

  it("marks hits already seen this session as primed", async () => {
    await note("Session Note", "indexing strategy for the vault");
    await rebuildContentIndex(vaultPath, dataDir);
    const buffer = new SessionBuffer();
    buffer.touch("Session Note");

    const result = await recall(vaultPath, dataDir, "indexing strategy", { sessionBuffer: buffer });

    expect(result.hits[0].why.primed).toBe(true);
  });

  it("finds notes written since the last index rebuild", async () => {
    await note("Indexed Note", "some other subject");
    await rebuildContentIndex(vaultPath, dataDir);
    await note("Brand New Note", "written after the nightly rebuild, about hedgehogs");

    const result = await recall(vaultPath, dataDir, "hedgehogs");

    expect(result.hits.map((hit) => hit.path)).toContain("Brand New Note");
  });

  it("works before any content index exists", async () => {
    await note("Unindexed Vault Note", "the nightly job has never run here");

    const result = await recall(vaultPath, dataDir, "nightly job");

    expect(result.hits[0].path).toBe("Unindexed Vault Note");
    expect(result.candidatesScored).toBe(1);
  });

  it("returns nothing for a query with no usable terms", async () => {
    await note("Anything", "content");
    await rebuildContentIndex(vaultPath, dataDir);

    const result = await recall(vaultPath, dataDir, "   ---   ");

    expect(result.hits).toEqual([]);
    expect(result.seeds).toEqual([]);
    expect(result.candidatesScored).toBe(0);
  });

  it("honors topK", async () => {
    for (let i = 0; i < 5; i++) await note(`Note ${i}`, "shared vocabulary across every note");
    await rebuildContentIndex(vaultPath, dataDir);

    const result = await recall(vaultPath, dataDir, "shared vocabulary", { topK: 2 });

    expect(result.hits).toHaveLength(2);
  });

  it("expands through structural wikilinks even with no usage history", async () => {
    await note("Query Target", "spreading activation write-up, see [[Sibling Note]]");
    await note("Sibling Note", "wording that shares nothing with the query");
    await rebuildContentIndex(vaultPath, dataDir);
    await rebuildStructuralIndex(vaultPath, dataDir);

    const result = await recall(vaultPath, dataDir, "spreading activation write-up");

    expect(result.hits.map((hit) => hit.path)).toContain("Sibling Note");
  });
});
