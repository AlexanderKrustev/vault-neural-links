import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { startActivationSocketServer } from "./activationSocket.js";
import {
  activateTool,
  compactWeightsTool,
  createNoteTool,
  getEdgeWeightTool,
  getWeightedNeighborsTool,
  listNotesTool,
  logTraversalTool,
  makeToolContext,
  readNoteTool,
  reinforceLinkTool,
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
ctx.activationSocket = await startActivationSocketServer(ctx.vaultDataDir, instanceId);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await ctx.activationSocket?.close();
    process.exit(0);
  });
}

const server = new McpServer({
  name: "vault-neural-link",
  version: "0.0.0",
});

server.registerTool(getWeightedNeighborsTool.name, getWeightedNeighborsTool.config, getWeightedNeighborsTool.handler(ctx));
server.registerTool(activateTool.name, activateTool.config, activateTool.handler(ctx));
server.registerTool(getEdgeWeightTool.name, getEdgeWeightTool.config, getEdgeWeightTool.handler(ctx));
server.registerTool(logTraversalTool.name, logTraversalTool.config, logTraversalTool.handler(ctx));
server.registerTool(reinforceLinkTool.name, reinforceLinkTool.config, reinforceLinkTool.handler(ctx));
server.registerTool(compactWeightsTool.name, compactWeightsTool.config, compactWeightsTool.handler(ctx));
server.registerTool(createNoteTool.name, createNoteTool.config, createNoteTool.handler(ctx));
server.registerTool(updateNoteTool.name, updateNoteTool.config, updateNoteTool.handler(ctx));
server.registerTool(readNoteTool.name, readNoteTool.config, readNoteTool.handler(ctx));
server.registerTool(listNotesTool.name, listNotesTool.config, listNotesTool.handler(ctx));
server.registerTool(searchNotesTool.name, searchNotesTool.config, searchNotesTool.handler(ctx));

await server.connect(new StdioServerTransport());
