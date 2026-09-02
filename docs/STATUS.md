# Project status — 2026-09-02

This file is a plain-language snapshot of what's done and what's pending.
Jira (project AIBRAIN) stays the actual backlog per this repo's CLAUDE.md —
this file exists so "what's going on" doesn't require reading 15 Jira
tickets and a vault note to answer.

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
   outperforming the full engine (AIBRAIN-140). That sharpened the original
   question from "is the usage tier miscalibrated" to "does the whole
   reinforcement mechanism earn its complexity."
4. **Root-caused and fixed the core issue** (AIBRAIN-130) — a note you'd
   just looked at could get permanently buried behind a generically
   popular note (something linked from everywhere), regardless of whether
   it was actually the answer to your question. Fixed, tested, shipped
   (`be88d9b`).
5. **Re-ran the benchmark after the fix**: the engine's rank-1 accuracy
   went from 9/18 to 15/18 — it now clearly beats every simpler
   alternative again, and for a reason we can explain instead of one we
   have to trust.

**Net effect: the tool is measurably more reliable right now than it was
this morning**, and there's a real number to point at.

## Uncommitted work sitting in your working tree — not mine, not touched

These were already modified before this session started and are still
just sitting there, uncommitted:

- `packages/desktop-app/renderer/index.html`
- `packages/desktop-app/src/main.ts`
- `packages/desktop-app/src/renderer.ts`
- `packages/desktop-app/scripts/repro-search.mjs` (new, untracked)

These look like your own AIBRAIN-131/132 work (desktop app crash fixes at
300k-note scale). **Action needed from you**: either commit them, or tell
me to look at them — right now they exist only on this machine and aren't
part of any of the fixes above.

## Pending — in priority order

### 1. Update AIBRAIN-140 with today's final numbers
It was filed this morning saying "grep beats the engine" (13/18 vs 9/18).
That's now stale — after the AIBRAIN-130 fix, the engine is back ahead
(15/18 vs 13/18). Needs a comment so the ticket isn't misleading. **Small,
five minutes.**

### 2. AIBRAIN-141 — priming has no memory of *when* something was touched
Direct side effect of today's fix: priming now reliably wins its
comparisons (that's the fix), which means a note you looked at early in a
long session stays "primed" just as strongly as one you looked at a
second ago, until it falls out of a 20-note buffer. Filed, not started.
**Real design work, not a quick patch.**

### 3. AIBRAIN-133 — search has no real index
`search_notes` still reads and checks every single note in the vault on
every query. Fine at ~470 notes (this vault), painfully slow at scale
(300k-note test fixture: ~2 minutes per search). Epic exists, not started.

### 4. Widen the benchmark past 18 queries
The 18-query test set that's been driving all of today's numbers is small
and was written by one person (you) testing their own notes. Good enough
to catch real bugs (it did, twice, today) — not enough to make confident
claims beyond that. No ticket yet.

### 5. Stale docs
- `README.md` documents 9 of the 11 tools that actually exist.
- `docs/spec.md` still describes an old design ("no MCP, no server") that
  was abandoned early on.
- Your global `CLAUDE.md` still has a note about `log_traversal` that
  contradicts what the tool actually does now.

### 6. Everything NOT touched, deliberately paused
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

## One open question for you

Given the engine now measurably works, is the priority still "keep making
retrieval more correct" (items 1–4 above), or do you want to shift toward
"make it installable/usable by someone who isn't you" (item 5, plus the
one-line install work in AIBRAIN-39)? Both are legitimate next moves — I
don't want to guess which one you actually want without asking.
