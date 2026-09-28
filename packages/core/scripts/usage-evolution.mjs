#!/usr/bin/env node
// 2026-09-28 — how the vault and its usage signal evolved. Read-only.
// Point it at a *copy* of .vault-neural-links (a frozen snapshot), not the live folder:
//   node scripts/usage-evolution.mjs <snapshotDataDir> <vaultPath>
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

const [snap, vault] = process.argv.slice(2);
const J = async (p) => JSON.parse(await readFile(p, "utf8"));
const jsonl = async (dir) => {
  const out = [];
  let files = [];
  try { files = await readdir(dir); } catch { return out; }
  for (const f of files) {
    if (!f.endsWith(".jsonl")) continue;
    for (const line of (await readFile(join(dir, f), "utf8")).split("\n")) {
      if (!line.trim()) continue;
      try { out.push({ ...JSON.parse(line), _file: f }); } catch {}
    }
  }
  return out;
};
const day = (ts) => String(ts).slice(0, 10);
const week = (d) => {
  const t = new Date(d + "T00:00:00Z");
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow);
  return t.toISOString().slice(0, 10);
};
const inc = (m, k, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const sorted = (m) => Object.fromEntries([...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
const R = {};

// ---- usage graph (compacted)
const lw = await J(join(snap, "link-weights.json"));
const edges = Object.entries(lw.edges);
R.graph = {
  compactedAt: lw.compactedAt,
  edges: edges.length,
  traverseTotal: edges.reduce((s, [, e]) => s + (e.traverseCount ?? 0), 0),
  reinforceTotal: edges.reduce((s, [, e]) => s + (e.reinforceCount ?? 0), 0),
  consolidated: edges.filter(([, e]) => (e.consolidatedScore ?? 0) > 0).length,
  edgesWithReactivationDays: edges.filter(([, e]) => (e.reactivationDays ?? []).length > 1).length,
};
const lastTouchedWeek = new Map();
const activeDaysByWeek = new Map(); // edge-activity days (reactivationDays) per week
const edgeActivityByDay = new Map();
for (const [, e] of edges) {
  inc(lastTouchedWeek, week(day(e.lastTouched)));
  for (const d of e.reactivationDays ?? []) { inc(activeDaysByWeek, week(d)); inc(edgeActivityByDay, d); }
}
R.graph.lastTouchedByWeek = sorted(lastTouchedWeek);
R.graph.edgeActivityByWeek = sorted(activeDaysByWeek);
// Degree concentration: how much of the graph hangs off the top notes
const deg = new Map();
for (const [k] of edges) { const [a, b] = k.split("|"); inc(deg, a); inc(deg, b); }
const degSorted = [...deg.entries()].sort((a, b) => b[1] - a[1]);
R.graph.notesTouched = deg.size;
R.graph.topNotesByEdges = degSorted.slice(0, 12);
// Folder share of usage edges
const folder = (p) => p.split("/").slice(0, 2).join("/");
const folderEdges = new Map();
for (const [k] of edges) { const [a] = k.split("|"); inc(folderEdges, folder(a)); }
R.graph.edgesByTopFolder = [...folderEdges.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

// ---- term graph
const tw = await J(join(snap, "term-weights.json"));
const tEdges = Object.entries(tw.edges);
R.terms = { edges: tEdges.length, tokens: new Set(tEdges.map(([k]) => k.split("|")[0])).size, notes: new Set(tEdges.map(([k]) => k.split("|").slice(1).join("|"))).size };
const tWeek = new Map();
for (const [, e] of tEdges) for (const d of e.reactivationDays ?? []) inc(tWeek, week(d));
R.terms.activityByWeek = sorted(tWeek);

// ---- structural + content + embeddings coverage
const ci = await J(join(snap, "content-index.json"));
const covered = new Set(ci.coveredPaths);
R.corpus = { indexedNotes: covered.size };
let emb = null;
try { emb = await J(join(snap, "embeddings.json")); } catch {}
if (emb) {
  const embedded = new Set(Object.keys(emb.notes));
  const missing = [...covered].filter((p) => !embedded.has(p));
  R.embeddings = { model: emb.model, embedded: embedded.size, indexedButNotEmbedded: missing.length, missingSample: missing.slice(0, 8), builtAt: emb.builtAt ?? emb.updatedAt ?? null };
}
const st = await J(join(snap, "structural-links.json"));
R.corpus.notesWithLinks = Object.keys(st.edges).length;
R.corpus.wikilinkEdges = Object.values(st.edges).reduce((s, v) => s + (Array.isArray(v) ? v.length : Object.keys(v).length), 0);

// ---- file mtimes of the indexes (did nightly run?)
R.indexMtimes = {};
for (const f of ["content-index.json", "structural-links.json", "link-weights.json", "term-weights.json", "embeddings.json", "seed-weights.json", "note-importance.json"]) {
  try { R.indexMtimes[f] = (await stat(join(vault, ".vault-neural-links", f))).mtime.toISOString(); } catch {}
}

// ---- recall read-through (VNL-057), per week
const rec = await jsonl(join(snap, "recall"));
const calls = new Map();
for (const e of rec) {
  if (e.type === "returned") calls.set(e.recallId, { ts: e.ts, n: e.resultCount, read: new Set(), write: false, query: e.query });
}
for (const e of rec) {
  const c = calls.get(e.recallId);
  if (!c) continue;
  if (e.type === "read") c.read.add(e.path);
  if (e.type === "write") c.write = true;
}
const rw = new Map();
for (const c of calls.values()) {
  const w = week(day(c.ts));
  const r = rw.get(w) ?? { calls: 0, returned: 0, read: 0, callsWithRead: 0, callsWithWrite: 0 };
  r.calls++; r.returned += c.n ?? 0; r.read += c.read.size; if (c.read.size) r.callsWithRead++; if (c.write) r.callsWithWrite++;
  rw.set(w, r);
}
const tot = [...rw.values()].reduce((a, r) => ({ calls: a.calls + r.calls, returned: a.returned + r.returned, read: a.read + r.read, callsWithRead: a.callsWithRead + r.callsWithRead, callsWithWrite: a.callsWithWrite + r.callsWithWrite }), { calls: 0, returned: 0, read: 0, callsWithRead: 0, callsWithWrite: 0 });
R.recall = { byWeek: sorted(rw), total: tot, resultReadRate: tot.read / Math.max(tot.returned, 1), usefulRecallRate: tot.callsWithRead / Math.max(tot.calls, 1), writeFollowRate: tot.callsWithWrite / Math.max(tot.calls, 1) };
const recallDays = new Map();
for (const c of calls.values()) inc(recallDays, day(c.ts));
R.recall.byDay = sorted(recallDays);
R.recall.sampleQueries = [...calls.values()].slice(-8).map((c) => c.query);

// ---- search + retrieval logs per week
const se = await jsonl(join(snap, "search"));
const sw = new Map(); for (const e of se) if (e.ts) inc(sw, week(day(e.ts)));
R.searchByWeek = sorted(sw);
const re = await jsonl(join(snap, "retrieval"));
const retw = new Map(); for (const e of re) if (e.ts) inc(retw, week(day(e.ts)) + " " + (e.tool ?? e.type ?? "?"));
R.retrievalByWeekTool = sorted(retw);

// ---- uncompacted events by trigger
const ev = await jsonl(join(snap, "events"));
const trig = new Map(); for (const e of ev) inc(trig, `${e.type}:${e.trigger ?? "-"}`);
R.uncompactedEvents = { count: ev.length, byTrigger: sorted(trig), span: [ev.map((e) => e.ts).sort()[0], ev.map((e) => e.ts).sort().at(-1)] };

// ---- vault writes over time (changes.jsonl)
const ch = (await readFile(join(vault, "changes.jsonl"), "utf8")).split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const cw = new Map();
const cwDomain = new Map();
for (const c of ch) {
  const d = day(c.ts ?? c.timestamp ?? "");
  if (!/^\d{4}-/.test(d)) continue;
  const w = week(d);
  inc(cw, `${w} ${c.action ?? "?"}`);
  const f = String(c.file ?? c.path ?? "");
  inc(cwDomain, `${w} ${f.split("/").slice(0, 2).join("/")}`);
}
R.changesByWeekAction = sorted(cw);
R.changesLastTs = ch.map((c) => c.ts ?? c.timestamp).filter(Boolean).sort().at(-1);

// ---- workspace-history import
try { const wh = await J(join(snap, "workspace-history-imported.json")); R.historyImport = { keys: Object.keys(wh), size: JSON.stringify(wh).length }; } catch {}

console.log(JSON.stringify(R, null, 2));
