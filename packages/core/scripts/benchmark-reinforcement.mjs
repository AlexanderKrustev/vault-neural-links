#!/usr/bin/env node
// AIBRAIN-66 fast-follow: does Hebbian reinforcement (reinforce_link +
// traversal weight, folded into link-weights.json by compaction) actually
// contribute anything on top of the static structural/importance layers
// AIBRAIN-67 already validated?
//
// AIBRAIN-67's "structuralOnly" baseline disabled priming/importance/
// consolidation but did NOT disable the usage tier itself — query.ts's
// computeLiveNeighborWeights reads link-weights.json's accumulated
// baseStrength unconditionally, regardless of ablation layers (there is no
// AblationLayers toggle for it at all). So AIBRAIN-67 never actually
// measured a true "zero usage history" condition; both its "engine" and
// "structuralOnly" rows already included whatever real accumulated usage
// weight happens to exist in the live vault's link-weights.json. This
// script fills that gap with three conditions instead of two:
//
//   1. asIs                   — real link-weights.json as it exists today
//                                (whatever historical usage happens to be
//                                baked in) + full engine. Matches
//                                AIBRAIN-67's "engine" row for continuity.
//   2. zeroUsage               — full engine (priming/importance/
//                                structuralFallback on), but link-weights.json
//                                entirely absent — a scratch data dir with
//                                only structural-links.json + note-importance.json
//                                copied in, no usage tier at all. Isolates
//                                what accumulated usage currently
//                                contributes on top of pure structure.
//   3. simulatedReinforcement  — starts from the same zero-usage scratch
//                                dir, then injects a synthetic but modest
//                                usage history (one traversal + two explicit
//                                reinforce_link calls, spread over ~10
//                                simulated days so decay applies) for each
//                                ground-truth (origin, target) pair,
//                                compacts it into link-weights.json, then
//                                re-measures. Isolates the marginal value
//                                reinforcement WOULD add if it were actually
//                                used as designed — the decision-delegation
//                                audit found reinforce_link has ~0 real
//                                invocations in practice, so "as designed"
//                                usage has never really happened yet.
//
// Never writes to the real vault's .vault-neural-links dir — all scratch
// dirs live under node:os tmpdir() and are removed after the run.

import { mkdtemp, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activate, resolveDataDir, SessionBuffer, appendEvent, compact } from "../dist/index.js";

const vaultPath = process.argv[2] ?? process.env.CLAUDE_VAULT_PATH;
if (!vaultPath) {
  console.error("Usage: node benchmark-reinforcement.mjs <vaultPath>  (or set CLAUDE_VAULT_PATH)");
  process.exit(1);
}
const realDataDir = resolveDataDir(vaultPath);

// Same 18 (origin, target) pairs as eval-retrieval.mjs / benchmark-baselines.mjs
// — kept in sync by hand so results stay comparable across all three scripts.
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

async function makeZeroUsageDataDir() {
  const dir = await mkdtemp(join(tmpdir(), "vnl-bench-zero-"));
  for (const file of ["structural-links.json", "note-importance.json"]) {
    await cp(join(realDataDir, file), join(dir, file)).catch((err) => {
      if (err.code !== "ENOENT") throw err;
    });
  }
  return dir;
}

/**
 * Copies the zero-usage scratch dir, then appends a modest synthetic usage
 * history for one (origin, target) pair and compacts it into
 * link-weights.json. "Modest" deliberately, not maxed-out — one traversal
 * plus two explicit reinforce_link calls a few days apart, roughly what a
 * user who found this note genuinely useful a couple of times would
 * produce, not an artificial worst/best case.
 */
async function makeSimulatedReinforcementDataDir(zeroUsageDir, origin, target) {
  const dir = await mkdtemp(join(tmpdir(), "vnl-bench-reinforce-"));
  await cp(zeroUsageDir, dir, { recursive: true });

  const instanceId = "benchmark-simulated-user";
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const events = [
    { offsetDays: 9, type: "traverse", weight_delta: 1, trigger: "read" },
    { offsetDays: 6, type: "reinforce", weight_delta: 5, trigger: "explicit" },
    { offsetDays: 2, type: "reinforce", weight_delta: 5, trigger: "explicit" },
  ];
  for (const e of events) {
    await appendEvent(dir, instanceId, {
      ts: new Date(now - e.offsetDays * dayMs).toISOString(),
      instance: instanceId,
      type: e.type,
      from: origin,
      to: target,
      weight_delta: e.weight_delta,
      trigger: e.trigger,
    });
  }
  await compact(dir);
  return dir;
}

async function main() {
  const zeroUsageDir = await makeZeroUsageDataDir();
  const scratchDirs = [zeroUsageDir];
  const rows = [];

  try {
    for (const q of QUERIES) {
      const simDir = await makeSimulatedReinforcementDataDir(zeroUsageDir, q.origin, q.target);
      scratchDirs.push(simDir);

      const asIsBuffer = new SessionBuffer();
      asIsBuffer.touch(q.target);
      const asIs = await activate(realDataDir, q.origin, ENERGY, undefined, vaultPath, asIsBuffer);

      const zeroBuffer = new SessionBuffer();
      zeroBuffer.touch(q.target);
      const zeroUsage = await activate(zeroUsageDir, q.origin, ENERGY, undefined, vaultPath, zeroBuffer);

      const simBuffer = new SessionBuffer();
      simBuffer.touch(q.target);
      const simulatedReinforcement = await activate(simDir, q.origin, ENERGY, undefined, vaultPath, simBuffer);

      rows.push({
        label: q.label,
        origin: q.origin,
        target: q.target,
        perMethod: {
          asIs: rankOf(asIs, q.target),
          zeroUsage: rankOf(zeroUsage, q.target),
          simulatedReinforcement: rankOf(simulatedReinforcement, q.target),
        },
      });
    }

    const methods = ["asIs", "zeroUsage", "simulatedReinforcement"];
    const summaries = methods.map((m) => summarize(m, rows));

    console.log(JSON.stringify({ queryCount: rows.length, summaries, rows }, null, 2));
  } finally {
    await Promise.all(scratchDirs.map((d) => rm(d, { recursive: true, force: true })));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
