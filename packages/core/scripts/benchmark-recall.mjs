#!/usr/bin/env node
// VNL-020 — the real-vault tier of the retrieval benchmark.
//
// The CI tier (test/benchmark.test.ts, against the checked-in fixture vault)
// answers "did this change break something". This answers "does the engine
// actually work on real notes", which no fixture can, and it is the only
// tier whose numbers may be quoted anywhere per D5/D6.
//
// Read-only: no events logged, no weights written, no session files. Safe to
// run against a live vault as often as you like.
//
//   node scripts/benchmark-recall.mjs <vaultPath> <queries.json> [--json out.json]
//
// The query set is a JSON array of { query, target, label? }. It is written
// once, reviewed by a human, and then reused unchanged — a benchmark whose
// questions move cannot measure a change in the engine.
import { readFile, writeFile } from "node:fs/promises";
import {
  formatBenchmarkReport,
  getSharedEmbeddingProvider,
  loadContentIndex,
  loadEmbeddings,
  loadStructuralIndex,
  resolveDataDir,
  runBenchmark,
} from "../dist/index.js";

const [vaultPath, queriesPath] = process.argv.slice(2);
const jsonFlag = process.argv.indexOf("--json");
const jsonOut = jsonFlag !== -1 ? process.argv[jsonFlag + 1] : null;
const dataDirFlag = process.argv.indexOf("--data-dir");
const dataDirOverride = dataDirFlag !== -1 ? process.argv[dataDirFlag + 1] : null;

if (!vaultPath || !queriesPath) {
  console.error("usage: benchmark-recall <vaultPath> <queries.json> [--json out.json] [--data-dir <dir>]");
  process.exit(1);
}

// `--data-dir` exists so a vault can be measured without writing indexes
// into it — the fixture vault is checked into the repo and must stay clean.
const vaultDataDir = dataDirOverride ?? resolveDataDir(vaultPath);
const queries = JSON.parse(await readFile(queriesPath, "utf8"));
if (!Array.isArray(queries) || queries.length === 0) {
  console.error("query set must be a non-empty JSON array of { query, target }");
  process.exit(1);
}

// Refuse to produce numbers from a vault that was never indexed. Without a
// content index `recall` falls back to a plain scan, so every condition and
// the baseline collapse onto the same result — which still prints as a
// clean-looking table, and is exactly the sort of figure that gets quoted
// later as a measurement. Better to stop.
const contentIndex = await loadContentIndex(vaultDataDir);
if (!contentIndex) {
  console.error(`No content index in ${vaultDataDir}.`);
  console.error("");
  console.error("Without it recall degrades to a full scan and every condition returns the");
  console.error("same thing, so the numbers would mean nothing. Build the indexes first:");
  console.error("  node bin/vnl-nightly.js <vaultPath>");
  process.exit(1);
}
const structural = await loadStructuralIndex(vaultDataDir);
if (!structural) {
  console.error(`No structural index in ${vaultDataDir} — the graph phase would have no edges.`);
  console.error("Run: node bin/vnl-nightly.js <vaultPath>");
  process.exit(1);
}

// Say up front which mechanisms are actually in play, so a number can never
// be read as coming from a configuration it did not come from.
const embeddings = await loadEmbeddings(vaultDataDir);
const provider = embeddings ? await getSharedEmbeddingProvider() : null;
const semantic = embeddings && provider && provider.model === embeddings.model;
console.log(`vault:      ${vaultPath}`);
console.log(`data dir:   ${vaultDataDir}`);
console.log(`indexed:    ${contentIndex.coveredPaths.length} notes, ${Object.keys(structural.edges).length} with links`);
console.log(`queries:    ${queries.length}`);
console.log(`semantic:   ${semantic ? `on (${embeddings.model}, ${Object.keys(embeddings.notes).length} notes)` : "off"}`);
console.log("");

const start = Date.now();
const report = await runBenchmark(vaultPath, vaultDataDir, queries, {
  onProgress: (done, total) => {
    process.stdout.write(`  ${done}/${total} queries\r`);
  },
});
process.stdout.write("\n\n");

console.log(formatBenchmarkReport(report));
console.log("");

// The gate this benchmark exists to judge (docs/PLAN.md, Phase 2b).
const cold = report.conditions.unprimed;
const lexical = report.baselines.lexicalOnly;
const gate = cold.mrr > lexical.mrr;
console.log(
  `Phase 2b exit gate — recall beats pure BM25 on MRR, cold: ` +
    `${gate ? "PASS" : "FAIL"} (${cold.mrr.toFixed(3)} vs ${lexical.mrr.toFixed(3)})`,
);

// The claim the project's headline rests on: that priming is not doing all
// the work. If cold retrieval collapses relative to the target-primed
// condition, the engine is measuring its own session buffer.
const primed = report.conditions.targetPrimed;
console.log(
  `Priming dependence — targetPrimed MRR ${primed.mrr.toFixed(3)} vs unprimed ${cold.mrr.toFixed(3)} ` +
    `(ratio ${(cold.mrr / Math.max(primed.mrr, 1e-9)).toFixed(2)}; near 0 means the old benchmark's problem)`,
);

const worst = [...cold.outcomes]
  .filter((outcome) => outcome.rank === null || outcome.rank > 5)
  .slice(0, 10);
if (worst.length > 0) {
  console.log(`\nWorst cold results (${worst.length} shown) — where to look next:`);
  for (const outcome of worst) {
    console.log(`  ${outcome.rank === null ? "not found" : `rank ${outcome.rank}`.padEnd(9)}  "${outcome.query}" -> ${outcome.target}`);
  }
}

if (jsonOut) {
  await writeFile(jsonOut, JSON.stringify(report, null, 2), "utf8");
  console.log(`\nfull report written to ${jsonOut}`);
}

console.log(`\ncompleted in ${((Date.now() - start) / 1000).toFixed(1)}s`);
