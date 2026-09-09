#!/usr/bin/env node
// VNL-051: builds (or refreshes) the optional semantic index on demand.
//
// The nightly pipeline does this too, but it runs inside Obsidian on the
// main thread, and a first full build is minutes of CPU for a real vault —
// several orders of magnitude past the per-run cost of anything else in that
// pipeline (see VNL-033). So the first build belongs out of process, and a
// headless setup needs a way to do it at all.
//
// Idempotent and incremental: notes whose text hasn't changed keep the
// vector they already have, so re-running this after editing a handful of
// notes costs a handful of embeddings, not a whole vault.
import {
  createObsidianAdapter,
  loadEmbeddings,
  loadTransformersProvider,
  rebuildEmbeddings,
  resolveDataDir,
} from "../dist/index.js";

const vaultPath = process.argv[2];
if (!vaultPath) {
  console.error("usage: vnl-embed <vault-path>");
  console.error("");
  console.error("Requires the optional peer dependency:");
  console.error("  npm install @huggingface/transformers");
  process.exit(1);
}

const vaultDataDir = resolveDataDir(vaultPath);

console.log("loading model (first run downloads ~23 MB, once)...");
const modelStart = Date.now();
const provider = await loadTransformersProvider();
if (!provider) {
  console.error("");
  console.error("Could not load @huggingface/transformers.");
  console.error("Install it next to this package and try again:");
  console.error("  npm install @huggingface/transformers");
  process.exit(1);
}
console.log(`model ready in ${((Date.now() - modelStart) / 1000).toFixed(1)}s`);

const existing = await loadEmbeddings(vaultDataDir);
if (existing) {
  console.log(`existing index: ${Object.keys(existing.notes).length} notes, model ${existing.model}`);
}

const nodes = await createObsidianAdapter(vaultPath).listNodes();
console.log(`scanning ${nodes.length} notes...`);

const start = Date.now();
let lastReport = 0;
const result = await rebuildEmbeddings(vaultDataDir, nodes, provider, {
  existing,
  onProgress: (embedded, total) => {
    // Throttled to once a second: a per-batch line is noise on a vault
    // large enough for the progress to matter.
    if (Date.now() - lastReport < 1000 && embedded < total) return;
    lastReport = Date.now();
    const elapsed = (Date.now() - start) / 1000;
    const rate = embedded / Math.max(elapsed, 0.001);
    const remaining = (total - embedded) / Math.max(rate, 0.001);
    process.stdout.write(
      `  embedded ${embedded}/${total} (${rate.toFixed(1)}/s, ~${remaining.toFixed(0)}s left)\r`,
    );
  },
});

const seconds = (Date.now() - start) / 1000;
process.stdout.write("\n");
console.log(
  `semantic index: ${result.noteCount} notes (${result.embeddedCount} embedded this run) ` +
    `with ${result.model} in ${seconds.toFixed(1)}s, at ${result.builtAt}`,
);
if (result.embeddedCount === 0) {
  console.log("nothing changed since the last run.");
}
