#!/usr/bin/env node
// AIBRAIN-118 groundwork: times the exact two calls workspace:load-folder
// (main.ts) runs before the desktop app ever touches the graph —
// listNodes() and buildStructuralIndex() — against a folder of any size.
// Written after a manual 300k-note at-scale check surfaced a real bug:
// both adapters' listNodes() read notes one at a time in a plain
// sequential loop, which hadn't finished after 30+ minutes at 300k notes
// (see packages/core/src/adapters.ts's readNodesInBatches doc comment for
// the fix). Kept as a standing diagnostic for future at-scale checks
// rather than a one-off throwaway script.
//
// Usage: node scripts/time-structural-index.mjs <folderPath>
//   Generate a synthetic corpus first if you don't have one:
//   node scripts/generate-sample-corpus.mjs 300000

import { createOkfAdapter, buildStructuralIndex } from "@vault-neural-links/core";

const folder = process.argv[2];
if (!folder) {
  console.error("Usage: node scripts/time-structural-index.mjs <folderPath>");
  process.exit(1);
}

const t0 = Date.now();
const adapter = createOkfAdapter(folder);
const nodes = await adapter.listNodes();
const t1 = Date.now();
console.log(`listNodes(): ${nodes.length} notes in ${t1 - t0}ms`);

const index = await buildStructuralIndex(folder, adapter);
const t2 = Date.now();
const edgeCount = Object.values(index.edges).reduce((sum, n) => sum + n.length, 0) / 2;
console.log(`buildStructuralIndex(): ${edgeCount} edges in ${t2 - t1}ms`);
console.log(`total: ${t2 - t0}ms`);
