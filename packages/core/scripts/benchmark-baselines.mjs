#!/usr/bin/env node
// AIBRAIN-67: does the engine actually beat free, naive alternatives?
// Reuses AIBRAIN-31's 18-query ground-truth set (see eval-retrieval.mjs)
// and runs three retrieval strategies per query:
//
//   1. engine         — full activate() with all mechanisms on (the product)
//   2. structuralOnly — activate() with priming/importance/consolidation
//                       disabled, structuralFallback left on — i.e. "plain
//                       wikilink graph traversal, no smart weighting," the
//                       honest stand-in for what Obsidian's own graph view
//                       gives you for free
//   3. grep           — searchNotes() with useWeights:false, a substring
//                       match over title/alias/body with no relevance
//                       ranking — the honest stand-in for a naive full-text
//                       search tool
//
// A fourth strategy, semantic-embedding search, is deliberately not
// implemented here — it needs an embeddings-capable API call (real cost,
// real dependency), scoped as a separate fast-follow rather than silently
// left out of the report. CAG (context-stuffing) isn't a ranking algorithm
// to benchmark per-query; its comparison is the corpus-size-vs-context-
// window arithmetic printed at the end instead.
//
// Read-only against the live vault — no writes to link-weights.json,
// session buffers, or note content.

import {
  activate,
  runAblationComparison,
  resolveDataDir,
  SessionBuffer,
  searchNotes,
  listNotes,
  readNote,
} from "../dist/index.js";

const vaultPath = process.argv[2] ?? process.env.CLAUDE_VAULT_PATH;
if (!vaultPath) {
  console.error("Usage: node benchmark-baselines.mjs <vaultPath>  (or set CLAUDE_VAULT_PATH)");
  process.exit(1);
}
const vaultDataDir = resolveDataDir(vaultPath);

// Same 18 (origin, target) pairs as eval-retrieval.mjs's QUERIES — kept in
// sync by hand since this script answers a different question (baseline
// comparison, not layer ablation) but must stay comparable to those
// results. `label` doubles as the free-text query fed to the grep
// baseline — "what you'd actually type into search to find this."
const QUERIES = [
  { origin: "MOCs/VaultNeuralLinks", target: "Notes/VaultNeuralLinks/Vault Neural Links Project", label: "decay half-life decision" },
  { origin: "MOCs/VaultNeuralLinks", target: "Notes/VaultNeuralLinks/Nightly Pipeline Scheduling Decision", label: "nightly pipeline scheduling" },
  { origin: "MOCs/VaultNeuralLinks", target: "Notes/VaultNeuralLinks/Cluster-Grouped Radial Star Layout by Importance", label: "radial star layout" },
  { origin: "MOCs/VaultNeuralLinks", target: "Notes/VaultNeuralLinks/Harness Tool Routing Hard Rules", label: "harness tool routing rules" },
  { origin: "MOCs/VaultNeuralLinks", target: "Notes/VaultNeuralLinks/Vault Global Hook Architecture", label: "global hook architecture" },
  { origin: "MOCs/VaultNeuralLinks", target: "Notes/VaultNeuralLinks/Case Study - Mechanism to Cognitive-Science Mapping", label: "cognitive-science mapping case study" },
  { origin: "MOCs/VaultNeuralLinks", target: "Notes/VaultNeuralLinks/Phase 7 Literature Review - Mechanism Grounding and Candidate Screening", label: "literature review candidate screening" },
  { origin: "MOCs/AML", target: "02-Projects PPS/Bulstrad/AML/Features/2026-07-19 - LexisNexis Screening Integration Plan", label: "LexisNexis screening integration plan" },
  { origin: "MOCs/bunit2", target: "02-Projects PPS/Bulstrad/Bunit2/Bugs/2026-07-09 - Broken-pipe log spam and AML PII leak", label: "broken-pipe log spam bug" },
  { origin: "MOCs/bunit2", target: "02-Projects PPS/Bulstrad/Bunit2/Analysis/2026-07-16 - payment_plan Double Generation Contract 12478", label: "payment_plan double generation" },
  { origin: "MOCs/InvoiceFlow", target: "01-Personal/Business/BrainSpace/InvoiceFlow/Analysis/2026-07-05 - Auth Extraction In-Process Proof of Concept", label: "auth extraction PoC" },
  { origin: "MOCs/InvoiceFlow", target: "01-Personal/Business/BrainSpace/InvoiceFlow/Features/2026-07-08 - PLAT-6 YARP Gateway + PLAT-15 Frontend Cutover", label: "YARP gateway cutover" },
  { origin: "MOCs/IFRS17", target: "02-Projects PPS/Bulstrad/IFRS17/Analysis/2026-07-15 - Persistence Architecture Decisions", label: "IFRS17 persistence architecture" },
  { origin: "MOCs/IFRS17", target: "02-Projects PPS/Bulstrad/IFRS17/Analysis/2026-07-16 - Gate and Check Architecture", label: "IFRS17 gate and check architecture" },
  { origin: "MOCs/General", target: "Notes/General/Windows Find and Kill Process by Port", label: "kill process by port" },
  { origin: "MOCs/General", target: "Notes/General/YARP Load Balancing Strategies", label: "YARP load balancing strategies" },
  { origin: "MOCs/Medex", target: "02-Projects PPS/Bulstrad/Medex/Medex Jasper File Strategy", label: "Medex Jasper file strategy" },
  { origin: "MOCs/General", target: "Notes/General/Ronnie Coleman 6-Day Workout Split", label: "(distractor) workout split — should not be boosted by any work-context mechanism" },
];

const ENERGY = 10;
const GREP_TOP_K = 50; // generous — a naive grep tool has no relevance ranking, so the target may legitimately land far down an unranked list

function rankOf(list, target) {
  const idx = list.findIndex((n) => n.path === target);
  return idx === -1 ? null : idx + 1;
}

function summarize(method, rows) {
  const ranks = rows.map((r) => r.perMethod[method]).filter((r) => r !== null);
  const found = ranks.length;
  const rankOne = ranks.filter((r) => r === 1).length;
  const meanRank = found > 0 ? ranks.reduce((a, b) => a + b, 0) / found : null;
  return { method, found, total: rows.length, rankOne, meanRank };
}

async function main() {
  const rows = [];

  for (const q of QUERIES) {
    const sessionBuffer = new SessionBuffer();
    sessionBuffer.touch(q.target);

    const engineResult = await activate(vaultDataDir, q.origin, ENERGY, undefined, vaultPath, sessionBuffer);
    const structuralResult = await runAblationComparison(
      vaultDataDir,
      q.origin,
      ENERGY,
      { priming: false, importance: false, consolidation: false },
      undefined,
      vaultPath,
      sessionBuffer,
    );
    const grepHits = await searchNotes(vaultPath, q.label, { topK: GREP_TOP_K, vaultDataDir, useWeights: false });

    rows.push({
      label: q.label,
      origin: q.origin,
      target: q.target,
      perMethod: {
        engine: rankOf(engineResult, q.target),
        structuralOnly: rankOf(structuralResult.ablated, q.target),
        grep: rankOf(
          grepHits.map((h) => ({ path: h.path })),
          q.target,
        ),
      },
    });
  }

  const methods = ["engine", "structuralOnly", "grep"];
  const summaries = methods.map((m) => summarize(m, rows));

  // Corpus-size-vs-context-window arithmetic for the CAG comparison — not a
  // per-query ranking run, just the architectural fact that determines
  // whether "stuff the whole vault in context" is even viable.
  const notePaths = await listNotes(vaultPath);
  let totalChars = 0;
  for (const path of notePaths) {
    const note = await readNote(vaultPath, path);
    if (note) totalChars += note.body.length;
  }
  const estimatedTokens = Math.round(totalChars / 4); // rough chars-per-token heuristic

  console.log(
    JSON.stringify(
      {
        queryCount: rows.length,
        summaries,
        rows,
        corpus: {
          noteCount: notePaths.length,
          totalChars,
          estimatedTokens,
        },
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
