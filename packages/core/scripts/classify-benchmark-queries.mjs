#!/usr/bin/env node
// VNL-067 — assign each benchmark query a question type.
//
// One type is decided by measurement, not judgement: `vocabulary-mismatch`
// means keyword search (BM25, every other axis off, no candidate cap) gives
// the target a score of exactly zero — the lexical phase cannot see it at all.
// `temporal` and `multi-hop` need a reader's judgement and come from the
// query file itself (a `type` already set there is kept). Everything else is
// `single-hop`.
//
// Precedence when two apply: a type set by hand wins, then vocabulary-mismatch.
//
//   node scripts/classify-benchmark-queries.mjs <vaultPath> <queries.json> [--write] [--data-dir <dir>]
//
// Without --write it only prints the proposed types.
import { readFile, writeFile } from "node:fs/promises";
import { recall, resolveDataDir } from "../dist/index.js";

const [vaultPath, queriesPath] = process.argv.slice(2);
const write = process.argv.includes("--write");
const dataDirFlag = process.argv.indexOf("--data-dir");
const dataDir = dataDirFlag !== -1 ? process.argv[dataDirFlag + 1] : resolveDataDir(vaultPath);
if (!vaultPath || !queriesPath) {
  console.error("usage: classify-benchmark-queries <vaultPath> <queries.json> [--write] [--data-dir <dir>]");
  process.exit(1);
}

const queries = JSON.parse(await readFile(queriesPath, "utf8"));
const counts = {};
for (const entry of queries) {
  const lexical = await recall(vaultPath, dataDir, entry.query, {
    topK: 100_000,
    candidateCap: 100_000,
    graphWeight: 0,
    termWeight: 0,
    semanticWeight: 0,
    embeddings: false,
    outcome: false,
  });
  const lexicallyVisible = lexical.hits.some((hit) => hit.path === entry.target && hit.why.lexicalScore > 0);
  const judged = entry.type && entry.type !== "single-hop" && entry.type !== "vocabulary-mismatch" ? entry.type : undefined;
  entry.type = judged ?? (lexicallyVisible ? "single-hop" : "vocabulary-mismatch");
  counts[entry.type] = (counts[entry.type] ?? 0) + 1;
  console.log(`${entry.type.padEnd(20)} ${entry.query}`);
}
console.log("\n" + JSON.stringify(counts));

if (write) {
  await writeFile(queriesPath, JSON.stringify(queries, null, 2) + "\n", "utf8");
  console.log(`types written to ${queriesPath}`);
}
