# Setting up on another machine

Full parity setup: MCP server registered with Claude Code, Obsidian plugin
installed, vault path configured, same daily compaction cadence as an
existing installation.

## Prerequisites

- Node.js >=20 and npm
- Claude Code CLI installed
- Obsidian installed, with the target vault already there

## 1. Register the MCP server

```powershell
claude mcp add vault-neural-link --scope user -- npx -y @vault-neural-links/mcp-server
```

> **Not yet published to npm** (tracked in AIBRAIN-39/42 — needs a
> one-time manual publish setup that hasn't happened yet). Use
> [Build from source instead](#build-from-source-works-today) until then;
> the rest of this page still applies once it works.

## 2. Point it at the vault

```powershell
setx CLAUDE_VAULT_PATH "C:\path\to\your\vault"
```

`setx` only takes effect in new terminal sessions — close and reopen
PowerShell/Claude Code after running it.

## 3. Install the Obsidian plugin

Once submitted and accepted into the Obsidian community plugin store
(also AIBRAIN-39, a manual review process not started yet): **Settings →
Community plugins → Browse**, search "Vault Neural Links", install and
enable. Until then, see
[Build from source](#build-from-source-works-today) below.

## 4. Nightly pipeline — no setup needed

The Obsidian plugin schedules the daily compact/consolidate/reindex/
importance/cluster/content-index pipeline itself (see `NightlyScheduler`
in `packages/obsidian-plugin/src`) — it checks periodically while Obsidian
is open and runs at most once per day, gated on `note-importance.json`'s
`computedAt` staleness marker so it's safe across restarts and doesn't
double-run. No OS scheduled task and no Claude Code session are involved;
the pipeline simply doesn't run on days the vault isn't opened in Obsidian.

`packages/core/bin/vnl-compact.js <vaultPath>` and
`packages/core/bin/vnl-nightly.js <vaultPath>` remain available as manual
CLI fallbacks (e.g. headless/non-Obsidian setups) but are no longer part
of the standard install.

## 4b. Optional: semantic matching (VNL-051)

Skip this unless you want `recall` to match notes by meaning as well as by
words. It is off by default and nothing depends on it.

```bash
npm install @huggingface/transformers   # alongside the MCP server
```

Then build the index once, out of process:

```bash
node packages/core/bin/vnl-embed.js <vault-path>    # or: npx vnl-embed <vault-path>
```

and turn on **"Match meaning, not just words"** in the plugin's settings so
the nightly job keeps it current. From then on `recall` blends cosine
similarity into its ranking and reports a `semanticScore` per hit.

Two things worth knowing before enabling it:

- **The first build downloads a ~23 MB model** (all-MiniLM-L6-v2, ONNX)
  from HuggingFace's CDN. That is the only network request this project
  makes. Everything after it runs offline on your machine, and note text is
  never sent anywhere.
- **Build it with the CLI, not by waiting for the nightly job.** Measured on
  a real 494-note vault: 2.4 s to load the model, then ~28 notes/second —
  about 18 seconds in total. That is fine in a terminal and not fine on
  Obsidian's main thread, which is where the nightly job runs it (VNL-033).
  Later runs only re-embed notes whose text changed, so the nightly refresh
  is cheap; it is the first full build that wants the CLI.

If the package isn't installed, or the model can't load, the setting has no
effect and retrieval behaves exactly as it does without it. Vaults above
50,000 notes are skipped until the SQLite-backed index (VNL-031) lands: the
vector file is read and scanned per query, same as the content index.

## 5. Exclude `.vault-neural-links/` from file sync

If the vault lives in OneDrive, iCloud Drive, Dropbox or any other syncing
folder, exclude `<vault>/.vault-neural-links/` from that sync.

This folder holds the engine's own append-only event logs and index files,
which are rewritten constantly and are strictly local runtime state — a
sync client racing those writes produces `... (1).json` / `-conflict`
copies, which is exactly what was observed in a real vault. Nothing in it
is worth syncing: it is rebuilt from the notes themselves, and deleting it
leaves you with a plain Obsidian vault.

- **OneDrive**: right-click the folder → *Always keep on this device* off
  is **not** enough; use *Settings → Sync and backup → Advanced settings →
  Excluded folders*, or keep the vault outside OneDrive entirely.
- **Dropbox**: *Preferences → Sync → Selective sync* → untick it.
- **iCloud Drive**: append `.nosync` to the folder name is not viable here
  (the engine writes to the literal path), so keep the vault outside
  iCloud Drive if you need this.

---

## Build from source (works today)

Everything above, done from a local clone instead of published packages —
this is the only install path that actually works right now.

### 1. Get the code onto the machine

Copy the repo folder over (git clone, USB, OneDrive, network share —
whatever's convenient). Skip `node_modules` and `dist` folders; they get
rebuilt in the next step.

### 2. Install and build

```powershell
npm install
npm run build --workspace=packages/core
npm run build --workspace=packages/mcp-server
```

### 3. Register the MCP server with Claude Code

```powershell
claude mcp add vault-neural-link --scope user -- node C:\path\to\vault-neural-link\packages\mcp-server\dist\index.js
```

`--scope user` makes it available in every project, not just one repo.

### 4. Point it at the vault

Same as step 2 above: `setx CLAUDE_VAULT_PATH "C:\path\to\your\vault"`.

### 5. Build and install the Obsidian plugin

```powershell
npm run deploy --workspace=packages/obsidian-plugin
```

That builds the plugin and copies `main.js`, `manifest.json` and
`styles.css` into
`$env:CLAUDE_VAULT_PATH\.obsidian\plugins\vault-neural-links`, creating the
folder if it is not there. To deploy somewhere else, name it:
`npm run deploy --workspace=packages/obsidian-plugin -- "C:\other\vault"`.

In Obsidian: **Settings → Community plugins** → turn off Restricted mode
(if on) → enable **Vault Neural Links**.

After any later rebuild, run `deploy` again **and reload the plugin**
(toggle it off and on, or Ctrl+P → "Reload app without saving") — Obsidian
holds the old bundle in memory, and `npm run build` on its own never
touches the vault at all.

### 6. Nightly pipeline

Same as step 4 above — no separate setup needed either way.

### 7. Exclude `.vault-neural-links/` from file sync

Same as step 5 above; it applies to every install path.

## Not covered here

The global `CLAUDE.md` instructions and the `vault-memory` skill live in
`~/.claude/`, not this repo — they're a separate personal-config layer on
top of this setup, not part of installing the MCP server or plugin
themselves.
