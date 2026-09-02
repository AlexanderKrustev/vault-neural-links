#!/usr/bin/env node
// Reproduces main.ts's engine:search handler body (searchNotes with
// vaultDataDir/useWeights set, same as the desktop app), headless, to time
// AIBRAIN-133's content-scan batching fix without needing the Electron GUI.
// See scripts/repro-load-folder.mjs for the equivalent for folder loading.
import { searchNotes, resolveDataDir } from "@vault-neural-links/core";

// Usage: node scripts/repro-search.mjs <folderPath> <query>
const folder = process.argv[2];
const query = process.argv[3];
if (!folder || !query) {
  console.error("Usage: node scripts/repro-search.mjs <folderPath> <query>");
  process.exit(1);
}

const t0 = Date.now();
const hits = await searchNotes(folder, query, { vaultDataDir: resolveDataDir(folder), useWeights: true, topK: 10 });
console.log(`searchNotes("${query}"): ${Date.now() - t0}ms, rss=${Math.round(process.memoryUsage().rss / 1048576)}MB`);
console.log(`topHits=${hits.length}`);
for (const hit of hits) console.log(`  ${hit.matched.padEnd(8)} ${hit.path} weight=${hit.weight ?? "n/a"}`);
