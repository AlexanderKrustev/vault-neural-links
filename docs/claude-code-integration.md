
# CLAUDE.md integration

Once `packages/core` has a working implementation, a session wires in
traversal logging like this:

```ts
import { initInstance } from "@vault-neural-links/core";

const link = initInstance(vaultPath); // instanceId auto-generated if omitted

// call once per linked note the session reads, immediately after reading it
await link.logTraversal(fromNotePath, toNotePath);

// Reinforcement is automatic — reading a note that surfaced in this
// session's most recent activate()/getWeightedNeighbors() result reinforces
// that link by itself. There is no reinforce_link MCP tool: it was removed
// (AIBRAIN-66/69) because a couple of calls could force any note to rank
// first regardless of relevance.

// ranking neighbors when deciding what to open next
const neighbors = await link.getWeightedNeighbors(currentNotePath, 5);
```

Granularity: **per-note-read**, not batched at session end — call
`logTraversal` at the point a linked note is actually opened, not in a
summary pass.

Config in effect for this vault: decay half-life = **30 days**.
