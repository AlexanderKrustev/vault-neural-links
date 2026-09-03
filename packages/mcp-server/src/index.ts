import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startActivationSocketServer } from "./activationSocket.js";
import {
  ablationDiffTool,
  activateTool,
  compactWeightsTool,
  createNoteTool,
  getEdgeWeightTool,
  getWeightedNeighborsTool,
  listNotesTool,
  logTraversalTool,
  makeToolContext,
  readNoteTool,
  searchNotesTool,
  updateNoteTool,
} from "./tools.js";

const vaultPath = process.env.CLAUDE_VAULT_PATH;
if (!vaultPath) {
  console.error(
    "vault-neural-link MCP server: CLAUDE_VAULT_PATH is not set. " +
      "This must point at the Obsidian vault root.",
  );
  process.exit(1);
}

const instanceId = `mcp-${randomUUID()}`;
const ctx = makeToolContext(vaultPath, instanceId);

// VNL-002: the activation socket is an optional convenience for the Obsidian
// plugin's live graph. A bind failure (no loopback, a sandbox that forbids
// listening, an exhausted descriptor table) must not take the MCP server
// down with it — the tools all work without it.
try {
  ctx.activationSocket = await startActivationSocketServer(ctx.vaultDataDir, instanceId);
} catch (error) {
  console.error(
    "vault-neural-link MCP server: activation socket unavailable, continuing without " +
      `the live graph feed (${error instanceof Error ? error.message : String(error)})`,
  );
}

// The nightly compact/consolidate/reindex/importance/cluster pipeline is no
// longer triggered from here — Obsidian is now the sole scheduler (see
// packages/obsidian-plugin/src/NightlyScheduler.ts, AIBRAIN-46). This
// process still exposes compact_weights for on-demand ad-hoc compaction.

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await ctx.activationSocket?.close();
    process.exit(0);
  });
}

// VNL-005: report the real published version rather than a hardcoded 0.0.0.
// `dist/index.js` and `src/index.ts` are both one directory below the package
// root, so the same relative path works for the bundle and for tests.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

const server = new McpServer({
  name: "vault-neural-link",
  version,
});

server.registerTool(getWeightedNeighborsTool.name, getWeightedNeighborsTool.config, getWeightedNeighborsTool.handler(ctx));
server.registerTool(activateTool.name, activateTool.config, activateTool.handler(ctx));
server.registerTool(ablationDiffTool.name, ablationDiffTool.config, ablationDiffTool.handler(ctx));
server.registerTool(getEdgeWeightTool.name, getEdgeWeightTool.config, getEdgeWeightTool.handler(ctx));
server.registerTool(logTraversalTool.name, logTraversalTool.config, logTraversalTool.handler(ctx));
// reinforce_link removed (AIBRAIN-66/AIBRAIN-69 follow-up) — see tools.ts's
// comment at the former reinforceLinkTool location for why.
server.registerTool(compactWeightsTool.name, compactWeightsTool.config, compactWeightsTool.handler(ctx));
server.registerTool(createNoteTool.name, createNoteTool.config, createNoteTool.handler(ctx));
server.registerTool(updateNoteTool.name, updateNoteTool.config, updateNoteTool.handler(ctx));
server.registerTool(readNoteTool.name, readNoteTool.config, readNoteTool.handler(ctx));
server.registerTool(listNotesTool.name, listNotesTool.config, listNotesTool.handler(ctx));
server.registerTool(searchNotesTool.name, searchNotesTool.config, searchNotesTool.handler(ctx));

await server.connect(new StdioServerTransport());
