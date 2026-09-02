# Feasibility memo: Vault Neural Link (VNL)

**Date:** 2026-09-02  **Stance:** skeptical seed-stage investor / product strategist  **Subject:** solo-founder side project, ~2 months old, 0 users, paid-from-launch plan

**TL;DR.** As a *product*, VNL is a credible, well-engineered entrant in a crowded but fast-moving niche (local-first, markdown-native agent memory). As a *business* on the current plan it is not feasible: the plan front-loads ~50 tickets of billing/legal/ops for a 3–4 EUR/month product whose only claimed technical differentiator (Hebbian usage weights) the founder's own ablation shows adds nothing today. The realistic 12-month ARR under the current plan is in the low thousands of euros at best. Recommendation: **do not build a licensing backend; do not charge at launch.** Ship free, measure, then gate the Obsidian-plugin experience behind a Merchant-of-Record checkout (Option B, sequenced after a free validation window). Details and numbers below.

---

## 1. Market and competitive landscape

### 1a. General agent-memory layers (the funded competition)

| Product | Open source | MCP | Pricing | Funding | Notes |
|---|---|---|---|---|---|
| **Mem0** | Yes (Apache; 41k stars, 14M downloads) | Yes (OpenMemory MCP) | Free 10k memories; $19/mo Starter; $249/mo Pro | $24M (seed + Series A, Oct 2025, Basis Set/Peak XV/YC) | AWS picked it as exclusive memory provider for its Agent SDK. [TechCrunch](https://techcrunch.com/2025/10/28/mem0-raises-24m-from-yc-peak-xv-and-basis-set-to-build-the-memory-layer-for-ai-apps/), [pricing review](https://theaiagentindex.com/agents/mem0) |
| **Zep / Graphiti** | Graphiti OSS (24k stars) | Yes | Free tier; Flex ~$25/mo | Reported ~$500K seed (YC) — figure likely understated; treat as estimate | Temporal knowledge graph. [vectorize.io](https://vectorize.io/articles/mem0-vs-zep), [Startup Intros](https://startupintros.com/orgs/zep-ai) |
| **Letta (MemGPT)** | Yes | Yes | Free; Pro $20/mo | $10M seed (Felicis, Sept 2024) | Full agent runtime, not just memory. [BigDATAwire](https://www.hpcwire.com/bigdatawire/this-just-in/letta-emerges-from-stealth-with-10m-to-build-ai-agents-with-advanced-memory/) |
| **Cognee** | Apache-2.0 (29.7k stars) | Yes (14 tools) | Self-host free; cloud from $5/workspace/mo | €7.5M seed (Feb 2026, Redalpine) | Berlin. [hyperight](https://hyperight.com/cognee-seed-funding-ai-memory-technology/), [cognee-mcp](https://github.com/topoteretes/cognee/tree/main/cognee-mcp) |
| **Supermemory** | Partly | Yes | Hosted API | $3M pre-seed (Oct 2025, Susa) | [supermemory.ai](https://supermemory.ai/blog/supermemory-raises-3-million-and-building-the-best-memory-engine-for-llms) |
| **Honcho (Plastic Labs)** | Yes | Partial | API | $5.35M pre-seed | User-modelling focus. [Dealroom](https://app.dealroom.co/news/feed/plastic-labs-raises-5-35m-launches-honcho) |
| **LangMem** | Yes (LangChain) | No | Free | (LangChain) | Framework-bound. |

**Platform-native memory (the free competition):**
- **Claude Code auto-memory** is on by default since v2.1.59 (Feb 2026): a `MEMORY.md` index + topic files, per-project, 200-line/25KB cap, no semantic search, does not follow you to Cursor/Codex. [Claude Code docs](https://code.claude.com/docs/en/memory), [guide](https://www.claudedirectory.org/blog/claude-code-auto-memory-guide)
- **Anthropic memory tool** (`memory_20250818`) is in public beta on the Developer Platform, Bedrock and Vertex: file-based cross-conversation memory for API builders. [Anthropic](https://www.anthropic.com/news/context-management), [docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- Codex, Cursor, Windsurf each have their own memories; a cottage industry of cross-tool syncers already exists (memoir, memorix, memories.sh, MemoryPlugin). [memoir](https://github.com/camgitt/memoir), [memorix](https://github.com/AVIDS2/memorix), [memories.sh](https://memories.sh/)

**Takeaway:** ~$50M+ of venture money is chasing "memory for agents" as hosted infrastructure, and the agent vendors themselves now ship "good enough" free memory. VNL cannot and should not compete on the hosted-API axis (this kills Option D below). Its only defensible lane is *"your memory is your markdown vault, on your disk, and you own it"* — and even that lane is contested.

### 1b. Direct lane: markdown/Obsidian-native memory via MCP

- **Basic Memory (basicmachines)** — AGPL, 3.8k stars, 1.9k commits; local free forever, cloud $15/mo beta (regular $19). Markdown notes + knowledge graph + semantic search, "works with Obsidian," positioned exactly as "AI conversations that actually remember." [GitHub](https://github.com/basicmachines-co/basic-memory), [review Aug 2026](https://www.sylvainleroy.com/2026/08/basic-memory-persistent-ai-memory-obsidian/)
- **Vestige** — the closest mechanism analogue: Rust MCP server with FSRS-6 decay, *spreading activation*, synaptic tagging, prediction-error gating, a live memory dashboard, ~96k LOC / 1,961 tests, 615 stars, AGPL, **Vestige Pro $19/mo** for encrypted cross-device continuity. [GitHub](https://github.com/samvallad33/vestige)
- **Cuba-Memorys** — Rust + Postgres MCP server with Hebbian learning (Oja's rule), FSRS decay, GraphRAG, auto-consolidation after 15 min idle. [dev.to](https://dev.to/lenadro1910/i-built-a-persistent-memory-mcp-with-hebbian-learning-and-graphrag-1b5p)
- **Memento MCP, mcp-memory-service (doobidoo), Anthropic's reference knowledge-graph memory server, Obsidian-Memory MCP (Markdown + wikilinks)** — a long tail with confidence decay ("default half-life 30 days" appears verbatim in one). [awesome list](https://github.com/TensorBlock/awesome-mcp-servers/blob/main/docs/knowledge-management--memory.md), [PulseMCP](https://www.pulsemcp.com/servers/yunaga224-obsidian-memory)
- An **OKF-backed memory MCP server** already exists (fellowgeek/mcp-memory). [GitHub](https://github.com/fellowgeek/mcp-memory)

**Obsidian-side AI plugins (paid models exist and work):**
- **Copilot for Obsidian** — 1.79M downloads, 7.7k stars. Free (BYOK) / Lite $74.99/yr / Plus $139.99/yr / Supporter $349.99 one-time (lifetime self-host + 2 yrs Plus). v4 agent preview shipped Aug 2026. [pricing](https://www.obsidiancopilot.com/en/pricing), [obsidianstats](https://www.obsidianstats.com/plugins/copilot)
- **Smart Connections** — 1.18M downloads, 5.4k stars. Free core + Pro All-Access **$30/mo or $299/yr**, plus a one-time "Founding Supporter" lifetime tier capped at 1,000 spots, **823 filled** as of today. [pricing](https://smartconnections.app/pro-plugins/), [obsidianstats](https://www.obsidianstats.com/plugins/smart-connections)
- **Khoj** — 35k stars, AGPL, self-host free, cloud $8/mo. [needaitool](https://www.needaitool.com/tools/khoj-ai)
- **Obsidian MCP plugins** — at least five in the store; the original *MCP Tools* reached **87k installs** before its author stepped back; *Local REST API* (2.6k stars) added a built-in MCP server in v4.0 (May 2026); *Claude Code IDE* plugin makes Obsidian show up in Claude Code's `/ide` selector. [obsidianstats](https://www.obsidianstats.com/plugins/mcp-tools-istefox), [Q2 2026 update](https://mostlycopyandpaste.com/articles/2026/05/obsidian-claude-code-q2-2026-update/)
- **Obsidian itself**: no first-party AI, no official MCP (an open feature request exists); stated posture is "enable the ecosystem." May 12 2026 blog: plugin store gets automated security review + Free / Optional payments / Paid labels, still **no in-store payments**. [Obsidian blog](https://obsidian.md/blog/future-of-plugins/), [developer policies](https://docs.obsidian.md/Developer+policies)

### 1c. Is anyone doing the same mechanism?

Yes, and academically it is now mainstream:
- **SYNAPSE** (arXiv 2601.02744, Jan 2026; ACL Findings 2026): spreading activation + lateral inhibition + temporal decay over a memory graph, SOTA on LoCoMo multi-hop/temporal. Code "upon acceptance." [arXiv](https://arxiv.org/abs/2601.02744)
- **ACT-R-inspired memory for LLM agents** (HAI 2026): base-level activation, decay, noise. [ACM](https://dl.acm.org/doi/10.1145/3765766.3765803)
- **Validation-gated Hebbian learning (Kairos)** on OpenReview; **Memory Bear** (ACT-R BLA + Ebbinghaus). [OpenReview](https://openreview.net/forum?id=EN9VRTnZbK)
- Practitioner side: Vestige and Cuba-Memorys above.

So the *idea* is not novel and the *implementation* is being done in Rust with 10x the LOC by at least one solo competitor. What nobody I found does is **run the mechanism over an existing human-authored wikilink graph** (rather than over agent-written memories) and **render it back into Obsidian's own graph UI**. That is VNL's actual distinctive position — not "Hebbian."

### 1d. Google's Open Knowledge Format (OKF)

Announced June 12 2026 by Google Cloud; markdown files + YAML frontmatter, one required field (`type`), interlinked with plain markdown links; v0.2 shipped July 25 2026 adding provenance/attestation. Positioned against Notion/Confluence lock-in, explicitly *not* an SEO signal. As of Aug 2026 "no major AI agents read OKF bundles natively." [MarkTechPost](https://www.marktechpost.com/2026/06/16/google-cloud-introduces-open-knowledge-format-okf-a-vendor-neutral-markdown-spec-for-giving-ai-agents-curated-context/), [startuphub](https://www.startuphub.ai/ai-news/insights/2026/google-open-knowledge-format-okf-explained-2026), [okf.md FAQ](https://okf.md/faq/)

**Does supporting it matter?** Cheaply, yes — it costs ~nothing since OKF is a subset of what an Obsidian vault already is, and it is a free "Google-aligned" checkbox for a landing page. It is not a demand driver in 2026; keep it as a one-line feature, not a positioning pillar.

### 1e. MCP distribution surface

Official MCP registry: **18,849 servers (18,650 active) as of July 2026**; PulseMCP lists ~15.9k; ~9.4k distinct servers across canonical registries by April 2026. [MCP Queen](https://mcpqueen.com/reports/state-of-mcp-2026-07), [Digital Applied](https://www.digitalapplied.com/blog/mcp-ecosystem-h1-2026-retrospective-adoption-data-points). Claude Code alone ~4.2M weekly active developers (Q1 2026); Codex 3M WAU (April 2026). [Claude stats](https://www.getpanto.ai/blog/claude-ai-statistics), [Codex](https://uvik.net/blog/claude-code-vs-cursor-vs-copilot-vs-codex-2026/). Only 31% of surveyed developers use agents at all. [The New Stack](https://thenewstack.io/23-of-devs-regularly-use-ai-agents-per-stack-overflow-survey/)

Pricing reality check: of ~318 MCP servers in the Claude Code marketplace, the vast majority are $0; the paid few charge $19–149/mo and are B2B; **"there's almost nothing in the $5–15/mo casual paid tier."** [dev.to](https://dev.to/whoffagents/pricing-an-mcp-server-in-2026-why-we-charge-19mo-when-the-market-average-is-0-nig) A 3–4 EUR/month MCP server would be pricing into a band that empirically does not exist — either because nobody has tried it or because it doesn't work. Both readings argue for testing before building infrastructure.

---

## 2. Willingness to pay

### 2a. How Obsidian plugin devs actually monetize

- The store has no payments; devs use external license keys / login gates and must label the plugin Free / Optional payments / Paid. [policies](https://docs.obsidian.md/Developer+policies)
- Working models observed: **BYOK free + hosted-model subscription** (Copilot $75–140/yr), **free core + Pro plugin bundle at a high price point** (Smart Connections $299/yr) with a **capped lifetime "founding supporter" tier** (823/1000 sold), **one-time offline Ed25519-signed license via Gumroad, zero servers** (Highlight Inbox Synthesizer, June 2026), **paid external service** (Readwise). [Indie Hackers](https://www.indiehackers.com/post/i-shipped-a-paid-obsidian-plugin-with-no-server-no-subscription-and-offline-licensing-0a87e1f23c)
- **Nobody successful sells an Obsidian plugin at 3–4/month.** The two AI plugins that monetize charge $6–30/month and bundle *hosted compute* (models, credits) or a large Pro bundle. Price anchors in this niche are 3–8x VNL's.

### 2b. Audience size and conversion

- Obsidian ~**1.5M MAU**, ~2,700 community plugins (April 2026). [fueler.io](https://fueler.io/blog/obsidian-usage-revenue-valuation-growth-statistics)
- Dev-tool freemium conversion: **1–3%** typical; Cursor's 36% is the famous outlier. [Artisan](https://www.artisangrowthstrategies.com/blog/freemium-conversion-rate-benchmarks), [Monetizely](https://www.getmonetizely.com/articles/whats-the-right-ratio-of-free-to-paid-users-in-developer-saas)
- Empirical Obsidian anchor: Smart Connections has ~1.18M cumulative downloads and has sold 823 lifetime tiers (plus an unknown number of $299/yr subs). Even generously assuming 2,000 total payers, that is **~0.17% of downloads**. Downloads overstate users 3–10x, so paid ≈ 0.5–1.5% of *active* users — consistent with the 1–3% benchmark at a much lower conversion because the free tier is genuinely good.

### 2c. Unit economics at 3.5 EUR/month

MoR fees are 5% + $0.50 per transaction at every MoR (Paddle, Lemon Squeezy, Polar Starter). [buildmvpfast](https://www.buildmvpfast.com/blog/lemon-squeezy-vs-polar-paddle-merchant-of-record-2026), [Dodo review of Polar](https://dodopayments.com/blogs/polar-sh-review)

- Monthly at 3.50 EUR: fee ≈ 0.175 + 0.46 = **0.63 EUR → 18% take**. Net ≈ 2.87 EUR/mo ≈ 34.4 EUR/yr.
- Annual at 36 EUR: fee ≈ 1.80 + 0.46 = **2.26 EUR → 6.3% take**. Net ≈ 33.7 EUR/yr.
- Stripe direct (current plan): ~1.5% + 0.25 EUR EU cards → ~0.30 EUR/mo (8.6%), but you carry VAT, disputes, dunning, invoices, and the backend. The MoR premium is ~0.33 EUR/user/month. At 100 payers that is **~400 EUR/year** saved by self-building — versus ~50 tickets of work. Self-building only pays off past roughly 2,000–3,000 subscribers (estimate).

**Conclusion:** if you charge at all, charge **annual or one-time**; the 50-cent fixed fee makes a 3.5 EUR monthly plan structurally bad.

### 2d. ARR bands (estimates; every input is a guess, shown so you can replace it)

Funnel: cumulative plugin downloads → active users (20%) → payers (conversion) → × 36 EUR/yr gross.

| Scenario | 6 mo downloads / payers | 12 mo downloads / payers | 24 mo downloads / payers | ARR @6/12/24 mo |
|---|---|---|---|---|
| **Conservative** (niche MCP plugin trajectory, ~1% conv.) | 3,000 → 600 active → 6 | 10,000 → 2,000 → 20 | 30,000 → 6,000 → 60 | **~220 / ~720 / ~2,200 EUR** |
| **Base** (MCP Tools-like: 87k installs in ~18 mo; 2% conv.) | 10,000 → 2,000 → 40 | 40,000 → 8,000 → 160 | 100,000 → 20,000 → 400 | **~1,400 / ~5,800 / ~14,400 EUR** |
| **Optimistic** (Smart-Connections-class growth, 3% conv., 60 EUR/yr blended incl. lifetime tier) | 25,000 → 5,000 → 150 | 120,000 → 24,000 → 720 | 400,000 → 80,000 → 2,400 | **~9,000 / ~43,000 / ~144,000 EUR** |

Sanity check on optimistic: Smart Connections took ~3 years, one of the best-known plugins in the ecosystem, to reach ~1.2M downloads; VNL at month 24 reaching a third of that is a top-decile outcome. **Base case: ~6k EUR ARR at 12 months, ~14k at 24.** Before MoR fees and before the founder's time. As a side income this is fine; as a "business" it does not clear a solo founder's opportunity cost (~1 day/week of a senior engineer ≈ 15–25k EUR/yr in Bulgaria, far more elsewhere).

---

## 3. Moat and defensibility

**What is not a moat**
- **The Hebbian layer.** The founder's own 18-query benchmark: full engine 15/18 rank-1; plain relevance search 13/18; engine with usage weights zeroed **also 15/18**. The named differentiator contributes zero measurable lift today. Two possible explanations: (a) the vault/traffic is too small for weights to become informative (cold-start — see §4), or (b) the wikilink structure + priming already captures what usage would add. Either way the pitch "Hebbian" is currently unsupported by the pitcher's own data, and a skeptical HN reader will ask for exactly this ablation.
- **The code.** ~3.5k LOC of MIT TypeScript; Vestige has the same mechanism family in 96k LOC Rust with 1,961 tests. Anthropic could add link-weight decay to auto-memory in a sprint.
- **Data lock-in.** Explicitly disclaimed (weights live in `.vault-neural-links/` inside the user's vault; good ethics, zero moat).

**Where defensibility could exist (thin, but real)**
1. **Human-authored graph as the substrate.** Every funded competitor builds a graph the *agent* writes. VNL weights the graph the *human* already spent years building. That is a differentiated data source and a story ("your vault is already the brain; we just add plasticity") that Basic Memory/Vestige don't tell.
2. **The in-Obsidian visualization.** Smart Connections' "Smart Graph" and Copilot's UI are what people pay for; the *neural graph with activation pulses* is the only VNL surface that is emotionally compelling and not trivially replicable by an MCP-only competitor. It is also the only piece a plain CLI-agent user cannot get elsewhere.
3. **Cross-client portability** is a real user pain (Claude Code auto-memory is single-project, single-tool) — but it is a property of *any* MCP memory server, so it differentiates VNL from Anthropic, not from Basic Memory/Vestige/memoir.
4. **Session priming** (20-min half-life) is what actually carried the benchmark gain. Nobody in the Obsidian space markets "what you were just working on ranks first." Lead with it.

Net: defensibility is UX + distribution + speed, not algorithm. That is normal for indie tools; it just means the business case has to rest on audience, not IP.

---

## 4. Product-market-fit risks

**ICP intersection (estimates):**
- Obsidian MAU ≈ 1.5M.
- Share who use an MCP-capable coding/CLI agent daily: developer-heavy audience, but SO 2026 says only 31% of *developers* use agents at all. Assume 25–35% of Obsidian users are developers and 30% of those use agents daily → **~110–160k** people.
- Share of those whose *agent* reads their *vault* regularly (not just their repo): MCP Tools' 87k lifetime installs is the best proxy; realistically **20–40k** active vault-connected agent users today.
- Share with traffic high enough that usage weights become informative: with a 30-day half-life, an edge needs multiple traversals per month to stay above noise; the founder's own 470-note vault after 2 months didn't get there. **Perhaps 10–25%** of the above → **~3–8k people worldwide** for whom the *Hebbian* layer could matter in 2026. That is a hobby-sized market for the headline feature — but the *broader* product (priming + structure-aware retrieval + graph UI) addresses the full 20–40k.

**Who is the ICP?** Not the "second brain" enthusiast (mostly non-technical; doesn't run Claude Code). Not the pure developer (memory should live next to the repo; Claude Code auto-memory is fine). It is the **developer-who-journals**: someone using Obsidian as a decision log / project notebook *and* driving Claude Code/Codex daily — i.e., the founder. Fine as a wedge, small as a market.

**Zero-cost 2-week validation experiment**
1. Week 1: publish the MCP server to npm under MIT with a 90-second GIF of the activation-pulse graph; post to r/ObsidianMD, r/ClaudeAI, and the Obsidian forum "Share & showcase"; submit to the official MCP registry and PulseMCP. Add an opt-in, anonymous "ping" (count-only, no content) *or* a "star the repo / join Discord" call-to-action — telemetry in the plugin itself is prohibited by Obsidian policy, so use the MCP server or a landing page.
2. Week 2: landing page with **two fake-door CTAs**: "Get Pro (graph visualization + nightly consolidation) — 29 EUR/yr" and "Founding Supporter lifetime — 79 EUR." Collect email + intended tier via Polar/Lemon Squeezy *pre-order* pages (both are free to set up). Show HN with the ablation table included honestly.
3. Success thresholds: ≥300 npm installs, ≥100 GitHub stars, ≥25 pre-order emails, and ≥3 unsolicited messages describing the pain in their words. Failure on all four → Option E.

---

## 5. Founder / execution risk

- **Solo, side project, 2 months, zero external users, 227 tests.** The engineering velocity is good. The plan's problem is sequencing: ~50 tickets of Stripe/entitlements/dunning/portal/VAT/ToS before the first euro, for a product whose demand is unproven and whose price point (3–4 EUR) cannot justify that infrastructure.
- **VAT in plain terms (Bulgaria, B2C digital services, EU-wide):**
  - Digital services to EU consumers are taxed **where the customer lives**. Normally, once cross-border B2C sales exceed **€10,000/year**, you must charge each country's VAT rate (17–27%) and file quarterly via the **OSS** one-stop shop; below €10k you may charge home-country VAT. [amavat](https://amavat.eu/vat-oss-threshold-explained-what-happens-after-e10000/), [vatcalc](https://www.vatcalc.com/eu/eu-vat-on-b2c-digital-services-after-1-july-2021-moss-oss/)
  - Bulgaria adopted the euro on 1 Jan 2026; domestic VAT registration threshold is **€51,130**. Crucially, Bulgaria implemented the **EU SME scheme**: a business under €51,130 domestic and **€100,000 EU-wide** turnover can sell VAT-free across the EU with no OSS and no foreign registration (a prior notification to the Bulgarian NRA to obtain an "EX" number is required under the EU scheme — verify with an accountant; the sources I found don't detail the procedure). [Eurofast](https://eurofast.eu/bulgaria-vat-reform-2026-what-businesses-need-to-know/), [vatcalc](https://www.vatcalc.com/bulgaria/bulgaria-monitors-vat-on-jan-2026-euro-adoption/)
  - **Implication:** at the ARR bands above, the founder is under every threshold for years. VAT is *not* the reason to avoid self-billing. The reasons are: (i) non-EU customers (UK, US states, Australia, India, etc.) each have their own digital-services tax rules and MoRs handle all of them; (ii) consumer-law refund/dispute handling, invoice formatting, dunning, and card-network chargebacks; (iii) the ~50 tickets. MoR platforms exist precisely so a solo founder doesn't do this, at a ~5% + 0.50 premium.
  - Also: as an individual, the founder needs some legal form to invoice at all (ET/EOOD or freelancer registration) — that is a fixed cost regardless of MoR and should be in the plan.
- **Time-to-first-euro:** current plan — realistically 3–5 months of evenings for billing/legal/ops *plus* npm/store launch. Alternative (Polar/Lemon Squeezy + license-key validation endpoint + Gumroad-style offline signed key as fallback) — **one weekend**; the plugin verifies a key against the MoR's validate endpoint (Lemon Squeezy License API, Polar license-key benefit) or offline via Ed25519. [Lemon Squeezy License API](https://docs.lemonsqueezy.com/guides/tutorials/license-keys), [Polar benefits](https://polar.sh/features/benefits)
- **Burnout risk:** the ratio of non-product to product work in the current backlog is the classic way side projects die. Every ticket that isn't retrieval quality or the graph UI is a ticket a funded competitor doesn't have to write.

---

## 6. Strategic options

**A. Execute current paid-from-launch plan.** Time-to-revenue 3–5 months; first-year ARR base case ~6k EUR minus fees; carries VAT/consumer-law surface area; kills launch virality (paid MCP servers at $3.5 don't get adopted — the $5–15 tier is empty for a reason); pricing tier is 3–8x below every comparable. **Reject.**

**B. Free OSS MCP server + paid Obsidian plugin "Pro" via MoR, license keys, no own backend.** Aligns with what actually works in the store (Smart Connections, Copilot). Pro = graph visualization with activation pulses, nightly maintenance/consolidation dashboard, ablation/"why did this rank" explainer, multi-vault. Price like the neighbours: **29–49 EUR/yr** or **79–99 EUR lifetime founding tier (capped)**, not 3.5/mo. Time-to-first-euro: days. Downside: gating the visualization slows adoption of the thing that makes the product memorable; mitigate with a generous free graph and Pro-only *animations/history/maintenance*. **Strong candidate — but only after C's validation window.**

**C. Fully free/OSS, build audience, monetize later.** Maximizes adoption and honest feedback; costs nothing; matches how Basic Memory/Vestige/Khoj all started. Risk: "later" never comes and the founder has a well-liked free tool and no revenue. **Correct first phase, wrong end state.**

**D. Hosted memory API (compete with mem0/Zep/Cognee).** They have $24M/$8M/$7.5M, AWS distribution, and benchmarks; the local-first vault story is VNL's *only* differentiator and hosting throws it away. **Reject.**

**E. Shelve commercial ambitions; portfolio/OSS.** Legitimate fallback if the 2-week experiment fails all four thresholds. Not the default.

**F. Recommended: sequenced C → B, with a repositioning.**
1. **Reposition now.** Drop "Hebbian" from the headline until the ablation shows lift. Lead with what the benchmark supports and what is visibly unique: *"Your Obsidian vault is already a brain. VNL gives your coding agent working memory over it — session priming, link-structure-aware retrieval, and a live neural graph — and it travels with you from Claude Code to Codex to Gemini."* Keep the plasticity layer as the roadmap/science story, and instrument it so weights *can* become informative (see below).
2. **Weeks 1–2:** run the zero-cost validation in §4. Publish MCP server (MIT) + plugin (free) to npm and the store. Set up Polar or Lemon Squeezy pre-order pages for Pro annual and Founding lifetime. Ship OKF read support as a one-liner.
3. **Weeks 3–10:** if thresholds pass, ship Pro behind MoR license keys. Delete the ~40 billing/legal/ops tickets; keep ToS/Privacy (templated) and the legal-entity ticket.
4. **Fix the cold-start** so the differentiator can eventually earn its name: seed usage weights from existing signals (Obsidian file-open history, git log of the vault, backlink counts), shorten the initial half-life, and re-run the 18-query ablation monthly on your own vault and on 3–5 volunteer vaults. If usage weights still add nothing at month 6, drop the layer and simplify — that is a product win, not a loss.
5. **Later (12+ months, only with >300 payers):** consider team/shared-vault features or a small hosted sync — that is the moment Phase 4 becomes a question, not before.

---

## 7. Verdict

**Feasibility as a product: 7/10.** Real problem, working code, tests, a visual hook competitors lack, and a data substrate (human wikilink graph) no funded player uses. Docked for the unproven headline mechanism and for a crowded lane (Basic Memory, Vestige, five Obsidian MCP plugins).

**Feasibility as a business (current plan): 2/10.** Wrong price, wrong billing sequencing, empty price band, no evidence of demand, solo capacity consumed by non-product work.

**Feasibility as a business (Option F): 5/10.** A plausible 5–15k EUR/yr side income within 24 months, with a small chance of a Smart-Connections-class outcome (100k+ EUR/yr) if the graph UI becomes the way Obsidian users *see* what their agent is doing.

**Three assumptions to test first**
1. *Anyone other than the founder wants an agent reading their vault with priority ranking* — measured by installs, stars, and unsolicited pain descriptions in 2 weeks.
2. *The graph visualization is worth money* — fake-door pre-orders at 29–49 EUR/yr and 79–99 EUR lifetime; target ≥25 emails.
3. *Usage weights ever become informative on a real vault* — the monthly ablation on ≥3 external vaults; target any statistically visible lift over zeroed weights by month 6.

**Three biggest red flags**
1. The founder's own benchmark refutes the headline differentiator (15/18 vs 15/18).
2. ~50 tickets of billing/legal/ops precede the first euro for a 3.5 EUR/mo product — the classic solo-founder failure mode.
3. Platform vendors ship free memory (Claude Code auto-memory default since Feb 2026; Anthropic memory tool in beta) and a Rust competitor with the same cognitive-science mechanism already sells Pro at $19/mo.

**What would change my mind (upward)**
- The ablation flips: usage weights produce a measurable lift on external vaults (then "Hebbian" is a real, marketable claim).
- 1,000+ installs and 100+ stars in the first month with organic "this is how I want my agent to think about my notes" feedback.
- Obsidian ships an official MCP core plugin — that would expand the 20–40k addressable base by an order of magnitude and make a memory layer on top of it the obvious upsell.
- Evidence that agent traffic on personal vaults is growing fast (e.g., Copilot for Obsidian's agent mode or Claude Code IDE plugin adoption numbers), which would fix the cold-start problem for everyone.

**What would change my mind (downward):** the 2-week experiment fails all four thresholds, or Anthropic adds decay-weighted link ranking to auto-memory before VNL ships.

---

*Sources are linked inline. All conversion rates, funnel percentages and ARR figures are estimates constructed from the cited anchors (Smart Connections and Copilot download/pricing data, MCP Tools install count, Obsidian MAU, published freemium benchmarks) and should be replaced with measured data after the validation window.*
