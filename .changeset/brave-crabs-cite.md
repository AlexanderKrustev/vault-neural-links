---
"@vault-neural-links/core": minor
---

`citedNotes` — the write-back "Referenced" signal (VNL-054).

When the agent writes `[[X]]` into a note and X is one it read earlier in the
same session, that is the one moment an MCP server gets to see a retrieved
note reach the work product rather than merely being opened. `citedNotes`
resolves those wikilinks against the session's read set only (exact path, or
an unambiguous bare title, mirroring `buildStructuralIndex`'s resolution
discipline), and the mcp-server credits each new pair once per session as a
`reinforce` at `CITED_REINFORCE_BOOST` with `trigger: "cited"`.
`computeUsageReport` counts it as a third reinforcement axis alongside
explicit and auto-retrieval.
