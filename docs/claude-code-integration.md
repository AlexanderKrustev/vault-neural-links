# CLAUDE.md integration

Once `packages/core` has a working implementation, a session wires in
traversal logging like this:

```ts
import { initInstance } from "@vault-neural-links/core";

const link = initInstance(vaultPath); // instanceId auto-generated if omitted

// call once per linked note the session reads, immediately after reading it
await link.logTraversal(fromNotePath, toNotePath);

// call when the user explicitly signals a link matters
await link.reinforce(fromNotePath, toNotePath, boost);

// ranking neighbors when deciding what to open next
const neighbors = await link.getWeightedNeighbors(currentNotePath, 5);
```

Granularity: **per-note-read**, not batched at session end — call
`logTraversal` at the point a linked note is actually opened, not in a
summary pass.

Config in effect for this vault: decay half-life = **30 days**.
