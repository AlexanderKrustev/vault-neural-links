#!/usr/bin/env node
// AIBRAIN-31: controlled evaluation of retrieval quality per ablation layer,
// run against the real vault (read-only — no writes to link-weights.json,
// session buffers, or note content).
//
// Ground-truth query set is the 18-item set reviewed and approved by the
// user in the AIBRAIN-31 Jira ticket / this repo's chat history — see
// Notes/VaultNeuralLinks/AIBRAIN-31 Ablation Evaluation Results.md in the
// vault for the write-up this script's output feeds.

import { activate, runAblationComparison, resolveDataDir, SessionBuffer } from "../dist/index.js";

const vaultPath = process.argv[2] ?? process.env.CLAUDE_VAULT_PATH;
if (!vaultPath) {
  console.error("Usage: node eval-retrieval.mjs <vaultPath>  (or set CLAUDE_VAULT_PATH)");
  process.exit(1);
}
const vaultDataDir = resolveDataDir(vaultPath);

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

const LAYERS = ["priming", "importance", "consolidation", "structuralFallback"];
const ENERGY = 10;

function rankOf(list, target) {
  const idx = list.findIndex((n) => n.path === target);
  return idx === -1 ? null : idx + 1;
}
function energyOf(list, target) {
  return list.find((n) => n.path === target)?.energy ?? null;
}

async function main() {
  const rows = [];
  for (const q of QUERIES) {
    // Simulates "you already read the target note earlier this session" —
    // the concrete scenario SessionBuffer/primingBonus is designed to
    // detect. Without seeding the buffer this way, priming has literally
    // nothing to ablate (its bonus only ever applies to notes the buffer
    // has been touched with), so a "no effect" result would be a
    // test-setup artifact, not a real finding.
    const sessionBuffer = new SessionBuffer();
    sessionBuffer.touch(q.target);

    const baseline = await activate(vaultDataDir, q.origin, ENERGY, undefined, vaultPath, sessionBuffer);
    const baseRank = rankOf(baseline, q.target);
    const baseEnergy = energyOf(baseline, q.target);

    const perLayer = {};
    for (const layer of LAYERS) {
      const result = await runAblationComparison(vaultDataDir, q.origin, ENERGY, { [layer]: false }, undefined, vaultPath, sessionBuffer);
      const ablatedRank = rankOf(result.ablated, q.target);
      const ablatedEnergy = energyOf(result.ablated, q.target);
      perLayer[layer] = { ablatedRank, ablatedEnergy, diffStatus: result.diff.find((d) => d.path === q.target)?.status ?? "unchanged" };
    }

    rows.push({ ...q, baseRank, baseEnergy, connected: baseline.length > 0, perLayer });
  }
  console.log(JSON.stringify(rows, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
