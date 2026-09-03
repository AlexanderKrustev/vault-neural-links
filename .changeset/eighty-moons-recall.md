---
"@vault-neural-links/mcp-server": minor
"@vault-neural-links/core": minor
---

New `recall(query, topK?, context?)` tool — query-driven hybrid retrieval
(VNL-050).

One call answers "what should I read for this task?": BM25 over the content
index picks the notes that match, spreading activation over the usage-weighted
link graph expands and re-ranks them, and each hit comes back with a snippet
and a `why` (matched terms, the seed note and hop count it was reached
through, activation energy, days since the file changed, and `supersededBy`).
Notes no query term touches can now surface if the graph says they belong with
the ones that did, and reading a graph-expanded hit auto-reinforces the edge it
came from. Existing tools are unchanged; `recall` is the recommended entry
point.
