import { extractWikilinks } from "./parser.js";
import { listNotes, readNotesInBatches, writeNote } from "./notes.js";
import { appendChangelogEntry } from "./changelog.js";

const RELATED_HEADING = "## Related (auto-linked)";
const MIN_TERM_LENGTH = 4;
// Whole [[...]] spans, embeds included — see the `prose` blanking below.
const WIKILINK_SPAN_RE = /!?\[\[[^\]]+\]\]/g;

export interface AutoLinkResult {
  content: string;
  added: string[];
}

interface Candidate {
  path: string;
  title: string;
  terms: string[];
}

/**
 * TS port of the vault's PostToolUse auto-link hook (vault-postwrite.ps1):
 * scans every other note's title + frontmatter aliases for literal
 * mentions in `content`, and appends any not already linked anywhere in
 * the file under a "## Related (auto-linked)" heading. Pure function —
 * caller is responsible for writing the returned content back to disk.
 *
 * Three rules keep the output from turning into noise (VNL-012):
 * a term must uniquely identify one note (a title or alias shared by two
 * notes could not resolve from the bare `[[title]]` this writes); a
 * single-word term must match the note's own casing; and text inside an
 * existing wikilink is not treated as prose.
 */
export async function autoLinkScan(
  vaultPath: string,
  notePath: string,
  content: string,
): Promise<AutoLinkResult> {
  const allPaths = await listNotes(vaultPath);

  // Read candidate notes in bounded-concurrency batches, and fail open
  // per-note (a locked/unreadable file elsewhere in the vault — e.g. a
  // transient OneDrive sync conflict — must not block writing the current
  // note, same as the PowerShell hook it replaces; it stays usable as a
  // title-only candidate). The unbounded `Promise.all` this used to be was
  // the same EMFILE pattern already fixed in search: one note written to a
  // large vault opened every other note at once (VNL-012).
  //
  // The note being written is included here even though it can never be a
  // candidate: its own title and aliases still have to be counted when
  // deciding which terms are ambiguous below.
  const notes = await readNotesInBatches(vaultPath, allPaths);
  const candidates: Candidate[] = allPaths.map((path, i) => {
    const title = path.split("/").pop() ?? path;
    const note = notes[i];
    const aliases = note && Array.isArray(note.frontmatter.aliases) ? (note.frontmatter.aliases as string[]) : [];
    return { path, title, terms: [title, ...aliases] };
  });

  // A term is only linkable when it identifies exactly one note, mirroring
  // the rule buildStructuralIndex() already applies to hand-written
  // wikilinks (structuralLinks.ts): this vault has ~20 notes titled "Index"
  // and several titled "CLAUDE" across project folders, so a bare
  // [[Index]] resolves to whichever one Obsidian guesses. Linking every
  // one of them — which is what this scan used to do — produced 20
  // identical dead links on a single write (VNL-012).
  const owners = new Map<string, Set<string>>();
  const byPathLower = new Map<string, string>();
  for (const { path, terms } of candidates) {
    byPathLower.set(path.toLowerCase(), path);
    for (const term of terms) {
      if (typeof term !== "string" || term.length < MIN_TERM_LENGTH) continue;
      const key = term.toLowerCase();
      const set = owners.get(key) ?? new Set<string>();
      set.add(path);
      owners.set(key, set);
    }
  }

  function soleOwnerOf(term: string): string | undefined {
    const set = owners.get(term.toLowerCase());
    return set?.size === 1 ? [...set][0] : undefined;
  }

  // Which notes the content already links to, resolved the same way a
  // wikilink resolves: an existing [[MOCs/VaultNeuralLinks]] means the note
  // titled "VaultNeuralLinks" is already linked, even though the link text
  // is the path and the candidate's term is the bare title.
  const linkedPaths = new Set<string>();
  for (const { target } of extractWikilinks(content)) {
    const resolved = byPathLower.get(target.toLowerCase()) ?? soleOwnerOf(target.split("/").pop() ?? target);
    if (resolved) linkedPaths.add(resolved);
  }

  // Text inside a wikilink belongs to that link's target, not to this
  // note's prose: a mention of "Jira" inside [[... - Jira Retired ...]] is
  // not the author writing about Jira. Blanked to a space so word
  // boundaries either side still hold.
  const prose = content.replace(WIKILINK_SPAN_RE, " ");

  const added: string[] = [];
  for (const { path, title, terms } of candidates) {
    if (!title || path === notePath) continue;
    if (linkedPaths.has(path)) continue;

    const isMentioned = terms.some((term) => {
      if (typeof term !== "string" || term.length < MIN_TERM_LENGTH) return false;
      // Ambiguous term: some other note answers to it too, so a bare
      // [[term]] would be a guess. Dropped rather than guessed at.
      if (soleOwnerOf(term) !== path) return false;
      // A single-word title is usually a common noun ("Index", "Reports",
      // "Architecture"), and matching it case-insensitively links every
      // note that happens to use the word in prose. Requiring the note's
      // own casing keeps the deliberate mentions and drops the incidental
      // ones. Multi-word terms are specific enough to stay loose.
      const flags = /\s/.test(term) ? "i" : "";
      return new RegExp(`\\b${escapeRegExp(term)}\\b`, flags).test(prose);
    });

    if (isMentioned) added.push(title);
  }

  if (added.length === 0) return { content, added: [] };

  return { content: insertRelatedLinks(content, added), added };
}


/** Templates/ are placeholders, not real notes — skip auto-link/changelog for them. */
export function isTemplatePath(notePath: string): boolean {
  return notePath === "Templates" || notePath.startsWith("Templates/");
}

/**
 * Shared write path for anything that creates/updates a real note: runs the
 * auto-link scan, writes the file once (auto-link only ever touches the
 * body, so scan-then-write avoids a second write), and appends a
 * changes.jsonl entry — the same pipeline the MCP `create_note`/`update_note`
 * tools use, extracted here so the desktop app's note editor (or any future
 * caller) gets identical auto-link/changelog behavior instead of a second,
 * possibly-drifting copy of this logic.
 */
export async function writeNoteWithAutoLink(
  vaultPath: string,
  notePath: string,
  frontmatter: Record<string, unknown>,
  body: string,
  action: "create" | "update",
  /**
   * The existing note's verbatim frontmatter block, for a body-only edit
   * (VNL-003). When given it is re-emitted unchanged and `frontmatter` is
   * used only by callers that inspect it; omit it when the frontmatter is
   * itself being written.
   */
  rawFrontmatter?: string,
): Promise<{ path: string; autoLinked: string[] }> {
  if (isTemplatePath(notePath)) {
    await writeNote(vaultPath, notePath, { frontmatter, body, raw: rawFrontmatter });
    return { path: notePath, autoLinked: [] };
  }

  const linked = await autoLinkScan(vaultPath, notePath, body);
  await writeNote(vaultPath, notePath, { frontmatter, body: linked.content, raw: rawFrontmatter });

  await appendChangelogEntry(vaultPath, {
    action,
    file: `${notePath}.md`,
    reason: "Written via vault-neural-link MCP.",
  });

  return { path: notePath, autoLinked: linked.added };
}

function insertRelatedLinks(content: string, titles: string[]): string {
  const newLines = titles.map((t) => `- [[${t}]]`);

  const headingRe = new RegExp(`(^|\\n)(${escapeRegExp(RELATED_HEADING)})\\r?\\n`);
  const match = content.match(headingRe);
  if (match) {
    const insertAt = (match.index ?? 0) + match[0].length;
    return content.slice(0, insertAt) + `${newLines.join("\n")}\n` + content.slice(insertAt);
  }

  return `${content.trimEnd()}\n\n${RELATED_HEADING}\n${newLines.join("\n")}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export { RELATED_HEADING };
