# Vault Neural Link — Deep Analysis Report

**Date**: 2026-09-02 · **Repo**: `main` @ `f7b6b55` · **Scope**: CTO review, investor feasibility, architect re-plan, gap proposals, cross-check.

This is the consolidated report. The three underlying analyses are next to it and are quoted, not repeated:

- [`2026-09-02-cto-audit.md`](2026-09-02-cto-audit.md) — technical due diligence, file:line cited.
- [`2026-09-02-investor-memo.md`](2026-09-02-investor-memo.md) — market, willingness-to-pay, moat, options, sources linked.
- [`2026-09-02-vault-decision-digest.md`](2026-09-02-vault-decision-digest.md) — every recorded decision, constraint, measurement and open question from the Obsidian vault.
- [`2026-09-02-jira-export.json`](2026-09-02-jira-export.json) — raw export of all 142 AIBRAIN issues; rendered faithfully in [`../BACKLOG-ARCHIVE.md`](../BACKLOG-ARCHIVE.md).

The resulting plan is [`../PLAN.md`](../PLAN.md). This report explains how it was reached.

---

## Executive summary

**The engine is real, well-built and tested. The product is not yet safe to publish, its headline claim is not yet demonstrated, and its business plan front-loads the wrong work.**

- Eight weeks of solo work produced ~8.4k lines of strict TypeScript across five packages with 227 passing tests and a clean build. The retrieval mechanisms (decay, priming, consolidation, spreading activation, PageRank, Louvain, tiered fallback) all behave as documented.
- Two critical defects block publishing: every path-taking MCP tool escapes the vault with `../` (confirmed over the protocol: read, write and list outside the vault), and `update_note` destroys any Obsidian frontmatter that is not a flat scalar or inline list. Both are hours to fix.
- The core claim — "memory gets more accurate the longer it runs" — is not supported by the founder's own data. With all usage weights zeroed the benchmark score is unchanged (15/18). The benchmark itself pre-seeds the session buffer with the answer, so it can only show that session priming works. Plain relevance-ranked text search has a better mean rank (1.27 vs 2.38).
- The real vault holds 122 usage edges and 144 traversals after two months. The Hebbian layer is signal-starved, not just unmeasured.
- As a business on the recorded plan (paid from launch, 3–4 EUR/month, self-built Stripe/entitlement backend, founder as Merchant of Record) the investor view scores it 2/10: ~45 tickets of non-product work before the first euro, a price band that does not exist in the MCP market, no demand evidence. As a product it scores 7/10.
- The re-plan therefore: fixes safety first (Phase 0, ~4 days), publishes free and validates demand against four measurable thresholds in 14 days (Phase 1), rebuilds the benchmark and attacks cold-start so the differentiator can be tested honestly (Phase 2), replaces monolithic JSON indexes with SQLite before any scale claim (Phase 3), and monetizes the Obsidian plugin through a Merchant-of-Record platform only if validation passes (Phase 4). Jira is retired; 142 issues are dispositioned in `PLAN.md` §8.

Two decisions overturn recorded vault decisions and need the founder's explicit confirmation: free launch first (vs paid from launch) and MoR platform (vs Stripe direct, no resellers).

---

## Part 1 — CTO view: what is done, how, and what is pending

### Built and working

| Package | LOC (src/test) | Maturity | Notes |
|---|---|---|---|
| `core` | 3,552 / 2,749 | Beta (math), alpha (I/O) | 200 tests. All mechanisms unit-tested. No tests for concurrency, corruption, path safety, Windows. |
| `mcp-server` | 611 / 448 | Alpha, unsafe | 11 tools over stdio; `ws` broadcast socket. Protocol verified end-to-end by smoke test. Tests call handlers directly, none through a client. |
| `obsidian-plugin` | 1,404 / 0 | Prototype | Graph view, 4 file watchers, nightly scheduler, panels. `isDesktopOnly:false` is wrong; version `0.0.0`. |
| `render-core` | 1,328 / 0 | Alpha | d3-force + canvas. Re-implements decay math independently of core. |
| `desktop-app` | 1,482 / 0 | Prototype, paused | Electron; OAuth PKCE against an in-process mock IdP; no CSP; `innerHTML` of note paths. |

Verification runs today: `tsc --noEmit` clean in all five packages; `npm run build` succeeds; `eval-retrieval.mjs` and `benchmark-baselines.mjs` run read-only against the real vault in ~4 s / ~2.4 s; `npm audit --omit=dev` shows one moderate advisory in a transitive `express`/`qs` dependency that is unreachable (stdio transport only).

### How it works (short)

All runtime state lives in `<vault>/.vault-neural-links/` as JSON and JSONL, every writer uses tmp+rename. `search_notes` narrows candidates via a content index then scores title > alias > content with weight as a capped tie-breaker. `get_weighted_neighbors`/`activate` go through `computeLiveNeighborWeights`, which live-decays edges, blends PageRank importance, floors primed neighbours just above the strongest unprimed one (scaled by a 20-minute priming half-life), and spreads energy over up to 3 hops. `retrieveWithFallback` relaxes thresholds up to 3 times, then keyword, then recency, inside a 300 ms budget. The Obsidian plugin polls the same files and connects to the server's WebSocket for live activation traces. Nightly maintenance (compact, consolidate, reindex, PageRank, Louvain, content index) is triggered solely by the plugin.

### Pending, as visible from the code and docs

- Publishing: mechanically ready (core bundled into mcp-server, verified; release workflow correct) but no changeset pending and version hardcoded `0.0.0`. Founder must add `NPM_TOKEN`.
- Obsidian store: not ready (manifest flag, version, `versions.json`, `registerInterval`, logging).
- Entitlement/licensing: nothing exists; desktop login talks to a mock IdP that auto-approves a demo account.
- Cross-client validation (Codex, Gemini, Cursor): never done, though it is the positioning.
- `docs/spec.md` describes an abandoned "no MCP" design; `docs/claude-code-integration.md` shows a removed tool.
- 84 stale session files, OneDrive conflict copies of weights/importance/structural files in the real data dir.

### Top defects (severity, effort)

1. Path traversal in all path-taking tools — critical, 4 h.
2. Frontmatter destruction on `update_note` — critical, 4 h.
3. WebSocket bound to all interfaces, unauthenticated — high, 1 h.
4. Compaction unlinks the live session's event file after reading it (events appended in between are lost); no lock, so two compactors double-fold — high, 1 day.
5. One malformed JSONL line breaks compaction permanently — high, 1 h.
6. Content index does not scale with real note bodies (8.5 MB at 471 notes; parsed per query) — high, 1 day short-term / 1 week for SQLite.
7. Retrieval re-reads three JSON files and scans every edge per neighbour lookup — high, 1 day.
8. Benchmark circularity (target pre-seeded) — high, 2 days.
9. Autolink reads every note per write with unbounded concurrency and links ambiguous titles — medium, 1 day.
10. Zero tests on 4,214 LOC (plugin, render-core, desktop); Ubuntu-only CI — medium, 2 days.

Full list of 15 with file:line references and 14 quick wins: CTO audit §9–10.

---

## Part 2 — Investor view: is the idea feasible?

### Market

- Agent memory as hosted infrastructure is heavily funded (Mem0 $24M, Letta $10M, Cognee €7.5M, Supermemory $3M, Honcho $5.35M) and platform vendors ship free memory (Claude Code auto-memory on by default since Feb 2026; Anthropic memory tool in beta; Codex/Cursor/Windsurf memories). VNL cannot compete on that axis.
- In VNL's actual lane (local, markdown-native, Obsidian) there are direct competitors: Basic Memory (AGPL, cloud $15–19/mo), Vestige (Rust, FSRS decay + spreading activation, Pro $19/mo, 1,961 tests), several Obsidian MCP plugins (the original reached 87k installs), and two AI plugins that monetize successfully at 3–8x VNL's proposed price (Copilot for Obsidian $75–140/yr; Smart Connections $299/yr or capped lifetime tier, 823 of 1,000 sold).
- The mechanism family (spreading activation, ACT-R-style decay, Hebbian updates) is mainstream in 2026 research (SYNAPSE, ACL 2026) and implemented by at least one solo competitor. What nobody else does: run it over the **human-authored** wikilink graph and render it back inside Obsidian.
- OKF (Google, June 2026) is a cheap checkbox, not a demand driver.

### Willingness to pay and unit economics

- Obsidian ~1.5M MAU; developers who drive an MCP agent daily against their vault: ~20–40k (estimate); those with enough traffic for usage weights to matter: ~3–8k. The headline feature addresses a hobby-sized market; the broader product (priming + structure + graph) addresses the 20–40k.
- At 3.50 EUR/month a MoR's 5% + 0.50 fee is an 18% take; annual pricing drops it to ~6%. Self-billing saves ~0.33 EUR/user/month — worth it only past ~2–3k subscribers.
- ARR bands at 12 months: conservative ~0.7k EUR, base ~6k EUR, optimistic ~43k EUR. Side income, not a business, under any plan short of Smart-Connections-class growth.

### Moat

Not the code (3.5k LOC MIT), not the Hebbian layer (measures zero lift today), not data lock-in (explicitly disclaimed). Thin but real: the human graph as substrate, the in-Obsidian visualization with activation pulses, session priming as a marketable feature, and cross-client portability (real pain, but shared with every MCP memory server).

### Verdict

Product 7/10. Business on the current plan 2/10. Business on the recommended path (free → validated → plugin Pro via MoR) 5/10. Three assumptions to test first: does anyone else want this (installs/stars in 14 days); is the graph worth money (fake-door pre-orders); do usage weights ever become informative (monthly ablation on ≥3 external vaults). Full memo with sources: investor memo §1–7.

---

## Part 3 — Architect view: the re-plan

Inputs: Part 1, Part 2, and the vault digest's binding constraints (MCP-only AI surface; cross-client portability; no Claude-Code-specific hooks; deterministic server-owned logging; data stays in the vault as plain files; nightly pipeline owned by the plugin; one rendering codepath; measure before adding mechanisms).

What the re-plan keeps: every binding technical constraint above, the MIT license, the portability positioning, the desktop-app pause, the deterministic-logging architecture, the local-files promise.

What it changes: sequencing (safety before publish; validation before monetization), monetization mechanics (MoR instead of an owned backend — needs confirmation), positioning (priming + structure + graph, not Hebbian), the index storage shape (SQLite instead of monolithic JSON), the benchmark design, and an explicit cold-start strategy with a month-6 keep-or-drop gate on the usage-weight layer.

What it drops: 25 Jira items — the Stripe/entitlement/dunning/portal/hosting/secrets/monitoring stack and the 3–4 EUR/month tier. All are listed with a one-line reason in `PLAN.md` §8.

Phases, gates and effort are in `PLAN.md` §3. The critical path to a public, safe, honestly-described release is Phase 0 (~4 engineering days) plus the founder's npm token.

---

## Part 4 — Gaps and proposals

Seventeen numbered proposals are in `PLAN.md` §4, each tied to a work item. The ones that are not obvious from the defect list:

- **Benchmark redesign** with unprimed / related-primed / target-primed conditions and MRR, ≥50 queries, a second vault, run in CI. Without it no quality claim can be made and the month-6 gate cannot be evaluated.
- **Cold-start seeding** of initial weights from backlink counts, mtime recency and optional Obsidian workspace history, with a shorter initial half-life. Gives the Hebbian layer a fair test instead of starving it.
- **SQLite-backed index store** (`node:sqlite` preferred, spike to confirm) replacing five monolithic JSON files, keeping the "delete the folder and the vault is plain again" property.
- **Multi-machine sync strategy** — the observed OneDrive conflict copies show the current layout forks weights across machines; document exclusion now, design per-machine merge later.
- **Deduplicate decay math** out of render-core so the graph cannot drift from the engine.
- **Free/Pro split** that keeps the whole MCP server and a static graph free and puts animation/history/Memory Trace/consolidation dashboard/multi-vault behind Pro — mirrors what works in the Obsidian store.
- **Founder-only task list** kept separate so non-automatable items (token, submission, legal form, MoR account, two confirmations) are not lost among engineering tickets.

---

## Part 5 — Cross-check

What was independently verified in this session, beyond the agents' reports:

| Claim | How verified | Result |
|---|---|---|
| Path traversal | Read `notes.ts` `toFilePath` and `listNotes`; CTO agent additionally exercised it over the MCP protocol | Confirmed, no containment check anywhere |
| Frontmatter data loss | Ran `parseFrontmatter` on an Obsidian block-list `aliases:` via the built `core` | `aliases: ""` — confirmed |
| Compactor unlinks live files | Read `compactor.ts` lines 75 and 166–172 | Confirmed; the inline comment is false |
| WebSocket binding | Grepped `activationSocket.ts` for host/loopback | No host given → all interfaces; CTO agent observed `{"address":"::"}` |
| No pending changeset | `npx changeset status` | "Packages to be bumped:" empty — confirmed |
| Benchmark pre-seeding | Read both scripts | `sessionBuffer.touch(q.target)` before every measurement — confirmed |
| Benchmark numbers | Re-ran `benchmark-baselines.mjs` | engine 15/18 rank-1, mean 2.375; grep 13/18, mean 1.267; distractor ranks #1 in engine — confirmed |
| Real vault signal volume | Parsed `link-weights.json` | 122 edges, 144 traversals, 9 reinforcements, 4 consolidated — confirmed |
| Index sizes | `ls` on real vault and 300k fixture | 8.2 MB @ 474 notes; 375 MB content index and 78 MB structural index @ 300k synthetic — confirmed |
| Tests | Ran both suites | 200/200, 27/27 |
| Jira migration completeness | Agent's self-check plus independent key count | 142/142 keys present exactly once in archive; 142 rows in disposition table |

Discrepancies found and how they were resolved:

- The vault's latest recorded benchmark is 9/18 rank-1 (2026-08-28); the repo's is 15/18 (fixes on 2026-09-02). Both are correct for their dates; the vault note was not updated after the fix. Recorded as a staleness item (PLAN §4.16).
- The vault records `AUTO_REINFORCE_BOOST` as 3; the code has 1 (lowered in the AIBRAIN-66 fast-follow). Code wins; vault is stale.
- Note counts differ slightly between runs (471/472/474) because of transient files; immaterial.
- The investor memo flags one funding figure (Zep, reported $500K) as likely understated and one Bulgarian VAT procedural detail (EX-number notification) as needing an accountant. Both are labelled as estimates in the memo and neither affects the recommendation.
- Four Jira items marked In Review/In Progress (AIBRAIN-68, 131, 132, 133) are complete in the code; the plan records them as done.

Nothing in the three reports contradicted the code once checked. The only claims in the repo's own docs that did not survive verification are the README's "verified against a 300,000-note vault" for retrieval (search only, synthetic) and STATUS.md's framing of the engine as "back ahead of plain text search" (true on rank-1 count, false on mean rank).

---

## What was changed in the repository today

- Added `docs/PLAN.md` (plan of record), `docs/BACKLOG-ARCHIVE.md` (faithful Jira export), `docs/analysis/` (this report, three analyses, raw Jira JSON).
- Updated `CLAUDE.md` so the source of truth for tasks is `docs/PLAN.md`, not Jira.
- Replaced `docs/STATUS.md` with a short pointer and today's state; marked Part 1 of `docs/PLAN-AND-ARCHITECTURE.md` as superseded.
- No source code was changed. Nothing was committed; nothing was changed in Jira.
