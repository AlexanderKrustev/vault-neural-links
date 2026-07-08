# Vault Neural Links — Technical Spec

Weighted-link engine + visualization layer on top of an Obsidian vault, built for
multi-instance Claude Code access. Wikilinks stay as the graph skeleton; a
Hebbian-style weight layer tracks usage (co-traversal, reinforcement, decay) so
Claude Code sessions can rank neighbors by relevance instead of treating all
links as equal.

---

## 0. Architecture Overview

```
vault-neural-links/
├── packages/
│   ├── core/              # Phase 1 — headless engine, npm package
│   └── obsidian-plugin/   # Phase 2 — visualization, Obsidian Community Plugin
├── data/                  # runtime data, gitignored
│   ├── events/            # append-only JSONL logs, one per instance
│   └── link-weights.json  # compacted output (source of truth for readers)
└── docs/
```

**Single source of truth**: `data/link-weights.json`. Core writes it via
compaction; plugin only reads it. This keeps a plugin bug from ever corrupting
weight data (per Phase 2 decoupling requirement).

**No MCP, no server.** Every Claude Code instance imports `core` directly and
operates on the vault path. Concurrency is handled via append-only per-instance
logs, not shared-state locking.

---

## 1. Data Schemas

### 1.1 Event log entry (JSONL, one file per Claude Code instance)

File: `data/events/{instance-id}.jsonl`

```json
{"ts": "2026-07-07T14:32:10Z", "instance": "cc-warehouse-01", "type": "traverse", "from": "Flow Invoice/ADR-003", "to": "Flow Invoice/outbox-pattern", "weight_delta": 1}
{"ts": "2026-07-07T14:33:02Z", "instance": "cc-warehouse-01", "type": "reinforce", "from": "Flow Invoice/ADR-003", "to": "Flow Invoice/outbox-pattern", "weight_delta": 5}
```

- `type`: `"traverse"` (implicit co-read within a session window) | `"reinforce"` (explicit manual boost) | `"decay"` (written only by the decay job, not by instances)
- `from`/`to`: vault-relative note paths without extension, matching wikilink target resolution
- `weight_delta`: raw increment; sign and magnitude interpreted by compactor

### 1.2 Compacted weights file

File: `data/link-weights.json`

```json
{
  "version": 1,
  "compactedAt": "2026-07-07T15:00:00Z",
  "edges": {
    "Flow Invoice/ADR-003|Flow Invoice/outbox-pattern": {
      "weight": 12.4,
      "lastTouched": "2026-07-07T14:33:02Z",
      "traverseCount": 8,
      "reinforceCount": 1
    }
  }
}
```

- Edge key: `sortedPathA|sortedPathB` (undirected — alphabetically sorted so A→B and B→A collapse to one edge; direction doesn't matter for "how strongly are these related")
- `weight`: decayed, accumulated score — the number consumers actually rank on

---

## 2. Phase 1 — Core Engine (`packages/core`)

### 2.1 Tech stack

- TypeScript, Node.js ≥ 20
- Zero heavy deps: no markdown parser, no DB. `fs/promises`, regex, `crypto.randomUUID` for instance IDs if not supplied
- Test runner: `vitest`
- Build: `tsup` (fast, dual ESM/CJS output for max compatibility with different Claude Code invocation contexts)

### 2.2 Module layout

```
packages/core/
├── src/
│   ├── parser.ts        # wikilink extraction from note content
│   ├── logger.ts         # append events to instance JSONL
│   ├── compactor.ts      # merge all event logs → link-weights.json
│   ├── decay.ts          # exponential decay pass, invoked by compactor
│   ├── query.ts          # getWeightedNeighbors(), getEdgeWeight()
│   ├── types.ts
│   └── index.ts          # public API surface
├── test/
├── package.json
└── tsconfig.json
```

### 2.3 Public API (`index.ts`)

```typescript
initInstance(vaultPath: string, instanceId?: string): VaultLinkClient

interface VaultLinkClient {
  logTraversal(from: string, to: string): Promise<void>;
  reinforce(from: string, to: string, boost?: number): Promise<void>;
  getWeightedNeighbors(note: string, topK?: number): Promise<WeightedNeighbor[]>;
  compact(): Promise<CompactionResult>; // merges all instance logs, applies decay, writes link-weights.json
}

interface WeightedNeighbor {
  path: string;
  weight: number;
  lastTouched: string;
}
```

### 2.4 Tasks

1. **Scaffold package** — `package.json`, `tsconfig.json`, `tsup.config.ts`, vitest config.
2. **`parser.ts`** — extract `[[target]]` and `[[target|alias]]` from a note's raw text; resolve relative to vault root; unit tests against edge cases (embeds `![[...]]`, headings `[[note#heading]]`, block refs `[[note^block]]`).
3. **`logger.ts`** — append-only writer to `data/events/{instanceId}.jsonl`; must be safe under concurrent writes from the *same* instance (single fd, sequential writes) — cross-instance safety is handled by file separation, not locking.
4. **`decay.ts`** — exponential decay function: `weight = weight * exp(-λ * daysSinceLastTouched)`. Expose `λ` as config (default: half-life ≈ 30 days). Pure function, fully unit-testable.
5. **`compactor.ts`** — read all `data/events/*.jsonl`, fold into edge map, apply decay relative to `compactedAt`, write `link-weights.json` atomically (write to temp file, rename — avoids partial-read races for concurrent readers).
6. **`query.ts`** — read `link-weights.json`, return top-K neighbors for a note sorted by weight descending.
7. **CLI wrapper** (`bin/vnl-compact.js`) — so compaction can run via cron/systemd timer independent of any Claude Code session.
8. **Integration point** — a short doc snippet for `CLAUDE.md` showing how a session calls `logTraversal` when it reads a linked note, so Alex can wire it into his existing instruction set without redesigning it.
9. **Milestone gate** — run for ~1 week on the real vault, confirm `link-weights.json` shows non-trivial divergence (some edges clearly hotter than others) before starting Phase 2.

---

## 3. Phase 2 — Obsidian Plugin + Visualization (`packages/obsidian-plugin`)

### 3.1 Tech stack

- TypeScript + `esbuild` (Obsidian's standard plugin build)
- Obsidian Plugin API (`obsidian` npm types package)
- Rendering: **custom canvas/SVG force-directed panel**, not a re-skin of the stock graph view (per the reputational goal — needs to visually read as a new idea)
- Force simulation: `d3-force` (lightweight, just the physics — no need for full D3)
- Reads `data/link-weights.json` directly off disk — read-only, polling or file-watch, never writes

### 3.2 Module layout

```
packages/obsidian-plugin/
├── src/
│   ├── main.ts            # Plugin class, lifecycle, settings
│   ├── WeightsWatcher.ts   # file-watch on link-weights.json, debounced reload
│   ├── view/
│   │   ├── NeuralGraphView.ts   # ItemView subclass, registers the panel
│   │   ├── ForceSim.ts          # d3-force wrapper: nodes = notes, edges = weighted links
│   │   ├── Renderer.ts          # canvas draw loop: edge thickness/opacity by weight, decay fade, reinforcement pulse animation
│   │   └── styles.css
│   ├── settings.ts
│   └── manifest.json
├── esbuild.config.mjs
└── package.json
```

### 3.3 Visualization behavior spec

- **Edge thickness** ∝ `weight` (log-scaled, so a few outlier hot edges don't flatten everything else visually)
- **Edge opacity/color** — fades toward a muted color as `lastTouched` ages, independent of weight (so you can visually distinguish "strong but stale" from "strong and active")
- **Reinforcement pulse** — brief animation on an edge when a `reinforce` event lands (requires the watcher to diff against the previous snapshot, not just re-render statically)
- **Node clustering** — let `d3-force` handle layout organically from edge weights; don't hardcode folder-based clustering (that's Obsidian's stock graph's job already)
- **Interaction**: click node → open note; hover edge → tooltip with `weight`, `traverseCount`, `lastTouched`

### 3.4 Tasks

1. Scaffold via Obsidian's official sample-plugin template (`manifest.json`, `esbuild.config.mjs`, `main.ts` skeleton).
2. `WeightsWatcher.ts` — `fs.watch` (or polling fallback) on `link-weights.json`, debounce reloads (~500ms), emit diffs for pulse animation.
3. `ForceSim.ts` — wrap `d3-force`, feed nodes from vault file list + edges from weights file, expose tick callback.
4. `Renderer.ts` — canvas draw loop consuming `ForceSim` positions; implement thickness/opacity/pulse rules above.
5. `NeuralGraphView.ts` — register as an Obsidian `ItemView`, add ribbon icon + command palette entry to open the panel.
6. Settings tab — decay half-life display (read-only, mirrors core config), color scheme toggle, min-weight filter slider (hide noise edges below threshold).
7. Polish pass — this is the reputational deliverable, budget real time here: transitions, empty-state (no weights yet), performance test on Alex's actual vault size (large note count).
8. Package for Community Plugins: `manifest.json` compliance check, no network calls, no bundled binaries, README with screenshots/GIF of the pulse animation (this sells the idea more than text will).
9. Submit PR to `obsidian-releases`, expect review latency — don't block on it, plugin works standalone via manual install (`.obsidian/plugins/`) in the meantime.

---

## 4. Sequencing & Gates

| Gate | Condition |
|---|---|
| Start Phase 1 | now |
| Start Phase 2 rendering | Phase 1 has run ≥1 week on real vault with visibly non-uniform weights |
| Submit to Community Plugins | visualization polish pass complete — first impression matters more than shipping early |

---

## 5. Decisions

- **Decay half-life**: 30 days — favors keeping long-term structural links visible across gaps between sessions, over reacting to only the last couple of weeks.
- **Traversal event granularity**: per-note-read. `logTraversal()` fires each time a session reads a linked note, not batched at session end.
- **Minimum weight threshold** for an edge to render in Phase 2: still open, revisit once real weight data exists.
