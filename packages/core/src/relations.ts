import { readFile } from "node:fs/promises";
import { extractWikilinks } from "./parser.js";
import { parseFrontmatter } from "./frontmatter.js";
import { resolveNoteFile } from "./vaultPaths.js";

/**
 * Resolves a note's `superseded_by` frontmatter value to a target note path.
 * Accepts either wikilink form (`[[Target]]`, `[[Target|Alias]]`) — the
 * shape the vault-memory skill actually writes — or a bare path/string.
 * Returns undefined unless `status: superseded` is also set, since a
 * `superseded_by` value on its own (e.g. left over from a prior edit)
 * shouldn't be treated as a live "this note is outdated" signal.
 */
export function resolveSupersededBy(frontmatter: Record<string, unknown>): string | undefined {
  if (frontmatter.status !== "superseded") return undefined;

  const raw = frontmatter.superseded_by;
  if (typeof raw !== "string" || !raw.trim()) return undefined;

  const [link] = extractWikilinks(raw);
  return link ? link.target : raw.trim();
}

/**
 * Reads a note's frontmatter straight off disk and resolves its
 * supersession target, if any. Separate from notes.ts's readNote so
 * callers that only need this one signal (query.ts's per-neighbor check)
 * don't have to pull in the full NoteRef shape.
 */
export async function readSupersession(vaultPath: string, notePath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(resolveNoteFile(vaultPath, notePath), "utf8");
    const { frontmatter } = parseFrontmatter(raw);
    return resolveSupersededBy(frontmatter);
  } catch {
    return undefined;
  }
}
