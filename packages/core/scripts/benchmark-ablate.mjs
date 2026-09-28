#!/usr/bin/env node
// 2026-09-28 — axis decomposition + usage-removed variant on the VNL-020 query set, cold only.
// Frozen snapshots only (copy .vault-neural-links; for the usage-removed copy omit link-weights.json and term-weights.json):
//   node scripts/benchmark-ablate.mjs <vaultPath> <queries.json> <snapshotDir> <snapshotWithoutUsageDir> <out.json>
import { readFile, writeFile } from "node:fs/promises";
import { runBenchmark } from "../dist/index.js";

const [vault, queriesPath, snap, snapNoUsage, out] = process.argv.slice(2);
const queries = JSON.parse(await readFile(queriesPath, "utf8"));
const now = new Date("2026-09-28T12:00:00Z");

const variants = [
  ["full (as served)", snap, {}],
  ["no graph axis", snap, { graphWeight: 0 }],
  ["no term axis", snap, { termWeight: 0 }],
  ["no semantic axis", snap, { semanticWeight: 0 }],
  ["usage history removed", snapNoUsage, {}],
  ["usage removed, no graph", snapNoUsage, { graphWeight: 0 }],
];

const rows = [];
const perQuery = {};
for (const [name, dir, recallOptions] of variants) {
  const r = await runBenchmark(vault, dir, queries, { recallOptions, now });
  const c = r.conditions.unprimed;
  const byLabel = {};
  for (const o of c.outcomes) {
    const l = o.label ?? "none";
    byLabel[l] ??= { n: 0, rr: 0, r1: 0 };
    byLabel[l].n++; byLabel[l].rr += o.rank ? 1 / o.rank : 0; if (o.rank === 1) byLabel[l].r1++;
  }
  for (const l of Object.keys(byLabel)) byLabel[l].mrr = +(byLabel[l].rr / byLabel[l].n).toFixed(4);
  rows.push({ name, mrr: +c.mrr.toFixed(4), rank1: c.outcomes.filter((o) => o.rank === 1).length, found: c.outcomes.filter((o) => o.rank !== null).length, byLabel, lexical: +r.baselines.lexicalOnly.mrr.toFixed(4) });
  perQuery[name] = c.outcomes.map((o) => o.rank);
  console.error(`${name}: ${c.mrr.toFixed(4)}`);
}
// per-query diff between full and usage-removed
const diffs = queries.map((q, i) => ({ q: q.query, full: perQuery["full (as served)"][i], noUsage: perQuery["usage history removed"][i], noGraph: perQuery["no graph axis"][i] }))
  .filter((d) => d.full !== d.noUsage || d.full !== d.noGraph);
await writeFile(out, JSON.stringify({ rows, diffs }, null, 2));
console.log(JSON.stringify({ rows, diffs }, null, 2));
