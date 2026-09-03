# Vault Neural Link — Plan of Record

**Effective**: 2026-09-02 · **Replaces**: Jira project AIBRAIN (retired; frozen export in [`BACKLOG-ARCHIVE.md`](BACKLOG-ARCHIVE.md)) · **Repo state**: `main` @ `f7b6b55`

This file is the single source of truth for what the project is doing, in what order, and why. It was produced by a full re-plan on 2026-09-02 that took three views in turn — CTO (what is built, how, what is pending), investor (is the idea a business), architect (rework the plan on that evidence). The evidence is in [`analysis/2026-09-02-deep-analysis-report.md`](analysis/2026-09-02-deep-analysis-report.md) and the three underlying reports next to it. Architecture reference remains Part 2 of [`PLAN-AND-ARCHITECTURE.md`](PLAN-AND-ARCHITECTURE.md); its Part 1 is superseded by this file.

---

## 0. How this file works

- **Status vocabulary**: `todo` · `doing` · `review` · `done` · `dropped` · `deferred`. Update the status inline when work starts, progresses, or finishes. Add a dated one-liner under *Changelog* (§9) for anything that changes a decision or a phase.
- **IDs**: migrated items keep their `AIBRAIN-nn` key as a stable identifier. New items are `VNL-nnn`. Next free: `VNL-060`.
- **Durable knowledge** (decisions, rationale, measurements) still goes to the Obsidian vault via the `vault-memory` skill; this file links to vault notes rather than duplicating them.
- **Gates**: a phase does not start until its listed gate is met. Gates are measurable on purpose.
- Every one of the 142 migrated Jira keys has a row in §8 (disposition). Nothing was silently discarded.

---

## 1. Where we actually are (verified 2026-09-02)

| Claim | Verified state |
|---|---|
| Engine works | Yes. 200/200 core tests, 27/27 mcp-server tests, all five packages typecheck, root build succeeds. |
| Engine beats plain text search | **Only on rank-1 count.** Engine 15/18 rank-1, mean rank 2.38; relevance-ranked text search 13/18 rank-1, mean rank **1.27** (better). |
| "Memory gets more accurate the longer it runs" | **Not demonstrated.** Zeroing all usage weights gives the same 15/18. Ablating priming drops to 1/18. Both benchmark scripts pre-seed the session buffer with the target note, so the benchmark measures "the note I already read this session ranks first"; the distractor query also ranks #1 for the same reason. |
| Signal exists to learn from | Barely. Real vault after 8 weeks: 474 notes, 122 usage edges, 144 traversals, 9 reinforcements, 4 consolidated edges. |
| Safe to expose to an LLM | **Fixed 2026-09-03 (VNL-001, VNL-002).** Every path argument is contained by `resolveInsideVault()` plus a zod `.refine`, verified over the MCP protocol itself in `mcpIntegration.test.ts`; the activation WebSocket binds 127.0.0.1 only. It still has no auth, which is acceptable for a loopback-only feed. |
| Safe to point at an existing Obsidian vault | **Fixed 2026-09-03 (VNL-003).** The parser handles block lists and nested maps, and a body-only `update_note` re-emits the frontmatter block verbatim, so anything the parser still doesn't understand survives a write untouched. |
| Verified at 300k notes | Search only, on a synthetic small-vocabulary fixture. Content index is 8.5 MB for 471 real notes (≈5 GB extrapolated to 300k, above V8's string limit) and is re-parsed from disk on every query. Retrieval, autolink and the nightly pipeline were never measured at scale. |
| Publishing is one token away | Yes, once the founder adds `NPM_TOKEN` (AIBRAIN-42). Changeset added and the server reports its real version as of 2026-09-03 (VNL-005/006). |
| Obsidian store submission is a manual step away | No. `isDesktopOnly: false` is wrong (plugin requires Node `fs`), version `0.0.0`, no `versions.json`, raw `setInterval`, `console.log`. Would be rejected. |
| Paid-from-launch plan is executable | 45 tickets of billing/legal/ops precede the first euro for a 3–4 EUR/month product; the price band is empty in the MCP market and 3–8x below every comparable Obsidian AI plugin. See investor memo. |

---

## 2. Decisions taken in this re-plan

Each entry states what changed, why, and what earlier vault decision it overturns. All nine decisions were **confirmed by the founder on 2026-09-02**, including D1 and D2, which overturn earlier vault decisions.

**D1 — Ship free and open (MIT) first; monetize only after validation.**
Why: zero users, unproven demand, and a headline mechanism the founder's own ablation shows adds nothing yet. Every comparable that monetized (Smart Connections, Copilot for Obsidian, Basic Memory, Vestige, Khoj) started free. Overturns *Paid-From-Launch Monetization and Licensing Backend Decision* (2026-08-16). **Confirmed 2026-09-02.**

**D2 — If validated, monetize the Obsidian plugin "Pro" through a Merchant-of-Record platform with license keys; no owned billing backend.**
Why: a MoR (Polar, Lemon Squeezy, Paddle) costs ~5% + 0.50 per transaction and removes ~45 tickets (Stripe webhooks, entitlement DB, dunning, portal, VAT, hosting, secrets, monitoring). Self-building pays off only past ~2–3k subscribers. Price like the neighbours: 29–49 EUR/year or a capped 79–99 EUR lifetime "founding" tier, never 3.50/month (the 0.50 fixed fee makes that an 18% take). Overturns "no marketplace resellers / Stripe direct, user is MoR" (2026-08-16). **Confirmed 2026-09-02.**

**D3 — Reposition: lead with what is measured and visible.**
Headline becomes: *your vault is already a brain; VNL gives your agent working memory over it — session priming, link-structure-aware retrieval, a live neural graph — and it travels with you from Claude Code to Codex to Gemini.* "Hebbian / gets better with use" moves to the roadmap and science story until Phase 2 measures a lift. Does not overturn any vault decision; the portability positioning (2026-08-16) stays.

**D4 — Security and data-safety fixes precede the first publish.** Path containment, loopback socket, frontmatter preservation, compactor durability. These are hours of work each and are the difference between "alpha" and "unsafe". New decision.

**D5 — Retract the scale claim to what is measured; redesign the index before claiming anything above ~20k notes.** README and INSTALL say what was verified (search, synthetic 300k) and nothing more. Monolithic JSON indexes parsed per query are replaced by a SQLite-backed store in Phase 3. New decision.

**D6 — The benchmark is rebuilt before any quality claim is made publicly.** Unprimed and related-note-primed conditions, MRR alongside rank-1, ≥50 queries, a second vault, automated in CI. The current 18-query pre-seeded set stays as a regression test only. Extends AIBRAIN-66's "measure before adding mechanisms" (2026-08-15).

**D7 — Desktop app stays paused and off the critical path.** Confirms the 2026-08-30 pause; nothing in Phases 0–4 depends on it. Code stays in the monorepo.

**D8 — Jira is retired; this file is the backlog.** The vault stays the knowledge store. Per the founder's instruction, 2026-09-02. Jira project AIBRAIN is left untouched as a read-only archive; it can be archived or deleted by the founder at any time.

**D9 — Cold-start is a first-class problem.** The Hebbian layer cannot become informative from ~2 traversals/day. Phase 2 seeds initial weights from signals that already exist (backlink counts, file modification recency, optional Obsidian workspace history) and shortens the initial half-life, so the layer has a chance to earn its name by the month-6 gate. New decision.

**D10 — Engine usefulness thesis. Confirmed by the founder 2026-09-02, including the priority order of Phase 2b.**
The engine is not useful today for three structural reasons, none of which is a tuning problem: (1) its entry point is a *note* (`activate(note)`), but the agent's real question is a *query* ("what should I read for this task?"), so the graph never gets to improve a real search; (2) its only learning signal is the agent's own MCP traffic (~2 events/day), while the human's navigation inside Obsidian — 100x the volume — is ignored; (3) it ranks by graph and usage alone with no relevance model, so it can only re-rank things it was already pointed at. The fix is to make the engine a **query-driven hybrid retriever** in which lexical/semantic relevance answers *what matches*, the weighted graph answers *what this user actually uses together and what has gone stale*, and the Obsidian plugin becomes the primary **sensor**, not just a viewer. Work items: Phase 2b. This does not overturn any binding constraint: still MCP-only, no owned API key (embeddings run locally), deterministic logging, data stays in the vault.

---

## 3. Roadmap

Effort figures are focused engineering time for one person, not calendar time.

### Phase 0 — Safety and honesty (before anything is published) · ~4 days

Gate to exit: all items `done`, tests green, one MCP-client integration test exercising a traversal rejection. **Met 2026-09-03** — 288 tests green (248 core, 40 mcp-server), all five packages typecheck, `test/mcpIntegration.test.ts` drives the real server over the SDK's in-memory transport.

| ID | Item | Effort | Status |
|---|---|---|---|
| VNL-001 | **Vault containment for every path argument.** `resolveInsideVault()` in core (`path.resolve`, reject absolute, reject escape, reject `.vault-neural-links/` and `.obsidian/` targets), used by `toFilePath`, `listNotes`, `readNoteType`, `readSupersession`, autolink, desktop IPC; zod `.refine` in `tools.ts`; 6+ tests. | 4 h | done |
| VNL-002 | **Activation socket binds loopback only** (`host: "127.0.0.1"`); socket bind failure must not kill the MCP server (socket is optional). | 1 h | done |
| VNL-003 | **Preserve frontmatter verbatim on body-only `update_note`.** Keep the raw frontmatter block and re-emit it unchanged unless frontmatter was explicitly supplied. Add block-list / nested-map fixtures. Longer term: adopt a real YAML parser (`yaml`). | 4 h | done |
| VNL-004 | **Compactor durability.** Rename each `events/*.jsonl` to `*.compacting` before reading so a live session's new appends land in a fresh file; per-line `try/catch` with quarantine of malformed lines; lock file so two compactors cannot double-fold; tests for all three. | 1 day | done |
| VNL-005 | Server `version` read from `package.json` (currently hardcoded `0.0.0`); drop sourcemap and empty `.d.ts` from the mcp-server tarball (75 KB → ~20 KB, measured 19.2 KB). | 30 min | done |
| VNL-006 | Add the first changeset so `release.yml` opens a Version PR on merge. | 10 min | done |
| VNL-007 | **MCP-client integration test** via the SDK in-memory transport: `tools/list` (11 tools), `read_note` round trip, `read_note ../x` rejected. | 2 h | done |
| VNL-008 | **Honest README/INSTALL**: scale claim limited to what was measured; add "exclude `.vault-neural-links/` from OneDrive/iCloud sync" (conflict copies were observed in the real vault); remove `reinforce_link` remnants from `compact_weights` description and `docs/claude-code-integration.md`; mark `docs/spec.md` superseded. | 1 h | done |
| VNL-009 | Delete own `session/*.json` and `activation-sockets/*.json` on SIGINT/SIGTERM/stdin close; nightly prune of orphaned session/retrieval/search files (84 stale session files observed). | 2 h | done |
| VNL-012 | Autolink: route the per-write scan through `readNodesInBatches` (bounded concurrency) and skip ambiguous titles (those `structuralLinks.ts` refuses to resolve) — the unbounded `Promise.all` is the same EMFILE pattern already fixed in search. Done 2026-09-03: ambiguous titles, path-form dedup, case-sensitive single-word matching, wikilink-span exclusion, and the batching half via a shared `readNotesInBatches`. | 2 h | done |

### Phase 1 — Publish and validate · weeks 1–2

Gate to enter: Phase 0 done — **met 2026-09-03**. Gate to exit (the validation decision, D1→D2): within 14 days of launch, **≥300 npm installs, ≥100 GitHub stars, ≥25 pre-order emails at the Pro price, ≥3 unsolicited messages describing the pain in the user's own words.** All four missed → go to §7 option E (keep as open-source project, stop investing in monetization). Two or more met → Phase 4 unlocks.

| ID | Item | Effort | Status |
|---|---|---|---|
| AIBRAIN-42 | Founder: create npm Automation token, add `NPM_TOKEN` repo secret; merge Version PR; verify `npx -y @vault-neural-links/mcp-server` from a clean machine. | 1 h (founder) | review |
| AIBRAIN-43 | **Obsidian store readiness**: `isDesktopOnly: true`, `registerInterval` instead of raw `setInterval`, strip `console.log`, version 0.1.0, `versions.json`, GitHub release workflow producing `main.js`/`manifest.json`/`styles.css`. | 4 h | todo |
| AIBRAIN-57 / AIBRAIN-100 | Submit to `obsidian-releases` with the required README disclosure (no telemetry, local files only, what `.vault-neural-links/` contains). | 2 h + their queue | todo |
| AIBRAIN-107 | **Cross-client validation** on Codex CLI, Gemini CLI, Cursor: install, list tools, run `search_notes` → `read_note` → `get_weighted_neighbors`, confirm traversal events are logged identically. Record results in the vault. This is a prerequisite for the portability headline (D3). | 1 day | todo |
| VNL-010 | **Launch assets**: 90-second GIF of the activation-pulse graph; one-page landing site with two fake-door CTAs ("Pro — 29–49 EUR/yr", "Founding lifetime — 79–99 EUR") wired to a MoR pre-order page (Polar or Lemon Squeezy; both free to set up); the ablation table published honestly. Absorbs AIBRAIN-86. | 1 day | todo |
| AIBRAIN-58 | Launch: r/ObsidianMD, r/ClaudeAI, Obsidian forum *Share & showcase*, Show HN, official MCP registry, PulseMCP. | 0.5 day | todo |
| VNL-011 | Validation metrics sheet: npm downloads, GitHub stars, pre-order count, qualitative messages; reviewed at day 7 and day 14. No product telemetry (Obsidian policy forbids it in the plugin; the MCP server stays silent too). | 1 h | todo |
| AIBRAIN-39 | Epic container for the above; `done` when AIBRAIN-42/43/57 are. | — | doing |

### Phase 2 — Retrieval truth · weeks 1–8, parallel with Phase 1

Gate to exit: a benchmark that can distinguish "correct" from "primed", run automatically, and a written month-6 decision on the usage-weight layer.

| ID | Item | Effort | Status |
|---|---|---|---|
| VNL-020 | **Benchmark redesign.** Three conditions per query: *unprimed* (empty buffer), *related-primed* (buffer seeded with a sibling note, not the target), *target-primed* (today's condition, kept as regression). Report MRR and rank-1. ≥50 queries; add a second vault (a volunteer's, or a public Obsidian vault such as a published digital garden). Runs in CI against a fixture vault checked into `packages/core/test/fixtures/`. | 2 days | todo |
| VNL-021 | **Cold-start seeding (D9).** Initial `baseStrength` from backlink count and mutual-link presence, recency from file mtime, optional import of Obsidian `workspace.json` recent-files history. Shorter initial half-life for seeded edges so real traversal overrides them quickly. Measured against VNL-020 before/after. | 2 days | todo |
| VNL-022 | **Month-6 gate on the usage-weight layer** (target 2027-03-01): if `asIs` still equals `zeroUsage` on the VNL-020 benchmark across ≥3 vaults, remove decay/consolidation/reinforcement from the hot path, keep priming + structure + importance, and simplify. Record the finding either way in the vault. | decision | todo |
| AIBRAIN-134 | Evidence-state taxonomy (Retrieved / Read / Re-query / Referenced / Helpful) with explicit "MCP can / cannot know" labels; do not feed raw telemetry into weights before correlation is measured. | 1 day | todo |
| AIBRAIN-135 | Memory Trace panel in the Obsidian plugin (retrieved → read → traversal lifecycle per query). | 2 days | todo |
| AIBRAIN-136 | Query-level "was this helpful" feedback attached to Memory Trace, stored as a calibration dataset. | 1 day | todo |
| AIBRAIN-137 | Citation-token `report_usage()` experiment; kill criterion unchanged: near-zero invocation rate → record as a negative finding and delete. | 0.5 day | todo |
| AIBRAIN-142 | Content-index candidate narrowing on repetitive vocabulary; folded into VNL-031. | — | deferred |
| AIBRAIN-28 | Case-study write-up and demo captures; update the *Case Study* vault note so structuralFallback is no longer described as "engineering only" (ablation shows it is load-bearing). | 1 day | doing |
| AIBRAIN-66 | Epic container. | — | doing |

### Phase 2b — Make the engine useful (D10) · weeks 2–10 · **primary track after Phase 0**

Execution order confirmed 2026-09-02: VNL-050 (recall) and VNL-052 (plugin sensor) first, since VNL-053/054/055/056/057 depend on them; then VNL-053, VNL-054, VNL-051, VNL-055, VNL-056, VNL-057, VNL-058. Phase 2's VNL-020 benchmark redesign runs alongside so the exit gate can be measured.

Gate to exit: on the VNL-020 benchmark **with query text as input and an empty session buffer**, `recall` beats plain relevance search on MRR by a margin that survives a second vault; and ≥50% of `recall` results returned in real sessions are subsequently read (VNL-057 metric).

| ID | Item | Effort | Status |
|---|---|---|---|
| VNL-050 | **`recall(query, topK?, context?)` tool.** One call: lexical scoring (BM25 over the existing content index) → seed set → spreading activation over the weighted graph to expand and re-rank → top-K with `why` (matched terms, hop path, weight, staleness, `supersededBy`) and a **snippet** per hit so the agent does not need N `read_note` round trips. Existing tools stay for compatibility; `recall` becomes the tool description's recommended entry point. Done 2026-09-03: BM25 (df from the content index, tf computed live over a capped candidate set), per-seed spreading activation with the origin keeping its own activation, normalized blend at `graphWeight` 0.5, snippets, and `why`. 15 new tests (12 core, 3 mcp-server). | 3 days | done |
| VNL-051 | **Local embeddings, optional.** `@huggingface/transformers` (ONNX, all-MiniLM-L6-v2, ~23 MB, CPU) embedding per note, stored in the index; cosine blended with BM25 in VNL-050. Lazily built by the nightly job; disabled by default above 50k notes until VNL-031 lands. No API key, so the MCP-only / no-owned-key constraint holds. | 2 days | todo |
| VNL-052 | **Human navigation as signal (plugin).** The Obsidian plugin logs `file-open` and `modify` events and consecutive-open pairs into the same `events/*.jsonl` log with `trigger: "human-open" / "human-edit"`, at a lower weight delta than agent traversal. Co-open within a 10-minute window → traversal edge. This is the single biggest lever against signal starvation and turns the free plugin into the thing that makes the MCP server smart. | 2 days | todo |
| VNL-053 | **Term-to-note learning.** Search queries are already logged; when a `search_notes`/`recall` result is read next, persist a `query-token → note` weight (same decay/consolidation math as note edges). The graph then learns what "kill process by port" means for *this* user, which no static ranking can. | 2 days | todo |
| VNL-054 | **"Referenced" signal via write-back.** When the agent's `create_note`/`update_note` body contains `[[X]]` and X was read in this session, log a `reinforce` with `trigger: "cited"`. This is the deterministic, MCP-visible half of AIBRAIN-134's *Referenced* state; no gateway needed. | 0.5 day | todo |
| VNL-055 | **Session briefing resource.** MCP resource `vault://briefing` (and a prompt) that returns the top primed + weighted + recently-modified notes for the current project (matched by cwd name or an explicit `project` arg). Delivers value at session start without the agent choosing to call a tool; works on any MCP client. | 1 day | todo |
| VNL-056 | **Staleness and conflict outputs.** Surface decay-derived staleness ("not touched in 94 days") and `supersedes` conflicts in `recall` results. This is the one thing the Hebbian layer can already do usefully with today's data volume. | 0.5 day | todo |
| VNL-057 | **Usefulness metric in production.** Log per `recall`: results returned, results read within the session, whether a write followed. Report "read-through rate" in the plugin's Usage Report panel. This replaces rank-1-of-a-pre-seeded-target as the number the project steers by. | 1 day | todo |
| VNL-058 | **Mechanism diet.** Consolidation (inert) and importance (±1–8%) stay in code but leave the marketing and the hot path's default config until VNL-020 shows a lift; priming, structure, term-learning and human signal are the defaults. | 0.5 day | todo |

### Phase 3 — Performance and scale · weeks 3–10

Gate to enter: Phase 0 done — **met 2026-09-03**. Gate to exit: `search_notes`, `activate`, `create_note` each measured on a **real-vocabulary** corpus (Wikipedia-derived sample, AIBRAIN-111) at 50k and 300k notes, with numbers in the README.

| ID | Item | Effort | Status |
|---|---|---|---|
| VNL-030 | **In-process mtime-keyed cache** for `link-weights.json`, `structural-links.json`, `note-importance.json`, `content-index.json`; adjacency map built once per load so a neighbor lookup is O(degree), not O(E); cache `readNoteType` per path. Removes the 3 file reads + full edge scan per `computeLiveNeighborWeights` call. | 1 day | todo |
| VNL-031 | **SQLite-backed index store.** Tables: `postings(token, path)`, `structural(from, to)`, `edges(key, baseStrength, lastTouched, …)`, `importance(path, score)`, `clusters(path, cluster)`. Spike first: `node:sqlite` (built-in, needs Node ≥22.5; would bump `engines`) vs `better-sqlite3` (native dep, complicates `npx` install) vs sharded JSON (pure JS, no schema). Decide in the spike; the recommendation going in is `node:sqlite` with a JSON fallback for Node 20. Replaces the monolithic JSON files; retains the "delete the folder, vault is plain again" property. Absorbs AIBRAIN-142. | 1 week | todo |
| VNL-032 | `mostRecentNotes` and any remaining unbounded `Promise.all` over the vault go through bounded batches. | 2 h | todo |
| VNL-033 | Nightly pipeline off Obsidian's main thread (worker or child process) — PageRank + Louvain at 300k will freeze the UI otherwise. | 1–2 days | todo |
| VNL-034 | Deduplicate decay math: `render-core/ForceSim.ts` re-implements `liveWeight`; export from core and import. Same for `escapeRegExp`, `daysSinceDayKey`, edge-key construction (4 copies). | 3 h | todo |
| VNL-035 | Multi-machine sync strategy: per-machine `link-weights.<host>.json` merged on read (max of decayed weights), or document sync exclusion as the supported mode. Decide after VNL-031 (SQLite WAL files make sync worse, not better). | 1–3 days | todo |
| AIBRAIN-110/111/112/113 | Scale epic AIBRAIN-108 rescoped: real-vocabulary corpus (111) becomes the primary fixture; full-pipeline run (112) and bottleneck write-up (113) happen after VNL-031. Synthetic generator (110) exists already in `desktop-app/scripts`. | 2 days | todo |
| AIBRAIN-117/118 | OKF corpus generator exists; re-run at scale after VNL-031. | 0.5 day | todo |

### Phase 4 — Monetize (only if Phase 1's gate passes) · weeks 3–6 after the gate

Requires **Confirmed 2026-09-02.** on D1 and D2.

| ID | Item | Effort | Status |
|---|---|---|---|
| VNL-040 | MoR selection spike: Polar vs Lemon Squeezy vs Paddle — license-key API, EU invoicing, payout to Bulgaria, lifetime-tier support. | 0.5 day | todo |
| VNL-041 | Free/Pro split. Free: MCP server (all 11 tools), static graph view. Pro: activation-pulse animation and history, Memory Trace panel, nightly consolidation dashboard, ablation explainer, multi-vault. Absorbs AIBRAIN-90 (runtime guard). | 1 day design | todo |
| VNL-042 | Plugin license-key entry, online validation against the MoR endpoint, 14-day offline grace with cached entitlement, graceful degraded state (features hide, nothing breaks). Absorbs AIBRAIN-89/91/92 and AIBRAIN-129. | 2 days | todo |
| VNL-043 | Legal: templated ToS + Privacy Policy (AIBRAIN-97); legal form to invoice (freelancer/ET/EOOD); accountant check on the EU SME VAT scheme and the EX-number notification (AIBRAIN-98 rescoped — under a MoR the VAT collection itself is theirs). | founder, 1 week elapsed | todo |
| VNL-045 | Support channel: GitHub Discussions + one email address (AIBRAIN-99). | 1 h | todo |
| VNL-046 | Metrics: MoR dashboard (MRR, churn) + Obsidian `community-plugin-stats.json` downloads + npm downloads (AIBRAIN-60). No owned pipeline. | 1 h | todo |

### Phase 5 — Conditional / later

Nothing here starts before Phase 4 has ≥300 paying users or the founder explicitly re-prioritizes.

| ID | Item | Status |
|---|---|---|
| AIBRAIN-63 | Standalone desktop app (paused 2026-08-30). If resumed: Electron, single OAuth surface, single MCP registration, Obsidian path = companion only (vault decisions 2026-08-18). | deferred |
| AIBRAIN-64 | Markdown/vault import tooling for onboarding (in progress in the desktop app; parked with it). | deferred |
| AIBRAIN-62 / 65 | Server-side engine / model-API gateway for true "Referenced" attribution; repricing. | deferred |
| AIBRAIN-127 | Desktop setup screen logout button. | deferred |
| AIBRAIN-119–125 | Anonymous opt-in telemetry pipeline. Not needed while metrics come from npm/Obsidian/MoR. | deferred |
| AIBRAIN-109 / 114–116 | OKF phases C–E (autolink switch, Obsidian setting, migration of existing notes). Read support (phases A/B) is done and is all launch needs. | deferred |
| AIBRAIN-34 | AI-inferred edges for link-less sources (Confluence, Word). | deferred |
| AIBRAIN-105 / 106 | Account dashboard, business-metrics dashboard. | deferred |
| AIBRAIN-45 | Shared core-backed read path for SessionStart MOC/Inbox context (founder's own harness). | deferred |
| AIBRAIN-54 | Dogfood — ongoing by definition; not a ticket. | deferred |

---

## 4. Gaps found and proposals

Numbered so they can be referenced. Effort is engineering time.

1. **Path traversal (critical, 4 h)** — see VNL-001. Prompt-injected note content can currently make the agent read any `.md` on disk or write to any `.md` path. Must ship before publish.
2. **Frontmatter destruction (critical, 4 h)** — see VNL-003. Any vault not authored solely by this tool loses block-list aliases/tags on the first `update_note`. Must ship before publish.
3. **Open WebSocket (high, 1 h)** — see VNL-002.
4. **Event loss during compaction (high, 1 day)** — see VNL-004. The comment in `compactor.ts` claiming live files are left alone is false; they are in the processed set.
5. **Benchmark circularity (high, 2 days)** — see VNL-020. The current numbers cannot support any public claim; a skeptical reader will ask for exactly this ablation.
6. **Index scaling (high, 1 week)** — see VNL-031. Monolithic JSON parsed per query is the wrong shape; SQLite is the standard answer and keeps the local-files promise.
7. **Per-call I/O in retrieval (high, 1 day)** — see VNL-030. Cheap and large win.
8. **Cold start (medium, 2 days)** — see VNL-021. Without it the differentiator can never be tested fairly.
9. **Billing plan mismatch (strategic)** — D1/D2. Removes 25 tickets and 3–5 months of non-product work.
10. **Positioning mismatch (strategic)** — D3. Sell priming, structure and the graph; keep Hebbian as science story until measured.
11. **Obsidian store rejection risks (medium, 4 h)** — AIBRAIN-43 as rescoped.
12. **No tests on 4,200 LOC** (plugin, render-core, desktop) — add vitest for render-core's pure functions (`orderClustersByConnection`, `computeClusters`) and one plugin smoke test; Windows job in CI. 1 day.
13. **OneDrive conflict copies** in `.vault-neural-links/` — VNL-008 documents exclusion now; VNL-035 designs a real answer.
14. **Duplicated decay math** in render-core — VNL-034; a drift here would make the graph lie about weights.
15. **Autolink over-linking** ("Index", "Plan" linked into everything) — VNL-012 skips ambiguous titles; consider a minimum title length of 6 and a stoplist.
16. **Stale vault notes** — the *Standalone Decoupled Product Direction* note still calls itself "the living plan-of-record"; *Case Study* misdescribes structuralFallback; the 2026-08-30 pause rationale cites 9/18 which is now 15/18. Update via `vault-memory` (done for this re-plan; the individual notes get an Updates entry when their topic is next touched).
17. **Founder-only tasks are not automatable** and should be listed separately so they are not lost: npm token (AIBRAIN-42), Obsidian submission (AIBRAIN-57), legal form + accountant (VNL-043), MoR account (VNL-040), confirmation of D1/D2.

---

## 5. Decisions needed from the founder

1. ~~Confirm D1~~ — confirmed 2026-09-02.
2. ~~Confirm D2~~ — confirmed 2026-09-02.
3. Create the npm Automation token and `NPM_TOKEN` secret (AIBRAIN-42).
4. Pick a launch date for Phase 1 so the 14-day validation window is a real window.
5. Whether to archive or delete the Jira project (left untouched by this re-plan).

---

## 6. Risk register (top 10)

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| 1 | Path traversal exploited via prompt injection | Critical | VNL-001 before publish |
| 2 | `update_note` destroys user frontmatter | Critical | VNL-003 before publish |
| 3 | Launch claim ("gets better with use") refuted publicly | High | D3 repositioning; publish the ablation ourselves |
| 4 | Platform vendors ship equivalent free memory (Claude Code auto-memory already default) | High | Portability + Obsidian graph are the lane; validate fast (Phase 1) |
| 5 | Content index fails outright on a large real vault | High | VNL-030 short term, VNL-031 |
| 6 | Event loss / double counting corrupts weights silently | High | VNL-004 |
| 7 | Obsidian store rejection delays distribution by weeks | Medium | AIBRAIN-43 checklist |
| 8 | Founder time consumed by non-product work | Medium | D1/D2 drop 25 tickets |
| 9 | Multi-machine sync forks weights | Medium | VNL-008 now, VNL-035 later |
| 10 | Usage-weight layer never becomes informative | Medium | VNL-021 seeding; VNL-022 gate makes dropping it a planned outcome, not a failure |

---

## 7. Strategic options considered (for the record)

A. Execute paid-from-launch as planned — rejected (wrong price band, 3–5 months to first euro, unproven demand).
B. Free MCP server + paid plugin Pro via MoR — **adopted as Phase 4, conditional on Phase 1**.
C. Fully free, monetize later — **adopted as Phases 0–3**.
D. Hosted memory API — rejected (competes with $50M+ of funded players and discards the local-first differentiator).
E. Open-source portfolio project only — fallback if Phase 1's gate fails on all four thresholds.

---

## 8. Disposition of every migrated Jira issue

Full descriptions and acceptance criteria are in [`BACKLOG-ARCHIVE.md`](BACKLOG-ARCHIVE.md). "Done — archived" means Jira status was Done at migration. Four items marked In Review/In Progress in Jira are `done` in the code and are recorded as such here.

| Key | Type | Jira status | Summary | Disposition |
|---|---|---|---|---|
| AIBRAIN-1 | Epic | To Do | Phase 1 — Engine Foundation | Closed — epic container only; children dispositioned individually |
| AIBRAIN-2 | Epic | To Do | Phase 2 — Memory Integrity | Closed — epic container only; children dispositioned individually |
| AIBRAIN-3 | Epic | To Do | Phase 3 — Retrieval Upgrade | Closed — epic container only; children dispositioned individually |
| AIBRAIN-4 | Epic | Done | Phase 4 — Structural Signals | Done — archived |
| AIBRAIN-5 | Epic | Done | Phase 5 — MCP Retrieval Reliability | Done — archived |
| AIBRAIN-6 | Epic | To Do | Phase 6 — Case Study Packaging | Closed — epic container only; children dispositioned individually |
| AIBRAIN-7 | Story | Done | As the engine, I decay edge/node strength exponentially so recency reflects the Ebbinghaus forgetting curve | Done — archived |
| AIBRAIN-8 | Subtask | Done | Add last_accessed + base_strength fields to edge schema | Done — archived |
| AIBRAIN-9 | Subtask | Done | Implement live decay computation at query time (replace linear/batch decay) | Done — archived |
| AIBRAIN-10 | Story | Done | As Claude Code, I get a priming boost for notes related to the current session so context stays coherent | Done — archived |
| AIBRAIN-11 | Subtask | Done | Build LRU session buffer + priming_bonus scoring function | Done — archived |
| AIBRAIN-12 | Story | Done | As a user, I see node brightness reflect decay and a warm ring around primed notes in the graph view | Done — archived |
| AIBRAIN-13 | Story | Done | As the engine, I promote edges to a consolidated tier after repeated reactivation so important notes don't get lost to decay | Done — archived |
| AIBRAIN-14 | Subtask | Done | Add recent_score/consolidated_score fields + nightly consolidation batch job | Done — archived |
| AIBRAIN-15 | Story | Done | As a user, I see a gold ring on notes that have been consolidated into long-term memory | Done — archived |
| AIBRAIN-16 | Story | Done | As the engine, I support a "supersedes/conflicts with" edge type so outdated notes surface their successor | Done — archived |
| AIBRAIN-17 | Story | Done | As the engine, I spread activation across bounded multi-hop neighbors so indirect context surfaces on query | Done — archived |
| AIBRAIN-18 | Subtask | Done | Implement bounded recursive activation traversal + threshold cutoff | Done — archived |
| AIBRAIN-19 | Story | Done | As a user, I watch activation pulse hop-by-hop through the graph with a visible retrieval path trace | Done — archived |
| AIBRAIN-20 | Story | Done | As a user, I can switch between Live and Study playback speed for the activation animation | Done — archived |
| AIBRAIN-21 | Story | Done | As the engine, I compute PageRank-style importance so hub notes stay weighted even when not recently touched | Done — archived |
| AIBRAIN-22 | Story | Done | As the engine, I run Louvain/Leiden clustering so topic communities are auto-discovered without manual tagging | Done — archived |
| AIBRAIN-23 | Story | Done | As a user, I see node size reflect hub importance and node color reflect cluster in the D3 visualization | Done — archived |
| AIBRAIN-24 | Story | Done | As Claude Code, I always receive at least k results from an MCP query, even under sparse activation | Done — archived |
| AIBRAIN-25 | Story | Done | As Claude Code, I never get an empty MCP response — a tiered fallback chain always serves something | Done — archived |
| AIBRAIN-26 | Story | Done | As an operator, I have a bounded per-call timeout and full retrieval logging so failures are visible before they cause a bad session | Done — archived |
| AIBRAIN-27 | Story | Done | As a reviewer, I can toggle layers on/off and see a "why was this retrieved" ablation diff | Done — archived |
| AIBRAIN-28 | Story | In Progress | As Brain Space, I have recorded demo captures and a written case study mapping each mechanism to its science source | Keep → Phase 2 (Retrieval truth) |
| AIBRAIN-29 | Epic | Done | Phase 7 — Science Research & Validation | Done — archived |
| AIBRAIN-30 | Story | Done | As the research lead, I compile a literature review validating each mechanism and screening new candidates | Done — archived |
| AIBRAIN-31 | Story | Done | As the research lead, I run ablation evaluations measuring retrieval quality per mechanism | Done — archived |
| AIBRAIN-32 | Epic | To Do | Phase 8 — Source-Agnostic Generalization (Beyond Obsidian) | Closed — epic container only; children dispositioned individually |
| AIBRAIN-33 | Story | Done | As an architect, I define a pluggable source-adapter interface so the engine is source-agnostic | Done — archived |
| AIBRAIN-34 | Story | To Do | As the engine, I infer candidate edges via AI when a source has no explicit links (Confluence, Azure Wiki, Word docs) | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-35 | Story | Done | As the engine, I apply per-note-type decay live at query time instead of baking it in at compaction | Done — archived |
| AIBRAIN-36 | Bug | Done | compactWeightsTool test call sites fail tsc --noEmit: handler takes 0 args, tests pass ({}) | Done — archived |
| AIBRAIN-37 | Task | Done | Graph view UI/UX pass: brain icon, dismissible retrieval panel, interim clustering layout | Done — archived |
| AIBRAIN-38 | Story | Done | Radial star layout: importance pulls nodes toward each cluster's own center | Done — archived |
| AIBRAIN-39 | Epic | In Progress | Installable distribution: npm + Obsidian community store | Keep → Phase 1 (Publish & validate) |
| AIBRAIN-40 | Task | Done | Add LICENSE + npm publish metadata for core and mcp-server | Done — archived |
| AIBRAIN-41 | Task | Done | Bundle core into mcp-server build; adopt Changesets for monorepo versioning | Done — archived |
| AIBRAIN-42 | Task | In Review | GitHub Actions release workflow: Changesets -> npm publish | Keep → Phase 1 (Publish & validate) |
| AIBRAIN-43 | Task | To Do | Obsidian plugin: versions.json, release-asset workflow, submit to obsidian-releases | Keep → Phase 1 (Publish & validate) |
| AIBRAIN-44 | Task | Done | Update README.md / INSTALL.md with new one-line install instructions | Done — archived |
| AIBRAIN-45 | Task | To Do | Shared core-backed read path for SessionStart MOC/Inbox context | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-46 | Story | Done | As Obsidian, I own the daily compact/consolidation cycle myself, with no external scheduler or Claude Code trigger | Done — archived |
| AIBRAIN-47 | Epic | To Do | Phase 1: Build the MCP server | Closed — epic container only; children dispositioned individually |
| AIBRAIN-48 | Epic | To Do | Phase 2: Obsidian plugin wrapper and public launch | Closed — epic container only; children dispositioned individually |
| AIBRAIN-49 | Epic | To Do | Phase 3: Validate demand | Closed — epic container only; children dispositioned individually |
| AIBRAIN-50 | Epic | To Do | Phase 4: Standalone cloud app (conditional on Phase 3) | Closed — epic container only; children dispositioned individually |
| AIBRAIN-51 | Task | Done | Rebuild reinforcement engine and context assembly as MCP tool handlers | Done — archived |
| AIBRAIN-52 | Task | Done | Vault-reading layer: parse existing Obsidian markdown files directly | Done — archived |
| AIBRAIN-53 | Task | Done | Build one-click installer / npx setup for MCP server | Done — archived |
| AIBRAIN-54 | Task | To Do | Dogfood: use MCP server as daily working memory layer | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-55 | Task | Done | Build thin Obsidian plugin wrapper (auto-start MCP server + settings) | Done — archived |
| AIBRAIN-56 | Task | Done | Integrate D3 weighted-graph visualization as plugin panel | Done — archived |
| AIBRAIN-57 | Task | To Do | Submit plugin to Obsidian community plugin directory | Keep → Phase 1 (Publish & validate) |
| AIBRAIN-58 | Task | To Do | Public launch: r/ObsidianMD and Hacker News with demo video | Keep → Phase 1 (Publish & validate) |
| AIBRAIN-59 | Task | To Do | Set up paid tier (3 to 4 EUR monthly) gating reinforcement engine and visualization | Dropped — 3–4 EUR/mo tier; replaced by Phase 4 MoR pricing |
| AIBRAIN-60 | Task | To Do | Track installs, weekly active usage, and free-to-paid conversion | Keep → Phase 4, merged into VNL-046 |
| AIBRAIN-61 | Task | Done | Decision gate: go/no-go on Phase 4 based on Phase 3 data | Done — archived |
| AIBRAIN-62 | Task | To Do | Move reinforcement engine and context assembly server-side as cloud backend | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-63 | Task | To Do | Build standalone custom UI, decoupled from Obsidian | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-64 | Task | In Progress | Build markdown/vault import tooling for onboarding | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-65 | Task | To Do | Reprice for standalone cloud app based on usage data | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-66 | Epic | In Progress | Retrieval Benchmark vs. Baselines + Personal Usage Analytics | Keep → Phase 2 (Retrieval truth) |
| AIBRAIN-67 | Story | Done | As the research lead, I compare retrieval quality against grep, semantic-embedding, and naive full-context baselines | Done — archived |
| AIBRAIN-68 | Story | In Review | As a user, I see a personal usage report summarizing how I actually use the engine | Done — code is committed/merged; Jira status was stale |
| AIBRAIN-69 | Epic | Done | Deterministic usage instrumentation — stop delegating logging decisions to the LLM | Done — archived |
| AIBRAIN-70 | Story | Done | Persist every search_notes call to the event log | Done — archived |
| AIBRAIN-71 | Story | Done | Replace reinforce_link's LLM-judgment trigger with outcome-based auto-reinforcement | Done — archived |
| AIBRAIN-72 | Story | Done | Remove log_traversal's manual-credit path once auto-logging covers its gap | Done — archived |
| AIBRAIN-73 | Epic | To Do | Licensing/subscription backend — Stripe direct integration, paid from launch | Dropped — own licensing backend replaced by MoR platform |
| AIBRAIN-74 | Epic | To Do | Landing site & Stripe Checkout | Dropped — landing page kept as VNL-010; Stripe Checkout dropped |
| AIBRAIN-75 | Epic | To Do | Plugin-side license guard & UX | Dropped — epic replaced by VNL-041/042 |
| AIBRAIN-76 | Epic | To Do | Billing lifecycle & customer self-service | Dropped — billing lifecycle handled by MoR |
| AIBRAIN-77 | Epic | To Do | Legal, compliance & support readiness | Dropped — kept parts merged into VNL-043/045 |
| AIBRAIN-78 | Epic | To Do | Backend hosting & operational reliability | Dropped — no owned backend needed |
| AIBRAIN-79 | Epic | To Do | Post-launch: account dashboard & business metrics | Dropped — MoR dashboard covers this |
| AIBRAIN-80 | Story | To Do | Stripe account setup: business profile, products/prices, tax config | Dropped — MoR handles |
| AIBRAIN-81 | Story | To Do | Entitlement data model & database | Dropped — MoR handles |
| AIBRAIN-82 | Story | To Do | Stripe webhook receiver (signature verification + idempotency) | Dropped — MoR handles |
| AIBRAIN-83 | Story | To Do | License verification endpoint | Dropped — MoR validate endpoint used instead |
| AIBRAIN-84 | Story | To Do | Device/seat limit policy + enforcement | Dropped — MoR license activation limits |
| AIBRAIN-85 | Story | To Do | License key generation & delivery email | Dropped — MoR handles |
| AIBRAIN-86 | Story | To Do | Marketing/pricing landing page | Dropped — merged into VNL-010 |
| AIBRAIN-87 | Story | To Do | Stripe Checkout integration | Dropped — MoR checkout |
| AIBRAIN-88 | Story | To Do | Post-purchase success flow | Dropped — MoR handles |
| AIBRAIN-89 | Story | To Do | Settings UI: enter/validate license key | Keep → Phase 4, merged into VNL-042 |
| AIBRAIN-90 | Story | To Do | Runtime feature guard | Keep → Phase 4, merged into VNL-041 |
| AIBRAIN-91 | Story | To Do | Offline grace period / cached entitlement | Keep → Phase 4, merged into VNL-042 |
| AIBRAIN-92 | Story | To Do | Graceful degraded/unlicensed state | Keep → Phase 4, merged into VNL-042 |
| AIBRAIN-93 | Story | To Do | Stripe Customer Portal integration | Dropped — MoR customer portal |
| AIBRAIN-94 | Story | To Do | Dunning handling (failed payment -> grace period -> downgrade) | Dropped — MoR dunning |
| AIBRAIN-95 | Story | To Do | Compliant self-serve cancellation flow | Dropped — MoR cancellation |
| AIBRAIN-96 | Story | To Do | Refund/chargeback policy + handling process | Dropped — MoR policy templates + VNL-043 |
| AIBRAIN-97 | Story | To Do | Terms of Service + Privacy Policy drafted and published | Keep → Phase 4, merged into VNL-043 |
| AIBRAIN-98 | Story | To Do | VAT/sales-tax registration & Stripe Tax configuration | Keep → Phase 4, merged into VNL-043 |
| AIBRAIN-99 | Story | To Do | Support channel setup | Keep → Phase 4, merged into VNL-045 |
| AIBRAIN-100 | Story | To Do | Obsidian community-plugins.json submission README disclosure | Keep → Phase 1 (Publish & validate) |
| AIBRAIN-101 | Story | To Do | Choose hosting platform + deploy pipeline | Dropped — no backend |
| AIBRAIN-102 | Story | To Do | Uptime monitoring & alerting | Dropped — no backend |
| AIBRAIN-103 | Story | To Do | Rate limiting & abuse protection on verification endpoint | Dropped — no backend |
| AIBRAIN-104 | Story | To Do | Secrets management for Stripe keys and DB credentials | Dropped — no backend |
| AIBRAIN-105 | Story | To Do | Optional account/login for self-serve license management | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-106 | Story | To Do | Business metrics dashboard (MRR, churn, activation) | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-107 | Task | To Do | Validate MCP server behavior under non-Claude clients (Codex CLI, Gemini CLI) | Keep → Phase 1 (Publish & validate) |
| AIBRAIN-108 | Epic | To Do | Scale testing: synthetic 300k-note corpus + performance benchmarking | Keep → Phase 3 (Scale), rescoped after VNL-031 |
| AIBRAIN-109 | Epic | In Progress | OKF format support: implementation + scale/mock-data validation | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-110 | Story | To Do | Synthetic vault generator (preferential-attachment topology) | Keep → Phase 3 (Scale), rescoped after VNL-031 |
| AIBRAIN-111 | Story | To Do | Wikipedia-derived real-world link-graph sample (secondary validation corpus) | Keep → Phase 3 (Scale), rescoped after VNL-031 |
| AIBRAIN-112 | Story | To Do | Full-pipeline benchmark run at 300k-note scale | Keep → Phase 3 (Scale), rescoped after VNL-031 |
| AIBRAIN-113 | Story | To Do | Document bottlenecks/scaling limits found | Keep → Phase 3 (Scale), rescoped after VNL-031 |
| AIBRAIN-114 | Story | To Do | Re-validate OKF migration plan against the published v0.1 spec | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-115 | Story | To Do | Execute migration plan Phases A-C (shared resolver, dual-syntax parsing, autolink switch) | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-116 | Story | To Do | Execute migration plan Phases D-E (Obsidian setting + existing-notes migration) | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-117 | Story | To Do | Synthetic large-scale OKF corpus generator | Keep → Phase 3 (Scale), rescoped after VNL-031 |
| AIBRAIN-118 | Story | To Do | Run engine against synthetic OKF corpus at scale | Keep → Phase 3 (Scale), rescoped after VNL-031 |
| AIBRAIN-119 | Epic | To Do | Anonymous, offline-first telemetry pipeline | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-120 | Story | To Do | Anonymous local event buffer | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-121 | Story | To Do | Local telemetry queue storage security | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-122 | Story | To Do | Offline-first batched sync with retry/backoff and eviction | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-123 | Story | To Do | Backend telemetry ingestion endpoint | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-124 | Story | To Do | Opt-in first-run UX + settings toggle | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-125 | Story | To Do | Data minimization / anonymization spec | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-126 | Story | Done | Persist get_weighted_neighbors() calls to the retrieval log | Done — archived |
| AIBRAIN-127 | Task | To Do | Desktop app: setup screen has no logout button | Deferred → Phase 5 (conditional/later) |
| AIBRAIN-128 | Story | Done | Obsidian plugin reads the desktop app's shared account session instead of its own license-key login | Done — archived |
| AIBRAIN-129 | Story | To Do | No entitlement gate exists: unauthorized users get full retrieval access today | Keep → Phase 4, merged into VNL-042 |
| AIBRAIN-130 | Story | Done | Investigate stale/noisy accumulated usage weight degrading rank-1 vs. zero-usage baseline | Done — archived |
| AIBRAIN-131 | Story | In Review | Desktop app note-list/graph render hangs at 300k-note scale — capped to top-N by importance | Done — code is committed/merged; Jira status was stale |
| AIBRAIN-132 | Bug | In Review | searchNotes crashes (EMFILE/OOM) on broad queries against large vaults — unbounded concurrent weight lookups | Done — code is committed/merged; Jira status was stale |
| AIBRAIN-133 | Epic | In Progress | searchNotes has no content index — full-vault linear scan takes 130s+ at 300k-note scale | Done — code is committed/merged; Jira status was stale |
| AIBRAIN-134 | Story | To Do | Define evidence-state taxonomy (Retrieved/Read/Re-query/Referenced/Helpful); don't feed raw telemetry into graph weights until correlation is measured | Keep → Phase 2 (Retrieval truth) |
| AIBRAIN-135 | Story | To Do | Memory Trace panel in Obsidian plugin — expose retrieved/read/traversal lifecycle per query | Keep → Phase 2 (Retrieval truth) |
| AIBRAIN-136 | Story | To Do | Query-level "was this helpful" feedback attached to Memory Trace | Keep → Phase 2 (Retrieval truth) |
| AIBRAIN-137 | Story | To Do | Citation-token report_usage() experiment — measure real invocation rate | Keep → Phase 2 (Retrieval truth) |
| AIBRAIN-138 | Bug | Done | search_notes returns empty for real notes — matching is literal substring only, no tokenization | Done — archived |
| AIBRAIN-139 | Bug | Done | search_notes ranks by usage weight alone — exact title matches lose to incidental mentions in hub notes | Done — archived |
| AIBRAIN-140 | Story | Done | Relevance-ranked plain-text search now beats activate() on rank-1 — re-examine whether the Hebbian/spreading-activation layer earns its complexity | Done — archived |
| AIBRAIN-141 | Story | Done | Priming has no intra-session decay — a note touched early in a long session stays top-tier after it stops being relevant | Done — archived |
| AIBRAIN-142 | Story | To Do | Content index doesn't narrow enough for corpora with heavily repeated vocabulary — candidates still need per-file reads | Keep → Phase 2 (Retrieval truth) |

---

## 9. Changelog

- **2026-09-03 (Phase 2b starts)** — VNL-050 `done`: the `recall` tool ships, so the engine's entry point is a *query*, not a note (D10). Lexical relevance (BM25; document frequencies come free from the existing content index, term frequencies are computed live over a capped candidate set — the index carries no per-note counts and giving it some belongs to VNL-031, not here) picks the seed set; spreading activation runs per seed with energy proportional to that seed's share of the lexical score; both axes are normalized within the result set and blended at `graphWeight` 0.5, so the graph re-ranks and expands but cannot outrank a strong textual match. Each hit carries a snippet and a `why` (matched terms, seed + hop count, energy, `staleDays`, `supersededBy`, `primed`). Reading a graph-expanded hit auto-reinforces the seed → hit edge, which search_notes could never do (a text query has no origin note). One defect was found by running it against the real 474-note vault and is now a regression test: a seed got no graph score of its own while its neighbours did, so a hub MOC one hop away outranked the note that answered the query; the origin now keeps its own activation. 303 tests green (260 core, 43 mcp-server), all five packages typecheck, root build succeeds. Not yet a quality *claim*: the MRR-vs-plain-search gate is VNL-020's job (D6).

- **2026-09-03 (Phase 0 complete)** — VNL-002/003/004/005/006/007/008/009/012 all `done`; the Phase 0 gate is met, which unlocks Phases 1 and 3 and makes Phase 2b the primary track. Highlights: the activation WebSocket binds loopback only and is now optional rather than fatal (VNL-002); `parseFrontmatter` understands Obsidian block lists and nested maps and, more importantly, keeps the block's source text so a body-only `update_note` re-emits it byte for byte (VNL-003); compaction takes an exclusive lock, claims its input files by renaming before reading, and quarantines corrupt lines instead of aborting (VNL-004); the server reports its real version and its tarball dropped 75 KB → 19.2 KB (VNL-005); the first changeset is in (VNL-006); an MCP-client integration test over the SDK's in-memory transport covers `tools/list`, a note round trip and containment refusals on every path-taking tool (VNL-007); README/INSTALL now state only what was measured and tell users to exclude `.vault-neural-links/` from file sync (VNL-008); per-instance session and socket files are deleted on shutdown and pruned nightly (VNL-009); the auto-link scan's unbounded `Promise.all` is gone (VNL-012). 288 tests green, all five packages typecheck, root build succeeds.

- **2026-09-03 (later still)** — VNL-012 auto-link noise, second pass: a path-form link (`[[MOCs/X]]`) now counts as already linking the note titled `X`; a single-word term must match the note's own casing, so a note titled `Reports` no longer links itself into every note using the word in prose; and text inside an existing wikilink is no longer read as this note's prose. 7 more tests (22 in `autolink.test.ts`), 260 green.

- **2026-09-03 (later)** — VNL-012 ambiguous-title half done: `autoLinkScan` now links a title or alias only when it uniquely identifies one note, mirroring `buildStructuralIndex`'s existing rule. Found in practice — writing one vault note appended 27 auto-links, 20 of them identical dead `[[Index]]` links. 6 new tests. The bounded-concurrency half of VNL-012 is still open, so the row stays `doing`.

- **2026-09-03** — VNL-001 done: `resolveInsideVault`/`resolveNoteFile`/`assertVaultRelativePath` added in `packages/core/src/vaultPaths.ts` and wired into `toFilePath`, `listNotes`, `readNoteType`, `readSupersession` and the desktop IPC note handlers; every path argument in `tools.ts` now carries a zod `.refine`. 20 new tests (15 core, 5 mcp-server); 247 tests green, all five packages typecheck. Autolink is covered transitively (it only takes paths from `listNotes` and writes through `writeNote`). The rule and its rationale are in the vault: `Notes/VaultNeuralLinks/Vault Path Containment Rule`.

- **2026-09-02 (later still)** — Founder confirmed D10 and the Phase 2b priority order; Phase 2b is the primary track after Phase 0.
- **2026-09-02 (later)** — Founder confirmed D1–D9. D10 added (engine usefulness thesis) with Phase 2b items VNL-050..057 as the priority track; see §3 Phase 2b and analysis report addendum.
- **2026-09-02** — File created. Jira AIBRAIN retired (D8). Decisions D1–D9 recorded. Phases 0–5 defined. 142 issues dispositioned: 57 done, 30 kept, 21 deferred, 25 dropped, 9 epic containers closed. Source analysis: `analysis/2026-09-02-deep-analysis-report.md`.
