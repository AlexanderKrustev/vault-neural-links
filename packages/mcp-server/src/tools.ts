import { z } from "zod";
import {
  appendChangelogEntry,
  appendUnderHeading,
  AUTO_REINFORCE_BOOST,
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
  /**
   * Path of the last note read via read_note in this session, used to
   * auto-log traversal edges on the next read_note call. One MCP server
   * process backs one session (see mcp-server/src/index.ts), so this is
   * safe as plain mutable state rather than something keyed by client id.
   */
  lastReadNote?: string;
  /**
   * Notes that surfaced in this session's most recent activate() /
   * get_weighted_neighbors() result, mapped to the note that was queried to
   * retrieve them (AIBRAIN-71). If one of these is then actually opened via
   * read_note, that's a deterministic "this retrieval result got acted on"
   * signal, so it's auto-reinforced — no LLM has to notice and decide to
   * call a reinforcement tool. Overwritten wholesale on each new retrieval call
   * (last retrieval wins) and consumed (deleted) on credit, same
   * process-lifetime-only scope as lastReadNote.
   */
  pendingRetrievals: Map<string, string>;
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
    ctx.pendingRetrievals = new Map(neighbors.map((n) => [n.path, note]));
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
      ctx.pendingRetrievals = new Map(result.notes.map((n) => [n.path, note]));
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
      "Records that this session moved from one vault note to another via a wikilink, for usage-weighted " +
      "link ranking. read_note already logs this automatically between consecutive notes read in the same " +
      "session (AIBRAIN-68/71 analysis found this manual path was rarely if ever the thing actually credit " +
      "edges in practice) — reach for this tool only for the narrow remaining case a read_note pair can't " +
      "cover: crediting an edge whose target note's content was already known and so was never re-read. " +
      "This is a deliberate manual override, not a routine step to remember after every hop.",
    inputSchema: {
      from: z.string().describe("Vault-relative path of the previously read note"),
      to: z.string().describe("Vault-relative path of the note just read"),
    },
  },
  handler: (ctx: ToolContext) => async ({ from, to }: { from: string; to: string }) => {
    await ctx.client.logTraversal(from, to, (event) => ctx.activationSocket?.broadcast(event), "manual");
    return textResult({ logged: true, from, to });
  },
};

// reinforce_link tool removed (AIBRAIN-66/AIBRAIN-69 follow-up, 2026-08-21):
// per the MCP Tool Decision-Delegation Audit (2026-08-16), it had zero real
// invocations ever across months of production usage — the whole tool
// required an LLM to notice, mid-turn, that a link "materially helped" and
// decide to call it, with no deterministic trigger and no fallback if it
// didn't. Investigating a calibration fix (packages/core/scripts/
// benchmark-reinforcement.mjs) additionally found it was miscalibrated
// badly enough that two calls could force any note to rank #1 regardless
// of topical relevance. Deterministic auto-reinforcement (AUTO_REINFORCE_BOOST,
// see pendingRetrievals below) already covers the case that mattered —
// reading a note that was actually surfaced by a retrieval call this
// session — without needing an LLM decision at all. client.reinforce()
// itself stays in core, still used internally by that auto-reinforce path.

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
    if (note) {
      // Auto-log traversal: this is what used to require the caller to
      // separately invoke log_traversal after every second read. Doing it
      // here means usage weights accrue just from normal MCP-mediated
      // reading, with no separate call to remember.
      const from = ctx.lastReadNote;
      if (from && from !== path) {
        await ctx.client.logTraversal(from, path, (event) => ctx.activationSocket?.broadcast(event), "read");
      }
      ctx.lastReadNote = path;

      // Auto-reinforce (AIBRAIN-71): this note surfaced in the session's most
      // recent retrieval call and is now actually being read — a
      // deterministic "this retrieval result got acted on" signal, credited
      // once per retrieval (deleted from the map on credit) so re-reading
      // the same note doesn't double-count it.
      const origin = ctx.pendingRetrievals.get(path);
      if (origin && origin !== path) {
        await ctx.client.reinforce(origin, path, AUTO_REINFORCE_BOOST, (event) => ctx.activationSocket?.broadcast(event), "auto-retrieval");
        ctx.pendingRetrievals.delete(path);
      }
    }
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
      // Shallow-exposure priming only, same tier as get_weighted_neighbors —
      // surfacing in a result list is not the deeper engagement read_note /
      // log_traversal represent, so this must never persist as a weight.
      if (hits.length > 0) await ctx.client.touch(...hits.map((h) => h.path));
      // AIBRAIN-70: unconditional persisted trace of the search itself,
      // regardless of whether anything was found or acted on.
      await ctx.client.logSearch(query, hits.length, useWeights ?? true);
      // A search result is a retrieval too — if one of these gets actually
      // read next, that's the same "acted on" signal AIBRAIN-71 credits for
      // activate()/get_weighted_neighbors() results. There's no single
      // "origin" note for a text query the way there is for a note-relative
      // retrieval, so this pending set has no meaningful reinforcement
      // source note and is intentionally left out of pendingRetrievals.
      return textResult(hits);
    },
};

export function makeToolContext(vaultPath: string, instanceId: string): ToolContext {
  return {
    vaultPath,
    vaultDataDir: resolveDataDir(vaultPath),
    client: initInstance(vaultPath, instanceId),
    pendingRetrievals: new Map(),
  };
}
