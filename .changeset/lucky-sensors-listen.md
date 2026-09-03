---
"@vault-neural-links/core": minor
---

`HumanNavigationTracker` — the decision half of the Obsidian plugin's
human-navigation sensor (VNL-052).

Turns raw `file-open` / `modify` callbacks into the small set of edges worth
keeping: consecutive opens inside a 10-minute window become a `traverse` at
weight 0.25 (`trigger: "human-open"`), editing the note you navigated to
becomes a `reinforce` at 0.5 (`trigger: "human-edit"`), both throttled per
edge. They go into the same event log the MCP server writes, so compaction,
decay and consolidation are unchanged. `computeUsageReport` now reports human
opens/edits on their own axis instead of folding them into the agent's
traverse/reinforce counts.
