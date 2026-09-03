---
"@vault-neural-links/mcp-server": minor
"@vault-neural-links/core": minor
---

First published release (0.2.0).

Phase 0 safety work: every caller-supplied path is contained inside the vault
(`resolveInsideVault`), the activation WebSocket binds loopback only and is
optional, body-only `update_note` preserves frontmatter verbatim, the weight
compactor is crash- and concurrency-safe, and the server reports its real
version instead of `0.0.0`.
