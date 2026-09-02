# Project status — 2026-09-02

**The backlog and roadmap now live in [`PLAN.md`](PLAN.md).** Jira project
AIBRAIN is retired; its frozen export is [`BACKLOG-ARCHIVE.md`](BACKLOG-ARCHIVE.md).
The full analysis behind today's re-plan is
[`analysis/2026-09-02-deep-analysis-report.md`](analysis/2026-09-02-deep-analysis-report.md).

## One-paragraph state

The retrieval engine is real, unit-tested (200 + 27 tests) and builds
cleanly, but it is **not yet safe to publish**: every path-taking MCP tool
escapes the vault with `../`, `update_note` destroys Obsidian block-list
frontmatter, and the activation WebSocket listens on all interfaces. The
"gets better with use" claim is **not demonstrated** — zeroing usage
weights leaves the benchmark unchanged, and the benchmark pre-seeds the
answer. The paid-from-launch plan was found infeasible and replaced by a
free launch with a 14-day validation gate, then Obsidian-plugin Pro via a
Merchant-of-Record platform if the gate passes.

## What happens next (see PLAN.md §3)

1. **Phase 0 — Safety and honesty** (~4 engineering days): VNL-001..009, 012.
2. **Phase 1 — Publish and validate**: needs the founder's `NPM_TOKEN`
   (AIBRAIN-42) and confirmation of decisions D1/D2 (PLAN.md §5).
3. **Phase 2 — Retrieval truth** runs in parallel: benchmark redesign
   (VNL-020), cold-start seeding (VNL-021), month-6 gate (VNL-022).

## Founder-only items

- Create npm Automation token → repo secret `NPM_TOKEN`.
- Confirm D1 (free launch first) and D2 (MoR platform, plugin-Pro pricing).
- Decide whether to archive or delete the Jira project (left untouched).
