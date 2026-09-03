import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compact } from "../src/compactor.js";
import { rebuildContentIndex } from "../src/contentIndex.js";
import { appendEvent } from "../src/logger.js";
import { writeNote } from "../src/notes.js";
import {
  learnableQueryTerms,
  liveTermScores,
  parseTermEdgeKey,
  TERM_LEARN_WEIGHT,
  termEdgeKey,
  termEvents,
  TERM_WEIGHTS_FILE_NAME,
} from "../src/termWeights.js";

describe("termEdgeKey / parseTermEdgeKey (VNL-053)", () => {
  it("round-trips, and is directional unlike note-note edge keys", () => {
    const key = termEdgeKey("kill", "Notes/Windows Find and Kill Process by Port");
    expect(parseTermEdgeKey(key)).toEqual({ token: "kill", notePath: "Notes/Windows Find and Kill Process by Port" });
    // Not sorted — "kill|Notes/..." must stay distinguishable from a
    // (nonsensical, but structurally possible) reversed key.
    expect(termEdgeKey("a", "b")).not.toBe(termEdgeKey("b", "a"));
  });

  it("rejects a malformed key rather than guessing", () => {
    expect(parseTermEdgeKey("no-separator")).toBeNull();
    expect(parseTermEdgeKey("|no-token")).toBeNull();
    expect(parseTermEdgeKey("no-note|")).toBeNull();
  });
});

describe("termEvents", () => {
  it("emits one event per term, all crediting the same note", () => {
    const events = termEvents("inst-1", ["kill", "port"], "Notes/Kill Process", "search-read", new Date("2026-09-03T10:00:00.000Z"));

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: "term", from: "kill", to: "Notes/Kill Process", trigger: "search-read", weight_delta: TERM_LEARN_WEIGHT });
    expect(events[1]).toMatchObject({ from: "port" });
  });

  it("emits nothing for an empty term list", () => {
    expect(termEvents("inst-1", [], "Notes/X", "recall-read")).toEqual([]);
  });
});

describe("learnableQueryTerms", () => {
  let vaultPath: string;
  let dataDir: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-termlearn-vault-"));
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-termlearn-data-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  it("drops function words shared across most of the vault, same rule recall uses", async () => {
    await writeNote(vaultPath, "Merchant Of Record Decision", { frontmatter: {}, body: "what we decided about the merchant of record" });
    for (let i = 0; i < 8; i++) {
      await writeNote(vaultPath, `Filler ${i}`, { frontmatter: {}, body: "what did we decide about a thing of ours" });
    }
    await rebuildContentIndex(vaultPath, dataDir);

    const terms = await learnableQueryTerms(dataDir, "what did we decide about a merchant of record");

    expect(terms).toEqual(expect.arrayContaining(["merchant", "record"]));
    expect(terms).not.toContain("what");
  });

  it("returns every token when no content index exists yet", async () => {
    const terms = await learnableQueryTerms(dataDir, "kill process by port");
    expect(terms.sort()).toEqual(["by", "kill", "port", "process"]);
  });

  it("returns an empty array for a query with no tokens", async () => {
    expect(await learnableQueryTerms(dataDir, "   ")).toEqual([]);
  });
});

describe("liveTermScores", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-termscores-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns nothing when term-weights.json doesn't exist yet", async () => {
    const scores = await liveTermScores(dataDir, ["kill"]);
    expect(scores.size).toBe(0);
  });

  it("scores a note by the query terms that learned it, after a real fold through the compactor", async () => {
    const now = new Date("2026-09-03T12:00:00.000Z");
    for (const event of termEvents("inst-1", ["kill", "port"], "Notes/Kill Process", "search-read", now)) {
      await appendEvent(dataDir, "inst-1", event);
    }
    const result = await compact(dataDir);
    expect(result.termEdgeCount).toBe(2);

    const scores = await liveTermScores(dataDir, ["kill", "port"], now);
    const hit = scores.get("Notes/Kill Process");

    expect(hit).toBeDefined();
    expect(hit!.score).toBeCloseTo(2 * TERM_LEARN_WEIGHT, 5); // decay ~0 at the same instant
    expect(hit!.terms.sort()).toEqual(["kill", "port"]);
  });

  it("ignores tokens not asked for, even if they've learned other notes", async () => {
    const now = new Date();
    for (const event of termEvents("inst-1", ["gardening"], "Notes/Tomatoes", "search-read", now)) {
      await appendEvent(dataDir, "inst-1", event);
    }
    await compact(dataDir);

    const scores = await liveTermScores(dataDir, ["kill", "port"], now);
    expect(scores.size).toBe(0);
  });

  it("decays a term association the same way note edges decay", async () => {
    const touchedAt = new Date("2026-09-03T00:00:00.000Z");
    for (const event of termEvents("inst-1", ["kill"], "Notes/Kill Process", "search-read", touchedAt)) {
      await appendEvent(dataDir, "inst-1", event);
    }
    await compact(dataDir);

    const soon = await liveTermScores(dataDir, ["kill"], new Date(touchedAt.getTime() + 60_000));
    const muchLater = await liveTermScores(dataDir, ["kill"], new Date(touchedAt.getTime() + 60 * 24 * 60 * 60 * 1000));

    expect(soon.get("Notes/Kill Process")!.score).toBeGreaterThan(muchLater.get("Notes/Kill Process")?.score ?? 0);
  });
});

describe("term events through the real compactor", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-term-compact-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("folds into term-weights.json, not link-weights.json — a token must never become a graph neighbor", async () => {
    for (const event of termEvents("inst-1", ["kill", "port"], "Notes/Kill Process", "search-read")) {
      await appendEvent(dataDir, "inst-1", event);
    }

    const result = await compact(dataDir);

    expect(result.edgeCount).toBe(0); // no note-note edges created
    expect(result.termEdgeCount).toBe(2);

    const linkWeights = JSON.parse(await readFile(join(dataDir, "link-weights.json"), "utf8")) as { edges: Record<string, unknown> };
    expect(Object.keys(linkWeights.edges)).toEqual([]);

    const termWeights = JSON.parse(await readFile(join(dataDir, TERM_WEIGHTS_FILE_NAME), "utf8")) as {
      edges: Record<string, { baseStrength: number; traverseCount: number }>;
    };
    expect(termWeights.edges["kill|Notes/Kill Process"]).toMatchObject({ baseStrength: TERM_LEARN_WEIGHT, traverseCount: 1 });
    expect(termWeights.edges["port|Notes/Kill Process"]).toMatchObject({ baseStrength: TERM_LEARN_WEIGHT, traverseCount: 1 });
  });

  it("accumulates repeated learning of the same term-note pair rather than duplicating edges", async () => {
    for (let i = 0; i < 3; i++) {
      for (const event of termEvents("inst-1", ["kill"], "Notes/Kill Process", "recall-read")) {
        await appendEvent(dataDir, "inst-1", event);
      }
    }

    const result = await compact(dataDir);
    expect(result.termEdgeCount).toBe(1);

    const termWeights = JSON.parse(await readFile(join(dataDir, TERM_WEIGHTS_FILE_NAME), "utf8")) as {
      edges: Record<string, { baseStrength: number; traverseCount: number }>;
    };
    expect(termWeights.edges["kill|Notes/Kill Process"]).toMatchObject({ baseStrength: 3 * TERM_LEARN_WEIGHT, traverseCount: 3 });
  });

  it("does not write term-weights.json at all when nothing has ever learned anything", async () => {
    await appendEvent(dataDir, "inst-1", {
      ts: new Date().toISOString(),
      instance: "inst-1",
      type: "traverse",
      from: "A",
      to: "B",
      weight_delta: 1,
    });

    await compact(dataDir);

    await expect(readFile(join(dataDir, TERM_WEIGHTS_FILE_NAME), "utf8")).rejects.toThrow();
  });

  it("carries existing term edges forward across a compaction round with no new term events", async () => {
    for (const event of termEvents("inst-1", ["kill"], "Notes/Kill Process", "search-read")) {
      await appendEvent(dataDir, "inst-1", event);
    }
    await compact(dataDir);

    // Second round: only an unrelated note-note event, no term events at all.
    await appendEvent(dataDir, "inst-1", {
      ts: new Date().toISOString(),
      instance: "inst-1",
      type: "traverse",
      from: "X",
      to: "Y",
      weight_delta: 1,
    });
    const second = await compact(dataDir);

    expect(second.termEdgeCount).toBe(1); // the earlier term edge survived
    const termWeights = JSON.parse(await readFile(join(dataDir, TERM_WEIGHTS_FILE_NAME), "utf8")) as { edges: Record<string, unknown> };
    expect(Object.keys(termWeights.edges)).toEqual(["kill|Notes/Kill Process"]);
  });
});
