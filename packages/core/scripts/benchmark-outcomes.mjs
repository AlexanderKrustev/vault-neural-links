#!/usr/bin/env node
// VNL-074 — does outcome learning (VNL-073) move the notes actually opened up?
//
// Replays the real recall log week by week: the model for each week is learned
// only from calls before it, the week's shown lists are re-ordered, and the
// first opened note's rank is compared with the order that was served. Only the
// preregistered weight decides the verdict; the others are exploration.
//
// Read-only. Point it at a *copy* of .vault-neural-links for a number you
// intend to quote, so the session running it cannot add lines mid-read.
//
//   node scripts/benchmark-outcomes.mjs <dataDir> [--json out.json]
//   node scripts/benchmark-outcomes.mjs <dataDir> --legacy-replay <vaultPath>
//
// --legacy-replay reconstructs the shown list for calls logged before
// 2026-09-28 (which did not record it) by re-running each query against
// today's index. That is an approximation — today's index, today's learned
// terms, which were partly learned from those very reads — so it smoke-tests
// the pipeline and never counts toward the gate.
import { writeFile } from "node:fs/promises";
import {
  OUTCOME_GATE_MIN_CALLS,
  readRecallLog,
  recall,
  replayOutcomes,
  toRecallLogHits,
} from "../dist/index.js";

const args = process.argv.slice(2);
const dataDir = args[0];
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const jsonOut = flag("--json");
const legacyVault = flag("--legacy-replay");

if (!dataDir) {
  console.error("usage: benchmark-outcomes <dataDir> [--json out.json] [--legacy-replay <vaultPath>]");
  process.exit(1);
}

let entries = await readRecallLog(dataDir);
let reconstructed = 0;
if (legacyVault) {
  const patched = [];
  for (const entry of entries) {
    if (entry.type === "returned" && !entry.hits && entry.resultCount > 0) {
      const result = await recall(legacyVault, dataDir, entry.query, { topK: entry.resultCount, outcome: false });
      patched.push({ ...entry, hits: toRecallLogHits(result.hits) });
      reconstructed++;
    } else {
      patched.push(entry);
    }
  }
  entries = patched;
}

const report = replayOutcomes(entries);
const pct = (n) => n.toFixed(3);

if (legacyVault) {
  console.log(`APPROXIMATE — ${reconstructed} legacy calls re-run against today's index. Smoke test only, never the gate.\n`);
}
console.log(`judged calls in the log: ${report.judgedCallsTotal} (a call counts once it shows a list and something in it is opened)`);
console.log(`preregistered weight: ${report.weight}\n`);

if (report.windows.length === 0) {
  console.log("No held-out week yet: testing needs at least one week of calls before the week being tested.");
} else {
  const weights = Object.keys(report.pooled.replayMrr);
  console.log(["week of".padEnd(11), "train", "test", "w/evid", "served", ...weights.map((w) => `@${w}`.padStart(6)), "up", "down"].join("  "));
  for (const w of report.windows) {
    console.log(
      [
        w.start.slice(0, 10).padEnd(11),
        String(w.trainCalls).padStart(5),
        String(w.testCalls).padStart(4),
        String(w.callsWithEvidence).padStart(6),
        pct(w.servedMrr).padStart(6),
        ...weights.map((k) => pct(w.replayMrr[k]).padStart(6)),
        String(w.improvedCalls).padStart(2),
        String(w.worsenedCalls).padStart(4),
      ].join("  "),
    );
  }
  const p = report.pooled;
  console.log(
    `\npooled: ${p.testCalls} held-out calls, ${p.callsWithEvidence} with evidence; served MRR ${pct(p.servedMrr)}, ` +
      `replayed at ${report.weight}: ${pct(p.replayMrr[String(report.weight)])} (${p.improvedCalls} up, ${p.worsenedCalls} down)`,
  );
}

const verdictText = {
  pass: "PASS — outcome learning moves the notes actually opened up, on held-out weeks",
  fail: "FAIL — held-out weeks do not improve",
  "insufficient-data": `NOT YET — needs ${OUTCOME_GATE_MIN_CALLS} held-out judged calls, has ${report.pooled.testCalls}`,
};
console.log(`\nVNL-074 gate: ${legacyVault ? "(not applicable to an approximate replay) " : ""}${verdictText[report.verdict]}`);

if (jsonOut) {
  await writeFile(jsonOut, JSON.stringify(report, null, 2), "utf8");
  console.log(`full report written to ${jsonOut}`);
}
