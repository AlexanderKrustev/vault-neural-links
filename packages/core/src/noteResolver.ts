/**
 * Resolving a wikilink target to a real note path, in one place.
 *
 * This rule had grown three intended copies — `buildStructuralIndex`,
 * `citedNotes`, and VNL-056's supersession follow — which is exactly the
 * duplication VNL-034 exists to stop. It is one rule and it matters that all
 * three apply it identically: a link that resolves when the structural graph
 * reads it but not when a citation reads it would mean the two disagree about
 * what the vault says, silently.
 *
 * The rule: an exact path match wins; otherwise a bare `[[Title]]` resolves
 * only when exactly one candidate has that filename. Ambiguity resolves to
 * nothing rather than to a guess — this vault has around twenty notes called
 * "Index", and a wrong resolution is worse than an absent one in every caller.
 *
 * The candidate set is the caller's business, and the three differ on purpose:
 * the structural index resolves against the whole vault, citations resolve
 * only against notes read this session, and supersession resolves against the
 * whole vault again.
 */
export interface NoteResolver {
  /** The note path this target names, or undefined if absent or ambiguous. */
  resolve(target: string): string | undefined;
  /** How many candidates the resolver was built over. */
  readonly size: number;
}

export function createNoteResolver(paths: Iterable<string>): NoteResolver {
  const byPathLower = new Map<string, string>();
  const byTitleLower = new Map<string, string[]>();

  for (const path of paths) {
    byPathLower.set(path.toLowerCase(), path);
    const title = (path.split("/").pop() ?? path).toLowerCase();
    byTitleLower.set(title, [...(byTitleLower.get(title) ?? []), path]);
  }

  return {
    get size() {
      return byPathLower.size;
    },
    resolve(target: string): string | undefined {
      const norm = target.toLowerCase();
      const exact = byPathLower.get(norm);
      if (exact) return exact;

      const titleMatches = byTitleLower.get(norm.split("/").pop() ?? norm);
      return titleMatches?.length === 1 ? titleMatches[0] : undefined;
    },
  };
}
