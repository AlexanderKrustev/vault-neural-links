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
      const nodes: SourceNode[] = [];
      for (const path of paths) {
        const note = await readNote(rootPath, path);
        if (note) nodes.push({ id: path, body: note.body });
      }
      return nodes;
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
