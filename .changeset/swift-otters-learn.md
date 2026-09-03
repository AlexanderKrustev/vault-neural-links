---
"@vault-neural-links/mcp-server": minor
"@vault-neural-links/core": minor
---

Term-to-note learning (VNL-053) — `recall` and `search_notes` now learn what
your words mean.

When a `search_notes`/`recall` result is actually read next, the query's
selective terms are persisted as a `query-token → note` edge in a new
`term-weights.json` (kept separate from the note graph on purpose — a token
must never become a graph neighbor). `recall` blends this learned signal
into its ranking, so a note can now surface purely because your own past
searches associated a word with it, even when nothing in the note's text
matches today (`RecallHit.source: "term"`, `why.termScore` /
`why.learnedTerms`). `computeUsageReport` reports term-learning events on
their own axis (`mechanismCounts.termLearn`) instead of mixing them into
note-touch counts.
