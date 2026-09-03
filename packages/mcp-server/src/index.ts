import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { removeInstanceFiles } from "@vault-neural-links/core";
import { startActivationSocketServer } from "./activationSocket.js";
import { createMcpServer } from "./server.js";
import { makeToolContext } from "./tools.js";

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

// VNL-009: this instance's session buffer and socket registration describe
// live state, so they are deleted when the process goes away — on either
// signal, and on stdin close, which is how an MCP client actually ends a
// stdio server. Files left by a hard kill are collected by the nightly
// prune instead.
let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await ctx.activationSocket?.close();
  await removeInstanceFiles(ctx.vaultDataDir, instanceId);
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown();
  });
}
process.stdin.on("close", () => {
  void shutdown();
});
process.stdin.on("end", () => {
  void shutdown();
});

const server = createMcpServer(ctx);

await server.connect(new StdioServerTransport());
