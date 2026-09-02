# Vault Neural Link — Full Plan & Architecture Reference

**Generated**: 2026-09-02 · **Repo state**: `main` @ `d4d46d1` · **Jira**: project AIBRAIN, 142 issues (53 Done)

This document has two parts:

- **[Part 1 — Path to Market](#part-1--path-to-market)**: everything standing between today and a real, paid, publicly-listed product, organized into tracks with status, owner, and sequencing.
- **[Part 2 — Architecture & Design Reference](#part-2--architecture--design-reference)**: how the system actually works today — packages, data model, every mechanism, the tool surface, and the design decisions behind them.

Jira remains the source of truth for task status per this repo's `CLAUDE.md`; this document is a snapshot and a map, not a replacement for it. `docs/STATUS.md` is the shorter day-to-day version of Part 1's most recent slice.

---

## Part 1 — Path to Market

### Current state, honestly

The retrieval engine works and is now *measured* to work, not just assumed to — every mechanism has a real before/after number from this week's fixes (see [Part 2 §7](#7-case-study-how-ranking-actually-got-fixed-this-week) for the story). The packaging *mechanics* (license, versioning, bundling, CI, docs) are built and tested. Nothing about **distribution, monetization, legal standing, or support** exists yet beyond planning documents. If "market" means "a stranger can find this, pay for it, and get help if it breaks," essentially all of that is still ahead.

### Track A — Distribution (unblocks everything else)

Nothing downstream works until users can actually install this.

| # | Item | Status | Ticket | Blocker |
|---|---|---|---|---|
| A1 | npm publish metadata, LICENSE, version bump | ✅ Done | AIBRAIN-40 | — |
| A2 | Bundle `core` into `mcp-server`; Changesets versioning | ✅ Done, verified live | AIBRAIN-41 | — |
| A3 | GitHub Actions release workflow | ✅ Written, In Review | AIBRAIN-42 | **You**: create an npm access token, add as repo secret `NPM_TOKEN` |
| A4 | First actual `npm publish` | ⛔ Not started | AIBRAIN-42 | Depends on A3's token |
| A5 | README/INSTALL one-line install docs | ✅ Done | AIBRAIN-44 | — |
| A6 | Obsidian community plugin store submission | ⛔ Not started | AIBRAIN-39 (implicit) | **You**: submit to `obsidian-releases`, manual review queue (their timeline, not ours) |
| A7 | Validate non-Claude MCP clients (Codex, Gemini CLI) | ⛔ Not started | AIBRAIN-107 | Needs A4 or a local build to test against |

**Sequencing**: A3 → A4 is one PR-merge away from working, once you do the one manual step. A6 can start in parallel any time — it doesn't depend on npm at all.

### Track B — Licensing & Entitlement

Right now: **anyone who installs this gets full retrieval access, forever, for free.** If Track C (billing) ships before this, revenue leaks entirely.

| # | Item | Status | Ticket |
|---|---|---|---|
| B1 | No entitlement gate exists — flagged directly | ⛔ Not started | AIBRAIN-129 (High priority) |
| B2 | Entitlement data model & database | ⛔ Not started | AIBRAIN-81 |
| B3 | License verification endpoint | ⛔ Not started | AIBRAIN-83 |
| B4 | Device/seat limit policy + enforcement | ⛔ Not started | AIBRAIN-84 |
| B5 | License key generation & delivery email | ⛔ Not started | AIBRAIN-85 |
| B6 | Plugin-side settings UI: enter/validate license key | ⛔ Not started | AIBRAIN-89 |
| B7 | Runtime feature guard (gate reinforcement/visualization behind license) | ⛔ Not started | AIBRAIN-90 |
| B8 | Offline grace period / cached entitlement | ⛔ Not started | AIBRAIN-91 |
| B9 | Graceful degraded/unlicensed state (don't just break) | ⛔ Not started | AIBRAIN-92 |

**Sequencing**: B2 (data model) is the real starting point — everything else in this track and all of Track C depends on it existing first.

### Track C — Billing & Monetization

Decision already made and recorded (vault: *Paid-From-Launch Monetization and Licensing Backend Decision*, 2026-08-16): direct Stripe integration, you as Merchant of Record, no marketplace resellers. None of the implementation has started.

| # | Item | Status | Ticket |
|---|---|---|---|
| C1 | Stripe account setup (business profile, products/prices, tax config) | ⛔ Not started | AIBRAIN-80 |
| C2 | Stripe webhook receiver (signature verification + idempotency) | ⛔ Not started | AIBRAIN-82 |
| C3 | Marketing/pricing landing page | ⛔ Not started | AIBRAIN-86 |
| C4 | Stripe Checkout integration | ⛔ Not started | AIBRAIN-87 |
| C5 | Post-purchase success flow | ⛔ Not started | AIBRAIN-88 |
| C6 | Stripe Customer Portal integration | ⛔ Not started | AIBRAIN-93 |
| C7 | Dunning handling (failed payment → grace → downgrade) | ⛔ Not started | AIBRAIN-94 |
| C8 | Compliant self-serve cancellation flow | ⛔ Not started | AIBRAIN-95 |
| C9 | Refund/chargeback policy + handling process | ⛔ Not started | AIBRAIN-96 |

**Sequencing**: C1 is a you-only task (real business setup, can't be automated from here) and blocks everything else in this track. C2–C5 form the actual purchase path; C6–C9 are lifecycle management that can trail slightly behind launch if genuinely necessary, but not by much — a customer who can't cancel is a chargeback waiting to happen.

### Track D — Legal & Compliance

The one track with real personal/legal exposure if skipped, not just a missing feature.

| # | Item | Status | Ticket | Note |
|---|---|---|---|---|
| D1 | Terms of Service + Privacy Policy | ⛔ Not started | AIBRAIN-97 | Blocks any real checkout going live |
| D2 | VAT/sales-tax registration & Stripe Tax config | ⛔ Not started | AIBRAIN-98 | **Flagged in the vault as your own legal review, not resolved by any engineering decision** — get real advice before charging anyone |
| D3 | Obsidian `community-plugins.json` submission README disclosure | ⛔ Not started | AIBRAIN-100 | Required content for A6 |

### Track E — Backend Hosting & Operations

Only needed once Track B/C introduce an actual backend service (license verification + webhooks) — the MCP server itself runs locally and needs none of this.

| # | Item | Status | Ticket |
|---|---|---|---|
| E1 | Choose hosting platform + deploy pipeline | ⛔ Not started | AIBRAIN-101 |
| E2 | Uptime monitoring & alerting | ⛔ Not started | AIBRAIN-102 |
| E3 | Rate limiting & abuse protection on verification endpoint | ⛔ Not started | AIBRAIN-103 |
| E4 | Secrets management (Stripe keys, DB credentials) | ⛔ Not started | AIBRAIN-104 |
| E5 | Support channel setup | ⛔ Not started | AIBRAIN-99 |

### Track F — Post-Launch

| # | Item | Status | Ticket |
|---|---|---|---|
| F1 | Optional account/login for self-serve license management | ⛔ Not started | AIBRAIN-105 |
| F2 | Business metrics dashboard (MRR, churn, activation) | ⛔ Not started | AIBRAIN-106 |
| F3 | Anonymous, offline-first telemetry pipeline | ⛔ Not started | AIBRAIN-119 (epic, 6 stories) |
| F4 | Track installs, weekly active usage, conversion | ⛔ Not started | AIBRAIN-60 |
| F5 | Reprice for standalone cloud app based on usage data | ⛔ Not started | AIBRAIN-65 |

### Track G — Product Quality Gate

Not launch-blocking in the legal/business sense, but launch-*credibility*-blocking — shipping without these means selling on a claim you haven't actually verified.

| # | Item | Status | Ticket |
|---|---|---|---|
| G1 | Widen the 18-query ground-truth benchmark | ⛔ Not started, no ticket yet | — |
| G2 | Content index: repetitive-vocabulary degradation | ⛔ Not started, low priority | AIBRAIN-142 |
| G3 | `docs/spec.md` still describes an abandoned "no MCP" design | ⛔ Not started | — |
| G4 | Global `CLAUDE.md` has a stale `log_traversal` instruction | ⛔ Not started | — |
| G5 | Cross-client portability validation (Codex, Gemini, Cursor) | ⛔ Not started | AIBRAIN-107 |
| G6 | Scale testing: 300k-note corpus, full pipeline | 🟡 Partially done this week (search specifically) | AIBRAIN-108 (epic) |
| G7 | OKF format support at scale | 🟡 In progress | AIBRAIN-109 (epic) |

### Explicitly paused, not part of this plan

- **AIBRAIN-63** — standalone desktop app. Paused 2026-08-30 pending proof the engine worked; that proof now exists (this week's fixes), so this is a candidate to un-pause, but it's your call — it doesn't block anything above.
- **AIBRAIN-137** — citation-token usage experiment. Expected to fail the same voluntary-compliance way `reinforce_link` did; low priority regardless of launch timing.

### Suggested sequencing (dependency-driven, not calendar-driven)

```
Track A (distribution)  ──┬──────────────────────────────────────► listed & installable
                           │
Track D1/D2 (legal)  ──────┼──► Track C (billing) ──► Track B (entitlement) ──► paid, gated
                           │         │
Track E (hosting/ops) ─────┘         └──► Track F (post-launch metrics)

Track G (quality) ── runs in parallel throughout, not a gate on any of the above
```

The realistic critical path to "someone can pay you for this": **D1/D2 (legal) → C1 (Stripe setup, you) → C2–C5 (checkout+webhooks) → B2–B5 (entitlement+licenses) → B6/B7 (gate it in the product)**. That is easily several weeks of real work even moving quickly, most of it not automatable — it's business setup and integration work requiring your accounts, your identity, and your judgment calls (pricing, refund policy, tax jurisdiction), not code a session like this one can generate ahead of you.

---

## Part 2 — Architecture & Design Reference

### 1. What this is, in one paragraph

Vault Neural Link is an MCP (Model Context Protocol) server that gives an AI coding/knowledge agent a working memory layer over an Obsidian vault (or any OKF-format folder of markdown notes). Wikilinks between notes form the graph's skeleton; a Hebbian-style weighted layer on top — reinforced by real traversal and reading behavior, decayed exponentially over time — determines what actually surfaces as "relevant" at query time, instead of treating every link as equally important forever.

### 2. Repository layout

```
vault-neural-link/
├── packages/
│   ├── core/              headless engine — the actual product logic
│   ├── mcp-server/        MCP protocol wrapper around core (the installable artifact)
│   ├── obsidian-plugin/   visualization + nightly scheduler, runs inside Obsidian
│   ├── render-core/       shared force-directed graph rendering, used by the plugin
│   └── desktop-app/       experimental standalone Electron shell (paused)
├── docs/                  this file, STATUS.md, spec.md (stale), architecture diagrams
├── .changeset/            version/changelog management for core + mcp-server
├── .github/workflows/     release.yml — build/test/publish on merge
└── data/                  gitignored — this repo's own scratch dir, not a real vault
```

Total source: ~3,550 lines in `core`, ~4,825 lines across the other four packages, ~8,400 lines total (tests not counted separately — `core` alone carries 200 tests across 22 files).

### 3. Data model — what's persisted, and where

All runtime state lives inside `.vault-neural-links/` **inside the vault itself**, not in this repo and not in any external database. Delete that folder and the vault reverts to a plain Obsidian vault with zero trace of ever having been indexed.

| File | Built by | Purpose | Rebuild cadence |
|---|---|---|---|
| `link-weights.json` | `compactor.ts`, from `events/*.jsonl` | The Hebbian edge weights — `baseStrength`, `lastTouched`, `traverseCount`, `reinforceCount`, `reactivationDays`, `consolidatedScore` per edge | On every `compact_weights` call or MCP-server startup; folds pending events |
| `structural-links.json` | `structuralLinks.ts` | Pure wikilink adjacency graph, independent of usage — the "what's actually linked" skeleton | Nightly (staleness-gated) |
| `content-index.json` | `contentIndex.ts` (AIBRAIN-133) | Token → note-paths inverted index over title/aliases/body, for `search_notes` to avoid a full vault scan | Nightly, shares one `adapter.listNodes()` pass with the structural index |
| `note-importance.json` | `importance.ts` | PageRank score per note over the structural graph — the "genuine hub, even if not recently touched" signal | Nightly |
| `note-clusters.json` | `clustering.ts` | Louvain community detection over the structural graph — topic clusters with no manual tagging | Nightly |
| `events/{instance}.jsonl` | `logger.ts` | Append-only per-MCP-instance event log: `traverse`, `reinforce`, `decay`, search, retrieval events | Every relevant tool call |
| `session/{instance}.json` | `priming.ts` | This session's `SessionBuffer` snapshot (which notes were recently touched, and when) — lets the Obsidian plugin render "primed" state cross-process | Every `touch()` |
| `changes.jsonl` | `changelog.ts` (vault root, not `.vault-neural-links/`) | Plain-text human-readable audit trail of every create/update | Every write |

All persisted JSON files follow the same pattern: `buildX()` (pure, testable), `loadX()` (returns `null` if absent, never throws on missing file), `persistX()` (atomic — write to a `.tmp` file, then `rename()`), `rebuildX()` (the public build+persist wrapper, optionally accepting pre-fetched data to avoid a redundant scan).

### 4. The retrieval pipeline, end to end

```
   MCP tool call (search_notes / get_weighted_neighbors / activate)
                            │
              ┌─────────────┴─────────────┐
              │                            │
       search_notes()              computeLiveNeighborWeights()
      (notes.ts)                          (query.ts)
              │                            │
   content-index.json narrows    loads link-weights.json (usage),
   candidates (or full scan       note-importance.json (hub score),
   if index absent/stale) ──►     structural-links.json (fallback tier)
              │                            │
   matchField() scores each        live-decays each edge's weight,
   candidate: title/alias/         blends in importance, floors a
   content tier × phrase/token     primed neighbor above the
   quality (AIBRAIN-138/139)       strongest unprimed one, scaled
              │                    by how fresh that touch is
              │                    (AIBRAIN-130/141)
              │                            │
              └─────────────┬──────────────┘
                             │
                    activate() (activation.ts)
              spreads energy outward from computeLiveNeighborWeights'
              output across bounded multi-hop neighbors, splitting
              proportionally to edge weight at each hop, accumulating
              energy for notes reached via multiple paths
                             │
                    retrieveWithFallback() (fallback.ts)
              if activation returns too few results, relaxes
              thresholds up to 3 times, then falls back to keyword
              search, then to most-recently-touched notes — never
              returns nothing (AIBRAIN-24/25)
```

### 5. The mechanisms, one by one

**Decay** (`decay.ts`) — exponential: `weight × exp(-λ × daysSince)`, `λ = ln(2) / halfLifeDays`. Default half-life 30 days, tunable per note `type` (MOC notes decay slower at 90 days; project notes faster at 14). A "fast-decay window" variant exists for *unproven* edges (fewer than 3 total touches) — decays hard for the first 2 days at a 0.5-day half-life, then reverts to the normal rate — so a single stray touch doesn't linger at full strength, while genuinely repeated engagement decays normally.

**Priming** (`priming.ts`) — a `SessionBuffer` (in-memory LRU, capacity 20) remembers which notes this session has touched and when. `primingBonus()` applies a decaying bonus (default magnitude 2, 20-minute half-life — reuses `decay.ts`'s own exponential function, just at session timescale) rather than a flat always-on bonus. This is genuinely load-bearing: ablation testing this week showed priming carries most of what the whole engine's retrieval quality depends on (disabling it collapsed rank-1 accuracy from 9/18 to 1/18 on the benchmark set).

**Consolidation** (`consolidation.ts`) — models spaced repetition: an edge reactivated on ≥3 distinct days within a trailing 7-day window gets promoted into a long-term tier (`consolidatedScore`), which is added to its weight *undecayed*. Sustained engagement compounds this rather than triggering it once.

**Importance** (`importance.ts`) — standard PageRank (damping 0.85, 50 iterations, 1e-6 convergence tolerance) computed over the *structural* graph, deliberately not the usage-weighted one — the point is surfacing genuine hubs even during a long stretch with no recent traversal. Blended into live weight as `weight × (1 + 0.5 × importanceScore)`.

**Clustering** (`clustering.ts`) — Louvain community detection (resolution 1.0, up to 10 passes of local-moving optimization) over the structural graph. Powers the Obsidian plugin's radial-star graph layout (cluster hubs near center, leaves toward the rim) with zero manual tagging.

**Structural fallback** — a real wikilink with no usage history yet still gets a small floor weight (0.1) rather than being invisible to retrieval, but only for pairs with no usage-weighted edge already — real usage always outranks bare link presence.

**Ablation framework** (`ablation.ts`) — runs `activate()` twice (all layers on vs. specific layers off) and diffs the results, so any claim about what a mechanism contributes is checkable rather than asserted. This is the harness that made this week's root-causing possible at all.

**Content index** (`contentIndex.ts`, shipped this week) — a field-agnostic inverted index (token → paths, covering title/alias/body together) that only narrows candidates; live content is always re-checked for the real match, so a stale or missing index degrades speed, never correctness. Verified at 300k-note scale: 336s → 2.1s on a selective query.

### 6. The MCP tool surface (11 tools)

| Tool | What it does |
|---|---|
| `create_note` | Create a note (frontmatter + body); auto-links it, logs the change |
| `update_note` | Replace a note's body, or append under a heading |
| `read_note` | Read parsed frontmatter + body; auto-credits a pending retrieval as a reinforcement |
| `list_notes` | List paths, optionally scoped to a folder |
| `search_notes` | Tokenized, tiered-relevance text search (title > alias > content), weight as a bounded tie-breaker |
| `get_weighted_neighbors` | One-hop weighted neighbors of a note |
| `activate` | Multi-hop spreading-activation retrieval from one note |
| `ablation_diff` | Compare `activate`'s output with/without specific layers |
| `get_edge_weight` | Current live weight between two specific notes |
| `log_traversal` | Narrow manual override for an edge `read_note` couldn't credit automatically (rare) |
| `compact_weights` | Force-fold pending events into `link-weights.json` immediately |

Not a tool: reinforcement itself. Reading a note that just surfaced in this session's own retrieval result auto-reinforces that edge — deterministic, no LLM judgment call required. The earlier `reinforce_link` tool (an explicit, LLM-decided call) was removed after recording zero real invocations across months of production use, and when tested, being miscalibrated enough that two calls could force an irrelevant note to rank #1 regardless of topical relevance. This finding shapes several current design choices (see §7).

### 7. Case study: how ranking actually got fixed this week

This is worth documenting because it's the clearest illustration of the codebase's actual failure mode and how it gets found.

The product's core claim is "retrieval gets better as real usage accumulates." A benchmark run this week showed the opposite: real accumulated weight (`asIs`) scored **9/18** rank-1 accuracy against 18 ground-truth queries, while a *zeroed-out* usage tier (`zeroUsage`, pure structure + priming + importance) scored **15/18**. Two bugs, found and fixed in sequence, explain why:

1. **`search_notes` ranked by usage weight alone.** Match quality (`matched: "title"|"alias"|"content"`) was computed and then discarded from ranking — a note's raw historical weight decided position regardless of whether it was actually the right answer. Fixed by scoring a match-kind tier first (title=2000 > alias=500 > content=100, scaled by phrase/token quality) and using weight only as a small tie-breaker within a tier, capped so it can never cross one.

2. **`computeLiveNeighborWeights`'s priming bonus was a flat `+2`.** That reliably beat the structural floor (0.1) — explaining why `zeroUsage` scored well — but had no relationship to real usage weight, which reaches double digits for genuine hubs. A note the session had just touched could be permanently buried behind a generically popular note. Diagnosed by profiling real neighbor weights directly (`MOCs/VaultNeuralLinks → Vault Neural Links Project` sat at weight 12.85, dwarfing the +2 bonus) and confirmed by individually ablating `importance` and `consolidation` (both produced identical numbers to baseline — neither was the mechanism). Fixed by flooring a primed neighbor's weight at "strongest unprimed competitor in this same set, plus a small margin" instead of a flat constant — deliberately *not* a large fixed offset like the search fix, since this function also drives `activate()`'s proportional energy-share math, where an unbounded boost would let a primed neighbor swallow ~100% of a hop's outgoing energy.

After both fixes: `asIs` rank-1 accuracy is **15/18** — numerically identical to `zeroUsage`, closing the inversion the investigation started from.

A third, smaller fix (priming's flat bonus now decays with a 20-minute half-life instead of staying at full strength for as long as a note sits in the session buffer) followed directly from making priming *reliably win* — its previously-harmless lack of intra-session decay (a known gap since AIBRAIN-30's literature review) started mattering once it actually had the authority to dominate.

**The general pattern, worth naming explicitly**: every one of these bugs was the same shape — a signal with no ceiling relative to the thing that should be dominant (query relevance in search; session relevance in retrieval) was allowed to override it. Watch for this shape specifically if a future regression looks similar.

### 8. Cross-cutting design decisions

- **Portability over Claude-Code-specific shortcuts.** `SourceAdapter` (`adapters.ts`) abstracts the vault/link-extraction seam so Obsidian and OKF sources share every downstream mechanism unchanged. An MCP server structurally cannot see a client LLM's final answer text, on *any* client — this ruled out using Claude Code's own `Stop` hook for deterministic "was this referenced" detection, even though it would have been the easy win, because it would only ever work for one client.
- **Deterministic over judgment-triggered logging.** Reinforcement, search logging, and traversal credit all moved from "the LLM notices and decides to call a tool" to "the outcome deterministically triggers it" (AIBRAIN-69 epic) — directly because the judgment-triggered version (`reinforce_link`) measured at zero real usage.
- **Never silently miss, only degrade to slow.** Both the structural fallback tier and the content index follow the same rule: an absent or stale derived index can only make the system slower, never wrong — live content is always the final authority.
- **Accepted staleness, not real-time sync.** Every derived index (structural, importance, clusters, content) rebuilds nightly, staleness-gated, triggered by the Obsidian plugin being open — not by a Claude Code session or an OS scheduled task, since the vault syncs across machines that aren't always on.

### 9. Known limitations (current, not resolved)

- Retrieval quality claims rest on an 18-query benchmark from one vault, one author (Track G1).
- The content index's candidate-narrowing degrades on corpora with heavily repeated vocabulary — measured on a synthetic fixture, not yet observed on a real vault (AIBRAIN-142).
- No entitlement gate exists at all (Track B1) — every current user has full access.
- `docs/spec.md` still describes an architecture ("no MCP, no server") abandoned early in the project's life (Track G3).
- Cross-client portability (Codex, Gemini, Cursor) is unvalidated — the whole "survives switching models" positioning is currently a claim, not a test result (Track G5).

### 10. Appendix — default configuration values

| Config | Key values |
|---|---|
| `DEFAULT_DECAY_CONFIG` | `halfLifeDays: 30` |
| `DEFAULT_NOTE_TYPE_DECAY_CONFIG` | default 30d; `moc: 90d`, `atomic: 30d`, `project: 14d` |
| `DEFAULT_PRIMING_CONFIG` | `bufferSize: 20`, `bonus: 2`, `halfLifeMinutes: 20` |
| `DEFAULT_CONSOLIDATION_CONFIG` | `reactivationThreshold: 3` days within `windowDays: 7`, `promotionIncrement: 1` |
| `DEFAULT_SPREADING_ACTIVATION_CONFIG` | `energyEdgeWeightDecayPerHop: 0.5`, `maxHops: 3`, `minThreshold: 0.5`, `structuralMinThreshold: 0.05` |
| `DEFAULT_STRUCTURAL_FALLBACK_CONFIG` | `floorWeight: 0.1` |
| `DEFAULT_IMPORTANCE_CONFIG` | `dampingFactor: 0.85`, `iterations: 50`, `convergenceTolerance: 1e-6`, `blendLambda: 0.5` |
| `DEFAULT_CLUSTERING_CONFIG` | `resolution: 1.0`, `maxLevels: 10` |
| Search ranking tiers | `TITLE_TIER: 2000`, `ALIAS_TIER: 500`, `CONTENT_TIER: 100`, `WEIGHT_TIEBREAK_CAP: 10` |

None of these have been tuned against real usage data at any scale beyond this project's own ~470-note vault — every value above is a documented, reasoned first cut, not a measured optimum. Track G1's benchmark widening is the natural point to revisit them.
