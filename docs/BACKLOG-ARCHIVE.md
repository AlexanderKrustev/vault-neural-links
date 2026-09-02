# AIBRAIN backlog — migrated from Jira on 2026-09-02

Jira project AIBRAIN (brainspace-dev.atlassian.net) is retired as of this date; this file is the frozen, faithful export. The live backlog is [`PLAN.md`](PLAN.md); every key below has a disposition row in PLAN.md §8. Status snapshot at migration: 53 Done, 6 In Progress, 4 In Review, 79 To Do (142 total).

## How to read this file

Status vocabulary is Jira's, unchanged: **To Do**, **In Progress**, **In Review**, **Done**. Priority is Jira's five-step scale (Highest / High / Medium / Low / Lowest). Every item keeps its original `AIBRAIN-nn` key as a stable ID — keys are never reused or renumbered, and cross-references inside descriptions (other tickets, vault notes as `[[...]]` or quoted titles, commits, file paths) are kept verbatim from Jira. Hierarchy is Epic > Story/Task/Bug > Subtask; an issue with no parent epic is listed under "Orphan issues". Descriptions are faithful condensations of the Jira text (acceptance criteria, numbers, decisions and rationale retained; formatting noise dropped). To add a new item, take the **next free key, AIBRAIN-143**, add it under its epic in the detail section (or under Orphan issues) with the same heading shape, and add a row/line to the status index. To change status, edit the `[type, status, priority]` tag and move the index entry.

## Index by status

### In Progress / In Review (10)

| Key | Type | Status | Summary | Parent epic |
| --- | --- | --- | --- | --- |
| AIBRAIN-28 | Story | In Progress | As Brain Space, I have recorded demo captures and a written case study mapping each mechanism to its science source | AIBRAIN-6 — Phase 6 — Case Study Packaging |
| AIBRAIN-39 | Epic | In Progress | Installable distribution: npm + Obsidian community store | (is an epic) |
| AIBRAIN-42 | Task | In Review | GitHub Actions release workflow: Changesets -> npm publish | AIBRAIN-39 — Installable distribution: npm + Obsidian community store |
| AIBRAIN-64 | Task | In Progress | Build markdown/vault import tooling for onboarding | AIBRAIN-50 — Phase 4: Standalone cloud app (conditional on Phase 3) |
| AIBRAIN-66 | Epic | In Progress | Retrieval Benchmark vs. Baselines + Personal Usage Analytics | (is an epic) |
| AIBRAIN-68 | Story | In Review | As a user, I see a personal usage report summarizing how I actually use the engine | AIBRAIN-66 — Retrieval Benchmark vs. Baselines + Personal Usage Analytics |
| AIBRAIN-109 | Epic | In Progress | OKF format support: implementation + scale/mock-data validation | (is an epic) |
| AIBRAIN-131 | Story | In Review | Desktop app note-list/graph render hangs at 300k-note scale — capped to top-N by importance | AIBRAIN-108 — Scale testing: synthetic 300k-note corpus + performance benchmarking |
| AIBRAIN-132 | Bug | In Review | searchNotes crashes (EMFILE/OOM) on broad queries against large vaults — unbounded concurrent weight lookups | — |
| AIBRAIN-133 | Epic | In Progress | searchNotes has no content index — full-vault linear scan takes 130s+ at 300k-note scale | (is an epic) |

### To Do (79) — grouped by epic

**AIBRAIN-1 — Phase 1 — Engine Foundation** [To Do] (1)

- AIBRAIN-1 — Phase 1 — Engine Foundation [Epic, Highest] *(the epic itself)*

**AIBRAIN-2 — Phase 2 — Memory Integrity** [To Do] (1)

- AIBRAIN-2 — Phase 2 — Memory Integrity [Epic, High] *(the epic itself)*

**AIBRAIN-3 — Phase 3 — Retrieval Upgrade** [To Do] (1)

- AIBRAIN-3 — Phase 3 — Retrieval Upgrade [Epic, High] *(the epic itself)*

**AIBRAIN-6 — Phase 6 — Case Study Packaging** [To Do] (1)

- AIBRAIN-6 — Phase 6 — Case Study Packaging [Epic, Medium] *(the epic itself)*

**AIBRAIN-32 — Phase 8 — Source-Agnostic Generalization (Beyond Obsidian)** [To Do] (2)

- AIBRAIN-32 — Phase 8 — Source-Agnostic Generalization (Beyond Obsidian) [Epic, Low] *(the epic itself)*
- AIBRAIN-34 — As the engine, I infer candidate edges via AI when a source has no explicit links (Confluence, Azure Wiki, Word docs) [Story, Low]

**AIBRAIN-39 — Installable distribution: npm + Obsidian community store** [In Progress] (1)

- AIBRAIN-43 — Obsidian plugin: versions.json, release-asset workflow, submit to obsidian-releases [Task, High]

**AIBRAIN-47 — Phase 1: Build the MCP server** [To Do] (2)

- AIBRAIN-47 — Phase 1: Build the MCP server [Epic, Medium] *(the epic itself)*
- AIBRAIN-54 — Dogfood: use MCP server as daily working memory layer [Task, Medium]

**AIBRAIN-48 — Phase 2: Obsidian plugin wrapper and public launch** [To Do] (5)

- AIBRAIN-48 — Phase 2: Obsidian plugin wrapper and public launch [Epic, Medium] *(the epic itself)*
- AIBRAIN-57 — Submit plugin to Obsidian community plugin directory [Task, Medium]
- AIBRAIN-58 — Public launch: r/ObsidianMD and Hacker News with demo video [Task, Medium]
- AIBRAIN-135 — Memory Trace panel in Obsidian plugin — expose retrieved/read/traversal lifecycle per query [Story, Medium]
- AIBRAIN-136 — Query-level "was this helpful" feedback attached to Memory Trace [Story, Medium]

**AIBRAIN-49 — Phase 3: Validate demand** [To Do] (3)

- AIBRAIN-49 — Phase 3: Validate demand [Epic, Medium] *(the epic itself)*
- AIBRAIN-59 — Set up paid tier (3 to 4 EUR monthly) gating reinforcement engine and visualization [Task, Medium]
- AIBRAIN-60 — Track installs, weekly active usage, and free-to-paid conversion [Task, Medium]

**AIBRAIN-50 — Phase 4: Standalone cloud app (conditional on Phase 3)** [To Do] (4)

- AIBRAIN-50 — Phase 4: Standalone cloud app (conditional on Phase 3) [Epic, Medium] *(the epic itself)*
- AIBRAIN-62 — Move reinforcement engine and context assembly server-side as cloud backend [Task, Highest]
- AIBRAIN-63 — Build standalone custom UI, decoupled from Obsidian [Task, Low]
- AIBRAIN-65 — Reprice for standalone cloud app based on usage data [Task, Medium]

**AIBRAIN-66 — Retrieval Benchmark vs. Baselines + Personal Usage Analytics** [In Progress] (2)

- AIBRAIN-134 — Define evidence-state taxonomy (Retrieved/Read/Re-query/Referenced/Helpful); don't feed raw telemetry into graph weights until correlation is measured [Story, Medium]
- AIBRAIN-137 — Citation-token report_usage() experiment — measure real invocation rate [Story, Medium]

**AIBRAIN-73 — Licensing/subscription backend — Stripe direct integration, paid from launch** [To Do] (7)

- AIBRAIN-73 — Licensing/subscription backend — Stripe direct integration, paid from launch [Epic, Medium] *(the epic itself)*
- AIBRAIN-80 — Stripe account setup: business profile, products/prices, tax config [Story, Medium]
- AIBRAIN-81 — Entitlement data model & database [Story, Medium]
- AIBRAIN-82 — Stripe webhook receiver (signature verification + idempotency) [Story, Medium]
- AIBRAIN-83 — License verification endpoint [Story, Medium]
- AIBRAIN-84 — Device/seat limit policy + enforcement [Story, Medium]
- AIBRAIN-85 — License key generation & delivery email [Story, Medium]

**AIBRAIN-74 — Landing site & Stripe Checkout** [To Do] (4)

- AIBRAIN-74 — Landing site & Stripe Checkout [Epic, Medium] *(the epic itself)*
- AIBRAIN-86 — Marketing/pricing landing page [Story, Medium]
- AIBRAIN-87 — Stripe Checkout integration [Story, Medium]
- AIBRAIN-88 — Post-purchase success flow [Story, Medium]

**AIBRAIN-75 — Plugin-side license guard & UX** [To Do] (5)

- AIBRAIN-75 — Plugin-side license guard & UX [Epic, Medium] *(the epic itself)*
- AIBRAIN-89 — Settings UI: enter/validate license key [Story, Medium]
- AIBRAIN-90 — Runtime feature guard [Story, Medium]
- AIBRAIN-91 — Offline grace period / cached entitlement [Story, Medium]
- AIBRAIN-92 — Graceful degraded/unlicensed state [Story, Medium]

**AIBRAIN-76 — Billing lifecycle & customer self-service** [To Do] (5)

- AIBRAIN-76 — Billing lifecycle & customer self-service [Epic, Medium] *(the epic itself)*
- AIBRAIN-93 — Stripe Customer Portal integration [Story, Medium]
- AIBRAIN-94 — Dunning handling (failed payment -> grace period -> downgrade) [Story, Medium]
- AIBRAIN-95 — Compliant self-serve cancellation flow [Story, Medium]
- AIBRAIN-96 — Refund/chargeback policy + handling process [Story, Medium]

**AIBRAIN-77 — Legal, compliance & support readiness** [To Do] (5)

- AIBRAIN-77 — Legal, compliance & support readiness [Epic, Medium] *(the epic itself)*
- AIBRAIN-97 — Terms of Service + Privacy Policy drafted and published [Story, Medium]
- AIBRAIN-98 — VAT/sales-tax registration & Stripe Tax configuration [Story, Medium]
- AIBRAIN-99 — Support channel setup [Story, Medium]
- AIBRAIN-100 — Obsidian community-plugins.json submission README disclosure [Story, Medium]

**AIBRAIN-78 — Backend hosting & operational reliability** [To Do] (5)

- AIBRAIN-78 — Backend hosting & operational reliability [Epic, Medium] *(the epic itself)*
- AIBRAIN-101 — Choose hosting platform + deploy pipeline [Story, Medium]
- AIBRAIN-102 — Uptime monitoring & alerting [Story, Medium]
- AIBRAIN-103 — Rate limiting & abuse protection on verification endpoint [Story, Medium]
- AIBRAIN-104 — Secrets management for Stripe keys and DB credentials [Story, Medium]

**AIBRAIN-79 — Post-launch: account dashboard & business metrics** [To Do] (3)

- AIBRAIN-79 — Post-launch: account dashboard & business metrics [Epic, Low] *(the epic itself)*
- AIBRAIN-105 — Optional account/login for self-serve license management [Story, Medium]
- AIBRAIN-106 — Business metrics dashboard (MRR, churn, activation) [Story, Medium]

**AIBRAIN-108 — Scale testing: synthetic 300k-note corpus + performance benchmarking** [To Do] (5)

- AIBRAIN-108 — Scale testing: synthetic 300k-note corpus + performance benchmarking [Epic, Low] *(the epic itself)*
- AIBRAIN-110 — Synthetic vault generator (preferential-attachment topology) [Story, Medium]
- AIBRAIN-111 — Wikipedia-derived real-world link-graph sample (secondary validation corpus) [Story, Medium]
- AIBRAIN-112 — Full-pipeline benchmark run at 300k-note scale [Story, Medium]
- AIBRAIN-113 — Document bottlenecks/scaling limits found [Story, Medium]

**AIBRAIN-109 — OKF format support: implementation + scale/mock-data validation** [In Progress] (5)

- AIBRAIN-114 — Re-validate OKF migration plan against the published v0.1 spec [Story, Medium]
- AIBRAIN-115 — Execute migration plan Phases A-C (shared resolver, dual-syntax parsing, autolink switch) [Story, Medium]
- AIBRAIN-116 — Execute migration plan Phases D-E (Obsidian setting + existing-notes migration) [Story, Medium]
- AIBRAIN-117 — Synthetic large-scale OKF corpus generator [Story, Medium]
- AIBRAIN-118 — Run engine against synthetic OKF corpus at scale [Story, Medium]

**AIBRAIN-119 — Anonymous, offline-first telemetry pipeline** [To Do] (7)

- AIBRAIN-119 — Anonymous, offline-first telemetry pipeline [Epic, Medium] *(the epic itself)*
- AIBRAIN-120 — Anonymous local event buffer [Story, Medium]
- AIBRAIN-121 — Local telemetry queue storage security [Story, Medium]
- AIBRAIN-122 — Offline-first batched sync with retry/backoff and eviction [Story, Medium]
- AIBRAIN-123 — Backend telemetry ingestion endpoint [Story, Medium]
- AIBRAIN-124 — Opt-in first-run UX + settings toggle [Story, Medium]
- AIBRAIN-125 — Data minimization / anonymization spec [Story, Medium]

**AIBRAIN-133 — searchNotes has no content index — full-vault linear scan takes 130s+ at 300k-note scale** [In Progress] (1)

- AIBRAIN-142 — Content index doesn't narrow enough for corpora with heavily repeated vocabulary — candidates still need per-file reads [Story, Low]

**No parent epic** (4)

- AIBRAIN-45 — Shared core-backed read path for SessionStart MOC/Inbox context [Task, Medium]
- AIBRAIN-107 — Validate MCP server behavior under non-Claude clients (Codex CLI, Gemini CLI) [Task, Medium]
- AIBRAIN-127 — Desktop app: setup screen has no logout button [Task, Medium]
- AIBRAIN-129 — No entitlement gate exists: unauthorized users get full retrieval access today [Story, High]

### Done (53)

- AIBRAIN-4 — Phase 4 — Structural Signals (2026-07-20)
- AIBRAIN-5 — Phase 5 — MCP Retrieval Reliability (2026-07-20)
- AIBRAIN-7 — As the engine, I decay edge/node strength exponentially so recency reflects the Ebbinghaus forgetting curve (2026-07-11)
- AIBRAIN-8 — Add last_accessed + base_strength fields to edge schema (2026-07-11)
- AIBRAIN-9 — Implement live decay computation at query time (replace linear/batch decay) (2026-07-11)
- AIBRAIN-10 — As Claude Code, I get a priming boost for notes related to the current session so context stays coherent (2026-07-13)
- AIBRAIN-11 — Build LRU session buffer + priming_bonus scoring function (2026-07-13)
- AIBRAIN-12 — As a user, I see node brightness reflect decay and a warm ring around primed notes in the graph view (2026-07-13)
- AIBRAIN-13 — As the engine, I promote edges to a consolidated tier after repeated reactivation so important notes don't get lost to decay (2026-07-13)
- AIBRAIN-14 — Add recent_score/consolidated_score fields + nightly consolidation batch job (2026-07-13)
- AIBRAIN-15 — As a user, I see a gold ring on notes that have been consolidated into long-term memory (2026-07-13)
- AIBRAIN-16 — As the engine, I support a "supersedes/conflicts with" edge type so outdated notes surface their successor (2026-07-14)
- AIBRAIN-17 — As the engine, I spread activation across bounded multi-hop neighbors so indirect context surfaces on query (2026-07-13)
- AIBRAIN-18 — Implement bounded recursive activation traversal + threshold cutoff (2026-07-13)
- AIBRAIN-19 — As a user, I watch activation pulse hop-by-hop through the graph with a visible retrieval path trace (2026-07-16)
- AIBRAIN-20 — As a user, I can switch between Live and Study playback speed for the activation animation (2026-07-16)
- AIBRAIN-21 — As the engine, I compute PageRank-style importance so hub notes stay weighted even when not recently touched (2026-07-16)
- AIBRAIN-22 — As the engine, I run Louvain/Leiden clustering so topic communities are auto-discovered without manual tagging (2026-07-16)
- AIBRAIN-23 — As a user, I see node size reflect hub importance and node color reflect cluster in the D3 visualization (2026-07-16)
- AIBRAIN-24 — As Claude Code, I always receive at least k results from an MCP query, even under sparse activation (2026-07-14)
- AIBRAIN-25 — As Claude Code, I never get an empty MCP response — a tiered fallback chain always serves something (2026-07-16)
- AIBRAIN-26 — As an operator, I have a bounded per-call timeout and full retrieval logging so failures are visible before they cause a bad session (2026-07-14)
- AIBRAIN-27 — As a reviewer, I can toggle layers on/off and see a "why was this retrieved" ablation diff (2026-07-20)
- AIBRAIN-29 — Phase 7 — Science Research & Validation (2026-07-20)
- AIBRAIN-30 — As the research lead, I compile a literature review validating each mechanism and screening new candidates (2026-07-20)
- AIBRAIN-31 — As the research lead, I run ablation evaluations measuring retrieval quality per mechanism (2026-07-20)
- AIBRAIN-33 — As an architect, I define a pluggable source-adapter interface so the engine is source-agnostic (2026-07-20)
- AIBRAIN-35 — As the engine, I apply per-note-type decay live at query time instead of baking it in at compaction (2026-07-13)
- AIBRAIN-36 — compactWeightsTool test call sites fail tsc --noEmit: handler takes 0 args, tests pass ({}) (2026-07-16)
- AIBRAIN-37 — Graph view UI/UX pass: brain icon, dismissible retrieval panel, interim clustering layout (2026-07-16)
- AIBRAIN-38 — Radial star layout: importance pulls nodes toward each cluster's own center (2026-07-17)
- AIBRAIN-40 — Add LICENSE + npm publish metadata for core and mcp-server (2026-09-02)
- AIBRAIN-41 — Bundle core into mcp-server build; adopt Changesets for monorepo versioning (2026-09-02)
- AIBRAIN-44 — Update README.md / INSTALL.md with new one-line install instructions (2026-09-02)
- AIBRAIN-46 — As Obsidian, I own the daily compact/consolidation cycle myself, with no external scheduler or Claude Code trigger (2026-08-13)
- AIBRAIN-51 — Rebuild reinforcement engine and context assembly as MCP tool handlers (2026-08-15)
- AIBRAIN-52 — Vault-reading layer: parse existing Obsidian markdown files directly (2026-08-15)
- AIBRAIN-53 — Build one-click installer / npx setup for MCP server (2026-09-02)
- AIBRAIN-55 — Build thin Obsidian plugin wrapper (auto-start MCP server + settings) (2026-08-15)
- AIBRAIN-56 — Integrate D3 weighted-graph visualization as plugin panel (2026-08-15)
- AIBRAIN-61 — Decision gate: go/no-go on Phase 4 based on Phase 3 data (2026-08-17)
- AIBRAIN-67 — As the research lead, I compare retrieval quality against grep, semantic-embedding, and naive full-context baselines (2026-08-15)
- AIBRAIN-69 — Deterministic usage instrumentation — stop delegating logging decisions to the LLM (2026-08-21)
- AIBRAIN-70 — Persist every search_notes call to the event log (2026-08-16)
- AIBRAIN-71 — Replace reinforce_link's LLM-judgment trigger with outcome-based auto-reinforcement (2026-08-16)
- AIBRAIN-72 — Remove log_traversal's manual-credit path once auto-logging covers its gap (2026-08-16)
- AIBRAIN-126 — Persist get_weighted_neighbors() calls to the retrieval log (2026-08-16)
- AIBRAIN-128 — Obsidian plugin reads the desktop app's shared account session instead of its own license-key login (2026-08-21)
- AIBRAIN-130 — Investigate stale/noisy accumulated usage weight degrading rank-1 vs. zero-usage baseline (2026-09-02)
- AIBRAIN-138 — search_notes returns empty for real notes — matching is literal substring only, no tokenization (2026-09-02)
- AIBRAIN-139 — search_notes ranks by usage weight alone — exact title matches lose to incidental mentions in hub notes (2026-09-02)
- AIBRAIN-140 — Relevance-ranked plain-text search now beats activate() on rank-1 — re-examine whether the Hebbian/spreading-activation layer earns its complexity (2026-09-02)
- AIBRAIN-141 — Priming has no intra-session decay — a note touched early in a long session stays top-tier after it stops being relevant (2026-09-02)

## Epics and their children (full detail)

### AIBRAIN-1 — Phase 1 — Engine Foundation [To Do, Highest]

> Series note: engine-phase numbering (AIBRAIN-1..6, continued by Phases 7-8 in AIBRAIN-29/32). Not the same series as the product phases in AIBRAIN-47..50.

*created 2026-07-11 · updated 2026-07-11*

Implement exponential decay and session priming. Ship minimal visualization (decay brightness + priming rings). Goal: validate the core loop end-to-end with the cheapest mechanisms first.

#### AIBRAIN-7 — As the engine, I decay edge/node strength exponentially so recency reflects the Ebbinghaus forgetting curve [Story, Done, Highest]

*created 2026-07-11 · updated 2026-07-11 · resolution: Done*

strength(t) = strength_0 * e^(-t/τ), τ tunable per note-type. Live computation at query time using last_accessed + base_strength, not a scheduled batch job.

##### AIBRAIN-8 — Add last_accessed + base_strength fields to edge schema [Subtask, Done, Highest]

*created 2026-07-11 · updated 2026-07-11 · resolution: Done*

Extend EdgeRecord (packages/core/src/types.ts) with a per-note-type decay constant so tau can vary by note type (short for client/situational notes, long for structural/reference notes) instead of the single global halfLifeDays in DecayConfig. lastTouched already exists on EdgeRecord; new work is (a) a base_strength field distinct from the live-decayed weight, and (b) a lookup from note type/frontmatter to its tau.

##### AIBRAIN-9 — Implement live decay computation at query time (replace linear/batch decay) [Subtask, Done, Highest]

*created 2026-07-11 · updated 2026-07-11 · resolution: Done*

decayWeight() already exists and is correct (packages/core/src/decay.ts) but was only applied during compact() batches (packages/core/src/compactor.ts), not per query; getWeightedNeighbors (packages/core/src/query.ts) read the already-compacted weight from link-weights.json with no further decay. Wire decayWeight(record.weight, daysSince(record.lastTouched)) into the read path so ranking reflects continuous decay, not decay-as-of-last-compaction.

#### AIBRAIN-10 — As Claude Code, I get a priming boost for notes related to the current session so context stays coherent [Story, Done, Highest]

*created 2026-07-11 · updated 2026-07-13 · resolution: Done*

In-memory LRU buffer of last N accessed notes per session. retrieval_score(note) = base_score + priming_bonus(note, session_buffer). No persistence, session-scoped only.

##### AIBRAIN-11 — Build LRU session buffer + priming_bonus scoring function [Subtask, Done, Highest]

*created 2026-07-11 · updated 2026-07-13 · resolution: Done*

No session-scoped state existed — get_weighted_neighbors and search_notes (packages/mcp-server/src/tools.ts) were stateless per call. Add an in-memory LRU buffer (last N accessed notes) scoped to the MCP server instance/session, and a priming_bonus(note, buffer) function blended into retrieval_score. Session-only, no persistence or decay math — the lightest lift of the six mechanisms.

#### AIBRAIN-12 — As a user, I see node brightness reflect decay and a warm ring around primed notes in the graph view [Story, Done, Highest]

*created 2026-07-11 · updated 2026-07-13 · resolution: Done*

Minimal visualization layer validating Phase 1 mechanisms visually: node/edge brightness = freshness; dashed warm ring = session-buffer membership.

#### AIBRAIN-35 — As the engine, I apply per-note-type decay live at query time instead of baking it in at compaction [Story, Done, Highest]

*created 2026-07-13 · updated 2026-07-13 · resolution: Done*

Edge weights now store `baseStrength` (undecayed, raw accumulated weight from events) instead of a pre-decayed `weight`. Decay is computed live at query time via `liveWeight()`, using a configurable half-life per note frontmatter `type` (`resolveHalfLifeDays` / `NoteTypeDecayConfig` — moc: 90d, atomic: 30d, project: 14d, default: 30d).

Implemented in: `packages/core/src/decay.ts` (`resolveHalfLifeDays`); `packages/core/src/types.ts` (`EdgeRecord.baseStrength`, `NoteTypeDecayConfig`); `packages/core/src/query.ts` (`liveWeight()` used by `getWeightedNeighbors` / `getEdgeWeight`); `packages/obsidian-plugin/src/view/ForceSim.ts` (inlined equivalent live-decay formula for the graph view — browser bundle can't import core's Node-only runtime, only its types); `packages/core/src/compactor.ts` (stops pre-decaying weight at compaction).

Shipped in commit 529f10c ("decay and phase 1"); filed retroactively to keep AIBRAIN-1 status accurate.

### AIBRAIN-2 — Phase 2 — Memory Integrity [To Do, High]

> Series note: engine-phase numbering (AIBRAIN-1..6, continued by Phases 7-8 in AIBRAIN-29/32). Not the same series as the product phases in AIBRAIN-47..50.

*created 2026-07-11 · updated 2026-07-11*

Implement synaptic tagging & consolidation. Add consolidation ring visualization. Add contradiction/tension edge type. Goal: fix decay's blind spot for long-term-important notes before building further on top of it.

#### AIBRAIN-13 — As the engine, I promote edges to a consolidated tier after repeated reactivation so important notes don't get lost to decay [Story, Done, High]

*created 2026-07-11 · updated 2026-07-13 · resolution: Done*

Two-tier weight: recent_score (fast decay, updates on co-access) and consolidated_score (promoted via nightly batch job once recent_score crosses threshold N times across M days). Models sleep-dependent memory consolidation.

##### AIBRAIN-14 — Add recent_score/consolidated_score fields + nightly consolidation batch job [Subtask, Done, High]

*created 2026-07-11 · updated 2026-07-13 · resolution: Done*

EdgeRecord (packages/core/src/types.ts) had a single weight field; split into recent_score (fast decay, reusing decayWeight) and consolidated_score (promoted after crossing a threshold N times across M days). No scheduler existed in the repo — compaction ran only on demand via the compact_weights MCP tool or the vnl-compact.js bin. This ticket also stands up the first actual scheduled/nightly job — real new infrastructure, not a config change.

#### AIBRAIN-15 — As a user, I see a gold ring on notes that have been consolidated into long-term memory [Story, Done, High]

*created 2026-07-11 · updated 2026-07-13 · resolution: Done*

Visual proof the two-tier system works: consolidated nodes get a persistent gold border, distinct from merely-recent fading nodes.

#### AIBRAIN-16 — As the engine, I support a "supersedes/conflicts with" edge type so outdated notes surface their successor [Story, Done, High]

*created 2026-07-11 · updated 2026-07-14 · resolution: Done*

Distinct edge type beyond positive association, flagging tension/contradiction (e.g. old ADR vs. its revision). Retrieval surfaces "this note may be outdated — see its successor" even when the old note is still fresh by recency.

### AIBRAIN-3 — Phase 3 — Retrieval Upgrade [To Do, High]

> Series note: engine-phase numbering (AIBRAIN-1..6, continued by Phases 7-8 in AIBRAIN-29/32). Not the same series as the product phases in AIBRAIN-47..50.

*created 2026-07-11 · updated 2026-07-11*

Implement spreading activation. Add live pulse animation + activation path trace. Add Live/Study speed toggle. Goal: the actual retrieval quality upgrade — the mechanism most directly improving Claude Code context assembly.

#### AIBRAIN-17 — As the engine, I spread activation across bounded multi-hop neighbors so indirect context surfaces on query [Story, Done, High]

*created 2026-07-11 · updated 2026-07-13 · resolution: Done*

activate(node, energy) recursively transfers energy_edge_weight_decay_per_hop to neighbors, bounded at 2-3 hops, cutoff at min_threshold. Replaces direct-neighbor-only retrieval in Claude Code context assembly.

##### AIBRAIN-18 — Implement bounded recursive activation traversal + threshold cutoff [Subtask, Done, High]

*created 2026-07-11 · updated 2026-07-13 · resolution: Done*

getWeightedNeighbors (packages/core/src/query.ts) only returned direct neighbors (single hop) sorted by weight — no multi-hop traversal existed. Replace with activate(node, energy=1.0) recursion: transferred = energy * edge_weight * decay_per_hop, bounded to 2-3 hops, cutoff at min_threshold. Core architectural change of Phase 3 and the first true graph-traversal logic in the engine.

#### AIBRAIN-19 — As a user, I watch activation pulse hop-by-hop through the graph with a visible retrieval path trace [Story, Done, High]

*created 2026-07-11 · updated 2026-07-16 · resolution: Done*

WebSocket event stream (node_activated, edge_traversed) from engine to D3 plugin. Side panel logs the actual retrieval path (e.g. "M+S Hydraulic → SAP Sales Cloud → [2 hops] → Discovery Phase template") so the mechanism is auditable, not decorative.

#### AIBRAIN-20 — As a user, I can switch between Live and Study playback speed for the activation animation [Story, Done, High]

*created 2026-07-11 · updated 2026-07-16 · resolution: Done*

Two-state switch: Live (real ms-scale timing) vs Study (staggered ~150-300ms per hop). Applied only at the rendering layer — engine timing itself is never altered, like slow-motion footage of a real event.

### AIBRAIN-4 — Phase 4 — Structural Signals [Done, Medium]

> Series note: engine-phase numbering (AIBRAIN-1..6, continued by Phases 7-8 in AIBRAIN-29/32). Not the same series as the product phases in AIBRAIN-47..50.

*created 2026-07-11 · updated 2026-07-20 · resolution: Done*

Implement PageRank-style hub importance and community detection. Add hub sizing and cluster coloring. Goal: structural/visualization polish — the D3 plugin phase already planned.

#### AIBRAIN-21 — As the engine, I compute PageRank-style importance so hub notes stay weighted even when not recently touched [Story, Done, Medium]

*created 2026-07-11 · updated 2026-07-16 · resolution: Done*

importance(node) = (1-d) + d * Σ(importance(neighbor)/out_degree(neighbor)). Computed periodically (batch, not per-query). Blended into retrieval: final_score = activation_score * (1 + λ * importance).

#### AIBRAIN-22 — As the engine, I run Louvain/Leiden clustering so topic communities are auto-discovered without manual tagging [Story, Done, Medium]

*created 2026-07-11 · updated 2026-07-16 · resolution: Done*

Periodic clustering job assigns cluster_id per node. Feeds the visualization layer (node color) rather than retrieval directly. Sequencing note: only build after the weighting system (Phases 1-3) is mature, since cluster quality depends on edge-weight quality.

#### AIBRAIN-23 — As a user, I see node size reflect hub importance and node color reflect cluster in the D3 visualization [Story, Done, Medium]

*created 2026-07-11 · updated 2026-07-16 · resolution: Done*

Node size scales with PageRank score. Node color = cluster assignment from community detection. This is the originally-planned D3 visualization plugin phase.

#### AIBRAIN-38 — Radial star layout: importance pulls nodes toward each cluster's own center [Story, Done, Medium]

*created 2026-07-17 · updated 2026-07-17 · resolution: Done*

Clusters were already spatially separated (cluster-anchor force, AIBRAIN-22/23) and colored by community (AIBRAIN-23 follow-up), but within a region all nodes were pulled toward the anchor with equal strength — hub notes didn't stand out within their own cluster.

Added a second radial component to `createClusterForce` (packages/obsidian-plugin/src/view/ForceSim.ts): each node's target distance from its cluster anchor is `INTRA_CLUSTER_MAX_RADIUS * (1 - importance)`, using the existing min-max normalized PageRank score (note-importance.json, AIBRAIN-21). High-importance nodes settle near the region's center, low-importance toward the rim — each cluster reads as its own small star.

Depends on the nightly job having populated note-importance.json at least once (setGraphMetadata); before that all nodes have importance 0 and sit uniformly at the rim.

### AIBRAIN-5 — Phase 5 — MCP Retrieval Reliability [Done, High]

> Series note: engine-phase numbering (AIBRAIN-1..6, continued by Phases 7-8 in AIBRAIN-29/32). Not the same series as the product phases in AIBRAIN-47..50.

*created 2026-07-11 · updated 2026-07-20 · resolution: Done*

Implement guaranteed minimum-k with threshold relaxation, tiered fallback chain (incl. keyword fallback), per-call timeout budget, and retrieval logging/observability. Goal: the MCP tool that Claude Code calls never returns empty-handed, and failures are visible before they cause a bad session.

#### AIBRAIN-24 — As Claude Code, I always receive at least k results from an MCP query, even under sparse activation [Story, Done, High]

*created 2026-07-11 · updated 2026-07-14 · resolution: Done*

Guaranteed minimum-k (e.g. k=3): progressively relax activation min_threshold rather than returning an empty set when spreading activation + priming produce fewer than k qualifying nodes.

#### AIBRAIN-25 — As Claude Code, I never get an empty MCP response — a tiered fallback chain always serves something [Story, Done, High]

*created 2026-07-11 · updated 2026-07-16 · resolution: Done*

Fallback order: (1) full spreading activation; (2) relaxed-threshold activation; (3) structural-link floor weight — a precomputed bidirectional wikilink adjacency graph (built during compact()/vnl-nightly.js, persisted like link-weights.json) contributes neighbors at a configurable floor weight (default 0.1) for pairs with no usage-weighted edge, so real usage always outranks structural-only presence; shared by getWeightedNeighbors and activate via computeLiveNeighborWeights; (4) plain keyword/substring match over titles+tags; (5) most-recently-consolidated notes as last resort. Response indicates which tier served the result. Tier 3 specifically rescues cold-start/sparse-cluster notes with real wikilink structure but no usage history (e.g. bunit2/AML/InvoiceFlow domains observed 2026-07-14 with zero weighted edges despite active recent work — links exist, never traversed/reinforced via MCP calls).

#### AIBRAIN-26 — As an operator, I have a bounded per-call timeout and full retrieval logging so failures are visible before they cause a bad session [Story, Done, High]

*created 2026-07-11 · updated 2026-07-14 · resolution: Done*

Hard time budget per MCP call (e.g. 300ms) returning partial results instead of blocking. Log every call: query, tier served, result count, latency — to catch a whole cluster systematically falling through to fallback before a client demo.

### AIBRAIN-6 — Phase 6 — Case Study Packaging [To Do, Medium]

> Series note: engine-phase numbering (AIBRAIN-1..6, continued by Phases 7-8 in AIBRAIN-29/32). Not the same series as the product phases in AIBRAIN-47..50.

*created 2026-07-11 · updated 2026-07-11*

Build the "why was this retrieved" ablation/diff view. Record Live vs Study demo captures for presentation. Write up each mechanism against its cognitive-science source as the case-study narrative. Goal: package the working system as a product demo and research-grounded case study.

#### AIBRAIN-27 — As a reviewer, I can toggle layers on/off and see a "why was this retrieved" ablation diff [Story, Done, Medium]

*created 2026-07-11 · updated 2026-07-20 · resolution: Done*

Before/after panel showing what context would look like without a given layer (e.g. "activation only" vs "activation + priming") — turns the demo into a genuine ablation study, the strongest scientific-credibility asset for the case study.

#### AIBRAIN-28 — As Brain Space, I have recorded demo captures and a written case study mapping each mechanism to its science source [Story, In Progress, Medium]

*created 2026-07-11 · updated 2026-07-20*

Record Live vs Study demo captures for presentation. Write up each mechanism (decay, consolidation, activation, priming, hubs, clusters) against its cognitive-science source as the case-study narrative for product positioning.

### AIBRAIN-29 — Phase 7 — Science Research & Validation [Done, Low]

> Series note: continuation of the engine-phase series (AIBRAIN-1..6). Not the same series as the product phases in AIBRAIN-47..50.

*created 2026-07-11 · updated 2026-07-20 · resolution: Done*

Ongoing literature review to validate existing mechanisms and identify new cognitive-science candidates for the engine. Each addition must answer: does this make the system better at picking the right notes out of thousands, or is it decoration? Goal: keep the science layer rigorous and defensible for the case study, not just neuroscience-flavored.

#### AIBRAIN-30 — As the research lead, I compile a literature review validating each mechanism and screening new candidates [Story, Done, Low]

*created 2026-07-11 · updated 2026-07-20 · resolution: Done*

Deep-dive literature review of each shipped mechanism's grounding (Ebbinghaus, Frey & Morris, Collins & Loftus, priming studies, PageRank, Louvain/Leiden) plus one round of adjacent candidates: emotional salience/arousal effects on memory strength, context-dependent (state-dependent) memory, interference theory (proactive/retroactive), chunking, dual-coding.

#### AIBRAIN-31 — As the research lead, I run ablation evaluations measuring retrieval quality per mechanism [Story, Done, Low]

*created 2026-07-11 · updated 2026-07-20 · resolution: Done*

Design and run a controlled evaluation comparing retrieval quality (precision of "right 5 notes out of 5,000") with each mechanism on vs. off, individually and combined. The empirical backbone the case study needs — turns "we think this helps" into a measured result.

### AIBRAIN-32 — Phase 8 — Source-Agnostic Generalization (Beyond Obsidian) [To Do, Low]

> Series note: continuation of the engine-phase series (AIBRAIN-1..6). Not the same series as the product phases in AIBRAIN-47..50.

*created 2026-07-11 · updated 2026-07-11*

Generalize the engine beyond Obsidian: split into a pluggable source-adapter layer (Obsidian vault, Notion, Confluence, Azure Wiki, plain folder of docs) feeding a generic node/edge graph, keeping the engine/MCP/reliability layers (Phases 1-5) untouched underneath. Includes the harder edge-inference problem for sources with no existing wikilinks. Deliberately parked as its own initiative, separate from the personal-PKM pitch — same engine, different audience (enterprise knowledge base vs. personal tool).

#### AIBRAIN-33 — As an architect, I define a pluggable source-adapter interface so the engine is source-agnostic [Story, Done, Low]

*created 2026-07-11 · updated 2026-07-20 · resolution: Done*

Define a common interface: parse X into nodes+edges. Obsidian adapter (wikilinks) is the reference implementation. Everything below this line (engine, MCP, reliability) stays untouched regardless of source.

#### AIBRAIN-34 — As the engine, I infer candidate edges via AI when a source has no explicit links (Confluence, Azure Wiki, Word docs) [Story, To Do, Low]

*created 2026-07-11 · updated 2026-07-11*

For sources without explicit wikilinks (Confluence, Azure Wiki, plain Word docs): entity/topic co-occurrence for candidate edges, an LLM pass judging "does A reference/depend on/supersede B?", confidence-weighted edges that start weak and earn full weight only through consolidation (reusing Phase 2 machinery). Usage co-access remains the ground-truth validator, unchanged from the Obsidian version.

### AIBRAIN-39 — Installable distribution: npm + Obsidian community store [In Progress, Medium]

*created 2026-07-26 · updated 2026-09-02*

Replace the current git-clone + npm-build + manual-copy install flow (see README.md and INSTALL.md) with normal package-manager installs:
- MCP server: `claude mcp add vault-neural-link -- npx -y @vault-neural-links/mcp-server` (published to public npm)
- Obsidian plugin: installable from Settings -> Community plugins -> Browse, once accepted into obsidian-releases

Plan drafted 2026-07-26, agreed with user: publish core+mcp-server to npm (not GitHub-release-only), submit the Obsidian plugin to the official community store (not BRAT-only). Full implementation plan captured in the vault — see linked note.

#### AIBRAIN-40 — Add LICENSE + npm publish metadata for core and mcp-server [Task, Done, Medium]

*created 2026-07-26 · updated 2026-09-02 · resolution: Done*

Add a root LICENSE (MIT). Bump packages/core and packages/mcp-server off version 0.0.0 to 0.1.0, add "publishConfig": {"access": "public"} to both package.json files (scoped packages default private on npm otherwise).

#### AIBRAIN-41 — Bundle core into mcp-server build; adopt Changesets for monorepo versioning [Task, Done, Medium]

*created 2026-07-26 · updated 2026-09-02 · resolution: Done*

packages/mcp-server/package.json depends on "@vault-neural-links/core": "*", which only resolves via the npm workspace symlink and will not resolve for a standalone npx install. Fix: add noExternal: ["@vault-neural-links/core"] to packages/mcp-server/tsup.config.ts so core is bundled into mcp-server's dist, and move @vault-neural-links/core to devDependencies in mcp-server (keep it as a real published package too, since packages/core/bin/vnl-compact.js and vnl-nightly.js are used standalone for the scheduled compaction task).

Also adopt @changesets/cli at the repo root so version bumps + changelogs for core and mcp-server stay in sync.

#### AIBRAIN-42 — GitHub Actions release workflow: Changesets -> npm publish [Task, In Review, Medium]

*created 2026-07-26 · updated 2026-09-02*

Add .github/workflows/release.yml: on push to main with pending changesets, run the changesets/action bot to open a "Version Packages" PR; when merged, the same workflow runs npm run build for both packages and changesets/cli publish using an NPM_TOKEN repo secret.

Manual one-time prerequisite (not automatable from the coding agent): user creates an npm access token and adds it as the NPM_TOKEN GitHub Actions secret on the repo.

#### AIBRAIN-43 — Obsidian plugin: versions.json, release-asset workflow, submit to obsidian-releases [Task, To Do, High]

*created 2026-07-26 · updated 2026-08-17*

Add packages/obsidian-plugin/versions.json mapping plugin version -> minAppVersion (starts {"0.1.0": "1.4.0"}, matching manifest.json). Bump manifest.json version to 0.1.0.

Extend the release workflow (or add a plugin-v* tag-triggered one) to build with the existing esbuild.config.mjs production and attach manifest.json, main.js, styles.css as GitHub Release assets — the exact layout Obsidian's community-plugin infra expects.

One-time manual submission (needs user's GitHub identity): fork obsidianmd/obsidian-releases, add an entry for vault-neural-links to community-plugins.json, open a PR. Review queue can take weeks — not a blocker for the npm side.

#### AIBRAIN-44 — Update README.md / INSTALL.md with new one-line install instructions [Task, Done, Medium]

*created 2026-07-26 · updated 2026-09-02 · resolution: Done*

Rewrite README.md's Install section to lead with: `claude mcp add vault-neural-link --scope user -- npx -y @vault-neural-links/mcp-server`. Note the Obsidian plugin will be installable from Settings -> Community plugins -> Browse once the store submission is approved (keep manual-copy as a fallback note until then).

Trim INSTALL.md's "another machine" scenario from a 7-step git+build+copy sequence down to: claude mcp add ... npx, set CLAUDE_VAULT_PATH, install plugin from the store. Keep the scheduled-compaction step (step 7) since it's unrelated to distribution.

### AIBRAIN-47 — Phase 1: Build the MCP server [To Do, Medium]

> Series note: product/path-to-market phase numbering (AIBRAIN-47..50). Not the same series as the engine phases in AIBRAIN-1..6.

*created 2026-08-15 · updated 2026-08-15*

Decouple the Hebbian reinforcement engine and context assembly logic from Claude Code hooks and rebuild as a standalone MCP server. Timeline: 4 to 6 weeks. Goal: reusable, client-agnostic backend that any MCP-compatible client can connect to, not just Claude Code.

#### AIBRAIN-51 — Rebuild reinforcement engine and context assembly as MCP tool handlers [Task, Done, Medium]

*created 2026-08-15 · updated 2026-08-15 · resolution: Done*

Strip the Hebbian reinforcement engine, context assembly scripts, and weight update logic out of the Claude Code hooks and rebuild as MCP tool handlers: get_relevant_context, update_weights, get_graph_state.

#### AIBRAIN-52 — Vault-reading layer: parse existing Obsidian markdown files directly [Task, Done, Medium]

*created 2026-08-15 · updated 2026-08-15 · resolution: Done*

Keep the MCP server reading directly from an existing Obsidian vault's markdown files. No new note format at this stage.

#### AIBRAIN-53 — Build one-click installer / npx setup for MCP server [Task, Done, Medium]

*created 2026-08-15 · updated 2026-09-02 · resolution: Done*

Ship a one-click installer or npx command so setup does not require raw MCP config editing. Critical for non-technical adoption in later phases.

#### AIBRAIN-54 — Dogfood: use MCP server as daily working memory layer [Task, To Do, Medium]

*created 2026-08-15 · updated 2026-08-15*

Use the MCP server as your own actual working memory layer daily before showing anyone. Surface any friction or bugs before public exposure.

### AIBRAIN-48 — Phase 2: Obsidian plugin wrapper and public launch [To Do, Medium]

> Series note: product/path-to-market phase numbering (AIBRAIN-47..50). Not the same series as the engine phases in AIBRAIN-1..6.

*created 2026-08-15 · updated 2026-08-15*

Build the Obsidian plugin wrapper and publicly launch. Timeline: 2 to 3 weeks, following Phase 1. Goal: get the MCP server in front of real Obsidian users with minimal setup friction.

#### AIBRAIN-55 — Build thin Obsidian plugin wrapper (auto-start MCP server + settings) [Task, Done, Medium]

*created 2026-08-15 · updated 2026-08-15 · resolution: Done*

Build a thin Obsidian plugin that auto-starts the MCP server and exposes basic settings. No separate custom UI needed at this stage.

#### AIBRAIN-56 — Integrate D3 weighted-graph visualization as plugin panel [Task, Done, Medium]

*created 2026-08-15 · updated 2026-08-15 · resolution: Done*

Add the D3 weighted-graph visualization as a panel inside the Obsidian plugin. This is the primary shareable "wow" moment for launch content, distinct from both RAG and CAG which have no visual layer.

#### AIBRAIN-57 — Submit plugin to Obsidian community plugin directory [Task, To Do, Medium]

*created 2026-08-15 · updated 2026-08-15*

Submit the plugin to the Obsidian community plugin directory. Ensure it meets review requirements (no unusual permissions, clear README, recent commit history).

#### AIBRAIN-58 — Public launch: r/ObsidianMD and Hacker News with demo video [Task, To Do, Medium]

*created 2026-08-15 · updated 2026-08-15*

Launch with a demo video or GIF on r/ObsidianMD and Hacker News. Lead with the D3 visualization, not the architecture explanation.

#### AIBRAIN-135 — Memory Trace panel in Obsidian plugin — expose retrieved/read/traversal lifecycle per query [Story, To Do, Medium]

*created 2026-08-30 · updated 2026-08-30*

Extends the existing plugin (not the paused standalone desktop app, AIBRAIN-63) with a per-query trace view, so a human has something concrete to evaluate before being asked "was this useful."

Show per query, from data already logged by existing telemetry (AIBRAIN-71 event log): the query text; notes retrieved (count + list); which were subsequently read; whether a re-query on the same/similar topic followed (weak negative signal). Example shape:

```
Query: "How does authentication work?"
Retrieved: 8   Read: 5   Re-query detected: yes

✓ authentication.md      READ
✓ oauth.md                READ
✓ ADR-142                 READ
○ old-auth.md             NOT READ
○ changelog.md             NOT READ
```

Explicitly do NOT attempt "used"/"referenced" attribution — the plugin only surfaces what the server actually knows (see AIBRAIN-134). No new instrumentation needed; a read/query layer over existing event logs.

Portability: a consumer of the portable server-side event log, not a client-specific integration — any MCP client (Claude Code, Cursor, Codex, Gemini) can produce the underlying events.

Related: AIBRAIN-71, AIBRAIN-63 (paused, superseded by this for near-term UI needs).

#### AIBRAIN-136 — Query-level "was this helpful" feedback attached to Memory Trace [Story, To Do, Medium]

*created 2026-08-30 · updated 2026-08-30*

Depends on the Memory Trace panel (AIBRAIN-135) shipping first — feedback is only meaningful once the user can see what was retrieved/read.

Start query-level, not per-note (per-note grading is too much friction for v1): "Was the retrieved context helpful?" [ Yes ] [ Partly ] [ No ]

This becomes the calibration dataset (sparse, high-confidence ground truth) used to check whether cheaper automatic signals (read, re-query, citation-token) actually correlate with real usefulness — not the primary production telemetry source. See AIBRAIN-134 for how this fits with Retrieved/Read/Re-query/Referenced.

Future iteration (not v1): optional per-source checkboxes if query-level feedback proves too coarse.

### AIBRAIN-49 — Phase 3: Validate demand [To Do, Medium]

> Series note: product/path-to-market phase numbering (AIBRAIN-47..50). Not the same series as the engine phases in AIBRAIN-1..6.

*created 2026-08-15 · updated 2026-08-15*

Validate real demand after launch before committing to a standalone app. Timeline: 8 to 12 weeks post-launch. Goal: 1,000 to 5,000 downloads and a clear read on whether people pay 3 to 4 EUR monthly. This is the decision gate for Phase 4.

#### AIBRAIN-59 — Set up paid tier (3 to 4 EUR monthly) gating reinforcement engine and visualization [Task, To Do, Medium]

*created 2026-08-15 · updated 2026-08-15*

Gate the Hebbian reinforcement engine and D3 visualization behind a paid tier at 3 to 4 EUR monthly from day one, to get a real read on willingness to pay rather than assuming it from free usage alone.

#### AIBRAIN-60 — Track installs, weekly active usage, and free-to-paid conversion [Task, To Do, Medium]

*created 2026-08-15 · updated 2026-08-16*

Track installs, weekly active usage, and free-to-paid conversion. Target: 1,000 to 5,000 downloads and a clear conversion signal within 8 to 12 weeks post-launch. (Flagged in AIBRAIN-73/119 for re-scoping: assumed a free tier to convert from, which no longer exists.)

#### AIBRAIN-61 — Decision gate: go/no-go on Phase 4 based on Phase 3 data [Task, Done, Medium]

*created 2026-08-15 · updated 2026-08-17 · resolution: Done*

If conversion and retention are healthy, proceed to Phase 4 (standalone cloud app). If usage is low or people install and abandon, rework the core value proposition before spending on a standalone app.

### AIBRAIN-50 — Phase 4: Standalone cloud app (conditional on Phase 3) [To Do, Medium]

> Series note: product/path-to-market phase numbering (AIBRAIN-47..50). Not the same series as the engine phases in AIBRAIN-1..6.

*created 2026-08-15 · updated 2026-08-15*

Build the standalone cloud app, only if Phase 3 validates demand. Timeline: 3 to 4 months. Goal: reposition from Obsidian add-on to standalone AI memory product with its own UI and cloud backend.

#### AIBRAIN-62 — Move reinforcement engine and context assembly server-side as cloud backend [Task, To Do, Highest]

*created 2026-08-15 · updated 2026-08-30*

Move the reinforcement engine and context assembly server-side as the cloud backend. Largely already built from Phase 1's MCP server work.

Updated scope (2026-08-30): also the eventual home for real "Referenced" attribution — matching what actually contributed to an agent's final answer, which no MCP server (regardless of client) can see today, since the server never has visibility into a client LLM's generated response text. That gap is structural, not Claude-Code-specific.

Sequencing decided: don't jump straight here. First get cheaper, fully-portable signal flowing through the existing MCP surface and the Obsidian plugin (evidence-state taxonomy + Memory Trace panel + attached human feedback, all under AIBRAIN-66/AIBRAIN-48), and try the cheap citation-token experiment. Use that data to determine which behavioral signals actually correlate with confirmed usefulness before designing this backend's attribution/ranking logic. This epic becomes the place to build genuine request/response-level attribution (a model-API gateway in front of the provider, seeing full request+completion for any client that allows endpoint redirection) once the cheaper signals have been validated or exhausted, not before.

Also carries (per AIBRAIN-69) the acceptance detail for folding `activate`/`get_weighted_neighbors` into an owned context-assembly pipeline and moving `ablation_diff`/`get_edge_weight`/`compact_weights` off the agent-facing tool list.

#### AIBRAIN-63 — Build standalone custom UI, decoupled from Obsidian [Task, To Do, Low]

*created 2026-08-15 · updated 2026-08-30*

Build a simple custom UI on top of the cloud backend, positioned as "AI memory that gets smarter the more you use it," not tied to Obsidian. (Noted as paused/superseded for near-term UI needs by AIBRAIN-135.)

#### AIBRAIN-64 — Build markdown/vault import tooling for onboarding [Task, In Progress, High]

*created 2026-08-15 · updated 2026-08-23*

Build markdown/Obsidian vault import tooling as the primary onboarding path, so validated Obsidian-channel users can be inherited rather than starting acquisition from zero. (Desktop app work under this task produced the setup screen, OAuth login — commit 329b2fe — and `packages/core/src/accountSession.ts` cross-app auth hand-off, commit 77f5fc0; see AIBRAIN-127/128/129.)

#### AIBRAIN-65 — Reprice for standalone cloud app based on usage data [Task, To Do, Medium]

*created 2026-08-15 · updated 2026-08-15*

Reprice for the broader market once real usage data exists. 3 to 4 EUR from the Obsidian channel may be too low for a standalone product.

### AIBRAIN-66 — Retrieval Benchmark vs. Baselines + Personal Usage Analytics [In Progress, High]

*created 2026-08-15 · updated 2026-08-21*

Before validating monetization (AIBRAIN-49/59/60/61), answer a more fundamental question: does the Hebbian/decay/activation engine actually beat free, naive alternatives, and how does the user's own usage look in practice?

AIBRAIN-31's ablation harness (`packages/core/scripts/eval-retrieval.mjs`) measures which of the engine's own layers carry the most weight (structuralFallback > priming > importance > consolidation, per its results note) — but only compares the engine against itself with layers toggled off, never against an external baseline: plain grep/full-text search, embedding-based semantic search, or naive full-context-stuffing (CAG-style). Without that there's no evidence the system's complexity earns its keep over a $0 alternative.

Separately, the plugin already logs every session's traversal/reinforce/search events to append-only JSONL (`.vault-neural-links/events/`), but nothing summarizes that back to the user as "how do I actually use this." That's a personal-usage report, distinct from AIBRAIN-60's install/conversion funnel analytics.

Goal: this epic sits ahead of AIBRAIN-61's decision gate, not parallel to it — proving real advantage over free alternatives is a precondition for "will anyone pay."

#### AIBRAIN-67 — As the research lead, I compare retrieval quality against grep, semantic-embedding, and naive full-context baselines [Story, Done, Medium]

*created 2026-08-15 · updated 2026-08-15 · resolution: Done*

Extend `packages/core/scripts/eval-retrieval.mjs` (AIBRAIN-31's harness) with 2-3 baseline retrieval strategies, run against the same 18-query ground-truth set already validated for the ablation results:
1. Plain full-text/filename grep search (zero intelligence baseline)
2. Embedding-based semantic search over note content (no graph, no weights, no decay — a minimal RAG)
3. Optional: naive full-context-stuffing (CAG-style) if corpus size allows a fair test

Measure the same precision/rank metrics used in AIBRAIN-31 against each baseline. Answers "does the whole system beat a $0 alternative, and by how much," not "which of our layers matters most." Results note: Notes/VaultNeuralLinks/AIBRAIN-67 Baseline Benchmark Results.

#### AIBRAIN-68 — As a user, I see a personal usage report summarizing how I actually use the engine [Story, In Review, Medium]

*created 2026-08-15 · updated 2026-08-16*

The plugin/MCP server logs every session's traversal/reinforce/search/activate events to append-only JSONL under `.vault-neural-links/events/`, but nothing summarizes that data back to the user. Build a report (CLI output or plugin panel) surfacing:
- Session frequency and typical session length
- Which mechanisms actually fire in practice (traversal vs. reinforce vs. activate vs. search) and how often
- Which notes/clusters get touched most, and whether that matches what the engine considers "important" (note-importance.json)
- Any gap between intended usage and actual usage

Distinct from AIBRAIN-60 (install/conversion funnel analytics) — this is usage-pattern insight for the user, not a monetization metric. (Implemented as `computeUsageReport()`, referenced by AIBRAIN-70/71/126.)

#### AIBRAIN-130 — Investigate stale/noisy accumulated usage weight degrading rank-1 vs. zero-usage baseline [Story, Done, Medium]

*created 2026-08-28 · updated 2026-09-02 · resolution: Done*

benchmark-reinforcement.mjs (re-run 2026-08-28) shows the live vault's real accumulated usage weight (`asIs`, link-weights.json as-is) scores worse on rank-1 than a zeroed-out usage tier (`zeroUsage`, pure structure+priming+importance):
- asIs: 16/18 found, 9/18 rank-1, mean rank 3.06
- zeroUsage: 16/18 found, 15/18 rank-1, mean rank 2.375
- simulatedReinforcement (fresh, realistic single retrieval-then-read event injected on top of zeroUsage): 18/18 found, 18/18 rank-1, mean rank 1.0

The opposite of what the usage/reinforcement tier is meant to do — real historical baseStrength drags rank quality down, while a single fresh realistic usage event fixes it completely. Points at the accumulated weights being stale/noisy rather than the mechanism being wrong in principle.

Open question at filing: decay miscalibration, or accumulated weight from now-irrelevant old traversals never pruned? (AIBRAIN-139 later proposes a more general framing: usage weight used as the ranking signal rather than a tie-breaker on relevance. Fix landed as commit `be88d9b` per AIBRAIN-141 — primed neighbors floored above the strongest unprimed competitor.)

Full numbers and both benchmark re-runs (2026-08-23 and 2026-08-28): vault Notes/VaultNeuralLinks/AIBRAIN-67 Baseline Benchmark Results (## Updates, 2026-08-28 entry).

#### AIBRAIN-134 — Define evidence-state taxonomy (Retrieved/Read/Re-query/Referenced/Helpful); don't feed raw telemetry into graph weights until correlation is measured [Story, To Do, Medium]

*created 2026-08-30 · updated 2026-08-30*

Problem: benchmark data (AIBRAIN-67, 2026-08-28 run) shows the live vault's accumulated usage weight makes rank quality worse than a clean slate (zeroUsage 15/18 rank-1 vs asIs 9/18) — we already fed a behavioral signal into the ranking formula whose correlation with usefulness was never measured. Don't repeat that with the new telemetry work.

Define and document five explicit evidence states, and what the server can/can't know for each:

| State | Server can know? | Meaning |
| --- | --- | --- |
| Retrieved | Yes | Returned by memory search |
| Read | Yes | Agent subsequently requested/read it |
| Re-query | Yes | Agent searched again after retrieval (weak negative signal) |
| Referenced | No, not MCP-only (needs UI human confirmation or the AIBRAIN-62 gateway) | Source appears to have contributed to final answer |
| Helpful | Only via feedback/strong attribution | Evidence that context actually helped |

Deliverable: a short reference note (vault + code comment on the scoring module) naming these states so future work doesn't slide from "we observed the agent read it" into "we know the agent used it." Then, once AIBRAIN-133/Memory Trace/feedback data (AIBRAIN-48 stories) exists, measure actual correlation between each behavioral signal and confirmed-helpful outcomes before wiring any new signal into edge weights.

Related: AIBRAIN-67, AIBRAIN-31, AIBRAIN-71, AIBRAIN-62.

#### AIBRAIN-137 — Citation-token report_usage() experiment — measure real invocation rate [Story, To Do, Medium]

*created 2026-08-30 · updated 2026-08-30*

Cheap experiment, explicitly not to be built into the ranking architecture until proven.

retrieve() returns each note with an opaque token (e.g. note A -> [memory: m_123]). Expose a tool, report_usage(tokens=[...]), described as expected-to-call after using retrieved context in an answer.

Known risk: structurally the same voluntary-compliance shape as reinforce_link, which had zero real invocations ever (see MCP Tool Decision-Delegation Audit) — an MCP server cannot force a client to call a second tool before ending its turn, on any client.

Deliverable is the measurement: implement cheaply, track real invocation rate over a couple of weeks of live usage. If near-zero like reinforce_link, kill it and document the finding (useful negative result). If meaningfully non-zero, it becomes a "Referenced"-tier signal candidate alongside AIBRAIN-62's gateway work.

Related: AIBRAIN-71 (prior art on the same failure mode), AIBRAIN-62.

#### AIBRAIN-140 — Relevance-ranked plain-text search now beats activate() on rank-1 — re-examine whether the Hebbian/spreading-activation layer earns its complexity [Story, Done, High]

*created 2026-09-02 · updated 2026-09-02 · resolution: Done*

Side effect discovered while fixing AIBRAIN-138/139 (`bc508f5`).

`benchmark-baselines.mjs`'s `grep` strategy is literally `searchNotes(vaultPath, label, { useWeights: false })` — no Hebbian weights, spreading activation, priming, or importance blending. Once AIBRAIN-138/139 gave it tokenized matching and match-kind-tiered ranking (title > alias > content, no usage signal since `useWeights:false`), re-running the same 18-query set:

| method | found | rank-1 | mean rank |
| --- | --- | --- | --- |
| grep (searchNotes, no weights) — before | 8/18 | 2/18 | 3.75 |
| grep (searchNotes, no weights) — after | 15/18 | **13/18** | 1.27 |
| engine (activate(), full mechanism stack) | 16/18 | 9/18 | 3.06 |
| structuralOnly (plain wikilink graph) | 9/18 | 1/18 | 14.67 |

Stable across two consecutive runs. The plain-text baseline — none of the product's mechanisms (decay, priming, consolidation, spreading activation, importance, Hebbian reinforcement) — now beats the full `activate()` engine on rank-1, 13/18 vs 9/18.

**What this does and doesn't mean:**
- Does not resolve AIBRAIN-130 (the `asIs`-vs-`zeroUsage` inversion in `activate()`) — `benchmark-reinforcement.mjs` re-run after this fix is unchanged (`asIs` 9/18, `zeroUsage` 15/18), because `activate()`/`getWeightedNeighbors` is a different ranking path AIBRAIN-138/139 didn't touch.
- It sharpens AIBRAIN-130's question: not just "is the usage tier calibrated" but "does the whole activation/reinforcement machinery earn its cost over a much simpler baseline, once that baseline is given a fair basic implementation." Two bugs in a ~15-line naive-search function erased most of its measured disadvantage.
- n=18, one vault, one author writing both notes and ground truth — a strong lead, not a verdict, until AIBRAIN-130's honest-benchmark rebuild (real usage replayed from history predating the query set, no privileged event on the target) exists.

**Suggested next step:** once AIBRAIN-130 is root-caused (or the relevance-tier idea is tried in `getWeightedNeighbors`/`query.ts`, which sorts on weight alone with no query term since it's neighbor lookup, not search), re-run this comparison. If `activate()` still doesn't clear the fixed grep baseline by a meaningful margin, that answers whether the reinforcement engine belongs at the center of positioning, or whether structure + priming + importance (which already clearly beats grep pre-fix) is the sellable core and reinforcement a smaller refinement.

Related: AIBRAIN-130, AIBRAIN-138/139, AIBRAIN-134.

#### AIBRAIN-141 — Priming has no intra-session decay — a note touched early in a long session stays top-tier after it stops being relevant [Story, Done, Medium]

*created 2026-09-02 · updated 2026-09-02 · resolution: Done*

Known gap, originally surfaced in AIBRAIN-30's literature review ("priming has no intra-session decay per ACT-R") but not acted on since priming's flat `+2` bonus rarely won against real usage weight.

No longer true after AIBRAIN-130's fix (`be88d9b`): a primed neighbor's weight is now floored above the strongest unprimed competitor in its neighbor set, so priming reliably wins. That makes priming's lack of recency-within-buffer decay (`primingBonus()` in `priming.ts`: "deliberately not weighted by recency-within-buffer") matter more.

Concretely: `SessionBuffer` is an LRU with no timestamp per entry. A note touched at the start of a long session stays exactly as "primed" as one touched a second ago, until evicted by the buffer filling (default capacity 20). Under the AIBRAIN-130 fix it reliably outranks real usage-weighted hubs for as long as it stays in the buffer — including well after the session has moved to a different topic.

Suggested approach: weight `primingBonus` (or the AIBRAIN-130 floor built on it) by recency-within-buffer — e.g. a decay curve over buffer position, or an actual timestamp per touch. ACT-R's activation-decay model (already the citation basis for `decay.ts`) is the natural reference. Needs its own design pass, not a quick tack-on to AIBRAIN-130.

### AIBRAIN-69 — Deterministic usage instrumentation — stop delegating logging decisions to the LLM [Done, Medium]

*created 2026-08-16 · updated 2026-08-21 · resolution: Done*

The MCP server relied on Claude (the calling agent) to notice certain events and decide, mid-conversation, to call a tool reporting them — `reinforce_link` ("use this when a link materially helped"), `log_traversal`'s manual-credit path, and implicitly `search_notes` (nobody decided it should persist at all). This judgment-triggered logging fails silently: per AIBRAIN-68's usage report, `reinforce_link` has zero recorded invocations across the entire logged history despite months of real traversal activity.

This epic replaces judgment-triggered logging with outcome-triggered logging the server owns unconditionally, ahead of and independent from the Phase 4 standalone-decoupling decision (AIBRAIN-61/AIBRAIN-50) — it improves the data quality that decision depends on (ablation results, importance scoring, usage reports all consume this event log).

Full audit of all 12 MCP tools, current decision-owner per tool, and proposed fix: vault [[MCP Tool Decision-Delegation Audit and Deterministic Logging Plan]] (VaultNeuralLinks domain).

Not in scope: folding `activate`/`get_weighted_neighbors` into an owned context-assembly pipeline, and moving `ablation_diff`/`get_edge_weight`/`compact_weights` off the agent-facing tool list — those require the standalone backend and are tracked as acceptance detail on AIBRAIN-62 (gated by AIBRAIN-61).

#### AIBRAIN-70 — Persist every search_notes call to the event log [Story, Done, Medium]

*created 2026-08-16 · updated 2026-08-16 · resolution: Done*

`search_notes` only called `client.touch()` (in-memory session priming) — never `appendEvent`/`appendRetrievalLog`, so no persisted trace of search activity existed on disk. An omission, not a judgment gap: nobody wired search into the append-only logger that `traverse`/`reinforce` already use.

Fix: add a `search` entry to the `EventType` union (or a parallel lightweight log) and have `searchNotesTool`'s handler unconditionally append one per call — query, result count, whether weighting was used — regardless of what the caller does with the results.

Acceptance:
- [x] `computeUsageReport()` (AIBRAIN-68) reports real search counts instead of the "can't be measured" caveat in its `gaps` field; that caveat is removed.

#### AIBRAIN-71 — Replace reinforce_link's LLM-judgment trigger with outcome-based auto-reinforcement [Story, Done, Medium]

*created 2026-08-16 · updated 2026-08-16 · resolution: Done*

`reinforce_link` asked Claude to notice mid-conversation that a link "materially helped" and call a tool about it. Per AIBRAIN-68's usage report this never fired — zero invocations across the whole logged history — so the deeper-engagement signal the weighting model was designed around never existed; all persisted weight came from passive `read_note` traversal only.

Fix: deprecate the manual trigger in favor of a deterministic, server-computed signal derived from actual conversation outcome:
1. After a response is generated, check which notes were in the assembled context (from `activate`/`get_weighted_neighbors`/`search_notes` results) AND were actually cited/quoted in the final answer — auto-apply the reinforcement boost to those edges, no LLM call required.
2. Optionally layer an explicit user-facing signal (a 👍 on an answer, or equivalent) as a stronger deterministic boost — a UI event, not a tool call an agent might skip.

Keep `reinforce_link` callable during the transition but stop treating it as primary; update its description to "manual override on top of automatic reinforcement."

Acceptance:
- [x] reinforce events appear in `events/*.jsonl` from real sessions without any explicit tool call
- [x] `computeUsageReport()`'s "reinforce_link was never called" gap stops firing once there's real automatic reinforcement history

#### AIBRAIN-72 — Remove log_traversal's manual-credit path once auto-logging covers its gap [Story, Done, Medium]

*created 2026-08-16 · updated 2026-08-16 · resolution: Done*

`log_traversal`'s manual path existed only to patch a gap in `read_note`'s automatic traversal logging ("reach for it only when an edge should be credited without both notes having gone through read_note") — the same shape of problem as `reinforce_link` (closing a gap by asking the LLM to notice it), just lower-impact.

Fix: identify what actually causes the gap (e.g. content already known without a `read_note` call, or a hop that skipped a read) and close it with a deterministic server-side hook tied to whatever event represents "this note actually entered context." Once closed, remove the manual-credit path from the tool surface (or fold it into the same automatic mechanism as AIBRAIN-70/reinforce work) rather than leaving a rarely-used escape hatch.

Do alongside AIBRAIN-71 — both replace an agent-judgment trigger with an event-driven one and should share the same "note entered context" hook if practical.

#### AIBRAIN-126 — Persist get_weighted_neighbors() calls to the retrieval log [Story, Done, Medium]

*created 2026-08-16 · updated 2026-08-16 · resolution: Done*

activate() already persists every call to retrieval/{instance}.jsonl via appendRetrievalLog (AIBRAIN-26, index.ts:178), tested in index.test.ts. get_weighted_neighbors()'s client method (index.ts:153-156) only called touch() for session priming — no persistence, so its call volume was invisible to computeUsageReport() and to operators inspecting the retrieval log.

Fix (same shape as AIBRAIN-70 — deterministic, unconditional server-owned logging):
- Extend RetrievalLogEntry (types.ts) with `source: "activate" | "get_weighted_neighbors"`; make tier/relaxations/timedOut optional (activation-fallback-specific); add topK.
- Add the missing appendRetrievalLog call inside getWeightedNeighbors' client method.
- Tag activate's existing appendRetrievalLog call with source: "activate".
- Update computeUsageReport() to aggregate/report both sources.
- Tests: mirror index.test.ts's "logs every retrieveWithFallback call to retrieval-log.jsonl" case for getWeightedNeighbors.

Does not require the standalone backend or AIBRAIN-61 gate — small, same-day fix, distinct from AIBRAIN-62's larger pipeline scope.

### AIBRAIN-73 — Licensing/subscription backend — Stripe direct integration, paid from launch [To Do, Medium]

*created 2026-08-16 · updated 2026-08-18*

Product decision (2026-08-16, see vault [[Paid-From-Launch Monetization and Licensing Backend Decision]]): the plugin is paid from launch, not freemium. Obsidian's community store has no payment processing — the plugin installs free from Browse and must gate its functionality behind an entitlement check against infrastructure we own. A licensing/subscription backend is therefore launch-blocking.

Decisions locked in:
- No marketplace resellers (Gumroad/Lemon Squeezy ruled out — they act as Merchant of Record and put their brand between us and the customer).
- Direct Stripe integration. We are the Merchant of Record (chosen over Paddle knowingly — lower fees, but we personally own VAT/sales-tax registration and remittance once thresholds are crossed).

Scope:
- Stripe Checkout/Billing for subscription capture + recurring billing.
- Owned backend receiving Stripe webhooks (checkout.session.completed, customer.subscription.updated, invoice.payment_failed, etc.) and maintaining its own entitlement/license database.
- License verification endpoint the plugin calls to check whether a license is currently active.
- Plugin-side: settings UI for entering/checking a license key, graceful degradation when unlicensed/expired.
- Same backend also hosts the previously-decided opt-in, self-hosted telemetry mechanism (AIBRAIN-60) — one service, two concerns.

NOT in scope: the legal/tax assessment itself (entity structure, ToS, privacy policy, VAT/sales-tax registration under Stripe-as-MoR) — the user's own review, blocks real transactions independently of this work.

Sequence with AIBRAIN-39 (plugin still needs the npm/bundling fixes regardless). Follow-up: AIBRAIN-60 and AIBRAIN-61 both assumed a free tier to convert from — need re-scoping now that there is none (flagged via comment, not resolved here).

#### AIBRAIN-80 — Stripe account setup: business profile, products/prices, tax config [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Foundational — blocks everything else in AIBRAIN-73 and AIBRAIN-74. Set up the Stripe business profile, define the actual Product/Price objects for the decided plan shape (monthly/annual/lifetime), and configure Stripe Tax (or confirm manual VAT/sales-tax handling per AIBRAIN-77).

#### AIBRAIN-81 — Entitlement data model & database [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Source of truth for license/subscription state: customer, plan, status, device list, license key(s). Blocks the webhook receiver, verification endpoint, and device-limit enforcement stories.

#### AIBRAIN-82 — Stripe webhook receiver (signature verification + idempotency) [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Handle checkout.session.completed, customer.subscription.updated/deleted, invoice.payment_failed, and related events. Must verify Stripe's webhook signature and be idempotent (Stripe retries on any non-2xx or timeout). Writes to the entitlement DB.

#### AIBRAIN-83 — License verification endpoint [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

The endpoint AIBRAIN-75 (plugin-side guard) calls to check whether a given license is currently active. Rate-limited per AIBRAIN-78. Needs a stable contract early so plugin-side work can start against a mock.

#### AIBRAIN-84 — Device/seat limit policy + enforcement [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Decide a per-license device cap (e.g. SystemSculpt AI uses 5 devices per personal license) and enforce it in the verification endpoint. Without a cap, key-sharing directly erodes the subscription model.

#### AIBRAIN-85 — License key generation & delivery email [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

On checkout.session.completed, generate the license key and deliver it via transactional email (e.g. Resend/Postmark). Needs a transactional email provider decision.

### AIBRAIN-74 — Landing site & Stripe Checkout [To Do, Medium]

*created 2026-08-16 · updated 2026-08-17*

Marketing/pricing site + purchase flow for the paid-from-launch plugin. Depends on AIBRAIN-73's Stripe account/product/price setup (plans must exist before Checkout can reference them).

Stories: marketing/pricing landing page (features, plan comparison, CTA); Stripe Checkout integration for the defined plans (monthly/annual/lifetime — plan shape decided in AIBRAIN-73); post-purchase success flow (redirect + confirmation that license delivery email is on its way).

Part of the paid-from-launch effort — see vault "Paid-From-Launch Monetization and Licensing Backend Decision" and sibling epics AIBRAIN-73 (backend), plugin guard, billing lifecycle, compliance, hosting.

#### AIBRAIN-86 — Marketing/pricing landing page [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Public site: features, plan comparison, CTA to purchase. Needs final plan shape from AIBRAIN-73's Stripe setup story (AIBRAIN-80).

#### AIBRAIN-87 — Stripe Checkout integration [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Wire the landing page's purchase CTA to Stripe Checkout for the defined Price objects (AIBRAIN-80).

#### AIBRAIN-88 — Post-purchase success flow [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Redirect after successful Checkout + on-page confirmation that the license key email is on its way (AIBRAIN-85).

### AIBRAIN-75 — Plugin-side license guard & UX [To Do, Medium]

*created 2026-08-16 · updated 2026-08-17*

Everything on the Obsidian-plugin side that enforces and communicates license state. Depends on AIBRAIN-73's verification endpoint (at least a stable contract/mock to build against).

Stories: settings UI (enter/validate key, status active/trial/expired); runtime guard gating plugin features behind a valid entitlement; offline grace period / cached entitlement (must not hard-lock the plugin without network — a real 1-star-review risk, not an edge case); graceful degraded/unlicensed state with clear messaging and a purchase link.

Part of the paid-from-launch effort — see vault "Paid-From-Launch Monetization and Licensing Backend Decision".

#### AIBRAIN-89 — Settings UI: enter/validate license key [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Plugin settings pane where the user enters their license key and sees its status (active/trial/expired). Calls AIBRAIN-73's verification endpoint (AIBRAIN-83).

#### AIBRAIN-90 — Runtime feature guard [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Gate the plugin's actual functionality behind a valid entitlement, checked via the cached/verified license state.

#### AIBRAIN-91 — Offline grace period / cached entitlement [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Do not hard-lock the plugin when the user has no network. Cache last-known-good license status with a grace window before re-verification is required. Flagged as a real 1-star-review risk if skipped.

#### AIBRAIN-92 — Graceful degraded/unlicensed state [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Clear in-plugin messaging when unlicensed or expired, with a direct link to purchase (AIBRAIN-74's landing page).

### AIBRAIN-76 — Billing lifecycle & customer self-service [To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Everything that happens to a subscription after the first successful charge. Depends on AIBRAIN-73's webhook infrastructure.

Stories: Stripe Customer Portal integration (self-serve card update / cancel / invoice history — near-zero build cost, avoids every cancellation becoming a support ticket); dunning handling (invoice.payment_failed -> grace period -> downgrade, with a real email — Stripe Smart Retries handle the retry, we own downgrade + comms); cancellation flow compliant with click-to-cancel requirements (FTC and equivalents are active enforcement territory in 2026 — self-serve cancel is not optional); refund/chargeback policy + handling process.

Part of the paid-from-launch effort — see vault "Paid-From-Launch Monetization and Licensing Backend Decision".

#### AIBRAIN-93 — Stripe Customer Portal integration [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Self-serve card update / cancel / invoice history via Stripe's hosted Customer Portal. Low build cost, avoids every cancellation becoming a support ticket.

#### AIBRAIN-94 — Dunning handling (failed payment -> grace period -> downgrade) [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

On invoice.payment_failed, start a grace period, email the customer, then downgrade entitlement if unresolved. Stripe Smart Retries handle the retry itself; we own the downgrade logic and customer communication.

#### AIBRAIN-95 — Compliant self-serve cancellation flow [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Cancellation must be as easy as signup (click-to-cancel style requirements — FTC and equivalents are active enforcement territory in 2026). Not optional.

#### AIBRAIN-96 — Refund/chargeback policy + handling process [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Written policy plus the operational process for handling Stripe disputes/chargebacks. Needed before the first dispute arrives, not after.

### AIBRAIN-77 — Legal, compliance & support readiness [To Do, Medium]

*created 2026-08-16 · updated 2026-08-17*

Non-engineering-owned but launch-blocking. The user's own legal/tax assessment (entity structure, ToS, Privacy Policy, VAT/sales-tax registration under Stripe-as-Merchant-of-Record) is out of engineering scope, but several deliverables need engineering hands once legal content exists.

Stories: ToS + Privacy Policy drafted and published (legal content owned by the user; engineering publishes/links on site + plugin); VAT/sales-tax registration & Stripe Tax configuration (or manual handling); support channel setup (email/helpdesk) with basic SLA expectations; Obsidian community-plugins.json submission README disclosing network use, paid-license requirement, and linking the Privacy Policy per Obsidian developer policy.

Blocks the actual Obsidian submission (README disclosure needs real ToS/PP to link) and going live commercially (Stripe requires business/tax info before payouts). See vault "Paid-From-Launch Monetization and Licensing Backend Decision" for the Stripe-as-MoR tax-obligation flag.

#### AIBRAIN-97 — Terms of Service + Privacy Policy drafted and published [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Legal content owned by the user (own legal review, not engineering). Engineering publishes/links the final text on the landing site and in the plugin once drafted.

#### AIBRAIN-98 — VAT/sales-tax registration & Stripe Tax configuration [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Since Stripe is the direct processor with the user as Merchant of Record, VAT/sales-tax registration and remittance obligations are the user's own, across every jurisdiction with customers once thresholds are crossed. Stripe Tax can automate calculation/collection once registration is sorted.

#### AIBRAIN-99 — Support channel setup [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Real support email/helpdesk with basic SLA expectations — expected by card networks and by Obsidian reviewers for a paid submission.

#### AIBRAIN-100 — Obsidian community-plugins.json submission README disclosure [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

README must disclose network use (which remote services and why), the paid-license requirement, and link the Privacy Policy, per Obsidian's developer policy. Depends on AIBRAIN-39 packaging and this epic's ToS/PP story (AIBRAIN-97).

### AIBRAIN-78 — Backend hosting & operational reliability [To Do, Medium]

*created 2026-08-16 · updated 2026-08-17*

Once the licensing backend gates paying customers' access, its uptime directly blocks revenue — a new risk category that didn't exist when everything was free and client-side.

Stories: choose hosting platform + deploy pipeline for the licensing backend (AIBRAIN-73); uptime monitoring & alerting (outage = paying users locked out); rate limiting & abuse protection on the license verification endpoint (key-sharing/brute-force); secrets management for Stripe keys and DB credentials.

Blocks AIBRAIN-73's endpoints and the plugin guard (original text reads "AIBRAIN-3903" [sic] — presumably AIBRAIN-75) from having anything real to call in production. See vault "Paid-From-Launch Monetization and Licensing Backend Decision".

#### AIBRAIN-101 — Choose hosting platform + deploy pipeline [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

For the licensing backend (AIBRAIN-73). Blocks every other story in AIBRAIN-73/74/75/76 from having anything real to run against in production.

#### AIBRAIN-102 — Uptime monitoring & alerting [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Backend outage now directly blocks paying customers' access, not just an annoyance as when everything was free/client-side.

#### AIBRAIN-103 — Rate limiting & abuse protection on verification endpoint [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Prevents key-sharing/brute-force abuse of AIBRAIN-73's license verification endpoint (AIBRAIN-83).

#### AIBRAIN-104 — Secrets management for Stripe keys and DB credentials [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Proper secrets storage/rotation for the licensing backend's Stripe API keys, webhook signing secret, and DB credentials.

### AIBRAIN-79 — Post-launch: account dashboard & business metrics [To Do, Low]

*created 2026-08-16 · updated 2026-08-17*

Explicitly staged AFTER v1 launch — not launch-blocking. Split deliberately from the already-decided opt-in/self-hosted product telemetry (AIBRAIN-60/71 lineage): this epic is business metrics (MRR, churn, activation, purchase rate), not product usage data.

Stories: optional account/login for self-serve license management (view active licenses/devices without Stripe Portal); business metrics dashboard (MRR, churn, activation, purchase rate off the store listing).

Do not pull into the v1 launch scope — the user explicitly wants to think about the fuller SaaS shape only after the paid launch is live.

#### AIBRAIN-105 — Optional account/login for self-serve license management [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Post-launch. View active licenses/devices without going through Stripe's Customer Portal.

#### AIBRAIN-106 — Business metrics dashboard (MRR, churn, activation) [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Post-launch. Business metrics, distinct from the already-decided opt-in/self-hosted product usage telemetry (AIBRAIN-60/71 lineage).

### AIBRAIN-108 — Scale testing: synthetic 300k-note corpus + performance benchmarking [To Do, Low]

*created 2026-08-16 · updated 2026-08-17*

The real vault has ~250 notes. Nothing has been tested near the scale a real customer's vault could reach (300k notes used as the target order of magnitude). Extends the existing baseline benchmark work (packages/core/scripts/benchmark-baselines.mjs, from the AIBRAIN-68 usage-report commit) rather than starting fresh.

Mock data approach: real large interlinked-note corpora don't exist publicly at this scale, so the primary source is a synthetic generator — but a naive uniform-random link generator would under-stress the system, since real note graphs (like Wikipedia's) exhibit power-law/small-world structure. Use a preferential-attachment (Barabasi-Albert style) topology generator so hub-heavy structural stress (PageRank, clustering, spreading activation) is actually exercised.

Stories: synthetic vault generator (note count, avg links/note, cluster count; preferential attachment; extends benchmark-baselines.mjs); Wikipedia-derived real-world link-graph sample as a secondary validation corpus; full pipeline run (parse, structural index build, compaction/decay, PageRank, Louvain clustering, nightly pipeline) at 300k scale with timing/memory numbers against acceptance thresholds; document bottlenecks/scaling limits (discovery story — decide follow-up perf work only after seeing real numbers).

Related: AIBRAIN-31, AIBRAIN-66/67/68. The resulting fixture is `sample-okf-large` (300,003 OKF notes), which surfaced AIBRAIN-131/132/133/142.

#### AIBRAIN-110 — Synthetic vault generator (preferential-attachment topology) [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Parameterized by note count, avg links/note, cluster count. Uses preferential-attachment (Barabasi-Albert style) topology rather than uniform-random so hub-heavy structural stress (PageRank, clustering, spreading activation) is actually exercised, matching real-world note-graph shape. Extends packages/core/scripts/benchmark-baselines.mjs.

#### AIBRAIN-111 — Wikipedia-derived real-world link-graph sample (secondary validation corpus) [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Cross-check that the synthetic generator isn't accidentally easier or harder to process than real-world topology, using a sample built from publicly available Wikipedia dumps/pagelinks data reshaped into vault-note form.

#### AIBRAIN-112 — Full-pipeline benchmark run at 300k-note scale [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Parse, structural index build, compaction/decay, PageRank, Louvain clustering, nightly pipeline — run against the synthetic (and Wikipedia-derived) corpora at 300k notes. Capture timing/memory numbers against defined acceptance thresholds.

#### AIBRAIN-113 — Document bottlenecks/scaling limits found [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Discovery story, not a pre-committed fix. Write up whatever the 300k-scale run actually finds; decide follow-up performance work only after seeing real numbers, not in advance.

#### AIBRAIN-131 — Desktop app note-list/graph render hangs at 300k-note scale — capped to top-N by importance [Story, In Review, Medium]

*created 2026-08-28 · updated 2026-08-28*

Discovered live: with the desktop app's workspace pointed at sample-okf-large (300,003 OKF notes, the AIBRAIN-108 scale corpus), login appeared to hang on "Waiting for browser…" for minutes although the browser-side OAuth exchange had completed. Root cause wasn't auth — `loadAndShowFolder` in `packages/desktop-app/src/renderer.ts` auto-reopened the last workspace on login and then (1) built one `<li>` DOM element per note synchronously (300,000), and (2) handed all 300,000 notes+edges to `ForceSim`/`Renderer` (render-core's force-directed physics), which isn't built for that node count. The main process saturated enough to delay unrelated work (including the login IPC handler), so it looked like an auth bug. Electron eventually crashed.

Separate from AIBRAIN-118's `listNodes`/structural-index fix, which already handles 300k on the indexing side (confirmed in `main.ts`'s `workspace:load-folder` handler comment) — this bug was purely in what the desktop app renders.

**Fix implemented** (`packages/desktop-app/src/main.ts`, `renderer.ts`, `renderer/index.html`): `summarize()` caps the note list + graph to the top 500 notes by PageRank importance (`computePageRank`, the same score the radial-star layout uses) whenever a folder has more than 500 notes. Total counts preserved (`noteCount` vs new `renderedNoteCount`), edges filtered to those between two rendered notes, UI shows "Showing top N of M notes by importance" when capped. `search`/`activate` unaffected — they query the full on-disk structural index.

Verified against the real sample-okf-large corpus: total load ~31s (17s indexing + 14s PageRank-for-ranking), list and graph render correctly capped to 500 nodes.

**Known follow-up, deliberately deferred (user's call):** the 14s PageRank-for-capping cost is paid on every folder load. Could read the nightly pipeline's persisted `note-importance.json` (`loadNoteImportance`) first and fall back to live `computePageRank` only when no cache exists — at the cost of up-to-a-day stale ranking. Vault note: [[Desktop App Render Cap at Scale - Top-N by Importance]].

### AIBRAIN-109 — OKF format support: implementation + scale/mock-data validation [In Progress, Highest]

*created 2026-08-16 · updated 2026-08-17*

Google published the Open Knowledge Format (OKF) 2026-06-12 as v0.1 (Apache 2.0, GitHub) — a deliberately minimal spec: markdown files with a small YAML frontmatter block, one concept per file, only "type" required in v0.1 (title/description/resource/tags/timestamp optional). Positioned as the format for giving AI agents curated context, "a starting point," not a finished standard.

The detailed implementation plan exists in the vault — [[OKF Link Migration Plan]] (5 phases: extract shared target-resolution helper, dual-syntax link parsing in core, switch auto-generated links to OKF syntax, Obsidian vault setting, migrate existing notes) — saved 2026-07-20, not yet executed. This epic executes that plan AND adds scale/mock-data validation, since OKF is 2 months old and no large real-world OKF corpus exists — synthetic generation is the only option.

Stories: re-validate the plan's assumptions against the published v0.1 spec; execute Phases A-C (shared resolver, dual-syntax parsing, autolink switch); execute Phase D (Obsidian setting + manual verification) and E (migrate this vault's ~250 notes, dry-run first); synthetic large-scale OKF corpus generator reusing the AIBRAIN-108 topology generator but emitting OKF-shaped files (YAML frontmatter with type/title/description/resource/tags/timestamp, relative markdown links); run the engine against the synthetic OKF corpus at 300k scale, validating adapter correctness AND performance.

Related: AIBRAIN-34 (AI-inferred edges — different problem, OKF already has explicit links), AIBRAIN-108 (shared topology generator).

#### AIBRAIN-114 — Re-validate OKF migration plan against the published v0.1 spec [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

The existing plan (vault: OKF Link Migration Plan) was drafted 2026-07-20, close to OKF's 2026-06-12 announcement. Confirm its frontmatter-field and link-syntax assumptions match the actual released v0.1 spec doc (Apache 2.0, GitHub) rather than an early impression, before building against it.

#### AIBRAIN-115 — Execute migration plan Phases A-C (shared resolver, dual-syntax parsing, autolink switch) [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Per the vault OKF Link Migration Plan: extract the shared target-resolution helper (Phase A), add dual-syntax (wikilink + OKF) link parsing in core (Phase B), switch auto-generated links to OKF syntax (Phase C).

#### AIBRAIN-116 — Execute migration plan Phases D-E (Obsidian setting + existing-notes migration) [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Per the vault OKF Link Migration Plan: Phase D (Obsidian "New link format" setting + manual verification that native backlinks/graph view still work), Phase E (migrate this vault's existing ~250 notes' wikilinks to OKF syntax, dry-run reviewed before --apply).

#### AIBRAIN-117 — Synthetic large-scale OKF corpus generator [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Reuse the topology generator from AIBRAIN-108 but emit OKF-shaped files: YAML frontmatter with type/title/description/resource/tags/timestamp per the v0.1 spec, relative markdown links instead of wikilinks.

#### AIBRAIN-118 — Run engine against synthetic OKF corpus at scale [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-23*

Validate parsing/adapter correctness AND performance against the synthetic OKF corpus, aligned with the 300k-note target from AIBRAIN-108 — not just correctness at the current ~250-note scale. (Per AIBRAIN-131/133, the `listNodes`/structural-index fix done here already handles the 300k case on the indexing side.)

### AIBRAIN-119 — Anonymous, offline-first telemetry pipeline [To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Implements the telemetry mechanism already decided (vault: "Telemetry Approach and Distribution Sequencing Decision" — opt-in only, self-hosted endpoint, no third-party analytics) now that AIBRAIN-73 gives it a real backend. Refines that decision with three requirements:
1. Anonymous — no PII, no note content/titles/paths in any payload; identified only by an anonymous per-install token (not tied to license/email/account).
2. Offline-first — the plugin works fully offline, so telemetry must never block on network. Events queue locally and sync opportunistically.
3. Secured — both the local queue (at rest) and sync transport (in transit) need real protection; it's still a stream of usage data even if anonymous.

Stories: anonymous local event buffer; local storage security; offline-first batched sync (retry/backoff, max-age/size eviction); backend ingestion endpoint extending AIBRAIN-73's backend (install-token auth, rate-limited, TLS-only); opt-in first-run UX + settings toggle (never silently default on); data minimization / anonymization spec (exact event schema up front; feeds AIBRAIN-77's privacy policy text).

Depends on AIBRAIN-73 (backend) and transitively AIBRAIN-78 (hosting). Relates to AIBRAIN-77 (privacy policy must disclose this) and AIBRAIN-60 (this epic is the concrete implementation of AIBRAIN-60's telemetry mechanism; AIBRAIN-60 stays as the broader install/WAU/conversion goal, already flagged for re-scoping since there's no free tier).

#### AIBRAIN-120 — Anonymous local event buffer [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Append-only local queue for telemetry events, keyed by an anonymous per-install token generated on first run (not tied to license key, email, or account). Payload schema must never include note titles, paths, or content — structural/usage metrics only (e.g. tool-call counts, session duration, feature flags used).

#### AIBRAIN-121 — Local telemetry queue storage security [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

The local event buffer file needs real protection — restrict filesystem permissions to the current user, avoid storing it somewhere auto-synced/backed-up unexpectedly, and treat it as a liability if it leaks even though the data is anonymous (usage patterns can still be sensitive).

#### AIBRAIN-122 — Offline-first batched sync with retry/backoff and eviction [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Telemetry must never block plugin usage on network availability. Upload buffered events in batches when online; exponential backoff on failure; a max-age/max-size eviction policy so a long-offline user doesn't accumulate unbounded local queue growth.

#### AIBRAIN-123 — Backend telemetry ingestion endpoint [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Extends AIBRAIN-73's backend. Accepts batched anonymous events, authenticated via the anonymous per-install token (not a license key), rate-limited per AIBRAIN-78's abuse-protection story (AIBRAIN-103), TLS-only transport.

#### AIBRAIN-124 — Opt-in first-run UX + settings toggle [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Must respect the existing opt-in-only decision (vault: "Telemetry Approach and Distribution Sequencing Decision") — asks on first run, does not default to on, stays visibly toggleable in settings. No events are queued (not just "not sent") before the user opts in.

#### AIBRAIN-125 — Data minimization / anonymization spec [Story, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Define the exact event schema up front (field-by-field) and confirm nothing identifying can leak into it before any collection code is written. Output feeds directly into AIBRAIN-77's Privacy Policy story (AIBRAIN-97) and the Obsidian README network-use disclosure (AIBRAIN-100).

### AIBRAIN-133 — searchNotes has no content index — full-vault linear scan takes 130s+ at 300k-note scale [In Progress, Medium]

*created 2026-08-30 · updated 2026-09-02*

Discovered in the same session as AIBRAIN-132, testing desktop-app search against `sample-okf-large` (300,003 OKF notes).

**The gap**: `searchNotes` (`packages/core/src/notes.ts`) had no persisted index over note bodies — only titles/aliases get a cheap check; everything else requires a full `readNote` (file read + frontmatter parse) per candidate, for every note, on every search. No caching or incremental content indexing.

**Measured** (`packages/desktop-app/scripts/repro-search.mjs`, real fixture): fully sequential (pre-AIBRAIN-132) — hard-hung / never returned; bounded concurrency 50 (AIBRAIN-132 stopgap) — 203.8s; bounded concurrency 250 — 129.5s. The sublinear improvement (5x concurrency -> ~1.6x faster) shows the bottleneck is total disk/CPU work, not concurrency; tuning further has diminishing returns and risks reintroducing EMFILE.

**What's needed**: a persisted content index (e.g. inverted token index over note bodies, built/maintained incrementally like structural-links/link-weights/note-importance) so search looks up candidates from the index and only reads matched notes for snippet/context — same shape as AIBRAIN-118's `listNodes()` fix. Designing the index format/update strategy is the first task of this epic. `CONTENT_SCAN_CONCURRENCY = 250` stopgap stays until then.

Stopgap status at filing: search on a 300k vault slow (~2 min) but no longer crashes or hangs; the desktop app shows a "Searching…" indicator. AIBRAIN-142 records the honest follow-up from real-scale validation of the shipped index.

Related: AIBRAIN-132, AIBRAIN-118, AIBRAIN-108, AIBRAIN-138 (tokenization should be designed alongside the index format).

#### AIBRAIN-142 — Content index doesn't narrow enough for corpora with heavily repeated vocabulary — candidates still need per-file reads [Story, To Do, Low]

*created 2026-09-02 · updated 2026-09-02*

Honest follow-up from AIBRAIN-133's real-scale validation, not a bug in what shipped.

**Measured** against sample-okf-large (300k notes, AIBRAIN-108's fixture): a query on terms common in this corpus's vocabulary ("interface protocol context", each present in ~125k/300k notes — the generator reuses a small, heavily-repeated word pool) narrows via token-intersection from 300,000 to 28,920 candidates in 57ms — index and intersection are fast. But 28,920 is still large enough that per-candidate disk reads (`readNote()` for anything the title-only fast path doesn't resolve) dominate: 336s (no index) -> 206s (indexed) — a real but much smaller win than the 158x on a selective/zero-hit query (336s -> 2.1s, same corpus).

**Root cause**: the index deliberately only answers "could this note possibly match" (AIBRAIN-133's design choice — field-agnostic, always trust live content for scoring rather than risk a stale index producing a wrong tier). Where common words are genuinely common, the candidate set doesn't shrink enough to avoid the read cost.

**Not urgent**: the real `ai-brain` vault (471 notes) has genuinely diverse vocabulary (20,886 unique tokens across 471 notes) — nothing close to the synthetic ~1:1 token-to-note repetition. A synthetic-fixture-specific stress case.

**Possible direction, not decided**: have postings carry enough per-candidate information (matched field, or a cheap term-frequency count) to score a common-case candidate without a re-read. Deferred because it reopens the staleness/consistency tradeoff AIBRAIN-133 deliberately avoided — needs its own design pass.

Related: AIBRAIN-133, AIBRAIN-108.

## Orphan issues (no parent epic)

### AIBRAIN-36 — compactWeightsTool test call sites fail tsc --noEmit: handler takes 0 args, tests pass ({}) [Bug, Done, Low]

*created 2026-07-14 · updated 2026-07-16 · resolution: Done*

`packages/mcp-server/src/tools.ts` — `compactWeightsTool.handler` is `(ctx: ToolContext) => async () => {...}` (zero params). `packages/mcp-server/test/tools.test.ts` calls it as `compactWeightsTool.handler(ctx)({})` at 8 call sites (lines 51, 66, 77, 102, 117, 132, 143, 170). `npx tsc --noEmit -p packages/mcp-server` fails with 8x `TS2554: Expected 0 arguments, but got 1.`

Confirmed pre-existing on `main` at commit d0026a3 (verified via `git stash` + fresh `core` dist rebuild + `tsc --noEmit`). vitest doesn't catch it because it only transpiles rather than type-checks; `tsup` build doesn't catch it since it only compiles `src`, not `test`.

Fix: either give the handler an (unused/optional) parameter matching the other tools' handler shape, or drop the `({})` argument at each test call site. Low severity — doesn't block runtime or build, but breaks a clean `tsc --noEmit` gate; fix before CI requires it.

### AIBRAIN-37 — Graph view UI/UX pass: brain icon, dismissible retrieval panel, interim clustering layout [Task, Done, Medium]

*created 2026-07-14 · updated 2026-07-16 · resolution: Done*

User-reported UI/UX issues with the Obsidian plugin's Neural Graph view, fixed in commit f96f04f: (1) graph looked like an unstructured hairball vs. Obsidian's native graph; (2) retrieval path panel could not be hidden/dismissed; (3) ribbon/tab icon was the default "git-fork" Lucide icon.

Fixes:
- Ribbon icon and view tab icon switched to "brain" (main.ts, NeuralGraphView.ts).
- RetrievalPathPanel.ts + styles.css: collapse toggle in the panel header.
- ForceSim.ts: lightweight deterministic label-propagation clustering pass (new Clustering.ts) pulling detected communities toward distinct anchor points, as a stopgap ahead of the real Louvain/Leiden work in AIBRAIN-22. Tuned charge/link/collide physics and the isolate-ring force (now sized off a percentile with a symmetric band instead of a single max-distance outlier) so unlinked notes settle into one tight ring.
- Renderer.ts: reduced edge opacity/thickness to match Obsidian's minimal-ink style.

Note: Clustering.ts's label-propagation approach is intentionally throwaway — AIBRAIN-22 should replace it with real Louvain/Leiden modularity optimization, after which the anchor-pulling force in ForceSim.ts consumes its cluster assignments.

### AIBRAIN-45 — Shared core-backed read path for SessionStart MOC/Inbox context [Task, To Do, Medium]

*created 2026-07-26 · updated 2026-07-26*

The global hard rule says all vault .md interaction goes through vault-neural-link MCP tools, enforced by ~/.claude/hooks/enforce-vault-mcp.ps1 (PreToolUse hook denying native Read/Edit/Write/MultiEdit under the vault). But ~/.claude/hooks/vault-session-start.ps1 (SessionStart hook that dumps MOCs/*.md into context every session) reads those files with raw Get-ChildItem/Get-Content, outside that gate — SessionStart fires before any tool call exists to intercept, and hooks are shell subprocesses that can't invoke mcp__vault-neural-link__ tools. A silent loophole since the hook was written.

Fix: give the hook and the MCP server one shared read path in packages/core:
1. Add packages/core/src/sessionContext.ts: getMocSections(vaultPath), getInboxFlag(vaultPath), buildSessionStartContext(vaultPath) — reusing the listNotes pattern from packages/core/src/notes.ts, raw file reads (not parsed NoteRef) to preserve the verbatim dump format. Export from packages/core/src/index.ts.
2. Add packages/core/bin/vnl-session-context.js (same shape as vnl-compact.js/vnl-nightly.js): imports from ../dist/index.js, takes vaultPath as argv[2], must fail open (never exit non-zero, print nothing on error) since a broken context-loader must never block session start. Prints the complete SessionStart hook JSON payload to stdout. Add "vnl-session-context" to packages/core/package.json's bin field.
3. Rewrite ~/.claude/hooks/vault-session-start.ps1 to resolve CLAUDE_VAULT_PATH then shell out to `node <repo>/packages/core/bin/vnl-session-context.js $vaultFull` and pass stdout through — removing all direct vault access from the hook. Repo path hardcoded the same way ~/.claude.json already hardcodes the MCP server's dist path; should switch to resolving via the installed package once AIBRAIN-40..44 (npm publish) lands.
4. Update the "Harness tool routing (hard rules)" section of ~/.claude/CLAUDE.md to document SessionStart context-loading as a stated exception (read-only, pre-agent-turn, backed by the same packages/core code) — same treatment as the .yml/.yaml exception.

Full plan captured in the vault — see linked note.

### AIBRAIN-46 — As Obsidian, I own the daily compact/consolidation cycle myself, with no external scheduler or Claude Code trigger [Story, Done, Medium]

*created 2026-08-13 · updated 2026-08-13 · resolution: Done*

Move the daily weight-compaction pipeline (`compact` -> `runNightlyConsolidation` -> `rebuildStructuralIndex` -> `runImportanceComputation` -> `runClusterComputation`, currently `packages/core/bin/vnl-nightly.js`) into the Obsidian plugin itself, so it self-schedules from inside `packages/obsidian-plugin` while Obsidian is open.

Remove the two external triggers this replaces: the Windows Scheduled Task (`INSTALL.md` step 7, `schtasks /create ... vnl-compact.js ...`) and any reliance on a Claude Code session to kick off compaction (`compact_weights` MCP tool as effective trigger, `.claude/settings.local.json` Bash permission for `node bin/vnl-compact.js`).

Hard requirement: **100% idempotency, exactly one full run per calendar day, triggered only by Obsidian itself.**

Key risk: `runNightlyConsolidation` (`packages/core/src/consolidation.ts`) has NO internal same-day guard — its code comment states it must only be invoked by a real once-a-day cron, or repeated same-day calls double-promote edges past the reactivation threshold. The plugin-side scheduler must add an explicit last-run-date gate (persisted via plugin `loadData()`/`saveData()`, not just an in-memory interval), checked on every plugin load and on a periodic in-session timer, so that: reopening Obsidian multiple times in one day never re-runs consolidation; leaving Obsidian open across midnight still triggers exactly one run for the new day; a crash/reload mid-run doesn't produce a partial or duplicate day marker.

Also update `INSTALL.md` (drop step 7) and `docs/spec.md` bin/cron references to reflect the plugin as sole scheduler; CLI (`vnl-compact.js`/`vnl-nightly.js`) remains a manual/headless fallback, no longer the primary path.

### AIBRAIN-107 — Validate MCP server behavior under non-Claude clients (Codex CLI, Gemini CLI) [Task, To Do, Medium]

*created 2026-08-16 · updated 2026-08-16*

Product positioning decision (2026-08-16, see vault "MCP Cross-Client Portability as Core Positioning"): the pitch is "your AI Brain isn't rented from one AI vendor" — swap Claude for Codex/Gemini/a local model and the accumulated weighted-link memory (plain files in the user's own vault) comes with you, since MCP is a broadly-adopted open protocol (native support in Claude, ChatGPT/Codex, Gemini, Copilot, Cursor, Ollama, LM Studio as of 2026).

Never actually tested — @vault-neural-links/mcp-server has only been exercised against Claude Code's tool-calling conventions. Validation pass needed before this is a headline claim:
- Point the built MCP server at OpenAI Codex CLI and Google Gemini CLI (both native MCP clients) instead of Claude Code.
- Confirm all 12 tools are discoverable and callable under each client's conventions.
- Re-check the tools flagged in AIBRAIN-69's audit (search_notes persistence, auto-reinforcement via retrieval-then-read correlation, traversal auto-logging) — these depend on deterministic server-side hooks precisely because different agent loops can't be trusted to call judgment-triggered tools; confirm they fire regardless of client.
- Document client-specific quirks (system prompt differences, tool-choice heuristics, pagination/discovery behavior under MCP 2026-07-28) affecting real usage.

Acceptance:
- [ ] A short compatibility note (which clients tested, what worked, what didn't) that the marketing claim can stand behind.

Related: AIBRAIN-69.

### AIBRAIN-127 — Desktop app: setup screen has no logout button [Task, To Do, Medium]

*created 2026-08-17 · updated 2026-08-17*

Bug found 2026-08-17 reviewing the desktop app (AIBRAIN-63/64). Logout only exists on the app screen (`#appScreen` in `packages/desktop-app/renderer/index.html`) — the setup screen (`#setupScreen`, added in the AIBRAIN-64 commit) has no way to log out. A user landing on setup (first run, or via "Switch source…") is stuck with no logout path.

Fix: add the same logout button + `window.vnl.logout()` handler to the setup screen. Small, mechanical — not yet done, planning-only pass per user request.

### AIBRAIN-128 — Obsidian plugin reads the desktop app's shared account session instead of its own license-key login [Story, Done, Medium]

*created 2026-08-18 · updated 2026-08-21 · resolution: Done*

Read half of the cross-app auth hand-off started in AIBRAIN-64 (commit 77f5fc0, `packages/core/src/accountSession.ts`). Per the 2026-08-18 architecture decision (vault note "Standalone Decoupled Product Direction - Open Question"), the Electron desktop app is the single auth/subscription surface — the plugin should not prompt its own independent login when the user reached it via the desktop app's "existing Obsidian vault" companion screen.

Write half already exists: `accountSessionPath()` (`~/.vault-neural-links/account-session.json`, fixed OS-level location independent of any vault folder) + `readAccountSession`/`writeAccountSession`/`clearAccountSession` in `packages/core` — already `require()`'d unmodified by the plugin. Desktop app's `auth:login`/`auth:logout` IPC handlers write/clear this file.

Scope:
- On plugin load, check `readAccountSession(accountSessionPath())` before falling back to the plugin's own license-key flow.
- Decide entitlement semantics — reuse the offline-grace-period design in vault note "Desktop App Login and Subscription Validation" (14-day grace, `lastValidatedAt`) rather than inventing a second scheme.
- The plugin's own standalone license-key login must keep working unchanged for the plugin-only channel (no desktop app / no account-session file).
- Not in scope: plugin-connection-status detection surfaced back to the desktop app's companion screen — reverse direction, undesigned.

Depends on AIBRAIN-73 for the real verification endpoint eventually; buildable now against the desktop app's mock validator, same swap-seam approach `SubscriptionValidator` already uses.

### AIBRAIN-129 — No entitlement gate exists: unauthorized users get full retrieval access today [Story, To Do, High]

*created 2026-08-18 · updated 2026-08-18*

Confirmed gap, not yet fixed — user asked "what happens with the MCP server if not authorized" during AIBRAIN-64 OAuth work (2026-08-18). Both real surfaces checked:
- `packages/mcp-server` (the published npm package the Obsidian channel installs today) has **zero auth code** — no auth/entitlement/token/license reference anywhere. Anyone who registers it via `claude mcp add` with `CLAUDE_VAULT_PATH` set gets full `search_notes`/`activate`/`get_weighted_neighbors`/etc. access, free, no account, no check.
- Desktop app's `engine:search`/`engine:activate` IPC handlers (`packages/desktop-app/src/main.ts`) are also unguarded — login/setup screens gate reaching the UI, but nothing re-checks entitlement per retrieval call; an expired access token mid-session doesn't stop search/activate.

Predates and is not fixed by AIBRAIN-64's OAuth work (commit 329b2fe) — that makes a valid access token available (via `packages/core`'s `accountSession.ts`), it doesn't make anything check it.

Intended design (vault note "Desktop App Login and Subscription Validation", item 3): gate `engine:search`/`engine:activate` **hard-block, not degrade** — no partial results when unauthorized, just an error directing the client to log in. The same gate must apply to the future bundled MCP server (AIBRAIN-62 territory) and ideally to `packages/mcp-server` itself — the larger and more urgent gap since it's the one shipped today.

Not scoped here: verification logic against AIBRAIN-73's real backend (doesn't exist yet) — use the same token-expiry check available today (mock), swapped later.

### AIBRAIN-132 — searchNotes crashes (EMFILE/OOM) on broad queries against large vaults — unbounded concurrent weight lookups [Bug, In Review, High]

*created 2026-08-30 · updated 2026-08-30*

Discovered live testing the AIBRAIN-131 desktop-app loading-screen UX against `sample-okf-large` (300,003-note OKF corpus): a search triggered on app launch (auto-resumed workspace) crashed the whole Electron process.

**Root cause**: `searchNotes` (`packages/core/src/notes.ts`) ran `Promise.all(hits.map(hit => getWeightedNeighbors(...)))` with no cap on `hits.length`. A broad query produced ~8,000+ textual hits, so ~8,000 `getWeightedNeighbors` calls fired concurrently. Each independently calls `loadWeights`/`loadNoteImportance`/`loadStructuralIndex`, none cached — every call a fresh `readFile` + `JSON.parse` (including the large `structural-links.json`). Thousands of concurrent file opens exceeded the OS descriptor limit (`EMFILE`), and holding that many parsed copies exhausted the V8 heap (`OOM`). Only `topK` (default 10) hits are ever returned, so scoring every hit was pure waste.

**Fix implemented** (`packages/core/src/notes.ts`): capped the weight-scoring step to the first `WEIGHT_SCORE_CAP` (500) hits, processed in bounded batches of `WEIGHT_SCORE_CONCURRENCY` (25). Verified: `tsc --noEmit` clean, core rebuilt (`tsup`), desktop app relaunched against `sample-okf-large` without crashing.

**Deliberately not done** (follow-up, same "good enough for now" call as AIBRAIN-131's deferred PageRank cache): `loadWeights`/`loadNoteImportance`/`loadStructuralIndex` are still re-read from disk once per scored hit (up to 500 per search) instead of loaded once per batch. Revisit if search latency on large vaults becomes a real complaint.

Related: [[Desktop App Render Cap at Scale - Top-N by Importance]] (AIBRAIN-131) — same class of bug (fine at small scale, unbounded against the 300k fixture).

### AIBRAIN-138 — search_notes returns empty for real notes — matching is literal substring only, no tokenization [Bug, Done, Highest]

*created 2026-09-02 · updated 2026-09-02 · resolution: Done*

Found during a full-project audit (2026-09-02), reproduced live against the working vault (~430 notes — NOT scale-dependent).

**Defect**: `searchNotes` (`packages/core/src/notes.ts`) matched with `title.toLowerCase().includes(needle)` / `aliases.some(a => a.includes(needle))` / `note.body.toLowerCase().includes(needle)`. The query is one literal contiguous string — no tokenization, no OR/AND over terms, no stemming, no fuzzy fallback. Any query whose words aren't a contiguous slice of the note returns `[]`.

**Reproduced**: `search_notes("MCP Tool Decision-Delegation Audit")` -> 5 results (target found); `search_notes("decision delegation audit deterministic logging")` -> `[]`. Target note: `Notes/VaultNeuralLinks/MCP Tool Decision-Delegation Audit and Deterministic Logging Plan` — every word of the second query appears in its title.

**Why it matters**: the actual root cause of the "search_notes returns empty for a confirmed-real note" symptom recorded twice in the vault (2026-08-30 entry in `MOCs/VaultNeuralLinks`; Related section of `Notes/VaultNeuralLinks/Usefulness Signal Roadmap - Pause Desktop UI, Sequence Evidence-State Telemetry`), tentatively attributed to AIBRAIN-132/133 — both performance tickets, neither would fix this. The worst failure mode for an agent memory layer: recall confidently reports nothing exists, and the calling LLM can't tell a real absence from a phrasing miss.

**Fix**: tokenize the query, match on term overlap rather than substring containment, score by term frequency / field weighting (see AIBRAIN-139). Designed alongside AIBRAIN-133's content index, since the index format determines what matching is cheap. Fixed in commit `bc508f5` (with AIBRAIN-139).

Related: AIBRAIN-133, AIBRAIN-132.

### AIBRAIN-139 — search_notes ranks by usage weight alone — exact title matches lose to incidental mentions in hub notes [Bug, Done, Highest]

*created 2026-09-02 · updated 2026-09-02 · resolution: Done*

Found during a full-project audit (2026-09-02), reproduced live against the working vault.

**Defect**: after matching, `searchNotes` (`packages/core/src/notes.ts`) sorted with a single term: `hits.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));`. `SearchHit.matched` ("title" | "alias" | "content") is computed, returned, and discarded from ranking. No term-frequency score, no field weighting, no match-kind tier — usage weight did 100% of the ranking work.

**Reproduced** — `search_notes("MCP Tool Decision-Delegation Audit", topK: 5)`:
1. Notes/VaultNeuralLinks/Vault Neural Links Project — content — 13.417
2. MOCs/VaultNeuralLinks — content — 12.856
3. Notes/VaultNeuralLinks/Standalone Decoupled Product ... — content — 5.531
4. Notes/VaultNeuralLinks/MCP Cross-Client Portability ... — content — 0.150
5. Notes/VaultNeuralLinks/MCP Tool Decision-Delegation ... — title — 0.150

The exact title match ranks **last**, behind two high-traffic hub notes that merely mention the phrase. At default `topK` 10 it survives; at `topK: 4` it disappears. Two notes tie at the 0.15 floor with arbitrary order.

**Why Highest**: the same pathology as AIBRAIN-130 (`asIs` 9/18 rank-1 vs `zeroUsage` 15/18), reproducible in one tool call instead of a benchmark run. Suggests a simpler, more general framing than AIBRAIN-130's stale-weights hypothesis: **usage weight is being used as the ranking signal rather than as a tie-breaker on top of a relevance signal.** A heavily traversed note is heavily traversed for everything — so on any query it outranks the note that actually answers it.

**Fix**: score = relevance term (match kind tier: title > alias > content, plus term frequency once AIBRAIN-138 lands tokenization) with usage weight as a bounded multiplier or tie-breaker, not the sort key. Then re-run `benchmark-baselines.mjs` / `benchmark-reinforcement.mjs` — if rank-1 on `asIs` moves toward `zeroUsage`, AIBRAIN-130 is substantially answered, and the same correction likely applies to `getWeightedNeighbors`/`activate`. Fixed in commit `bc508f5` (with AIBRAIN-138); see AIBRAIN-140 for the benchmark consequence.

Related: AIBRAIN-130, AIBRAIN-138, AIBRAIN-134.
