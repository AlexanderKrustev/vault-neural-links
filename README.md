# Vault Neural Link

Give an AI agent a real memory in your Obsidian vault — not just files it
can read, but a graph that learns which notes actually matter to it over
time.

Vault Neural Link is an MCP server that turns any Obsidian vault into a
working knowledge base for Claude Code (or any MCP-compatible client):
create and update notes, auto-link them to related content, and rank
"related notes" by *actual usage* — how often a path between two notes is
traversed or reinforced — instead of by raw wikilink count alone. Point it
at a vault and it works: no scripts, no hooks, no manual git commands.

## Why

Wikilinks are a great graph skeleton, but every link is treated as equally
important the moment it's drawn. In a vault that's been growing for years,
that's wrong — some connections matter every session, others were relevant
once and never again. Vault Neural Link adds a lightweight, Hebbian-style
weight on top of your existing links: paths that get traversed or
explicitly reinforced stay warm; everything else decays. The result is a
`get_weighted_neighbors` call that surfaces what's actually relevant right
now, not just what's technically connected.

## What it does

- **Note authoring** — create, read, update, list, and search notes
  directly from an MCP client, with automatic frontmatter handling.
- **Auto-linking** — every note you write is scanned against the rest of
  the vault; mentions of other note titles or aliases get linked
  automatically under a `## Related (auto-linked)` section.
- **Weighted relevance** — every note read or link followed nudges an
  edge weight up; unused edges decay over time (30-day half-life by
  default). `get_weighted_neighbors` ranks by this weight, not just link
  count.
- **Spreading activation** — `activate` follows that weighted graph
  outward across multiple hops, so a note only indirectly connected
  through an intermediate note can still surface.
- **Persisted indexes** — a content index and a structural index mean
  `search_notes` doesn't re-scan the whole vault on every call. What has
  actually been measured: search against a **synthetic** 300,000-note
  corpus with a small vocabulary. Retrieval (`activate`), auto-linking and
  the nightly pipeline have *not* been measured at that size, and the
  content index is a single JSON file re-read per query — expect it to be
  the limit well before 300k real notes. A SQLite-backed store is the
  planned fix (`docs/PLAN.md`, VNL-031).
- **Learns from your own navigation, not just the AI's** — with the
  Obsidian plugin installed, opening one note after another (and editing
  the note you navigated to) records a low-weight edge in the same local
  event log the MCP server writes. This is what keeps the graph from
  starving: agent traffic alone measured about two events a day in a real
  vault. **What this records:** the paths of notes you open in sequence and
  edit, with timestamps, written to `.vault-neural-links/events/` inside
  your own vault. No note content, no network calls, nothing sent anywhere,
  no telemetry. Turn it off in the plugin's settings ("Learn from my
  navigation"), or delete the folder to erase it.
- **Plain-text audit trail** — every write appends a human-readable line to
  `changes.jsonl`. No git dependency — your vault doesn't need to be a git
  repo for any of this to work.
- **Zero lock-in** — runtime data lives inside your vault
  (`.vault-neural-links/`), not in some external database. Delete the
  folder and you're back to a plain Obsidian vault. Exclude that folder
  from OneDrive/iCloud/Dropbox sync — it is rewritten constantly, and a
  sync client racing those writes leaves conflict copies (see
  [INSTALL.md](INSTALL.md) step 5).

## Install

```bash
claude mcp add vault-neural-link --scope user \
  -- npx -y @vault-neural-links/mcp-server
```

> **Not yet published to npm.** The command above is the intended
> one-line install once `@vault-neural-links/mcp-server` has its first
> release (tracked in AIBRAIN-39/42) — publishing needs a one-time manual
> step (an npm access token added to this repo's GitHub Actions secrets)
> that hasn't happened yet. Until then, use the build-from-source install
> below; it works today.

<details>
<summary>Build from source (works today)</summary>

```bash
git clone <this-repo> path/to/vault-neural-link
cd path/to/vault-neural-link
npm install
npm run build --workspace=packages/core
npm run build --workspace=packages/mcp-server

claude mcp add vault-neural-link --scope user \
  -- node path/to/vault-neural-link/packages/mcp-server/dist/index.js
```

</details>

Either way, set `CLAUDE_VAULT_PATH` to your vault's root before starting a
session — that's the only required configuration:

```bash
export CLAUDE_VAULT_PATH="/path/to/your/vault"
```

That's it. Ask Claude to search, read, create, or link notes in your
vault, and it will use these tools automatically.

### Obsidian plugin (optional)

The `packages/obsidian-plugin` workspace adds a "Neural Graph" view to
Obsidian that visualizes the same weighted-link data as a force-directed
graph. It's optional — the MCP server works standalone.

Not yet submitted to the Obsidian community plugin store (tracked in
AIBRAIN-39, a manual review process once submitted) — for now, build it
yourself:

```bash
npm run build --workspace=packages/obsidian-plugin
```

Then copy `manifest.json`, `styles.css`, and the generated `main.js` (all
in `packages/obsidian-plugin/`) into
`<your-vault>/.obsidian/plugins/vault-neural-links/`, and enable "Vault
Neural Links" under Community Plugins in Obsidian. Open the view via the
ribbon icon or the "Open Neural Graph" command.

## Tools

| Tool | Purpose |
|---|---|
| `recall` | **Start here.** Answers a query, not a note path: BM25 relevance picks the matching notes, spreading activation over the weighted graph expands and re-ranks them, and every hit comes back with a snippet and a `why` (matched terms, seed note and hop count, activation energy, staleness, supersession) |
| `create_note` | Create a note (frontmatter + body); auto-links it and logs the change |
| `update_note` | Replace a note's body, or append text under a heading (e.g. `## Updates`) |
| `read_note` | Read a note's parsed frontmatter and body |
| `list_notes` | List note paths, optionally scoped to a folder |
| `search_notes` | Search titles/aliases/content, tokenized and ranked by match relevance, then by link weight |
| `get_weighted_neighbors` | Get a note's most-used related notes, one hop out |
| `activate` | Spreading activation: follow the weighted graph outward across multiple hops from one note |
| `ablation_diff` | Compare `activate`'s output with and without specific scoring layers, to see what each one contributes |
| `get_edge_weight` | Get the current weight between two specific notes |
| `log_traversal` | Manual override for crediting an edge `read_note` couldn't have credited on its own (rare — see the tool's own description) |
| `compact_weights` | Force-fold pending events into the weights file immediately |

Reinforcement (boosting a link beyond ordinary read/traversal tracking) is
automatic, not a tool call: reading a note that surfaced in the session's
most recent `activate`/`get_weighted_neighbors` result reinforces that link
on its own. An earlier explicit `reinforce_link` tool was removed — it had
zero real invocations across months of production usage and, when tested,
turned out to be miscalibrated badly enough to override topical relevance
entirely.

## Packages

- **`packages/core`** — headless engine: note I/O, auto-linking, the
  weighted-link event log, and decay/compaction logic. No MCP framing,
  no git dependency; usable standalone.
- **`packages/mcp-server`** (`@vault-neural-links/mcp-server`) — the MCP
  server described above. This is the installable product.
- **`packages/obsidian-plugin`** — an Obsidian plugin that visualizes the
  weighted-link graph as a force-directed layout, reading the same
  `.vault-neural-links/link-weights.json` the MCP server writes.
- **`packages/render-core`** — the shared force-directed graph rendering
  code behind the Obsidian plugin's view, extracted so it isn't tied to
  Obsidian's own extension APIs.
- **`packages/desktop-app`** — an experimental standalone Electron shell
  (bundled MCP server, no Obsidian dependency). Paused; see that
  package's own state before relying on it.

## Development

```bash
npm install
npm run build --workspace=packages/core
npm run build --workspace=packages/mcp-server
npm run build --workspace=packages/obsidian-plugin
npm test --workspace=packages/core
npm test --workspace=packages/mcp-server
```

Runtime data (`.vault-neural-links/`) lives inside whichever vault you
point `CLAUDE_VAULT_PATH` at, not in this repo — add it to that vault's
`.gitignore` if you don't want the event logs tracked there.

### Releasing (`packages/core` and `packages/mcp-server` only)

Versioning and npm publishing for these two packages goes through
[Changesets](https://github.com/changesets/changesets) — see
`.changeset/README.md` for the day-to-day workflow, and
`.github/workflows/release.yml` for what runs in CI. The Obsidian plugin
ships separately, through the community store submission process, not npm.
