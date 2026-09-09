import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compact } from "../src/compactor.js";
import { rebuildContentIndex } from "../src/contentIndex.js";
import { rebuildEmbeddings, type EmbeddingProvider } from "../src/embeddings.js";
import { appendEvent } from "../src/logger.js";
import { writeNote, toFilePath } from "../src/notes.js";
import { SessionBuffer } from "../src/priming.js";
import { recall } from "../src/recall.js";
import { rebuildStructuralIndex } from "../src/structuralLinks.js";
import { termEvents } from "../src/termWeights.js";

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

  it("ignores terms common to most of the vault, so a natural-language question doesn't match on function words", async () => {
    // Observed live: "what did we decide about a merchant of record" pulled
    // two unrelated notes into the top 5 on "what/did/we/about/a/of" alone.
    await note("Merchant Of Record Decision", "what we decided about the merchant of record");
    for (let i = 0; i < 8; i++) await note(`Filler ${i}`, "what did we decide about a thing of ours");
    await rebuildContentIndex(vaultPath, dataDir);

    const result = await recall(vaultPath, dataDir, "what did we decide about a merchant of record");

    expect(result.hits[0].path).toBe("Merchant Of Record Decision");
    expect(result.hits[0].why.matchedTerms).toEqual(expect.arrayContaining(["merchant", "record"]));
    expect(result.hits[0].why.matchedTerms).not.toContain("what");
    // The filler notes share only function words with the query, so none of
    // them should be a hit at all.
    expect(result.hits.map((hit) => hit.path)).toEqual(["Merchant Of Record Decision"]);
  });

  it("still answers a query made only of common words", async () => {
    for (let i = 0; i < 5; i++) await note(`Common ${i}`, "what did we decide about this");
    await rebuildContentIndex(vaultPath, dataDir);

    const result = await recall(vaultPath, dataDir, "what did we decide");

    expect(result.hits.length).toBeGreaterThan(0);
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

  it("surfaces a note via a learned term association, even when nothing in its text matches (VNL-053)", async () => {
    // "kpbp" is this user's own shorthand and appears nowhere in the note.
    await note("Windows Find and Kill Process by Port", "netstat and taskkill by pid");
    await note("Unrelated Filler", "nothing to do with any of this");
    await rebuildContentIndex(vaultPath, dataDir);
    for (const event of termEvents("inst-1", ["kpbp"], "Windows Find and Kill Process by Port", "search-read")) {
      await appendEvent(dataDir, "inst-1", event);
    }
    await compact(dataDir);

    const result = await recall(vaultPath, dataDir, "kpbp");
    const hit = result.hits[0];

    expect(hit.path).toBe("Windows Find and Kill Process by Port");
    expect(hit.source).toBe("term");
    expect(hit.why.termScore).toBeGreaterThan(0);
    expect(hit.why.learnedTerms).toEqual(["kpbp"]);
    // No lexical or graph contribution — the term signal alone must still
    // produce a usable snippet.
    expect(hit.why.lexicalScore).toBe(0);
    expect(hit.snippet.length).toBeGreaterThan(0);
  });

  it("boosts a lexical hit that also has a learned term association, without a term score alone outranking a strong textual match", async () => {
    await note("Kill Process By Port", "lsof and kill the pid on a port");
    await note("Only Learned", "shares nothing with the query text");
    await rebuildContentIndex(vaultPath, dataDir);
    for (const event of termEvents("inst-1", ["port"], "Only Learned", "recall-read")) {
      await appendEvent(dataDir, "inst-1", event);
    }
    await compact(dataDir);

    const result = await recall(vaultPath, dataDir, "kill process by port");

    // The genuine text match still wins even though the other note has a
    // learned association with one of the query's terms.
    expect(result.hits[0].path).toBe("Kill Process By Port");
    const learned = result.hits.find((hit) => hit.path === "Only Learned");
    expect(learned?.source).toBe("term");
  });

  it("expands through structural wikilinks even with no usage history", async () => {
    await note("Query Target", "spreading activation write-up, see [[Sibling Note]]");
    await note("Sibling Note", "wording that shares nothing with the query");
    await rebuildContentIndex(vaultPath, dataDir);
    await rebuildStructuralIndex(vaultPath, dataDir);

    const result = await recall(vaultPath, dataDir, "spreading activation write-up");

    expect(result.hits.map((hit) => hit.path)).toContain("Sibling Note");
  });

  // --- VNL-056: staleness and supersession conflicts -----------------------
  describe("staleness and conflicts", () => {
    it("reports days since the note was last used, from the usage graph not the file", async () => {
      await note("Used Long Ago", "spreading activation write-up");
      await note("Neighbour", "linked note");
      await appendEvent(dataDir, "inst-1", {
        ts: new Date(Date.now() - 120 * 86_400_000).toISOString(),
        instance: "inst-1",
        type: "traverse",
        from: "Used Long Ago",
        to: "Neighbour",
        weight_delta: 10,
      });
      await compact(dataDir);
      await rebuildContentIndex(vaultPath, dataDir);

      const result = await recall(vaultPath, dataDir, "spreading activation write-up");
      const hit = result.hits.find((entry) => entry.path === "Used Long Ago");

      expect(hit?.why.unusedDays).toBeGreaterThanOrEqual(119);
      // The file was written seconds ago; only the usage graph knows it has
      // not been read in four months. That gap is the whole point.
      expect(hit?.why.staleDays).toBe(0);
      expect(hit?.why.warnings?.join(" ")).toContain("Not used in");
      expect(hit?.why.warnings?.join(" ")).toContain("edited recently but not read since");
    });

    it("stays quiet about a note that has simply never been used", async () => {
      await note("Never Used", "spreading activation write-up");
      await rebuildContentIndex(vaultPath, dataDir);

      const result = await recall(vaultPath, dataDir, "spreading activation write-up");
      const hit = result.hits.find((entry) => entry.path === "Never Used");

      // "Never used" and "unused for 200 days" are different states; treating
      // them alike would warn on every note in a young vault.
      expect(hit?.why.unusedDays).toBeUndefined();
      expect(hit?.why.warnings).toBeUndefined();
    });

    it("pulls in the successor of a superseded hit, without demoting the original", async () => {
      await note("Old Decision", "charge from day one, spreading activation write-up", {
        status: "superseded",
        superseded_by: "[[New Decision]]",
      });
      await note("New Decision", "free first, then paid");
      await rebuildContentIndex(vaultPath, dataDir);

      const result = await recall(vaultPath, dataDir, "spreading activation write-up");

      const old = result.hits.find((entry) => entry.path === "Old Decision");
      expect(old).toBeDefined();
      expect(old!.why.warnings?.join(" ")).toContain("Superseded by");

      const successor = result.hits.find((entry) => entry.path === "New Decision");
      expect(successor).toBeDefined();
      expect(successor!.source).toBe("successor");
      expect(successor!.why.supersedes).toBe("Old Decision");
      // Not demoted: the earlier decision is often exactly what was asked for.
      expect(result.hits[0].path).toBe("Old Decision");
    });

    it("does not duplicate a successor that already ranked on its own", async () => {
      await note("Old Decision", "spreading activation write-up, superseded", {
        status: "superseded",
        superseded_by: "[[New Decision]]",
      });
      await note("New Decision", "spreading activation write-up, current");
      await rebuildContentIndex(vaultPath, dataDir);

      const result = await recall(vaultPath, dataDir, "spreading activation write-up");

      expect(result.hits.filter((entry) => entry.path === "New Decision")).toHaveLength(1);
    });

    it("flags a supersession pointing at a note that does not exist", async () => {
      await note("Orphaned", "spreading activation write-up", {
        status: "superseded",
        superseded_by: "[[Note That Was Deleted]]",
      });
      await rebuildContentIndex(vaultPath, dataDir);

      const result = await recall(vaultPath, dataDir, "spreading activation write-up");
      const hit = result.hits.find((entry) => entry.path === "Orphaned");

      expect(hit?.why.warnings?.join(" ")).toContain("dangling");
      // Nothing is invented to stand in for the missing note.
      expect(result.hits.some((entry) => entry.source === "successor")).toBe(false);
    });

    it("says so when the outdated note outranks the one that replaced it", async () => {
      await note("Old Decision", "spreading activation write-up spreading activation", {
        status: "superseded",
        superseded_by: "[[New Decision]]",
      });
      await note("New Decision", "spreading activation");
      await rebuildContentIndex(vaultPath, dataDir);

      const result = await recall(vaultPath, dataDir, "spreading activation write-up");
      const old = result.hits.find((entry) => entry.path === "Old Decision");

      expect(old!.why.warnings?.join(" ")).toContain("ranks above the note that replaced it");
    });

    it("does not call a note stale when it was read this session", async () => {
      await note("Read Today", "spreading activation write-up");
      await note("Neighbour", "linked");
      await appendEvent(dataDir, "inst-1", {
        ts: new Date(Date.now() - 200 * 86_400_000).toISOString(),
        instance: "inst-1",
        type: "traverse",
        from: "Read Today",
        to: "Neighbour",
        weight_delta: 10,
      });
      await compact(dataDir);
      await rebuildContentIndex(vaultPath, dataDir);

      const buffer = new SessionBuffer();
      buffer.touch("Read Today");
      const result = await recall(vaultPath, dataDir, "spreading activation write-up", {
        sessionBuffer: buffer,
      });
      const hit = result.hits.find((entry) => entry.path === "Read Today");

      // Usage weights only move at compaction, so the graph still thinks this
      // is 200 days cold; the session buffer knows better.
      expect(hit?.why.unusedDays).toBeGreaterThan(190);
      expect(hit?.why.warnings ?? []).toEqual([]);
    });
  });

  // --- VNL-051: the semantic axis ------------------------------------------
  // A fake provider throughout: these assert the blend, not the model. What
  // "means the same thing" means is declared by the test, so the ranking
  // being verified is the engine's, not MiniLM's.
  describe("semantic axis", () => {
    function provider(vectors: Record<string, number[]>, model = "test-model") {
      const calls: string[][] = [];
      return {
        model,
        dim: 3,
        calls,
        async embed(texts: string[]) {
          calls.push(texts);
          return texts.map((text) => {
            const hit = Object.entries(vectors).find(([key]) => text.toLowerCase().includes(key.toLowerCase()));
            return Float32Array.from(hit ? hit[1] : [0, 0, 1]);
          });
        },
      };
    }

    async function buildEmbeddings(
      embeddingProvider: EmbeddingProvider,
      nodes: { id: string; body: string }[],
    ) {
      return rebuildEmbeddings(
        dataDir,
        nodes.map((entry) => ({ ...entry, aliases: [] })),
        embeddingProvider,
      );
    }

    it("surfaces a note that shares no word with the query, on meaning alone", async () => {
      await note("Terminate A Listening Service", "How to stop whatever holds a socket open.");
      await note("Gardening", "Tomatoes need water.");
      await rebuildContentIndex(vaultPath, dataDir);

      // The query and the note are declared to be near-identical in vector
      // space; they share no tokens, so BM25 scores the note zero.
      const embeddingProvider = provider({
        "kill process by port": [1, 0, 0],
        "Terminate A Listening Service": [0.98, 0.2, 0],
      });
      await buildEmbeddings(embeddingProvider, [
        { id: "Terminate A Listening Service", body: "How to stop whatever holds a socket open." },
        { id: "Gardening", body: "Tomatoes need water." },
      ]);

      const result = await recall(vaultPath, dataDir, "kill process by port", { embeddingProvider });

      const hit = result.hits.find((entry) => entry.path === "Terminate A Listening Service");
      expect(hit).toBeDefined();
      expect(hit!.source).toBe("semantic");
      expect(hit!.why.lexicalScore).toBe(0);
      expect(hit!.why.semanticScore).toBeGreaterThan(0.9);
      // And it comes with a snippet, like every other hit — a semantic-only
      // hit was never read during the lexical phase.
      expect(hit!.snippet).toContain("socket");
    });

    it("labels a note that matched text as lexical, but still reports its semantic score", async () => {
      await note("Kill Process By Port", "Use lsof to find the process listening on a port and kill it.");
      await rebuildContentIndex(vaultPath, dataDir);

      const embeddingProvider = provider({
        "kill process by port": [1, 0, 0],
        "Kill Process By Port": [1, 0, 0],
      });
      await buildEmbeddings(embeddingProvider, [
        { id: "Kill Process By Port", body: "Use lsof to find the process listening on a port and kill it." },
      ]);

      const result = await recall(vaultPath, dataDir, "kill process by port", { embeddingProvider });

      expect(result.hits[0].path).toBe("Kill Process By Port");
      // "both" (lexical + its own graph self-activation as a seed), not
      // "semantic": the label says why the note is here at all, and text
      // matching outranks meaning matching as an explanation.
      expect(result.hits[0].source).toBe("both");
      expect(result.hits[0].why.semanticScore).toBeCloseTo(1, 3);
    });

    it("ranks unchanged when no embedding index exists — the axis is optional", async () => {
      await note("Kill Process By Port", "lsof and kill.");
      await note("Gardening", "Tomatoes need water.");
      await rebuildContentIndex(vaultPath, dataDir);

      const result = await recall(vaultPath, dataDir, "kill process by port");

      expect(result.hits[0].path).toBe("Kill Process By Port");
      expect(result.hits[0].why.semanticScore).toBeUndefined();
    });

    it("skips the phase entirely at semanticWeight 0 — no index read, no model call", async () => {
      await note("Kill Process By Port", "lsof and kill.");
      await rebuildContentIndex(vaultPath, dataDir);

      const embeddingProvider = provider({ "kill process by port": [1, 0, 0] });
      await buildEmbeddings(embeddingProvider, [{ id: "Kill Process By Port", body: "lsof and kill." }]);
      embeddingProvider.calls.length = 0;

      const result = await recall(vaultPath, dataDir, "kill process by port", {
        embeddingProvider,
        semanticWeight: 0,
      });

      expect(embeddingProvider.calls).toHaveLength(0);
      expect(result.hits[0].why.semanticScore).toBeUndefined();
    });

    it("ignores an index built by a different model rather than comparing incompatible vectors", async () => {
      await note("Terminate A Listening Service", "How to stop whatever holds a socket open.");
      await rebuildContentIndex(vaultPath, dataDir);

      await buildEmbeddings(provider({ "Terminate A Listening Service": [1, 0, 0] }, "old-model"), [
        { id: "Terminate A Listening Service", body: "How to stop whatever holds a socket open." },
      ]);

      const result = await recall(vaultPath, dataDir, "kill process by port", {
        embeddingProvider: provider({ "kill process by port": [1, 0, 0] }, "new-model"),
      });

      expect(result.hits.find((hit) => hit.path === "Terminate A Listening Service")).toBeUndefined();
    });

    it("keeps a strong text match above a merely-related semantic one", async () => {
      await note("Kill Process By Port", "Use lsof to find the process listening on a port and kill it.");
      await note("Docker Networking", "Container port mapping, unrelated to killing anything.");
      await rebuildContentIndex(vaultPath, dataDir);

      // The distractor is semantically adjacent (same topic area) but the
      // query's words are in the other note. Lexical must win: semanticWeight
      // is below 1 precisely so a topical neighbour cannot displace a match.
      const embeddingProvider = provider({
        "kill process by port": [1, 0, 0],
        "Docker Networking": [0.8, 0.6, 0],
        "Kill Process By Port": [0.5, 0.5, 0.7],
      });
      await buildEmbeddings(embeddingProvider, [
        { id: "Kill Process By Port", body: "Use lsof to find the process listening on a port and kill it." },
        { id: "Docker Networking", body: "Container port mapping, unrelated to killing anything." },
      ]);

      const result = await recall(vaultPath, dataDir, "kill process by port", { embeddingProvider });

      expect(result.hits[0].path).toBe("Kill Process By Port");
    });

    // --- VNL-061: semantic hits as spreading-activation origins ------------
    it("expands the graph out of a semantically-found note when no query term matches anything", async () => {
      // The query shares no word with any note in the vault, so the lexical
      // axis produces no seeds at all. Before VNL-061 the graph phase had
      // nothing to spread from and contributed nothing — on precisely the
      // query embeddings exist to answer.
      await note("Terminate A Listening Service", "Stop whatever holds a socket open. See [[Socket Teardown Notes]].");
      await note("Socket Teardown Notes", "Wording with nothing in common with the query.");
      await note("Gardening", "Tomatoes need water.");
      await rebuildContentIndex(vaultPath, dataDir);
      await rebuildStructuralIndex(vaultPath, dataDir);

      const embeddingProvider = provider({
        "kill process by port": [1, 0, 0],
        "Terminate A Listening Service": [0.98, 0.2, 0],
      });
      await buildEmbeddings(embeddingProvider, [
        { id: "Terminate A Listening Service", body: "Stop whatever holds a socket open." },
        { id: "Socket Teardown Notes", body: "Wording with nothing in common with the query." },
        { id: "Gardening", body: "Tomatoes need water." },
      ]);

      const result = await recall(vaultPath, dataDir, "kill process by port", { embeddingProvider });

      expect(result.seeds).toContain("Terminate A Listening Service");
      const neighbour = result.hits.find((hit) => hit.path === "Socket Teardown Notes");
      expect(neighbour).toBeDefined();
      expect(neighbour!.why.via).toBe("Terminate A Listening Service");
      expect(neighbour!.why.lexicalScore).toBe(0);
    });

    it("still labels the semantically-found note itself 'semantic', not 'graph'", async () => {
      // It self-activates as a seed, so it always carries graph energy now.
      // That energy is downstream of the semantic match, not evidence of its
      // own — crediting it to the graph would name the wrong mechanism.
      await note("Terminate A Listening Service", "Stop whatever holds a socket open.");
      await rebuildContentIndex(vaultPath, dataDir);

      const embeddingProvider = provider({
        "kill process by port": [1, 0, 0],
        "Terminate A Listening Service": [0.98, 0.2, 0],
      });
      await buildEmbeddings(embeddingProvider, [
        { id: "Terminate A Listening Service", body: "Stop whatever holds a socket open." },
      ]);

      const result = await recall(vaultPath, dataDir, "kill process by port", { embeddingProvider });

      expect(result.hits[0].path).toBe("Terminate A Listening Service");
      expect(result.hits[0].source).toBe("semantic");
    });

    it("seeds lexically only when semanticSeedCount is 0", async () => {
      await note("Terminate A Listening Service", "Stop whatever holds a socket open. See [[Socket Teardown Notes]].");
      await note("Socket Teardown Notes", "Wording with nothing in common with the query.");
      await rebuildContentIndex(vaultPath, dataDir);
      await rebuildStructuralIndex(vaultPath, dataDir);

      const embeddingProvider = provider({
        "kill process by port": [1, 0, 0],
        "Terminate A Listening Service": [0.98, 0.2, 0],
      });
      await buildEmbeddings(embeddingProvider, [
        { id: "Terminate A Listening Service", body: "Stop whatever holds a socket open." },
        { id: "Socket Teardown Notes", body: "Wording with nothing in common with the query." },
      ]);

      const result = await recall(vaultPath, dataDir, "kill process by port", {
        embeddingProvider,
        semanticSeedCount: 0,
      });

      expect(result.seeds).toEqual([]);
      expect(result.hits.find((hit) => hit.path === "Socket Teardown Notes")).toBeUndefined();
    });

    it("does not seed the same note twice when both axes find it", async () => {
      await note("Kill Process By Port", "Use lsof to find the process listening on a port and kill it.");
      await rebuildContentIndex(vaultPath, dataDir);

      const embeddingProvider = provider({
        "kill process by port": [1, 0, 0],
        "Kill Process By Port": [1, 0, 0],
      });
      await buildEmbeddings(embeddingProvider, [
        { id: "Kill Process By Port", body: "Use lsof to find the process listening on a port and kill it." },
      ]);

      const result = await recall(vaultPath, dataDir, "kill process by port", { embeddingProvider });

      expect(result.seeds).toEqual(["Kill Process By Port"]);
    });

    it("degrades to the pre-VNL-051 ranking when the model throws", async () => {
      await note("Kill Process By Port", "lsof and kill.");
      await rebuildContentIndex(vaultPath, dataDir);

      const working = provider({ "Kill Process By Port": [1, 0, 0] });
      await buildEmbeddings(working, [{ id: "Kill Process By Port", body: "lsof and kill." }]);

      const broken: EmbeddingProvider = {
        model: "test-model",
        dim: 3,
        async embed() {
          throw new Error("onnxruntime exploded");
        },
      };

      const result = await recall(vaultPath, dataDir, "kill process by port", { embeddingProvider: broken });

      expect(result.hits[0].path).toBe("Kill Process By Port");
      expect(result.hits[0].why.semanticScore).toBeUndefined();
    });
  });
});
