import { searchNotes } from "./notes.js";
import { SessionBuffer } from "./priming.js";
import { recall, type RecallOptions } from "./recall.js";
import { loadStructuralIndex } from "./structuralLinks.js";

/**
 * VNL-020 — a benchmark that can tell "correct" from "primed".
 *
 * The benchmark this replaces (`scripts/eval-retrieval.mjs`, AIBRAIN-31)
 * measured something it could not distinguish from its own setup. Every one
 * of its 18 cases started from a `(origin note, target note)` pair, called
 * `activate(origin)`, and pre-touched the session buffer with the *target*.
 * So it asked "does the note I already told the engine about this session
 * rank first?" — and the distractor case ranked #1 for exactly the same
 * reason the real ones did. No number produced that way can support a public
 * claim, which is what D6 in docs/PLAN.md says.
 *
 * Three things change here.
 *
 * **The input is a query, not a note.** An agent asks "what should I read
 * about X?", so the benchmark asks that too, through `recall`. A
 * (origin, target) pair cannot express a question that has no starting note,
 * which is most questions.
 *
 * **Priming is a condition, not a constant.** Every query runs in three:
 * `unprimed` (empty buffer — the honest cold case, and the number any
 * public claim has to be based on), `relatedPrimed` (the buffer holds a
 * structural *neighbour* of the target, never the target — the realistic
 * case, where you have been reading around a subject), and `targetPrimed`
 * (the old condition, kept only so a regression in it is still visible).
 * A mechanism that only works in `targetPrimed` is not retrieval.
 *
 * **MRR alongside rank-1.** Rank-1 counting throws away the difference
 * between rank 2 and rank 50, which is most of what a user experiences.
 *
 * Nothing here writes to the vault: no events, no weights, no session
 * files. It must be safe to run against a live vault repeatedly.
 */

export interface BenchmarkQuery {
  /** The question, as a person or agent would actually phrase it. */
  query: string;
  /** Vault-relative path of the note that should be found. */
  target: string;
  /** Optional human label for reporting. */
  label?: string;
}

export type BenchmarkCondition = "unprimed" | "relatedPrimed" | "targetPrimed";

export const BENCHMARK_CONDITIONS: BenchmarkCondition[] = ["unprimed", "relatedPrimed", "targetPrimed"];

/** How deep a result list is examined before the target counts as not found. */
export const DEFAULT_BENCHMARK_TOP_K = 20;

export interface QueryOutcome {
  query: string;
  target: string;
  label?: string;
  /** 1-based rank of the target, or null if it never appeared in the top K. */
  rank: number | null;
  /**
   * Which note the buffer was primed with, for `relatedPrimed`. Null when no
   * structural neighbour exists — the condition then degenerates to
   * `unprimed`, and `primedWith: null` is what says so in the output rather
   * than the run silently reporting a different condition than it ran.
   */
  primedWith?: string | null;
}

export type BaselineName = "plainSearch" | "lexicalOnly";

export interface ConditionMetrics {
  condition: BenchmarkCondition | BaselineName;
  queryCount: number;
  /** Queries whose target appeared anywhere in the top K. */
  found: number;
  /** Queries whose target was ranked first. */
  rank1: number;
  /**
   * Mean reciprocal rank over *all* queries, counting a miss as 0. The
   * headline number: unlike rank-1 it distinguishes rank 2 from rank 50,
   * and unlike "mean rank of found" it cannot be improved by finding fewer
   * things.
   */
  mrr: number;
  /** Mean rank across found queries only — reported because the old benchmark did. */
  meanRankOfFound: number | null;
  outcomes: QueryOutcome[];
}

export interface BenchmarkReport {
  vaultPath: string;
  ranAt: string;
  queryCount: number;
  topK: number;
  conditions: Record<BenchmarkCondition, ConditionMetrics>;
  /**
   * What `recall` has to beat, both measured cold.
   *
   * `lexicalOnly` is the one the Phase 2b exit gate means: `recall` with the
   * graph, term and semantic axes switched off, i.e. pure BM25 over the same
   * index. It isolates exactly what the engine's own layers add, and it is
   * the comparison that has previously *lost* — the 2026-09-02 audit found
   * relevance-ranked text search beating the engine on mean rank (1.27 vs
   * 2.38), which is the finding this benchmark exists to re-test honestly.
   *
   * `plainSearch` is `searchNotes`, reported for continuity with the older
   * benchmarks. Read it with care: it requires every query token to be
   * present, so on natural-language questions it mostly returns nothing.
   * Beating it is not an achievement and must not be quoted as one.
   */
  baselines: Record<BaselineName, ConditionMetrics>;
}

export interface BenchmarkOptions {
  topK?: number;
  /** Passed through to `recall`, so a caller can sweep weights. */
  recallOptions?: Omit<RecallOptions, "topK" | "sessionBuffer">;
  /** Called after each query completes, for progress on a long run. */
  onProgress?: (done: number, total: number) => void;
  now?: Date;
}

function metricsFrom(condition: ConditionMetrics["condition"], outcomes: QueryOutcome[]): ConditionMetrics {
  const found = outcomes.filter((outcome) => outcome.rank !== null);
  const reciprocalSum = outcomes.reduce((sum, outcome) => sum + (outcome.rank ? 1 / outcome.rank : 0), 0);
  const rankSum = found.reduce((sum, outcome) => sum + (outcome.rank ?? 0), 0);
  return {
    condition,
    queryCount: outcomes.length,
    found: found.length,
    rank1: outcomes.filter((outcome) => outcome.rank === 1).length,
    // Averaged over every query, so a run that finds nothing scores 0
    // rather than dividing by zero and reporting nothing at all.
    mrr: outcomes.length > 0 ? reciprocalSum / outcomes.length : 0,
    meanRankOfFound: found.length > 0 ? rankSum / found.length : null,
    outcomes,
  };
}

/**
 * A structural neighbour of `target` to prime the buffer with, for the
 * `relatedPrimed` condition — deliberately *not* the target itself.
 *
 * Picked deterministically (first in sorted order) rather than at random, so
 * two runs of the benchmark on an unchanged vault produce identical numbers.
 * A benchmark whose output moves on its own cannot be used to judge a change.
 */
export function relatedNoteFor(
  target: string,
  edges: Record<string, string[]>,
): string | null {
  const neighbours = (edges[target] ?? []).filter((path) => path !== target);
  if (neighbours.length === 0) return null;
  return [...neighbours].sort()[0];
}

function bufferFor(
  condition: BenchmarkCondition,
  target: string,
  related: string | null,
): { buffer: SessionBuffer; primedWith: string | null } {
  const buffer = new SessionBuffer();
  if (condition === "targetPrimed") {
    buffer.touch(target);
    return { buffer, primedWith: target };
  }
  if (condition === "relatedPrimed" && related) {
    buffer.touch(related);
    return { buffer, primedWith: related };
  }
  return { buffer, primedWith: null };
}

function rankOf(paths: string[], target: string): number | null {
  const index = paths.indexOf(target);
  return index === -1 ? null : index + 1;
}

/**
 * Runs every query in all three priming conditions plus the plain-search
 * baseline, and reports MRR and rank-1 for each.
 */
export async function runBenchmark(
  vaultPath: string,
  vaultDataDir: string,
  queries: BenchmarkQuery[],
  opts: BenchmarkOptions = {},
): Promise<BenchmarkReport> {
  const { topK = DEFAULT_BENCHMARK_TOP_K, recallOptions = {}, onProgress, now = new Date() } = opts;

  const structural = await loadStructuralIndex(vaultDataDir);
  const edges = structural?.edges ?? {};

  const byCondition: Record<BenchmarkCondition, QueryOutcome[]> = {
    unprimed: [],
    relatedPrimed: [],
    targetPrimed: [],
  };
  const plainSearchOutcomes: QueryOutcome[] = [];
  const lexicalOnlyOutcomes: QueryOutcome[] = [];

  let done = 0;
  for (const entry of queries) {
    const related = relatedNoteFor(entry.target, edges);

    for (const condition of BENCHMARK_CONDITIONS) {
      const { buffer, primedWith } = bufferFor(condition, entry.target, related);
      const result = await recall(vaultPath, vaultDataDir, entry.query, {
        ...recallOptions,
        topK,
        sessionBuffer: buffer,
        now,
      });
      byCondition[condition].push({
        query: entry.query,
        target: entry.target,
        label: entry.label,
        rank: rankOf(
          result.hits.map((hit) => hit.path),
          entry.target,
        ),
        primedWith,
      });
    }

    const hits = await searchNotes(vaultPath, entry.query, { topK, vaultDataDir });
    plainSearchOutcomes.push({
      query: entry.query,
      target: entry.target,
      label: entry.label,
      rank: rankOf(
        hits.map((hit) => hit.path),
        entry.target,
      ),
    });

    // Pure BM25: the same retrieval path with every one of the engine's own
    // layers disabled, so the difference against `unprimed` is attributable
    // to those layers and to nothing else — not to a different tokenizer, a
    // different index, or a different candidate cap.
    const lexical = await recall(vaultPath, vaultDataDir, entry.query, {
      ...recallOptions,
      topK,
      sessionBuffer: new SessionBuffer(),
      graphWeight: 0,
      termWeight: 0,
      semanticWeight: 0,
      now,
    });
    lexicalOnlyOutcomes.push({
      query: entry.query,
      target: entry.target,
      label: entry.label,
      rank: rankOf(
        lexical.hits.map((hit) => hit.path),
        entry.target,
      ),
    });

    onProgress?.(++done, queries.length);
  }

  return {
    vaultPath,
    ranAt: now.toISOString(),
    queryCount: queries.length,
    topK,
    conditions: {
      unprimed: metricsFrom("unprimed", byCondition.unprimed),
      relatedPrimed: metricsFrom("relatedPrimed", byCondition.relatedPrimed),
      targetPrimed: metricsFrom("targetPrimed", byCondition.targetPrimed),
    },
    baselines: {
      lexicalOnly: metricsFrom("lexicalOnly", lexicalOnlyOutcomes),
      plainSearch: metricsFrom("plainSearch", plainSearchOutcomes),
    },
  };
}

/** One aligned line per condition, for a terminal or a PLAN entry. */
export function formatBenchmarkReport(report: BenchmarkReport): string {
  const rows: ConditionMetrics[] = [
    report.conditions.unprimed,
    report.conditions.relatedPrimed,
    report.conditions.targetPrimed,
    report.baselines.lexicalOnly,
    report.baselines.plainSearch,
  ];
  const lines = [
    `${report.queryCount} queries, top-${report.topK}, ${report.vaultPath}`,
    "",
    "condition        MRR     rank-1    found    mean rank (found)",
    "-".repeat(62),
  ];
  for (const row of rows) {
    const meanRank = row.meanRankOfFound === null ? "  —  " : row.meanRankOfFound.toFixed(2).padStart(5);
    lines.push(
      `${row.condition.padEnd(16)}${row.mrr.toFixed(3).padStart(5)}   ` +
        `${String(row.rank1).padStart(3)}/${row.queryCount}   ` +
        `${String(row.found).padStart(3)}/${row.queryCount}    ${meanRank}`,
    );
  }
  return lines.join("\n");
}
