/**
 * Shared word tokenizer for search matching (AIBRAIN-138, notes.ts) and the
 * content index (AIBRAIN-133, contentIndex.ts) — both MUST tokenize
 * identically, since the index only narrows candidates for notes.ts's own
 * matchField to re-check; any divergence here would silently make the
 * index's candidate set wrong (missing real matches) without either side
 * being able to tell.
 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}
