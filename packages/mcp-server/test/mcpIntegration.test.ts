import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { computeUsageReport, resolveDataDir, type ReadThroughReport } from "@vault-neural-links/core";
import { buildServerInstructions } from "../src/instructions.js";
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

/**
 * A resource's content is a text-or-blob union in the SDK's types. Everything
 * this server serves is text, so narrow once here rather than casting at each
 * assertion — a cast would also hide the day one of them starts returning a blob.
 */
function resourceText(result: { contents: unknown[] }, index = 0): string {
  const entry = result.contents[index] as { text?: unknown };
  if (typeof entry?.text !== "string") throw new Error("expected a text resource content");
  return entry.text;
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

  // VNL-064. The whole claim is that the vault reaches a session without
  // anyone attaching, mentioning or calling anything — so the only test that
  // means something is what a real client receives from `initialize`.
  describe("server instructions (VNL-064)", () => {
    async function connectWith(instructions: string | undefined): Promise<Client> {
      const server = createMcpServer(makeToolContext(vaultPath, "instructions-test"), instructions);
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const fresh = new Client({ name: "instructions-test-client", version: "1.0.0" });
      await Promise.all([fresh.connect(clientTransport), server.connect(serverTransport)]);
      return fresh;
    }

    it("delivers instructions to the client at initialize, with no request from either side", async () => {
      const fresh = await connectWith(await buildServerInstructions(makeToolContext(vaultPath, "x")));

      const instructions = fresh.getInstructions();
      expect(instructions).toBeTruthy();
      expect(instructions).toContain("recall");
      await fresh.close();
    });

    it("still connects when no instructions are supplied", async () => {
      const fresh = await connectWith(undefined);

      expect(fresh.getInstructions()).toBeUndefined();
      // The server is fully usable either way — instructions are additive.
      const { tools } = await fresh.listTools();
      expect(tools.length).toBeGreaterThan(0);
      await fresh.close();
    });

    it("sends the static half alone when the vault matches no project", async () => {
      // The temp vault is not named after any folder in itself, so no project
      // resolves — and a briefing about nothing in particular is noise in
      // front of every session.
      const instructions = await buildServerInstructions(makeToolContext(vaultPath, "x"));

      expect(instructions).toContain("weighted-link memory");
      expect(instructions).not.toContain("Vault briefing");
    });

    it("includes the briefing once a project resolves", async () => {
      await client.callTool({
        name: "create_note",
        arguments: { path: "Widgets/A Note", frontmatter: {}, body: "text" },
      });

      // In production the project comes from the server process's working
      // directory — the repository the client launched it in.
      const instructions = await buildServerInstructions(makeToolContext(vaultPath, "x"), {
        cwd: "/somewhere/widgets",
      });

      expect(instructions).toContain("Vault briefing — widgets");
      expect(instructions).toContain("A Note");
    });

    // The SessionStart hook this replaces always flagged the inbox, whatever
    // directory the session was in. Losing that whenever no project matched
    // would be a quiet regression against the thing being retired.
    it("flags a waiting inbox even when no project resolves", async () => {
      await client.callTool({
        name: "create_note",
        arguments: { path: "Inbox/Scribble", frontmatter: {}, body: "raw" },
      });

      const instructions = await buildServerInstructions(makeToolContext(vaultPath, "x"), {
        cwd: "/nowhere/unmatched",
      });

      expect(instructions).not.toContain("Vault briefing");
      expect(instructions).toContain("1 unprocessed note");
      expect(instructions).toContain("/process-inbox");
    });

    // The client truncates server instructions at 2048 characters. Observed,
    // not guessed — `claude --debug` at session start printed:
    //   MCP server "vault-neural-link": Server instructions truncated
    //     from 2285 to 2048 chars
    // Anything past that is cut from the end, which is where the briefing
    // is, so overrunning silently costs exactly the content this feature
    // exists to deliver.
    it("stays inside the 2048-character limit the client imposes", async () => {
      // A project with deep folders and long note names — the shape that
      // overran in the first place.
      for (let i = 0; i < 10; i++) {
        await client.callTool({
          name: "create_note",
          arguments: {
            path: `Widgets/A Deliberately Long Folder Name/Note Number ${i} With A Long Descriptive Title`,
            frontmatter: {},
            body: "text",
          },
        });
      }

      const instructions = await buildServerInstructions(makeToolContext(vaultPath, "x"), {
        cwd: "/somewhere/widgets",
      });

      expect(instructions.length).toBeLessThanOrEqual(2048);
      // And it is not merely short because the briefing was dropped whole.
      expect(instructions).toContain("Vault briefing");
    });

    it("survives a vault it cannot read, rather than failing to start", async () => {
      const missing = join(tmpdir(), "vnl-does-not-exist-", String(Date.now()));
      const instructions = await buildServerInstructions(makeToolContext(missing, "x"));

      expect(instructions).toContain("weighted-link memory");
    });
  });

  // VNL-057. The attribution is a relationship between separate tool calls
  // over the life of a session, so it can only really be verified by making
  // those calls in order through the protocol — a unit test would be asserting
  // on state it set up itself.
  describe("read-through logging (VNL-057)", () => {
    async function usageReport(): Promise<{ readThrough: ReadThroughReport }> {
      return computeUsageReport(resolveDataDir(vaultPath)) as Promise<{ readThrough: ReadThroughReport }>;
    }

    beforeEach(async () => {
      for (const path of ["Notes/Alpha", "Notes/Beta"]) {
        await client.callTool({
          name: "create_note",
          arguments: { path, frontmatter: {}, body: "spreading activation write-up" },
        });
      }
    });

    it("logs a recall, the results opened afterwards, and the write that followed", async () => {
      await client.callTool({ name: "recall", arguments: { query: "spreading activation write-up" } });
      await client.callTool({ name: "read_note", arguments: { path: "Notes/Alpha" } });
      await client.callTool({
        name: "create_note",
        arguments: { path: "Notes/Derived", frontmatter: {}, body: "written after reading" },
      });

      const { readThrough } = await usageReport();
      expect(readThrough.recalls).toBe(1);
      expect(readThrough.resultsReturned).toBeGreaterThan(0);
      expect(readThrough.resultsRead).toBe(1);
      expect(readThrough.recallsWithAnyRead).toBe(1);
      expect(readThrough.recallsFollowedByWrite).toBe(1);
    });

    it("does not credit a read of a note the recall never returned", async () => {
      await client.callTool({ name: "create_note", arguments: { path: "Notes/Unrelated", frontmatter: {}, body: "nothing alike" } });
      await client.callTool({ name: "recall", arguments: { query: "spreading activation write-up" } });
      await client.callTool({ name: "read_note", arguments: { path: "Notes/Unrelated" } });

      const { readThrough } = await usageReport();
      expect(readThrough.recalls).toBe(1);
      expect(readThrough.resultsRead).toBe(0);
      expect(readThrough.usefulRecallRate).toBe(0);
    });

    it("counts one read once, even when two recalls both returned the note", async () => {
      await client.callTool({ name: "recall", arguments: { query: "spreading activation write-up" } });
      await client.callTool({ name: "recall", arguments: { query: "spreading activation" } });
      await client.callTool({ name: "read_note", arguments: { path: "Notes/Alpha" } });

      const { readThrough } = await usageReport();
      // Two calls, one physical read — crediting both would inflate the rate.
      expect(readThrough.recalls).toBe(2);
      expect(readThrough.resultsRead).toBe(1);
      expect(readThrough.recallsWithAnyRead).toBe(1);
    });

    it("counts a session that writes repeatedly as one useful recall, not several", async () => {
      await client.callTool({ name: "recall", arguments: { query: "spreading activation write-up" } });
      await client.callTool({ name: "read_note", arguments: { path: "Notes/Alpha" } });
      for (const path of ["Notes/One", "Notes/Two", "Notes/Three"]) {
        await client.callTool({ name: "create_note", arguments: { path, frontmatter: {}, body: "more work" } });
      }

      const { readThrough } = await usageReport();
      expect(readThrough.recallsFollowedByWrite).toBe(1);
    });

    it("says the number is not measured yet rather than reporting zero", async () => {
      const { readThrough } = await usageReport();

      expect(readThrough.recalls).toBe(0);
      expect(readThrough.resultReadRate).toBeNull();
    });
  });

  // VNL-055. A resource is the one thing here that reaches the model without
  // the model choosing to call anything, so whether it is actually advertised
  // over the protocol is the whole feature — a registration mistake would be
  // invisible to the unit tests, which never speak MCP.
  describe("session briefing (VNL-055)", () => {
    it("advertises the briefing resource and its project template", async () => {
      const { resources } = await client.listResources();
      expect(resources.map((resource) => resource.uri)).toContain("vault://briefing");

      const { resourceTemplates } = await client.listResourceTemplates();
      expect(resourceTemplates.map((template) => template.uriTemplate)).toContain("vault://briefing/{project}");
    });

    it("reads the briefing as markdown", async () => {
      const result = await client.readResource({ uri: "vault://briefing" });

      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe("text/markdown");
      expect(resourceText(result)).toContain("Vault briefing");
    });

    it("scopes to a project named in the URI", async () => {
      await client.callTool({
        name: "create_note",
        arguments: { path: "Notes/Widgets/Something", frontmatter: {}, body: "text" },
      });

      const result = await client.readResource({ uri: "vault://briefing/Widgets" });
      const text = resourceText(result);

      expect(text).toContain("Vault briefing — Widgets");
      expect(text).toContain("Notes/Widgets/Something");
    });

    it("advertises the briefing prompt and returns a usable message", async () => {
      const { prompts } = await client.listPrompts();
      expect(prompts.map((prompt) => prompt.name)).toContain("vault-briefing");

      const result = await client.getPrompt({ name: "vault-briefing" });
      expect(result.messages[0].role).toBe("user");
      expect(String((result.messages[0].content as { text?: unknown }).text)).toContain("Vault briefing");
    });

    it("returns a briefing rather than failing on an empty vault with no indexes", async () => {
      const result = await client.readResource({ uri: "vault://briefing/nothing-here" });

      expect(resourceText(result)).toContain("No vault folder matches");
    });
  });
});
