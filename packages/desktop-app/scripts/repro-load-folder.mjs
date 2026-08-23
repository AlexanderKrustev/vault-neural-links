#!/usr/bin/env node
// Reproduces main.ts's workspace:load-folder handler body exactly
// (createAdapter -> listNodes -> buildStructuralIndex -> rebuildStructuralIndex
// -> summarize), headless, to isolate where a crash/hang happens without
// needing the Electron GUI. See AIBRAIN-118/AIBRAIN-63 Jira threads.
import { createOkfAdapter, buildStructuralIndex, rebuildStructuralIndex, resolveDataDir } from "@vault-neural-links/core";

// Usage: node scripts/repro-load-folder.mjs <folderPath>
//   Generate a synthetic corpus first if you don't have one:
//   node scripts/generate-sample-corpus.mjs 300000
const folder = process.argv[2];
if (!folder) {
  console.error("Usage: node scripts/repro-load-folder.mjs <folderPath>");
  process.exit(1);
}

function summarize(folderPath, index, noteIds) {
  const notes = noteIds
    .map((id) => ({ id, neighborCount: index.edges[id]?.length ?? 0 }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edgeCount = Object.values(index.edges).reduce((sum, n) => sum + n.length, 0) / 2;
  const seen = new Set();
  const edges = [];
  for (const [source, neighbors] of Object.entries(index.edges)) {
    for (const target of neighbors) {
      const key = source < target ? `${source}|${target}` : `${target}|${source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ source, target });
    }
  }
  return { folderPath, noteCount: noteIds.length, edgeCount, notes, edges };
}

const t0 = Date.now();
const adapter = createOkfAdapter(folder);
const nodes = await adapter.listNodes();
console.log(`listNodes: ${nodes.length} in ${Date.now() - t0}ms, rss=${Math.round(process.memoryUsage().rss / 1048576)}MB`);

const t1 = Date.now();
const index = await buildStructuralIndex(folder, adapter);
console.log(`buildStructuralIndex #1: ${Date.now() - t1}ms, rss=${Math.round(process.memoryUsage().rss / 1048576)}MB`);

const t2 = Date.now();
await rebuildStructuralIndex(folder, resolveDataDir(folder), adapter, index);
console.log(`rebuildStructuralIndex (index reused, disk write only): ${Date.now() - t2}ms, rss=${Math.round(process.memoryUsage().rss / 1048576)}MB`);

const t3 = Date.now();
const summary = summarize(folder, index, nodes.map((n) => n.id));
console.log(`summarize: ${Date.now() - t3}ms, rss=${Math.round(process.memoryUsage().rss / 1048576)}MB`);
console.log(`notes=${summary.notes.length} edges=${summary.edges.length}`);

const t4 = Date.now();
const serialized = JSON.stringify(summary);
console.log(`JSON.stringify(summary) [approximates IPC structured-clone cost]: ${Date.now() - t4}ms, size=${Math.round(serialized.length / 1048576)}MB`);

console.log(`total: ${Date.now() - t0}ms, peak rss so far=${Math.round(process.memoryUsage().rss / 1048576)}MB`);
