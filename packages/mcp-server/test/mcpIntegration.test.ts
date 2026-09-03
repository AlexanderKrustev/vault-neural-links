import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer, SERVER_VERSION } from "../src/server.js";
import { makeToolContext } from "../src/tools.js";

/**
 * VNL-007 — drives the real server through a real MCP client over the SDK's
 * in-memory transport. Calling the handlers directly (tools.test.ts) skips
 * exactly the layer that let `read_note ../x` through in the first place:
 * the zod schemas as the protocol applies them.
 */
function parseResult(result: unknown): Record<string, unknown> {
  const content = (result as { content: { type: string; text: string }[] }).content;
  return JSON.parse(content[0].text);
}

/**
 * The SDK reports a schema rejection as an error *result* rather than a
 * thrown error, so asserting "it threw" would pass even if the call had
 * quietly succeeded. Assert on the result the client actually receives.
 */
async function expectRefused(call: Promise<unknown>): Promise<void> {
  const result = (await call) as { isError?: boolean; content: { text: string }[] };
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(/Must stay inside the vault|validation error/i);
}

describe("MCP client integration (VNL-007)", () => {
  let vaultPath: string;
  let client: Client;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-mcp-integration-"));
    const server = createMcpServer(makeToolContext(vaultPath, "integration-test"));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    client = new Client({ name: "integration-test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  });

  afterEach(async () => {
    await client.close();
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("tools/list advertises exactly the twelve supported tools", async () => {
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "ablation_diff",
      "activate",
      "compact_weights",
      "create_note",
      "get_edge_weight",
      "get_weighted_neighbors",
      "list_notes",
      "log_traversal",
      "read_note",
      "recall",
      "search_notes",
      "update_note",
    ]);
    // reinforce_link was removed (AIBRAIN-66/69) and must not come back.
    expect(tools.map((tool) => tool.name)).not.toContain("reinforce_link");
  });

  it("reports its real package version, not 0.0.0 (VNL-005)", async () => {
    expect(client.getServerVersion()).toMatchObject({ name: "vault-neural-link" });
    expect(SERVER_VERSION).not.toBe("0.0.0");
    expect(client.getServerVersion()?.version).toBe(SERVER_VERSION);
  });

  it("round-trips create_note -> read_note over the protocol", async () => {
    await client.callTool({
      name: "create_note",
      arguments: { path: "Notes/Round Trip", frontmatter: { type: "atomic" }, body: "hello" },
    });

    const read = parseResult(await client.callTool({ name: "read_note", arguments: { path: "Notes/Round Trip" } }));

    expect(read.path).toBe("Notes/Round Trip");
    expect(read.frontmatter).toMatchObject({ type: "atomic" });
    expect(String(read.body)).toContain("hello");
  });

  it("answers a recall query over the protocol (VNL-050)", async () => {
    await client.callTool({
      name: "create_note",
      arguments: { path: "Notes/Kill Process By Port", frontmatter: {}, body: "Use lsof, then kill the pid." },
    });

    const result = parseResult(await client.callTool({ name: "recall", arguments: { query: "kill process by port" } }));
    const hits = result.hits as { path: string; snippet: string; why: { matchedTerms: string[] } }[];

    expect(hits[0].path).toBe("Notes/Kill Process By Port");
    expect(hits[0].snippet).toContain("lsof");
    expect(hits[0].why.matchedTerms).toContain("kill");
  });

  it("rejects a traversal-escaping path on read_note (VNL-001)", async () => {
    await expectRefused(client.callTool({ name: "read_note", arguments: { path: "../outside-the-vault" } }));
  });

  it("rejects traversal, absolute paths and internal directories on every path-taking tool", async () => {
    const badPaths = ["../escape", "a/../../escape", "/etc/passwd", ".vault-neural-links/link-weights", ".obsidian/app"];

    for (const path of badPaths) {
      await expectRefused(client.callTool({ name: "read_note", arguments: { path } }));
      await expectRefused(
        client.callTool({ name: "create_note", arguments: { path, frontmatter: {}, body: "x" } }),
      );
      await expectRefused(client.callTool({ name: "update_note", arguments: { path, body: "x" } }));
    }
  });

  it("list_notes with an escaping folder argument is rejected rather than listing outside the vault", async () => {
    await expectRefused(client.callTool({ name: "list_notes", arguments: { folder: "../.." } }));
  });
});
