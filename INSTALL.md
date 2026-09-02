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
cd packages\obsidian-plugin
node esbuild.config.mjs production
```

Copy the built files into the vault's plugin folder:

```powershell
$dest = "C:\path\to\your\vault\.obsidian\plugins\vault-neural-links"
New-Item -ItemType Directory -Force $dest
Copy-Item manifest.json,main.js,styles.css $dest
```

In Obsidian: **Settings → Community plugins** → turn off Restricted mode
(if on) → enable **Vault Neural Links**.

### 6. Nightly pipeline

Same as step 4 above — no separate setup needed either way.

## Not covered here

The global `CLAUDE.md` instructions and the `vault-memory` skill live in
`~/.claude/`, not this repo — they're a separate personal-config layer on
top of this setup, not part of installing the MCP server or plugin
themselves.
