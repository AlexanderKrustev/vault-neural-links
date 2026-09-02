# Project status — 2026-09-02

This file is a plain-language snapshot of what's done and what's pending.
Jira (project AIBRAIN) stays the actual backlog per this repo's CLAUDE.md —
this file exists so "what's going on" doesn't require reading 15 Jira
tickets and a vault note to answer.

**Direction, confirmed by you**: retrieval hardening (done), then
installability/packaging (in progress — see bottom of this file).

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
8. **Fixed AIBRAIN-133** — search read and checked every single note in
   the vault on every query, no matter how few could possibly match. Built
   a real index (rebuilt nightly, same convention as the other derived
   indexes) so search only reads notes that could actually match. Verified
   against the real 300k-note test fixture, not just unit tests: a
   selective search went from 336s to 2.1s. Honestly reported a smaller
   win too — a search on this test fixture's own heavily-repeated made-up
   vocabulary only dropped from 336s to 206s, since narrowing 300k notes
   down to still-29,000 candidates doesn't save much. Filed that as
   AIBRAIN-142 rather than hiding it. Fixed, tested, shipped (`1b6c11b`).

9. **Shipped installability/packaging** (AIBRAIN-40, 41, 44 done; 42 In
   Review) — the actual code/config work to make `npx -y
   @vault-neural-links/mcp-server` work, once published:
   - `LICENSE`, version bumped to 0.1.0, npm publish metadata.
   - Fixed a real bug found while doing this: `mcp-server` depended on
     `core` in a way that only worked inside this repo's own workspace —
     anyone installing `mcp-server` standalone would have gotten an error.
     Fixed by bundling `core` straight into `mcp-server`'s build. Verified
     for real: packed it, installed the package into a totally separate
     project, ran it — worked cleanly.
   - Set up automatic versioning/changelogs (Changesets) and a GitHub
     Actions workflow that builds, tests, and publishes on merge.
   - Rewrote README/INSTALL to lead with the one-line install, honestly
     labeled "not live yet" until the two steps below happen — the
     git-clone method that works today is kept right underneath it.
   - Closed an old duplicate ticket (AIBRAIN-53) asking for the same thing.

**Net effect: the tool is measurably more reliable right now than it was
this morning**, and every fix has a real before/after number behind it.
**The three-item retrieval-hardening plan (AIBRAIN-141 → 133) is done, and
the packaging code is ready — it just needs two things only you can do.**

## Two things only you can do to finish this

1. **Create an npm access token** and add it as this repo's `NPM_TOKEN`
   GitHub Actions secret (npmjs.com → Access Tokens → "Automation" type →
   GitHub → repo Settings → Secrets and variables → Actions). Without
   this, nothing can actually publish — I can't create this myself, it's
   tied to your identity.
2. **Submit the Obsidian plugin to the community store** — a separate
   manual process (their own review queue), not started.

## Pending — in priority order

### 1. Widen the benchmark past 18 queries
The 18-query test set that's been driving all of today's numbers is small
and was written by one person (you) testing their own notes. Good enough
to catch real bugs (it did, four times, today) — not enough to make
confident claims beyond that. No ticket yet.

### 2. AIBRAIN-142 — search index doesn't help enough on repetitive vocabulary
Real but low-priority: only shows up on the synthetic 300k-note test
fixture's own oddly-repetitive made-up words, not observed against this
real vault. Not urgent.

### 3. Remaining stale docs
- `docs/spec.md` still describes an old design ("no MCP, no server") that
  was abandoned early on.
- Your global `CLAUDE.md` still has a note about `log_traversal` that
  contradicts what the tool actually does now.
- (README's own staleness — missing tools in its table — is fixed now.)

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
