import { createRequire } from "node:module";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { briefingByProjectResource, briefingPrompt, briefingResource } from "./resources.js";
import {
  ablationDiffTool,
  activateTool,
  compactWeightsTool,
  createNoteTool,
  getEdgeWeightTool,
  getWeightedNeighborsTool,
  listNotesTool,
  logTraversalTool,
  readNoteTool,
  recallTool,
  searchNotesTool,
  updateNoteTool,
  type ToolContext,
} from "./tools.js";

// VNL-005: report the real published version rather than a hardcoded 0.0.0.
// `dist/index.js` and `src/server.ts` are both one directory below the
// package root, so the same relative path works for the bundle and for tests.
const { version } = createRequire(import.meta.url)("../package.json") as { version: string };

export const SERVER_VERSION = version;

/**
 * Builds the MCP server with every tool registered, without connecting a
 * transport. Split out of index.ts (VNL-007) so an integration test can
 * drive the real server over the SDK's in-memory transport — exercising
 * schema validation, tool registration and error mapping the way a client
 * does, none of which is covered by calling the handlers directly.
 */
export function createMcpServer(ctx: ToolContext, instructions?: string): McpServer {
  // VNL-064: `instructions` is returned in the `initialize` result, so this
  // is the one place in MCP where the server may speak before it is spoken
  // to — no resource to attach, no tool to call, no client-specific hook.
  const server = new McpServer(
    { name: "vault-neural-link", version },
    ...(instructions ? [{ instructions }] : []),
  );

  const tools = [
    recallTool,
    getWeightedNeighborsTool,
    activateTool,
    ablationDiffTool,
    getEdgeWeightTool,
    logTraversalTool,
    // reinforce_link removed (AIBRAIN-66/AIBRAIN-69 follow-up) — see tools.ts's
    // comment at the former reinforceLinkTool location for why.
    compactWeightsTool,
    createNoteTool,
    updateNoteTool,
    readNoteTool,
    listNotesTool,
    searchNotesTool,
  ];

  for (const tool of tools) {
    server.registerTool(tool.name, tool.config as never, tool.handler(ctx) as never);
  }

  // VNL-055. Registered alongside the tools rather than in a separate
  // factory: a client that lists capabilities should see one server, and the
  // briefing shares the same ToolContext (vault path, data dir) as everything
  // else.
  server.registerResource(
    briefingResource.name,
    briefingResource.uri,
    briefingResource.config,
    briefingResource.handler(ctx) as never,
  );
  server.registerResource(
    briefingByProjectResource.name,
    new ResourceTemplate(briefingByProjectResource.template, { list: undefined }),
    briefingByProjectResource.config,
    briefingByProjectResource.handler(ctx) as never,
  );
  server.registerPrompt(
    briefingPrompt.name,
    briefingPrompt.config as never,
    briefingPrompt.handler(ctx) as never,
  );

  return server;
}
