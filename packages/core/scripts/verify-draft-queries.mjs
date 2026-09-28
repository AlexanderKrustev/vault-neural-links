#!/usr/bin/env node
// VNL-067 — mechanically check drafted benchmark queries before a human reviews them.
//
// A drafted question only reaches review if it is what it claims to be:
//   vocabulary-mismatch  keyword search (BM25, no cap, every other axis off)
//                        gives the target a score of exactly zero.
//   multi-hop            `via` and `target` are linked (either direction),
//                        keyword search ranks `via` in its top 3, and ranks
//                        the target below `via` or not at all — the words point
//                        at one note and the answer sits in the one it links to.
// The check cannot say whether the answer really is in the target. That is
// what the human review is for.
//
//   node scripts/verify-draft-queries.mjs <vaultPath> <drafts.json> [--keep <out.json>]
import { readFile, writeFile } from "node:fs/promises";
import { loadContentIndex, loadStructuralIndex, recall, resolveDataDir } from "../dist/index.js";

const [vaultPath, draftsPath] = process.argv.slice(2);
const keepFlag = process.argv.indexOf("--keep");
const keepPath = keepFlag !== -1 ? process.argv[keepFlag + 1] : null;
const dataDir = resolveDataDir(vaultPath);
const drafts = JSON.parse(await readFile(draftsPath, "utf8"));
const indexed = new Set((await loadContentIndex(dataDir))?.coveredPaths ?? []);
const structural = (await loadStructuralIndex(dataDir))?.edges ?? {};
const neighbours = (a) => new Set(Array.isArray(structural[a]) ? structural[a] : Object.keys(structural[a] ?? {}));
const linked = (a, b) => neighbours(a).has(b) || neighbours(b).has(a);

const kept = [];
for (const draft of drafts) {
  const problems = [];
  if (!indexed.has(draft.target)) problems.push("target not in the index");
  const lexical = await recall(vaultPath, dataDir, draft.query, {
    topK: 100_000,
    candidateCap: 100_000,
    graphWeight: 0,
    termWeight: 0,
    semanticWeight: 0,
    embeddings: false,
    outcome: false,
  });
  const rankOf = (path) => {
    const i = lexical.hits.findIndex((hit) => hit.path === path && hit.why.lexicalScore > 0);
    return i === -1 ? null : i + 1;
  };
  const targetRank = rankOf(draft.target);

  if (draft.type === "vocabulary-mismatch") {
    if (targetRank !== null) problems.push(`keyword search still sees the target (rank ${targetRank})`);
  } else if (draft.type === "multi-hop") {
    if (!draft.via || !indexed.has(draft.via)) problems.push("via note missing");
    else {
      const viaRank = rankOf(draft.via);
      if (!linked(draft.via, draft.target)) problems.push("via and target are not linked");
      if (viaRank === null || viaRank > 3) problems.push(`keyword search does not put via in its top 3 (rank ${viaRank})`);
      if (targetRank !== null && viaRank !== null && targetRank < viaRank) problems.push(`target outranks via (${targetRank} < ${viaRank})`);
    }
  } else {
    problems.push(`unsupported draft type ${draft.type}`);
  }

  console.log(`${problems.length === 0 ? "PASS" : "fail"}  ${draft.type.padEnd(19)} ${draft.query}${problems.length ? `\n      ${problems.join("; ")}` : ""}`);
  if (problems.length === 0) kept.push({ ...draft, status: "draft-verified" });
}

console.log(`\n${kept.length} of ${drafts.length} passed`);
if (keepPath) {
  await writeFile(keepPath, JSON.stringify(kept, null, 2) + "\n", "utf8");
  console.log(`passing drafts written to ${keepPath} — review before merging into the query set`);
}
