import { compact } from "./compactor.js";
import { buildStructuralIndex, rebuildStructuralIndex } from "./structuralLinks.js";
import { rebuildSeedWeights } from "./seedWeights.js";
import { buildContentIndex, rebuildContentIndex } from "./contentIndex.js";
import {
  DEFAULT_EMBEDDING_NOTE_LIMIT,
  getSharedEmbeddingProvider,
  loadEmbeddings,
  rebuildEmbeddings,
  type EmbeddingProvider,
} from "./embeddings.js";
import { createObsidianAdapter } from "./adapters.js";
import { runNightlyConsolidation } from "./consolidation.js";
import { loadNoteImportance, runImportanceComputation } from "./importance.js";
import { runClusterComputation } from "./clustering.js";
import { pruneStaleInstanceFiles } from "./sessionFiles.js";
import type { ActivationEventSink } from "./types.js";

export interface NightlyRunResult {
  ran: boolean;
  edgeCount?: number;
  promotedCount?: number;
  structuralEdgeCount?: number;
  /** VNL-021 cold-start priors written this run. */
  seedEdgeCount?: number;
  noteCount?: number;
  clusterCount?: number;
  contentIndexTokenCount?: number;
  /** Notes with a stored embedding after this run (VNL-051); absent when the semantic index is off. */
  embeddedNoteCount?: number;
  /** How many of those had to be (re-)embedded this run — 0 on a run where nothing changed. */
  reembeddedCount?: number;
  /** Model that produced them, so a mismatch is visible in the usage report. */
  embeddingModel?: string;
  /** Stale per-instance session/socket files and expired logs removed (VNL-009). */
  prunedFileCount?: number;
  computedAt?: string;
}

/**
 * Runs the same pipeline as bin/vnl-nightly.js, but gated on staleness
 * instead of wall-clock cron. Called from the Obsidian plugin's
 * NightlyScheduler (packages/obsidian-plugin/src/NightlyScheduler.ts) on
 * startup and on a periodic check while Obsidian is open — the sole
 * trigger for this pipeline as of AIBRAIN-46 (no OS scheduled task, no
 * Claude Code / MCP-server-startup trigger). note-importance.json's
 * `computedAt` is the staleness marker because, unlike link-weights.json's
 * `compactedAt`, it's only ever written by this full pipeline — never by
 * the on-demand `compact_weights` tool — so frequent ad-hoc compaction
 * can't mask a stale run, and because it's a persisted file (not
 * in-memory plugin state) the gate survives Obsidian restarts/crashes too.
 */
export interface NightlyEmbeddingOptions {
  /**
   * Tri-state on purpose. `true` builds the semantic index even if the
   * vault has never had one (the opt-in), `false` never builds it, and the
   * default — undefined — refreshes an index that already exists but never
   * creates one. So a vault opts in once, from the plugin's settings or a
   * one-off script, and every subsequent nightly run keeps it current
   * without the caller having to remember the flag.
   */
  enabled?: boolean;
  /** Injected in tests; defaults to the shared provider, which is null when the optional peer is absent. */
  provider?: EmbeddingProvider | null;
  /** Above this note count the index is skipped even when enabled (see DEFAULT_EMBEDDING_NOTE_LIMIT). */
  noteLimit?: number;
}

export async function runNightlyIfStale(
  vaultPath: string,
  vaultDataDir: string,
  staleDays = 1,
  now: Date = new Date(),
  onEvent?: ActivationEventSink,
  embeddingOptions: NightlyEmbeddingOptions = {},
): Promise<NightlyRunResult> {
  const existing = await loadNoteImportance(vaultDataDir);
  if (existing) {
    const ageDays = (now.getTime() - new Date(existing.computedAt).getTime()) / 86_400_000;
    if (ageDays < staleDays) return { ran: false };
  }

  const compaction = await compact(vaultDataDir, onEvent);
  const consolidation = await runNightlyConsolidation(vaultDataDir, undefined, now);

  // AIBRAIN-133: one adapter.listNodes() pass shared between the structural
  // and content indexes, instead of each rebuilding it independently — a
  // real cost at scale (~17s/300k notes, AIBRAIN-131), not worth paying twice
  // in the same pipeline run.
  const adapter = createObsidianAdapter(vaultPath);
  const nodes = await adapter.listNodes();
  const structuralIndex = await buildStructuralIndex(vaultPath, adapter, nodes);
  const structural = await rebuildStructuralIndex(vaultPath, vaultDataDir, adapter, structuralIndex);
  // VNL-021: same shared `nodes` pass; the only extra I/O is one stat() per
  // linked note, so the priors cost a fraction of the index builds either
  // side of them.
  const seeds = await rebuildSeedWeights(vaultPath, vaultDataDir, adapter, nodes, { now });
  const contentIndex = await buildContentIndex(vaultPath, adapter, nodes);
  const contentIndexResult = await rebuildContentIndex(vaultPath, vaultDataDir, adapter, contentIndex);

  // VNL-051: reuses the same `nodes` pass as the two indexes above, and
  // re-embeds only notes whose text changed since the last run — a full
  // vault embed is minutes of CPU, an unchanged one is a hash comparison.
  const embeddings = await runEmbeddingRefresh(vaultDataDir, nodes, embeddingOptions, now);

  const importance = await runImportanceComputation(vaultDataDir, undefined, now);
  const clustering = await runClusterComputation(vaultDataDir, undefined, now);

  // VNL-009: session buffers and socket registrations belonging to MCP
  // instances that did not exit cleanly, plus log files past their retention
  // window. Nothing else deletes these.
  const prune = await pruneStaleInstanceFiles(vaultDataDir, { now });

  return {
    ran: true,
    edgeCount: compaction.edgeCount,
    promotedCount: consolidation.promotedCount,
    structuralEdgeCount: structural.edgeCount,
    seedEdgeCount: seeds.edgeCount,
    noteCount: importance.noteCount,
    clusterCount: clustering.clusterCount,
    contentIndexTokenCount: contentIndexResult.tokenCount,
    ...embeddings,
    prunedFileCount: Object.values(prune.removed).reduce((sum, n) => sum + n, 0),
    computedAt: importance.computedAt,
  };
}

/**
 * The semantic half of the nightly pipeline (VNL-051). Returns the fields
 * to merge into `NightlyRunResult`, or an empty object when the index is
 * off, unavailable, or the vault is too large for a scan-per-query index.
 *
 * Nothing in here is allowed to fail the nightly run: embeddings are an
 * optional retrieval axis, and a missing model or a full disk must not cost
 * the vault its compaction, indexes and importance scores. The failure is
 * silent in the same way the absent package is — the plugin's usage report
 * shows the note count, so "it stopped updating" is visible where a user
 * would look for it.
 */
async function runEmbeddingRefresh(
  vaultDataDir: string,
  nodes: Awaited<ReturnType<ReturnType<typeof createObsidianAdapter>["listNodes"]>>,
  options: NightlyEmbeddingOptions,
  now: Date,
): Promise<Pick<NightlyRunResult, "embeddedNoteCount" | "reembeddedCount" | "embeddingModel">> {
  if (options.enabled === false) return {};

  const existing = await loadEmbeddings(vaultDataDir);
  // The default is "refresh what exists, never create" — see the tri-state
  // note on NightlyEmbeddingOptions.enabled.
  if (!existing && options.enabled !== true) return {};

  if (nodes.length > (options.noteLimit ?? DEFAULT_EMBEDDING_NOTE_LIMIT)) return {};

  const provider = options.provider ?? (await getSharedEmbeddingProvider());
  if (!provider) return {};

  try {
    const result = await rebuildEmbeddings(vaultDataDir, nodes, provider, { existing, now });
    return {
      embeddedNoteCount: result.noteCount,
      reembeddedCount: result.embeddedCount,
      embeddingModel: result.model,
    };
  } catch {
    return {};
  }
}
