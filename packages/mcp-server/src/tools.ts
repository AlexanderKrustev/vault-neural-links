import { z } from "zod";
import {
  appendChangelogEntry,
  appendUnderHeading,
  autoLinkScan,
  getEdgeWeight,
  getWeightedNeighbors,
  initInstance,
  listNotes,
  readNote,
  resolveDataDir,
  searchNotes,
  writeNote,
  type VaultLinkClient,
} from "@vault-neural-links/core";

export interface ToolContext {
  vaultPath: string;
  vaultDataDir: string;
  client: VaultLinkClient;
}

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

export const getWeightedNeighborsTool = {
  name: "get_weighted_neighbors",
  config: {
    title: "Get weighted neighbors",
    description:
      "Returns the notes most strongly linked to a given note in the vault, ranked by " +
      "usage-weighted edge strength (decayed traversal/reinforcement history), not just " +
      "raw wikilink presence. Note path is vault-relative without the .md extension, " +
      "matching wikilink targets (e.g. 'MOCs/General').",
    inputSchema: {
      note: z.string().describe("Vault-relative note path, without .md extension"),
      topK: z.number().int().positive().max(100).optional().describe("Max neighbors to return (default 10)"),
    },
  },
  handler: (ctx: ToolContext) => async ({ note, topK }: { note: string; topK?: number }) => {
    const neighbors = await getWeightedNeighbors(ctx.vaultDataDir, note, topK, ctx.vaultPath);
    return textResult(neighbors);
  },
};

export const getEdgeWeightTool = {
  name: "get_edge_weight",
  config: {
    title: "Get edge weight",
    description: "Returns the current weight of the link between two specific notes, if one exists.",
    inputSchema: {
      noteA: z.string().describe("Vault-relative note path, without .md extension"),
      noteB: z.string().describe("Vault-relative note path, without .md extension"),
    },
  },
  handler: (ctx: ToolContext) => async ({ noteA, noteB }: { noteA: string; noteB: string }) => {
    const weight = await getEdgeWeight(ctx.vaultDataDir, noteA, noteB, ctx.vaultPath);
    return textResult({ noteA, noteB, weight: weight ?? null });
  },
};

export const logTraversalTool = {
  name: "log_traversal",
  config: {
    title: "Log traversal",
    description:
      "Records that this session moved from one vault note to another via a " +
      "wikilink, for usage-weighted link ranking. Call this every time you read a " +
      "second, different vault note that you reached by following a link from the " +
      "note you were just looking at — this is what keeps get_weighted_neighbors " +
      "useful over time. Skip it for the very first note read in a session (no 'from').",
    inputSchema: {
      from: z.string().describe("Vault-relative path of the previously read note"),
      to: z.string().describe("Vault-relative path of the note just read"),
    },
  },
  handler: (ctx: ToolContext) => async ({ from, to }: { from: string; to: string }) => {
    await ctx.client.logTraversal(from, to);
    return textResult({ logged: true, from, to });
  },
};

export const reinforceLinkTool = {
  name: "reinforce_link",
  config: {
    title: "Reinforce link",
    description:
      "Explicitly signals that a link between two notes was useful for the current task, " +
      "boosting its weight beyond ordinary traversal-on-read tracking. Use this when a " +
      "linked note materially helped answer the user's question, not for incidental reads.",
    inputSchema: {
      from: z.string().describe("Vault-relative note path, without .md extension"),
      to: z.string().describe("Vault-relative note path, without .md extension"),
      boost: z.number().positive().optional().describe("Reinforcement strength (default 5)"),
    },
  },
  handler: (ctx: ToolContext) => async ({ from, to, boost }: { from: string; to: string; boost?: number }) => {
    await ctx.client.reinforce(from, to, boost);
    return textResult({ reinforced: true, from, to, boost: boost ?? 5 });
  },
};

export const compactWeightsTool = {
  name: "compact_weights",
  config: {
    title: "Compact weights",
    description:
      "Forces an immediate compaction of pending traversal/reinforcement events into " +
      "link-weights.json, instead of waiting for the nightly scheduled compaction. Useful " +
      "when a just-called reinforce_link or recent reads should be reflected right away.",
    inputSchema: {},
  },
  handler: (ctx: ToolContext) => async () => {
    const result = await ctx.client.compact();
    return textResult(result);
  },
};

function isTemplatePath(notePath: string): boolean {
  return notePath === "Templates" || notePath.startsWith("Templates/");
}

async function writeAndSync(
  ctx: ToolContext,
  notePath: string,
  frontmatter: Record<string, unknown>,
  body: string,
  action: "create" | "update",
) {
  // Templates/ are placeholders, not real notes — skip auto-link/changelog
  // for them, same exclusion the replaced PowerShell hook applied.
  if (isTemplatePath(notePath)) {
    await writeNote(ctx.vaultPath, notePath, { frontmatter, body });
    return { path: notePath, autoLinked: [] };
  }

  // Auto-link scan only ever touches the body (it inserts/reads the
  // "## Related (auto-linked)" heading there), so run it before the single
  // write rather than writing twice.
  const linked = await autoLinkScan(ctx.vaultPath, notePath, body);
  await writeNote(ctx.vaultPath, notePath, { frontmatter, body: linked.content });

  await appendChangelogEntry(ctx.vaultPath, {
    action,
    file: `${notePath}.md`,
    reason: "Written via vault-neural-link MCP.",
  });

  return { path: notePath, autoLinked: linked.added };
}

export const createNoteTool = {
  name: "create_note",
  config: {
    title: "Create note",
    description:
      "Creates a new note in the vault with the given frontmatter and body, then automatically " +
      "runs the auto-link scan and appends a changes.jsonl entry — no separate hook or hand-rolled " +
      "script needed, this works from any MCP client. Fails if a note already exists at this path " +
      "(use update_note instead).",
    inputSchema: {
      path: z.string().describe("Vault-relative note path, without .md extension"),
      frontmatter: z.record(z.string(), z.unknown()).describe("Frontmatter fields (type, created, domain, tags, aliases, etc.)"),
      body: z.string().describe("Note body (markdown, after the frontmatter block)"),
    },
  },
  handler:
    (ctx: ToolContext) =>
    async ({ path, frontmatter, body }: { path: string; frontmatter: Record<string, unknown>; body: string }) => {
      const existing = await readNote(ctx.vaultPath, path);
      if (existing) {
        return textResult({ error: `Note already exists at ${path}. Use update_note instead.` });
      }
      const result = await writeAndSync(ctx, path, frontmatter, body, "create");
      return textResult({ created: true, ...result });
    },
};

export const updateNoteTool = {
  name: "update_note",
  config: {
    title: "Update note",
    description:
      "Updates an existing note — either replacing its body outright, or appending text under a " +
      "heading (creating the heading if absent), matching this vault's '## Updates' / '## Related' " +
      "append-only convention. Then runs the same auto-link/changelog pipeline as create_note.",
    inputSchema: {
      path: z.string().describe("Vault-relative note path, without .md extension"),
      body: z.string().optional().describe("Replacement body. Omit if using appendUnderHeading."),
      appendUnderHeading: z
        .object({
          heading: z.string().describe("Markdown heading line, e.g. '## Updates'"),
          text: z.string().describe("Text to insert under the heading"),
          prepend: z.boolean().optional().describe("Insert immediately after the heading (default true) vs at the section's end"),
        })
        .optional()
        .describe("Append text under a heading instead of replacing the whole body"),
    },
  },
  handler:
    (ctx: ToolContext) =>
    async ({
      path,
      body,
      appendUnderHeading: appendOpts,
    }: {
      path: string;
      body?: string;
      appendUnderHeading?: { heading: string; text: string; prepend?: boolean };
    }) => {
      const existing = await readNote(ctx.vaultPath, path);
      if (!existing) {
        return textResult({ error: `No note found at ${path}. Use create_note instead.` });
      }

      const newBody = appendOpts ? appendUnderHeading(existing.body, appendOpts) : body ?? existing.body;
      const result = await writeAndSync(ctx, path, existing.frontmatter, newBody, "update");
      return textResult({ updated: true, ...result });
    },
};

export const readNoteTool = {
  name: "read_note",
  config: {
    title: "Read note",
    description: "Reads a note's frontmatter and body.",
    inputSchema: {
      path: z.string().describe("Vault-relative note path, without .md extension"),
    },
  },
  handler: (ctx: ToolContext) => async ({ path }: { path: string }) => {
    const note = await readNote(ctx.vaultPath, path);
    return textResult(note ?? { error: `No note found at ${path}` });
  },
};

export const listNotesTool = {
  name: "list_notes",
  config: {
    title: "List notes",
    description: "Lists vault-relative note paths, optionally scoped to a folder. Skips Templates/.",
    inputSchema: {
      folder: z.string().optional().describe("Vault-relative folder to scope the listing to"),
    },
  },
  handler: (ctx: ToolContext) => async ({ folder }: { folder?: string }) => {
    const notes = await listNotes(ctx.vaultPath, { folder });
    return textResult(notes);
  },
};

export const searchNotesTool = {
  name: "search_notes",
  config: {
    title: "Search notes",
    description:
      "Searches note titles, frontmatter aliases, and body content for a query string. When " +
      "useWeights is true (default), blends in the weighted-link graph so frequently-traversed " +
      "notes surface higher among matches — use this before creating a note, to check whether one " +
      "already covers the topic.",
    inputSchema: {
      query: z.string().describe("Text to search for"),
      topK: z.number().int().positive().max(100).optional().describe("Max results to return (default 10)"),
      useWeights: z.boolean().optional().describe("Blend in weighted-link data (default true)"),
    },
  },
  handler:
    (ctx: ToolContext) =>
    async ({ query, topK, useWeights }: { query: string; topK?: number; useWeights?: boolean }) => {
      const hits = await searchNotes(ctx.vaultPath, query, { topK, useWeights, vaultDataDir: ctx.vaultDataDir });
      return textResult(hits);
    },
};

export function makeToolContext(vaultPath: string, instanceId: string): ToolContext {
  return {
    vaultPath,
    vaultDataDir: resolveDataDir(vaultPath),
    client: initInstance(vaultPath, instanceId),
  };
}
