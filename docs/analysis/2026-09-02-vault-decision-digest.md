# Vault Neural Links — Vault Decision Digest (compiled 2026-09-02)

Sources: `MOCs/VaultNeuralLinks` plus all 27 notes in `Notes/VaultNeuralLinks/`. Searches for AIBRAIN-67 / benchmark / monetization / Stripe / OKF / desktop app / portability / telemetry / usefulness returned nothing relevant outside that folder (Stripe/monetization hits in `01-Personal/Business/BrainSpace/Radar/...` and `Phoenix/...` are other products; the Radar 2026-08-31 pricing note was read and is unrelated). No `Notes/Jira` or `Notes/BrainSpace` VNL notes exist.

## A. Chronological decision log

| Date | Decision | Note | Status |
|---|---|---|---|
| 2026-07-08 | Decay half-life 30 days; traversal granularity per-note-read; `.vault-neural-links/` gitignored; data lives inside the vault | Vault Neural Links Project | Half-life later refined to per-note-type (moc 90d / atomic 30d / project 14d, 2026-07-11) |
| 2026-07-08 | Traversal auto-logged by a `PostToolUse`/`Read` hook (`vault-log-traversal.ps1`); Windows Scheduled Task runs compaction daily | Vault Global Hook Architecture | **Superseded** 2026-07-09 (hook removed) and 2026-08-13 (task removed) |
| 2026-07-09 | Add `packages/mcp-server` (5 tools); **remove the Read hook** — "the user wanted one interface for this subsystem — every interaction goes through MCP tool calls the model makes deliberately (Serena-style)"; trade-off accepted: "traversal logging now depends on the model actually calling the tool" | Vault Neural Links Project | Trade-off later found to be fatal (2026-08-09: zero traversals for 4 weeks) → **superseded** by auto-logging |
| 2026-07-09 | Strategy: two product directions — (1) full "install, point, work" Obsidian MCP, (2) Obsidian plugin for visualization; **one shared rendering codepath** (extract `Renderer.ts`/`ForceSim.ts`) | Vault Neural Links Project | Binding; realized as `packages/render-core` 2026-08-17 |
| 2026-07-09 | Note CRUD (`create_note`/`update_note`/`read_note`/`list_notes`/`search_notes`) built into the MCP server with auto-link → changelog → git commit in TS; schema policy stays at skill/prompt level | Vault Neural Links Project | Binding |
| 2026-07-11 | Live decay at query time (not batch); `weight`→`baseStrength`; per-note-type half-life | Vault Neural Links Project | Binding |
| 2026-07-13 | Priming = flat +2 bonus from a 20-entry LRU `SessionBuffer`, no in-session recency weighting ("lightest-lift") | Vault Neural Links Project | **Superseded** — 20-min half-life decay now in repo (AIBRAIN-31 "fast-decay fix" referenced in AIBRAIN-67 note) |
| 2026-07-13 | Persist session buffer to disk (`.vault-neural-links/session/<instance>.json`) so plugin can show primed ring — user chose (a) persist over (b) approximate or (c) skip | Vault Neural Links Project | Binding |
| 2026-07-13 | Consolidation: ≥3 distinct days in trailing 7-day window promotes to an **undecayed** `consolidatedScore`; promotion runs only in the nightly job, never in `compact()` | Vault Neural Links Project | Binding |
| 2026-07-13 | Supersedes edges read straight from frontmatter (`status: superseded` + `superseded_by`), no parallel edge store | Vault Neural Links Project | Binding |
| 2026-07-13 | Bounded spreading activation: `energyEdgeWeightDecayPerHop` 0.5, `maxHops` 3, `minThreshold` 0.5 | Vault Neural Links Project | Binding; `structuralMinThreshold` 0.05 added 2026-07-14 |
| 2026-07-14 | Never-empty retrieval: `retrieveWithFallback` tiers activation → keyword → recency | Vault Neural Links Project | Binding |
| 2026-07-14 | Interim label-propagation clustering as throwaway until Louvain (AIBRAIN-22) | Vault Neural Links Project | **Superseded** 2026-07-16 by real Louvain (`note-clusters.json`) |
| 2026-07-14 | PageRank importance over the *structural* graph only, blended as `score * (1 + λ·importance)`; clustering feeds viz only, never retrieval | Vault Neural Links Project | Binding |
| 2026-07-15 | Nightly pipeline triggered from MCP-server startup (staleness-gated on `note-importance.json.computedAt`) | Nightly Pipeline Scheduling Decision | **Superseded** 2026-08-13 |
| 2026-07-15 | Harness hard rules: Serena for source, vault-neural-link MCP for all vault `.md`, vault = default persistence target, info-gathering starts with vault | Harness Tool Routing Hard Rules | Binding (harness-level) |
| 2026-07-17 | Cluster-grouped radial star layout by PageRank importance (AIBRAIN-38) | Cluster-Grouped Radial Star Layout | Binding (viz) |
| 2026-07-20 | Report ablation on the real ~250-note vault, not a synthetic 5,000-note one | AIBRAIN-31 Ablation Evaluation Results | Binding methodology |
| 2026-07-20 | Lit review: hold all new mechanisms pending measured effect sizes; "no new Phase-7-spawned engineering tickets" | Phase 7 Literature Review | Binding |
| 2026-07-20 | OKF = dual-syntax link support, not a foreign adapter; 5-phase plan saved, not executed | OKF Link Migration Plan | Phases A/B executed 2026-08-17 (AIBRAIN-109); C/D/E still open |
| 2026-07-26 | Distribution: npm (`npx -y @vault-neural-links/mcp-server`) over GitHub-releases; official Obsidian store over BRAT-first (AIBRAIN-39) | Installable Distribution Decision | Binding; code done, pending NPM_TOKEN per repo |
| 2026-07-26 | SessionStart MOC read to go through a shared core-backed CLI (AIBRAIN-45) | SessionStart MOC Read Bypasses MCP Routing | Open, not implemented |
| 2026-08-09 | `read_note` auto-logs traversal between consecutive different reads; `search_notes` primes but never persists weight; **no backfill of fabricated weights** | Auto-Logged Traversal on read_note… | Binding |
| 2026-08-09 | White spark glow for weighted edges; instant struck-edge yellow spark for activation | White Spark Glow Redesign | Binding (viz) |
| 2026-08-13 | Nightly pipeline scheduled **only** by the Obsidian plugin (`NightlyScheduler`, AIBRAIN-46); Scheduled Task and MCP-startup triggers removed. Requirement: "100% idempotency, exactly one run per day, triggered only by Obsidian" | Nightly Pipeline Self-Scheduled by Obsidian Plugin | Binding |
| 2026-08-15 | AIBRAIN-66 (benchmark vs. baselines + usage analytics) placed *ahead of* the AIBRAIN-61 monetization gate | MOC | Binding |
| 2026-08-15 | Open question raised: decouple from Claude Code, one-click installer, source picker, standalone UI | Standalone Decoupled Product Direction | See 2026-08-17 |
| 2026-08-16 | Telemetry: opt-in only, self-hosted, no third-party analytics; packaging first, telemetry as follow-up release | Telemetry Approach and Distribution Sequencing | Mechanism binding; **sequencing superseded** same day by paid-from-launch |
| 2026-08-16 | **Paid from launch** (not freemium); no marketplace resellers (Gumroad/Lemon Squeezy out); **Stripe direct, user is Merchant of Record** (over Paddle); licensing backend is launch-blocking | Paid-From-Launch Monetization | Binding |
| 2026-08-16 | Cross-client MCP portability = core positioning; AIBRAIN-69 deterministic logging reframed as a portability requirement | MCP Cross-Client Portability | Binding |
| 2026-08-16 | Audit: replace judgment-triggered tools with deterministic outcome-triggered logging; AIBRAIN-70/71/72 shipped (71 narrowed to retrieval-then-read correlation, `AUTO_REINFORCE_BOOST` 3; 72 kept with `trigger` field instead of deletion) | MCP Tool Decision-Delegation Audit | Binding |
| 2026-08-17 | **Gate overridden**: proceed with standalone direction; AIBRAIN-61 closed Done. Correction: "i want only mcp that can be consumed by different ai not a chat, or api key or whatever" — no owned agent loop, no chat UI, no app API key. Electron (not Tauri). Build OKF+engine standalone app *first*, then resume paid-launch | Standalone Decoupled Product Direction | Desktop UI (AIBRAIN-63) **paused** 2026-08-30; MCP-only constraint still binding |
| 2026-08-17 | Desktop app login: email+password, mock validator | Desktop App Login and Subscription Validation | **Superseded** 2026-08-18 |
| 2026-08-18 | Desktop app login = **OAuth 2.0 Authorization Code + PKCE** (loopback); refresh token never leaves encrypted app storage; hand-off file carries short-lived access token only. Driver: "if this app is hacked I will lose subscription fee directly" | Desktop App Login and Subscription Validation | Binding for that surface |
| 2026-08-18 | Electron app is the **single auth surface**; **single MCP registration**; Obsidian path = thin companion screen (no graph/editor in Electron) | Standalone Decoupled Product Direction | Binding (if desktop app resumes) |
| 2026-08-18 | Entitlement gating (2-week offline grace; block `engine:search`/`engine:activate` and future bundled MCP when not entitled) designed, **not built** (AIBRAIN-129) — user: "just note it for now" | Desktop App Login and Subscription Validation | Open |
| 2026-08-21 | **`reinforce_link` deleted** (commit `bb3ca54`) — zero real invocations ever + two calls could force any note to rank #1 | MCP Tool Decision-Delegation Audit (Updates) | Binding |
| 2026-08-28 | Desktop render cap: top 500 notes by PageRank when >500 (AIBRAIN-131); 14s PageRank-per-load cost accepted as "good enough for now" | Desktop App Render Cap at Scale | Binding (desktop) |
| 2026-08-30 | `searchNotes` EMFILE/OOM fix (cap 500 hits, batches of 25); content scan concurrency 250 as stopgap; **persisted content index** scoped as AIBRAIN-133 | searchNotes Crash and Desktop App Loading UX Fixes | Content index since shipped 2026-09-02 per repo |
| 2026-08-30 | **Pause AIBRAIN-63** (desktop UI, High→Low); sequence AIBRAIN-134/135/136/137 (evidence-state taxonomy, Memory Trace panel in the Obsidian plugin, helpfulness feedback, citation-token experiment); AIBRAIN-62 rescoped as eventual model-API gateway, last | Usefulness Signal Roadmap | Binding, current plan-of-record |

## B. Currently-binding constraints & commitments

1. **MCP-only AI surface; cross-client portability.** "i want only mcp that can be consumed by different ai not a chat, or api key or whatever." Pitch: "your AI's long-term memory, decoupled from whichever AI you're renting this year." `packages/mcp-server` is "the **only** AI-facing surface." Validation against Codex/Gemini CLI (AIBRAIN-107) still untested.
2. **No Claude-Code-specific hooks as a signal mechanism.** The `Stop`-hook option for detecting referenced notes was "Rejected specifically because [portability] already commits this product to working the same way across Claude Code, Cursor, Codex, and Gemini — a hook-based signal would only ever exist for Claude Code users."
3. **Deterministic, server-owned logging, not LLM-judgment logging.** "Server-owned, outcome-triggered logging is what lets the brain keep growing correctly no matter which agent is driving." `reinforce_link` is gone; `create_note`/`update_note` deliberately stay LLM-mediated.
4. **Hard protocol constraint to design around:** "An MCP server structurally cannot see a client LLM's final generated answer text, on **any** client." Evidence states an MCP server can know: Retrieved / Read / Re-query. Cannot: Referenced / Helpful (without UI feedback or a gateway).
5. **Data stays in the vault, plain files.** `<vault>/.vault-neural-links/` (`link-weights.json` + append-only JSONL); "the durable value is the data … untouched by which AI is calling it."
6. **Two-tier weight semantics:** priming (transient, session) vs. persisted weight only on genuine traversal; `search_notes`/`get_weighted_neighbors`/`activate` never persist weight; no fabricated backfill.
7. **Nightly pipeline owned by the Obsidian plugin only** — "100% idempotency, exactly one run per day, triggered only by Obsidian." `runNightlyConsolidation` must never be called outside `runNightlyIfStale`'s gate. Desktop-only (`FileSystemAdapter`).
8. **One rendering codepath** (`packages/render-core`), consumed by plugin and desktop app.
9. **Monetization:** paid from launch; "No marketplace resellers (Gumroad, Lemon Squeezy ruled out)"; "Stripe, direct integration, user is the Merchant of Record (not Paddle)"; VAT/sales-tax is "the user's own legal/tax assessment (not this project, not Claude)". Licensing backend (AIBRAIN-73) is launch-blocking; dependency chain 78 → 73 → 74/75/76; 77 → 39.
10. **Telemetry:** "opt-in only, self-hosted endpoint"; PostHog/Plausible rejected; anonymous per-install token, offline-first queue, TLS-only, rate-limited (AIBRAIN-119). Obsidian review requires disclosure matching shipped code.
11. **Distribution:** npm for core+mcp-server (core bundled via tsup `noExternal`), official Obsidian store (not BRAT). Plugin currently has **zero auth/entitlement code** — anyone with `claude mcp add` gets full access today; gating is AIBRAIN-129, deferred.
12. **Desktop app paused** (AIBRAIN-63 Low, 2026-08-30): "A standalone UI doesn't move retrieval quality, and there's no evidence yet the core ranking claim is even true." If resumed: Electron, single auth surface (OAuth+PKCE), single MCP registration, Obsidian path = companion screen only.
13. **Memory Trace panel goes in the existing Obsidian plugin**, "deliberately not the paused desktop app," and "Explicitly does not attempt 'used'/'referenced' attribution."
14. **Citation-token experiment (AIBRAIN-137) has a kill criterion:** "If invocation rate comes back near-zero, the plan is to kill it and record that as a real (negative) finding, not iterate on it."
15. **Measure before adding mechanisms** (lit review): no new parameters for plausible-but-unmeasured gaps.
16. **Harness rules:** all vault `.md` through `mcp__vault-neural-link__*`; source through Serena; vault is default persistence target; Jira (AIBRAIN) is source of truth for task status, vault for durable knowledge.
17. **Repo/monorepo:** desktop-app stays in this monorepo; commits to `main`; live plugin redeploy is a manual copy step.

## C. Open questions still unresolved in the vault

- **Root cause of zeroUsage beating asIs (15/18 vs 9/18 rank-1):** "decay miscalibration, or accumulated weight from now-irrelevant old traversals never getting pruned?" (AIBRAIN-67 note, Usefulness Roadmap).
- Which side owns/runs the single MCP server registration on the Obsidian path; how the plugin picks up auth from the Electron session; how the app detects plugin connection; metrics panel content (Standalone note, 2026-08-18).
- Whether plain folder browsing should be gated with retrieval when unentitled (Desktop Login note).
- Whether the plugin's standalone license-key channel should move to OAuth too.
- AIBRAIN-60/61 "free-to-paid conversion" framing needs re-scoping now there is no free tier.
- Legal/tax: entity structure, ToS, privacy policy, VAT registration under Stripe-as-MoR.
- AIBRAIN-45: SessionStart hook still reads MOCs with raw file access.
- Vault has no `.git` folder despite hooks/docs describing git history (2026-07-15).
- 2 ablation queries returned zero neighbors from `MOCs/AML` / `MOCs/Medex` — "Not fully root-caused."
- OKF Phases C/D/E (emit OKF-syntax auto-links, Obsidian link-format setting, migrate existing wikilinks) not executed; whether Obsidian auto-updates relative-path links on rename unverified.
- `search_notes` returned empty for a confirmed-real note title in a normal-sized vault (2026-08-30) — "the symptom isn't scale-exclusive."
- Desktop app OKF-folder/graph click-through never verified live (only login flow was).
- Bundled MCP binary: one long-lived process vs. spawn per client; editor component (CodeMirror assumed).
- Old note: some `link-weights.json` edges used bare wikilink basenames instead of vault-relative paths (2026-07-09) — "still open/unfixed upstream" at the time; not revisited.
- `activate` tool documented as session-init in global CLAUDE.md but is a required-arg retrieval call (flagged 2026-08-23).

## D. Measured results

**AIBRAIN-31 ablation (2026-07-20, ~250-note vault, 18 queries, energy 10, target pre-touched):**
- 13/18 reachable at baseline. Disabling priming: several targets vanish; others drop "from rank 1 to rank 12–33."
- Disabling structuralFallback: target vanishes in 8 of 13; 9th reranked 3→4.
- Importance: "energy shifts of roughly 1–8%", never flipped rank.
- Consolidation: "floating-point noise level" — inert (vault too young for ≥3 distinct-day reactivations).
- Order: **structuralFallback > priming > importance > consolidation (currently inert)**. Harness polarity bug (`disabledLayers: true` left layers enabled) caught first.
- 2 queries unreachable from stale structural index; 2 zero-neighbor MOC origins; 1 genuinely out of 3-hop range.

**AIBRAIN-67 baselines (2026-08-23, 419 notes / ~397K tokens; 2026-08-28, 428 notes / 1,619,668 chars / ~404,917 tokens — "numerically identical"):**
- Engine: **16/18 found, 9/18 rank-1, mean rank 3.06**.
- structuralOnly (plain wikilink graph): 9/18 found / 1/18 rank-1 / mean 14.67.
- grep (naive full-text): 8/18 found / 2/18 rank-1 / mean 3.75.
- CAG/full-context out of scope at this size.
- Reinforcement benchmark: asIs 16/18 / 9/18 / 3.06; **zeroUsage 16/18 / 15/18 / 2.375**; simulatedReinforcement 18/18 / 18/18 / 1.0; simulatedReinforcementNoPriming 1/18 / 0/18.
- Finding: "The live vault's real accumulated historical usage weight … is currently making rank quality *worse* than a clean slate."
- 2026-08-23 verdict: fast-decay fix "holding stable across a 2-day gap"; "priming carries most of what looks like reinforcement's effect."

**Reinforcement calibration (2026-08-21):** two `reinforce_link` calls forced any note (including an irrelevant distractor) to rank #1 for all 18 queries; scaling by importance disproven (distractor's importance was higher than several legitimate targets').

**Weight-gap audit (2026-08-09):** only 9 usage edges in `link-weights.json`, all 2026-07-08..14; `events/` empty for ~4 weeks; of 9 co-queried pairs only 2 were structurally linked.

**Scale (300,003-note `sample-okf-large`):** load ~31s (17s indexing + 14s PageRank for the cap); render capped at 500; `searchNotes` sequential = hang; concurrency 50 → 203.8s; concurrency 250 → 129.5s ("5x concurrency → only ~1.6x faster"). EMFILE from ~8,000 concurrent `getWeightedNeighbors`.

**Other:** Louvain on real vault: 175 notes → 8 clusters (2026-07-16). `activate()` multi-hop finishes in ~20–80ms server-side. `MOCs/bunit2` had 20 structural-only neighbors at 0.1 floor → zero results until `structuralMinThreshold` 0.05. Test counts grew 47 → 168 core.

## E. Science grounding

**Case Study (AIBRAIN-28)** fidelity table: exponential decay ↔ Ebbinghaus — High; session priming ↔ Meyer & Schvaneveldt 1971 — Loose (flat bonus); consolidation ↔ McGaugh 2000 / Frey & Morris 1997 — High qualitatively ("stops decaying entirely" is a simplification); spreading activation ↔ Collins & Loftus 1975 — High, "the single most literal mapping"; PageRank importance ↔ Nelson et al. 2000 hub salience — Medium, tension with ACT-R fan effect (Anderson 1974); Louvain ↔ Bousfield 1953 — Medium, "proxy, not a model"; supersedes edges ↔ Johnson et al. 1993 source monitoring / continued-influence effect — Weak, "an engineering fix"; tiered fallback — None, "reliability engineering, stated as such"; ablation diff ↔ lesion-study logic (Scoville & Milner 1957) — High.

**Phase 7 Lit Review (AIBRAIN-30):** one real gap — priming "has no decay at all within a session" vs. ACT-R's seconds-scale decay (this is the gap the later 20-min half-life fix addresses). Ebbinghaus is better fit by a power law; single exponential is a known simplification. Fan-effect tension resolved: different retrieval targets (finding a concept vs. a fact about it). Candidate screening: emotional salience — Investigate (needs a proxy signal); context-dependent memory — Reject (priming already covers it); interference theory — Investigate as supporting citation for supersedes; chunking — Reject; dual-coding — Reject (viz footnote only). Net: no new tickets.

**Empirically:** consolidation "currently inert"; structural fallback (no science mapping) is the load-bearing mechanism; priming has the largest measured effect and was the one mechanism the review flagged as oversimplified.

## F. Contradictions / staleness vs. repo state

1. **`reinforce_link` references linger.** Auto-Logged Traversal note's table still lists `log_traversal / reinforce_link` as "always (explicit)"; Harness Hard Rules note instructs calling `activate` "at the start of vault work" (it is a required-arg retrieval call); the AIBRAIN-67 note itself flags the stale CLAUDE.md `reinforce_link` mention. Global CLAUDE.md is now correct; these vault bodies are not (append-only convention).
2. **Priming decay.** Case Study and Lit Review describe priming as a flat, undecayed bonus. The repo now has a 20-minute half-life; the vault only alludes to a "fast-decay fix" inside the AIBRAIN-67 note with no dedicated decision entry.
3. **Content index.** `searchNotes Crash…` and the MOC say AIBRAIN-133 is "To Do, not started" and search "stays slow (~2 min at 300k notes) until this is picked up." Repo shipped it 2026-09-02 (commit `1b6c11b`). The vault also says AIBRAIN-131/132 fixes are "not yet committed."
4. **Benchmark numbers.** Vault's latest is 16/18 found / 9/18 rank-1 with zeroUsage at 15/18 and grep at 8/18 found. Repo now claims engine **15/18 vs text search 13/18** after fixes. The vault has no record of the post-2026-08-28 runs, the fix that produced them, or why grep/text-search rose from 8/18 to 13/18 (likely the content index). The "9/18 vs 15/18" story that justified pausing the desktop app is therefore partially stale.
5. **Packaging.** Telemetry note says AIBRAIN-40/41/42/44/53 "all still To Do"; Installable Distribution note describes the workspace-symlink blocker as open. Repo: bundling, Changesets, release CI done (commit `6345cfe`), pending NPM_TOKEN.
6. **Desktop app status.** MOC consistent (paused 2026-08-30, AIBRAIN-63 Low). But the Standalone note's frontmatter is still `active` and calls itself "the living plan-of-record for the standalone direction" with "build the full OKF+engine standalone app *first*" — superseded by the Usefulness Roadmap but not annotated in that note.
7. **Nightly scheduling.** Project note body still describes the Scheduled Task and MCP-startup triggers; both removed (only the dedicated notes carry the supersession).
8. **Case Study "structuralFallback = engineering only".** Ablation showed it carries most retrieval; the case-study positioning ("which mechanism matters most") was never updated.
9. **Dangling-link false alarm.** Usefulness Roadmap says the Audit note "was not found" then corrects itself; both statements remain in the body.
10. **AIBRAIN-67 note lacks its own baseline entry** — body starts at 2026-08-23 "re-ran," referencing 2026-08-21 figures that are not recorded anywhere in the vault.

## G. Product-direction narrative

The project began (2026-07-08) as a personal memory layer for one user's Obsidian vault used from Claude Code: a Hebbian weight layer over wikilinks fed by a `PostToolUse`/`Read` hook and compacted by a Windows Scheduled Task. Within a day the hook was traded for an MCP server so the same memory worked from any project — an explicit "one interface, Serena-style" choice whose accepted cost (logging depends on the model remembering to call a tool) turned out to be the project's central lesson: four weeks later there were zero traversal events. That drove the 2026-08 pivot to deterministic, server-owned logging, then the audit that found `reinforce_link` had never been called and later that it was dangerous, then its deletion. In parallel the Obsidian plugin grew from a gated visualization stub into the real front door (graph, clusters, ablation and usage panels) and, on 2026-08-13, the sole owner of the nightly pipeline, removing the last Claude-Code dependency.

Mid-August the ambition expanded fast: npm/Obsidian-store distribution (07-26), a positioning claim that the "AI Brain" is portable across Claude/Codex/Gemini/local (08-16), a freemium → **paid-from-launch** pivot with Stripe-as-MoR and a 33-issue launch backlog (08-16), and then the founder overriding his own AIBRAIN-61 validation gate to build a standalone Electron app with OKF support, OAuth login, and a plan to ship the desktop app *before* resuming the paid track (08-17/18). Two weeks of desktop work followed (login, render-core, 300k-note scale fixes). On 2026-08-30 a marketing-article review forced the question of whether the core claim — "memory gets more accurate the longer it runs" — was true; the benchmark said accumulated weight was making ranking *worse* (9/18 vs 15/18). The founder paused the desktop UI and redirected to retrieval hardening and an honest usefulness signal (evidence-state taxonomy, Memory Trace in the Obsidian plugin, feedback calibration, a citation-token experiment expected to fail like `reinforce_link`).

What the founder has consistently said he wants: an MCP server "that can be consumed by different ai not a chat, or api key or whatever"; the graph/memory as plain files in his own vault; the Obsidian plugin as "tip of the iceberg" with a standalone client as a parallel surface, not a replacement; no dependence on a Claude Code session for anything to run; to be paid directly (no reseller brands between him and the customer) and to take security seriously because "if this app is hacked I will lose subscription fee directly"; and, most recently, proof over polish — measure whether the memory actually helps before building more UI around the claim.
