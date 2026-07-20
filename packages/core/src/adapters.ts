/**
 * AIBRAIN-33: source-adapter interface so the structural (explicit-link)
 * graph builder isn't hardcoded to Obsidian's filesystem+wikilink model.
 * Everything below the structural index — link-weights.json, activation,
 * consolidation, importance, clustering, the MCP tools — already operates
 * on plain note-path strings and knows nothing about Obsidian, so this is
 * the one seam that actually needed abstracting. `createObsidianAdapter`
 * is the reference implementation; a Confluence/Azure-Wiki/Word adapter
 * (AIBRAIN-34) would need to implement `extractExplicitLinkTargets` as a
 * no-op (those sources have no explicit link syntax) and rely on the
 * AI-inference pass that ticket describes instead.
 */
import { extractWikilinks } from "./parser.js";
import { listNotes, readNote } from "./notes.js";

export interface SourceNode {
  /** Canonical identifier — a vault-relative path for Obsidian, a page ID/URL for another source. */
  id: string;
  /** Raw text content: scanned for explicit links here, and the basis for keyword search / future AI-inferred edges. */
  body: string;
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
export function createObsidianAdapter(vaultPath: string): SourceAdapter {
  return {
    async listNodes(): Promise<SourceNode[]> {
      const paths = await listNotes(vaultPath);
      const nodes: SourceNode[] = [];
      for (const path of paths) {
        const note = await readNote(vaultPath, path);
        if (note) nodes.push({ id: path, body: note.body });
      }
      return nodes;
    },
    extractExplicitLinkTargets(node: SourceNode): string[] {
      return extractWikilinks(node.body).map((link) => link.target);
    },
  };
}
