# Setting up on another machine

Full parity setup: MCP server registered with Claude Code, Obsidian plugin
installed, vault path configured, same daily compaction cadence as an
existing installation.

## 1. Prerequisites

- Node.js >=20 and npm
- Claude Code CLI installed
- Obsidian installed, with the target vault already there

## 2. Get the code onto the machine

Copy the repo folder over (git clone, USB, OneDrive, network share —
whatever's convenient). Skip `node_modules` and `dist` folders; they get
rebuilt in the next step.

## 3. Install and build

```powershell
npm install
npm run build --workspace=packages/core
npm run build --workspace=packages/mcp-server
```

## 4. Register the MCP server with Claude Code

```powershell
claude mcp add vault-neural-link --scope user -- node C:\path\to\vault-neural-link\packages\mcp-server\dist\index.js
```

`--scope user` makes it available in every project, not just one repo.

## 5. Point it at the vault

```powershell
setx CLAUDE_VAULT_PATH "C:\path\to\your\vault"
```

`setx` only takes effect in new terminal sessions — close and reopen
PowerShell/Claude Code after running it.

## 6. Build and install the Obsidian plugin

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

## 7. Optional: nightly compaction task

A Windows Scheduled Task can run `packages/core/bin/vnl-compact.js
<vaultPath>` daily to fold traversal events into `link-weights.json` with
decay applied:

```powershell
schtasks /create /tn "VaultNeuralLinksCompact" /tr "node C:\path\to\vault-neural-link\packages\core\bin\vnl-compact.js C:\path\to\your\vault" /sc daily /st 03:30
```

## Not covered here

The global `CLAUDE.md` instructions and the `vault-memory` skill live in
`~/.claude/`, not this repo — they're a separate personal-config layer on
top of this setup, not part of installing the MCP server or plugin
themselves.
