import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rebuildContentIndex } from "../src/contentIndex.js";
import { rebuildEmbeddings, type EmbeddingProvider } from "../src/embeddings.js";
import { createObsidianAdapter } from "../src/adapters.js";
import { rebuildStructuralIndex } from "../src/structuralLinks.js";
import {
  BENCHMARK_CONDITIONS,
  formatBenchmarkReport,
  relatedNoteFor,
  runBenchmark,
  type BenchmarkQuery,
} from "../src/benchmark.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_VAULT = join(here, "fixtures", "benchmark-vault");
const FIXTURE_QUERIES = join(here, "fixtures", "benchmark-vault-queries.json");

/**
 * VNL-020's CI tier. The fixture vault under `test/fixtures/benchmark-vault`
 * is authored so relevance is known by construction — synonym pairs that
 * share no content word, a superseded decision that must lose to the one
 * replacing it, and lexical traps where the note containing the query's
 * words is the *wrong* answer.
 *
 * It is also the second corpus the plan asks for. Two vaults matter because
 * a threshold tuned on one vault is a description of that vault; the real
 * vault is measured separately by `scripts/benchmark-recall.mjs`, whose
 * numbers cannot be checked in (it is someone's private notes).
 *
 * What this tier can and cannot do: it protects against regressions and it
 * proves the mechanisms compose. It cannot tell you the engine is good, and
 * no number from here belongs in a public claim.
 */

/**
 * A deterministic stand-in for the embedding model, so the semantic axis is
 * exercised in CI without a 23 MB download or a native runtime.
 *
 * It is a topic detector, not a language model: each dimension is a subject,
 * and text scores on a dimension by how many of that subject's words it
 * contains. That is enough to reproduce the one property the blend depends
 * on — two texts about the same thing land close together even with no word
 * in common — while staying completely predictable. It says nothing about
 * how good all-MiniLM-L6-v2 actually is; that is what the real-vault script
 * is for.
 */
const TOPICS: Record<string, string[]> = {
  ports: ["port", "socket", "address", "process", "pid", "kill", "taskkill", "lsof", "netstat", "service", "start", "boot", "occupying", "held", "holding"],
  database: ["database", "query", "session", "backend", "connection", "terminate", "runaway"],
  logging: ["log", "logs", "logging", "rotate", "rotation", "compress", "volume", "disk", "filled"],
  certs: ["certificate", "renewal", "renew", "reload", "expiry"],
  backups: ["backup", "restore", "recovery", "drill", "quarterly"],
  money: ["money", "paid", "pay", "charging", "price", "billing", "invoice", "invoices", "tax", "merchant", "dunning", "transaction", "free"],
  strategy: ["claim", "public", "publicly", "roadmap", "measured", "desktop", "client", "standalone", "parked", "paused", "useful", "opened", "steer", "name", "names"],
  baking: ["dough", "bread", "knead", "kneading", "starter", "sourdough", "culture", "feed", "feeding", "bake", "oven"],
  cooking: ["curry", "chilli", "heat", "spicy", "spiciness", "dairy", "sugar", "acid", "taste", "stock", "bones", "simmer", "boil", "roast", "knife", "blade", "sharpening"],
};

function topicVector(text: string): Float32Array {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const counts = new Set(words);
  const vector = Float32Array.from(
    Object.values(TOPICS).map((terms) => terms.reduce((sum, term) => sum + (counts.has(term) ? 1 : 0), 0)),
  );
  let norm = 0;
  for (const value of vector) norm += value * value;
  const length = Math.sqrt(norm);
  if (length === 0) return vector;
  return vector.map((value) => value / length) as Float32Array;
}

const topicProvider: EmbeddingProvider = {
  model: "fixture-topic-provider",
  dim: Object.keys(TOPICS).length,
  async embed(texts: string[]) {
    return texts.map(topicVector);
  },
};

// Each case runs the whole query set through four retrieval configurations,
// which is seconds rather than milliseconds. The default 5s timeout was close
// enough to the real cost that these flaked the moment the machine was busy
// with anything else — a benchmark that fails under load teaches nothing
// about the benchmark.
describe("VNL-020 benchmark", { timeout: 30_000 }, () => {
  let dataDir: string;
  let queries: BenchmarkQuery[];

  beforeEach(async () => {
    // Indexes go to a temp dir, never into the checked-in fixture: the
    // benchmark must be able to run against a vault it does not own, and a
    // test that writes into `test/fixtures/` would show up as repo churn.
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-benchmark-"));
    queries = JSON.parse(await readFile(FIXTURE_QUERIES, "utf8")) as BenchmarkQuery[];

    const adapter = createObsidianAdapter(FIXTURE_VAULT);
    const nodes = await adapter.listNodes();
    await rebuildContentIndex(FIXTURE_VAULT, dataDir, adapter);
    await rebuildStructuralIndex(FIXTURE_VAULT, dataDir, adapter);
    await rebuildEmbeddings(dataDir, nodes, topicProvider, { existing: null });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("has a fixture query set big enough to mean something, with reachable targets", async () => {
    expect(queries.length).toBeGreaterThanOrEqual(20);
    const paths = new Set((await createObsidianAdapter(FIXTURE_VAULT).listNodes()).map((node) => node.id));
    for (const entry of queries) {
      expect(paths.has(entry.target), `${entry.target} is not a note in the fixture vault`).toBe(true);
    }
  });

  it("reports MRR and rank-1 for all three priming conditions plus the baseline", async () => {
    const report = await runBenchmark(FIXTURE_VAULT, dataDir, queries, {
      recallOptions: { embeddingProvider: topicProvider },
    });

    expect(report.queryCount).toBe(queries.length);
    for (const condition of BENCHMARK_CONDITIONS) {
      const metrics = report.conditions[condition];
      expect(metrics.queryCount).toBe(queries.length);
      expect(metrics.mrr).toBeGreaterThan(0);
      expect(metrics.mrr).toBeLessThanOrEqual(1);
      expect(metrics.rank1).toBeLessThanOrEqual(metrics.found);
    }
    expect(report.baselines.plainSearch.queryCount).toBe(queries.length);
    expect(report.baselines.lexicalOnly.queryCount).toBe(queries.length);
  });

  // The whole point of the redesign (D6). The old harness pre-seeded the
  // target into the buffer, so it could not tell retrieval from priming.
  it("primes with a neighbour, never the target, in the relatedPrimed condition", async () => {
    const report = await runBenchmark(FIXTURE_VAULT, dataDir, queries, {
      recallOptions: { embeddingProvider: topicProvider },
    });

    for (const outcome of report.conditions.relatedPrimed.outcomes) {
      expect(outcome.primedWith).not.toBe(outcome.target);
    }
    for (const outcome of report.conditions.unprimed.outcomes) {
      expect(outcome.primedWith).toBeNull();
    }
    // At least some queries must actually have had a neighbour to prime
    // with, or the condition is silently identical to unprimed.
    const primed = report.conditions.relatedPrimed.outcomes.filter((o) => o.primedWith !== null);
    expect(primed.length).toBeGreaterThan(0);
  });

  it("finds most targets cold, with no session buffer at all", async () => {
    const report = await runBenchmark(FIXTURE_VAULT, dataDir, queries, {
      recallOptions: { embeddingProvider: topicProvider },
    });

    const unprimed = report.conditions.unprimed;
    // A regression gate, not an achievement: these are thresholds the
    // fixture comfortably clears today, set low enough that only a real
    // breakage trips them. Raising them as the engine improves is fine;
    // lowering them to make a change pass is the thing to refuse.
    expect(unprimed.found / unprimed.queryCount).toBeGreaterThanOrEqual(0.8);
    expect(unprimed.mrr).toBeGreaterThanOrEqual(0.5);
  });

  // The Phase 2b exit gate. The comparison that matters is against pure
  // BM25 over the same index — the engine's own layers switched off — not
  // against searchNotes, whose all-tokens-present rule makes it lose to
  // anything on a natural-language question.
  //
  // Read this result knowing what carries it: the semantic axis, driven here
  // by a perfect topic oracle. all-MiniLM-L6-v2 is not a perfect topic
  // oracle, so passing here is a statement about the *mechanism* composing
  // correctly, not evidence the gate is met in production. The real-vault
  // run is what settles that, and the test below records what happens on
  // this fixture with the semantic axis switched off.
  it("beats pure BM25 on MRR when cold — the Phase 2b exit gate", async () => {
    const report = await runBenchmark(FIXTURE_VAULT, dataDir, queries, {
      recallOptions: { embeddingProvider: topicProvider },
    });

    expect(report.conditions.unprimed.mrr).toBeGreaterThan(report.baselines.lexicalOnly.mrr);
  });

  // Measured 2026-09-09, and the reason the gate test above passes: with the
  // semantic axis off, the engine's remaining layers do NOT beat pure BM25 on
  // this fixture — 0.825 vs 0.858 MRR. The whole gap is one query ("reduce
  // spiciness of a dish", where BM25 ranks the answer 1st and the engine 3rd);
  // the other 19 are identical.
  //
  // That is the expected shape rather than a defect: the fixture has no usage
  // weights at all, so the graph axis can only promote wikilink neighbours,
  // and this fixture's link structure carries nothing the queries need. The
  // real conclusion is about the benchmark, not the engine — the CI tier
  // cannot judge the graph axis, only the real-vault run can.
  //
  // This test exists so that stops being true silently. It bounds the damage
  // rather than asserting a win the configuration cannot deliver.
  it("keeps the non-semantic layers from actively degrading pure BM25", async () => {
    const report = await runBenchmark(FIXTURE_VAULT, dataDir, queries, {
      recallOptions: { semanticWeight: 0 },
    });

    const engine = report.conditions.unprimed;
    const bm25 = report.baselines.lexicalOnly;
    const worsened = engine.outcomes.filter(
      (outcome, i) => (outcome.rank ?? Infinity) > (bm25.outcomes[i].rank ?? Infinity),
    );

    expect(engine.found).toBe(bm25.found);
    // One today. If a change makes this three, that change is the suspect.
    expect(worsened.length).toBeLessThanOrEqual(1);
  });

  it("ranks the current decision above the one it superseded", async () => {
    const report = await runBenchmark(
      FIXTURE_VAULT,
      dataDir,
      [{ query: "what did we decide about charging money", target: "Product/Free First Then Paid" }],
      { recallOptions: { embeddingProvider: topicProvider } },
    );

    const outcome = report.conditions.unprimed.outcomes[0];
    expect(outcome.rank).not.toBeNull();

    const superseded = await runBenchmark(
      FIXTURE_VAULT,
      dataDir,
      [{ query: "what did we decide about charging money", target: "Product/Charging From Day One" }],
      { recallOptions: { embeddingProvider: topicProvider } },
    );
    const supersededRank = superseded.conditions.unprimed.outcomes[0].rank;

    expect(outcome.rank!).toBeLessThan(supersededRank ?? Number.MAX_SAFE_INTEGER);
  });

  it("picks the related note deterministically, and never the target itself", () => {
    const edges = { "A": ["C", "B", "A"], "Lonely": [] };
    expect(relatedNoteFor("A", edges)).toBe("B");
    expect(relatedNoteFor("A", edges)).toBe("B");
    expect(relatedNoteFor("Lonely", edges)).toBeNull();
    expect(relatedNoteFor("Unknown", edges)).toBeNull();
  });

  it("formats a report that names every condition and the baseline", async () => {
    const report = await runBenchmark(FIXTURE_VAULT, dataDir, queries.slice(0, 3), {
      recallOptions: { embeddingProvider: topicProvider },
    });
    const text = formatBenchmarkReport(report);

    for (const label of ["unprimed", "relatedPrimed", "targetPrimed", "lexicalOnly", "plainSearch", "MRR", "rank-1"]) {
      expect(text).toContain(label);
    }
  });
});
