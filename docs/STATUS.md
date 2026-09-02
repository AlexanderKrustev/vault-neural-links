# Project status — 2026-09-02

This file is a plain-language snapshot of what's done and what's pending.
Jira (project AIBRAIN) stays the actual backlog per this repo's CLAUDE.md —
this file exists so "what's going on" doesn't require reading 15 Jira
tickets and a vault note to answer.

**Direction, confirmed by you**: keep hardening retrieval quality before
shifting to installability/packaging.

## What happened today, in order

1. **Full project audit.** Result: the retrieval engine works and beats
   naive alternatives, but the product's central claim ("memory gets more
   accurate the longer it runs") wasn't actually true yet — real usage
   history was making retrieval *worse* than starting from zero.
2. **Fixed `search_notes`** (AIBRAIN-138, AIBRAIN-139) — it used to require
   an exact contiguous phrase match and rank purely by historical usage
   weight, so an exact title match could lose to an unrelated popular note.
   Both fixed, tested, shipped (`bc508f5`).
3. **Found something bigger while checking that fix**: a plain, fixed
   text-search — no smart weighting, no AI mechanism — was now
   outperforming the full engine (AIBRAIN-140).
4. **Root-caused and fixed the core issue** (AIBRAIN-130) — a note you'd
   just looked at could get permanently buried behind a generically
   popular note (something linked from everywhere), regardless of whether
   it was actually the answer to your question. Fixed, tested, shipped
   (`be88d9b`). Engine's rank-1 accuracy went from 9/18 to 15/18.
5. **Closed AIBRAIN-140** with the final numbers — the engine is back
   ahead of plain text search (15/18 vs 13/18) now that both bugs are fixed.
6. **Committed and pushed everything**, including desktop-app work
   (AIBRAIN-131/132) that was sitting uncommitted before this session.
7. **Fixed AIBRAIN-141** — the direct side effect of the AIBRAIN-130 fix:
   priming now reliably wins its comparisons, so a note you looked at
   early in a long session used to stay just as "primed" as one you
   looked at a second ago, permanently outranking more relevant notes
   until it fell out of a 20-note buffer. Now decays with time since the
   touch (20-minute half-life, reusing the same decay math the rest of
   the engine already uses). Fixed, tested, shipped (`ec709da`).

**Net effect: the tool is measurably more reliable right now than it was
this morning**, and every fix has a real before/after number behind it.

## Pending — in priority order

### 1. AIBRAIN-133 — search has no real index
`search_notes` still reads and checks every single note in the vault on
every query. Fine at ~470 notes (this vault), painfully slow at scale
(300k-note test fixture: ~2 minutes per search). Epic exists, not started.
**Next up.**

### 2. Widen the benchmark past 18 queries
The 18-query test set that's been driving all of today's numbers is small
and was written by one person (you) testing their own notes. Good enough
to catch real bugs (it did, three times, today) — not enough to make
confident claims beyond that. No ticket yet.

### 3. Stale docs
- `README.md` documents 9 of the 11 tools that actually exist.
- `docs/spec.md` still describes an old design ("no MCP, no server") that
  was abandoned early on.
- Your global `CLAUDE.md` still has a note about `log_traversal` that
  contradicts what the tool actually does now.
- Lower priority than 1–2 per your call to keep hardening retrieval first.

### Everything NOT touched, deliberately paused
- **AIBRAIN-63** (standalone desktop app) — paused since 2026-08-30,
  correctly so: no point polishing a UI on top of a retrieval engine that
  wasn't proven to work yet. Worth revisiting now that it's proven, but
  that's your call, not an automatic next step.
- **Billing/licensing epics** (AIBRAIN-73 through 79, ~50 tickets) — still
  premature. Nothing changed here today and nothing should until there's
  real usage to justify it.
- **AIBRAIN-137** (citation-token experiment) — still expected to fail the
  same way the old `reinforce_link` tool did (an agent has no real reason
  to call a second tool voluntarily). Not started, low priority.
- **Installability/packaging** (AIBRAIN-39 one-line install, and item 3
  above) — deliberately deferred until retrieval hardening (1–2) is
  further along, per your direction.
