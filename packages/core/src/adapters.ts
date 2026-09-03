/**
 * AIBRAIN-33: source-adapter interface so the structural (explicit-link)
 * graph builder isn't hardcoded to Obsidian's filesystem+wikilink model.
 * Everything below the structural index — link-weights.json, activation,
 * consolidation, importance, clustering, the MCP tools — already operates
 * on plain note-path strings and knows nothing about Obsidian, so this is
 * the one seam that actually needed abstracting. `createObsidianAdapter`
 * was the first reference implementation; `createOkfAdapter` (AIBRAIN-109)
 * is the second, proving the seam actually holds for a real second source
 * rather than just in theory. A Confluence/Azure-Wiki/Word adapter
 * (AIBRAIN-34) would need to implement `extractExplicitLinkTargets` as a
 * no-op (those sources have no explicit link syntax) and rely on the
 * AI-inference pass that ticket describes instead.
 */
import { extractWikilinks, extractOkfLinks } from "./parser.js";
import { listNotes, readNotesInBatches } from "./notes.js";

export interface SourceNode {
  /** Canonical identifier — a vault-relative path for Obsidian, a page ID/URL for another source. */
  id: string;
  /** Raw text content: scanned for explicit links here, and the basis for keyword search / future AI-inferred edges. */
  body: string;
  /** Frontmatter aliases, if any (AIBRAIN-133) — indexed alongside body/title so alias-only matches are still covered by the content index. */
  aliases: string[];
}

export interface SourceAdapter {
  /** Enumerates every node in the source. */
  listNodes(): Promise<SourceNode[]>;
  /**
   * This node's outgoing explicit link targets, in the source's own raw
   * (unresolved) form — e.g. wikilink target strings for Obsidian.
   * Resolving a raw target to a canonical node id (path/title matching,
   * ambiguity handling) is the structural-index builder's job, not the
   * adapter's, since that resolution logic is source-independent.
   * Returns [] for sources with no explicit link syntax.
   */
  extractExplicitLinkTargets(node: SourceNode): string[];
}

/** Reference implementation: Obsidian's markdown files + `[[wikilinks]]`. */

/**
 * Reads notes in bounded-concurrency batches instead of one at a time —
 * see `readNotesInBatches` in notes.ts, which this and the auto-link scan
 * now share (VNL-012). Notes that could not be read are dropped; a source
 * node with no content contributes nothing to an index.
 */
async function readNodesInBatches(rootPath: string, paths: string[]): Promise<SourceNode[]> {
  const notes = await readNotesInBatches(rootPath, paths);
  const nodes: SourceNode[] = [];
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i];
    if (!note) continue;
    const aliases = Array.isArray(note.frontmatter.aliases) ? (note.frontmatter.aliases as string[]) : [];
    nodes.push({ id: paths[i], body: note.body, aliases });
  }
  return nodes;
}

export function createObsidianAdapter(vaultPath: string): SourceAdapter {
  return {
    async listNodes(): Promise<SourceNode[]> {
      const paths = await listNotes(vaultPath);
      return readNodesInBatches(vaultPath, paths);
    },
    extractExplicitLinkTargets(node: SourceNode): string[] {
      // Dual-syntax: this vault's ~250 existing notes use [[wikilinks]],
      // but auto-generated links (and any manually-converted note) may use
      // OKF-style [label](path.md) links instead — both produce the same
      // structural edges so migration is optional cleanup, not a forced
      // rewrite. See vault "OKF Link Migration Plan" Phase B.
      return [
        ...extractWikilinks(node.body).map((link) => link.target),
        ...extractOkfLinks(node.body).map((link) => link.target),
      ];
    },
  };
}

/**
 * OKF (Open Knowledge Format): plain markdown files + YAML frontmatter +
 * standard markdown links, in a folder that isn't an Obsidian vault (no
 * `.obsidian/`, no wikilink convention assumed). `listNotes`/`readNote`
 * are already source-agnostic filesystem walkers — Obsidian-specific
 * behavior only ever lived in which link syntax gets extracted, so this
 * adapter reuses them unchanged and only swaps that one piece in.
 */
export function createOkfAdapter(rootPath: string): SourceAdapter {
  return {
    async listNodes(): Promise<SourceNode[]> {
      const paths = await listNotes(rootPath);
      return readNodesInBatches(rootPath, paths);
    },
    extractExplicitLinkTargets(node: SourceNode): string[] {
      // Wikilinks tolerated too, not just OKF's own syntax — e.g. notes
      // carried over from an Obsidian vault via AIBRAIN-64's import
      // tooling before/without running the OKF migration script.
      return [
        ...extractOkfLinks(node.body).map((link) => link.target),
        ...extractWikilinks(node.body).map((link) => link.target),
      ];
    },
  };
}
