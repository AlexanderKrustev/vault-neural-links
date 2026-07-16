import { z } from "zod";
import {
  appendChangelogEntry,
  appendUnderHeading,
  autoLinkScan,
  DEFAULT_SPREADING_ACTIVATION_CONFIG,
  getEdgeWeight,
  initInstance,
  listNotes,
  readNote,
  resolveDataDir,
  searchNotes,
  writeNote,
  type ActivationTraceEvent,
  type VaultLinkClient,
} from "@vault-neural-links/core";
import type { ActivationSocketServer } from "./activationSocket.js";

export interface ToolContext {
  vaultPath: string;
  vaultDataDir: string;
  client: VaultLinkClient;
  activationSocket?: ActivationSocketServer;
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
    const neighbors = await ctx.client.getWeightedNeighbors(note, topK);
    return textResult(neighbors);
  },
};


export const activateTool = {
  name: "activate",
  config: {
    title: "Activate (spreading activation)",
    description:
      "Spreads activation energy outward from a note across bounded multi-hop neighbors (up to " +
      "maxHops away), so notes only indirectly linked through an intermediate note can surface " +
      "too — unlike get_weighted_neighbors, which only ever sees direct links. A note reachable " +
      "through several indirect routes accumulates energy from each and can outrank one reachable " +
      "through a single weak direct link. Use this when direct neighbors alone seem to be missing " +
      "relevant indirect context. Never returns empty: if fewer than minK notes activate, energy " +
      "thresholds are progressively relaxed and retried; if spreading activation still finds no " +
      "edges at all (usage-weighted or structural), falls back to a keyword/title match over the " +
      "vault, and as a last resort to the most recently touched notes. The whole call is bounded " +
      "by budgetMs — past that, partial activation results are returned instead of blocking, and " +
      "the (relatively expensive) keyword tier is skipped in favor of the cheap recency tier. The " +
      "response's `tier` field reports which of these actually served the result, `relaxations` " +
      "how many times thresholds were relaxed, and `timedOut` whether the budget ran out.",
    inputSchema: {
      note: z.string().describe("Vault-relative note path, without .md extension"),
      energy: z.number().positive().optional().describe("Starting energy at the origin note (default 10)"),
      maxHops: z.number().int().positive().max(3).optional().describe("Max hops from the origin note (default 3)"),
      minThreshold: z.number().positive().optional().describe("Energy cutoff below which propagation/inclusion stops for usage-weighted edges (default 0.5)"),
      structuralMinThreshold: z
        .number()
        .positive()
        .optional()
        .describe("Energy cutoff below which propagation/inclusion stops for structural-only (floor-weight) edges (default 0.05)"),
      minK: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Guaranteed minimum result count to aim for via threshold relaxation before falling through tiers (default 3)"),
      budgetMs: z
        .number()
        .positive()
        .optional()
        .describe("Hard time budget in ms for the whole call, including relaxation retries (default 300)"),
    },
  },
  handler:
    (ctx: ToolContext) =>
    async ({
      note,
      energy,
      maxHops,
      minThreshold,
      structuralMinThreshold,
      minK,
      budgetMs,
    }: {
      note: string;
      energy?: number;
      maxHops?: number;
      minThreshold?: number;
      structuralMinThreshold?: number;
      minK?: number;
      budgetMs?: number;
    }) => {
      const config =
        maxHops !== undefined || minThreshold !== undefined || structuralMinThreshold !== undefined
          ? {
              ...DEFAULT_SPREADING_ACTIVATION_CONFIG,
              ...(maxHops !== undefined && { maxHops }),
              ...(minThreshold !== undefined && { minThreshold }),
              ...(structuralMinThreshold !== undefined && { structuralMinThreshold }),
            }
          : undefined;

      // `trace` is Claude's own audit trail of the retrieval path,
      // independent of whether the Obsidian plugin is listening; the same
      // callback also broadcasts to any connected sockets so both views can
      // never drift apart.
      const trace: ActivationTraceEvent[] = [];
      const result = await ctx.client.retrieveWithFallback(
        note,
        energy,
        config,
        (event) => {
          trace.push(event);
          ctx.activationSocket?.broadcast(event);
        },
        { minK, budgetMs },
      );
      return textResult({
        activated: result.notes,
        tier: result.tier,
        relaxations: result.relaxations,
        timedOut: result.timedOut,
        trace,
      });
    },
};


export const ablationDiffTool = {
  name: "ablation_diff",
  config: {
    title: "Ablation diff",
    description:
      "Runs activate() twice for a note — once with every scoring layer on (baseline) and once " +
      "with the given layers turned off — and returns the diff between the two result sets, so a " +
      "reviewer can see concretely what a layer (session priming, PageRank importance, long-term " +
      "consolidation, or the structural/wikilink floor-weight fallback) actually contributes to " +
      "retrieval, rather than taking the mechanism's existence on faith. `removed` entries only " +
      "activated because of a disabled layer; `added` entries only cleared threshold once that " +
      "layer's contribution was taken out of other neighbors' energy shares; `reranked` entries " +
      "activated in both runs but with a materially different energy.",
    inputSchema: {
      note: z.string().describe("Vault-relative note path, without .md extension"),
      disabledLayers: z
        .object({
          priming: z.boolean().optional(),
          importance: z.boolean().optional(),
          consolidation: z.boolean().optional(),
          structuralFallback: z.boolean().optional(),
        })
        .describe("Which layers to turn off for the ablated run (true = disable that layer). Unset layers stay enabled."),
      energy: z.number().positive().optional().describe("Starting energy at the origin note (default 10)"),
      maxHops: z.number().int().positive().max(3).optional().describe("Max hops from the origin note (default 3)"),
      minThreshold: z.number().positive().optional().describe("Energy cutoff below which propagation/inclusion stops for usage-weighted edges (default 0.5)"),
      structuralMinThreshold: z
        .number()
        .positive()
        .optional()
        .describe("Energy cutoff below which propagation/inclusion stops for structural-only (floor-weight) edges (default 0.05)"),
    },
  },
  handler:
    (ctx: ToolContext) =>
    async ({
      note,
      disabledLayers,
      energy,
      maxHops,
      minThreshold,
      structuralMinThreshold,
    }: {
      note: string;
      disabledLayers: { priming?: boolean; importance?: boolean; consolidation?: boolean; structuralFallback?: boolean };
      energy?: number;
      maxHops?: number;
      minThreshold?: number;
      structuralMinThreshold?: number;
    }) => {
      const config =
        maxHops !== undefined || minThreshold !== undefined || structuralMinThreshold !== undefined
          ? {
              ...DEFAULT_SPREADING_ACTIVATION_CONFIG,
              ...(maxHops !== undefined && { maxHops }),
              ...(minThreshold !== undefined && { minThreshold }),
              ...(structuralMinThreshold !== undefined && { structuralMinThreshold }),
            }
          : undefined;

      // The tool's own input convention is "true = disable that layer" (the
      // intuitive reading of a param literally named disabledLayers); core's
      // runAblationComparison instead takes a Partial<AblationLayers> override
      // where you supply the desired (false) state directly, so translate here.
      const layerOverrides = Object.fromEntries(
        Object.entries(disabledLayers)
          .filter(([, disabled]) => disabled === true)
          .map(([layer]) => [layer, false]),
      );

      const result = await ctx.client.runAblationComparison(note, layerOverrides, energy, config);
      return textResult(result);
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
    await ctx.client.logTraversal(from, to, (event) => ctx.activationSocket?.broadcast(event));
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
    await ctx.client.reinforce(from, to, boost, (event) => ctx.activationSocket?.broadcast(event));
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
  handler: (ctx: ToolContext) => async (_args: Record<string, never>) => {
    const result = await ctx.client.compact((event) => ctx.activationSocket?.broadcast(event));
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
