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
- **Plain-text audit trail** — every write appends a human-readable line to
  `changes.jsonl`. No git dependency — your vault doesn't need to be a git
  repo for any of this to work.
- **Zero lock-in** — runtime data lives inside your vault
  (`.vault-neural-links/`), not in some external database. Delete the
  folder and you're back to a plain Obsidian vault.

## Install

```bash
git clone <this-repo> path/to/vault-neural-link
cd path/to/vault-neural-link
npm install
npm run build --workspace=packages/core
npm run build --workspace=packages/mcp-server

claude mcp add vault-neural-link --scope user \
  -- node path/to/vault-neural-link/packages/mcp-server/dist/index.js
```

Set `CLAUDE_VAULT_PATH` to your vault's root before starting a session —
that's the only required configuration:

```bash
export CLAUDE_VAULT_PATH="/path/to/your/vault"
```

That's it. Ask Claude to search, read, create, or link notes in your
vault, and it will use these tools automatically.

### Obsidian plugin (optional)

The `packages/obsidian-plugin` workspace adds a "Neural Graph" view to
Obsidian that visualizes the same weighted-link data as a force-directed
graph. It's optional — the MCP server works standalone.

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
| `create_note` | Create a note (frontmatter + body); auto-links it and logs the change |
| `update_note` | Replace a note's body, or append text under a heading (e.g. `## Updates`) |
| `read_note` | Read a note's parsed frontmatter and body |
| `list_notes` | List note paths, optionally scoped to a folder |
| `search_notes` | Search titles/aliases/content, optionally ranked by link weight |
| `get_weighted_neighbors` | Get a note's most-used related notes |
| `get_edge_weight` | Get the current weight between two specific notes |
| `log_traversal` | Record that a session followed a link from one note to another |
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
