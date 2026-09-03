import { extractWikilinks } from "./parser.js";
import { listNotes, readNote, writeNote } from "./notes.js";
import { appendChangelogEntry } from "./changelog.js";

const RELATED_HEADING = "## Related (auto-linked)";
const MIN_TERM_LENGTH = 4;

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
 * Only terms that uniquely identify one note are linked; a title or alias
 * shared by two or more notes is skipped, because the bare `[[title]]` this
 * writes could not resolve to a specific one (VNL-012).
 */
export async function autoLinkScan(
  vaultPath: string,
  notePath: string,
  content: string,
): Promise<AutoLinkResult> {
  const allPaths = await listNotes(vaultPath);

  // Read all candidate notes concurrently, and fail open per-note (a
  // locked/unreadable file elsewhere in the vault — e.g. a transient
  // OneDrive sync conflict — must not block writing the current note,
  // same as the PowerShell hook it replaces).
  //
  // The note being written is included here even though it can never be a
  // candidate: its own title and aliases still have to be counted when
  // deciding which terms are ambiguous below.
  const candidates: Candidate[] = await Promise.all(
    allPaths.map(async (path) => {
      const title = path.split("/").pop() ?? path;
      let aliases: string[] = [];
      try {
        const note = await readNote(vaultPath, path);
        aliases = note && Array.isArray(note.frontmatter.aliases) ? (note.frontmatter.aliases as string[]) : [];
      } catch {
        // Unreadable note — still usable as a title-only candidate.
      }
      return { path, title, terms: [title, ...aliases] };
    }),
  );

  // A term is only linkable when it identifies exactly one note, mirroring
  // the rule buildStructuralIndex() already applies to hand-written
  // wikilinks (structuralLinks.ts): this vault has ~20 notes titled "Index"
  // and several titled "CLAUDE" across project folders, so a bare
  // [[Index]] resolves to whichever one Obsidian guesses. Linking every
  // one of them — which is what this scan used to do — produced 20
  // identical dead links on a single write (VNL-012).
  const owners = new Map<string, Set<string>>();
  for (const { path, terms } of candidates) {
    for (const term of terms) {
      if (typeof term !== "string" || term.length < MIN_TERM_LENGTH) continue;
      const key = term.toLowerCase();
      const set = owners.get(key) ?? new Set<string>();
      set.add(path);
      owners.set(key, set);
    }
  }

  const existingTargets = new Set(extractWikilinks(content).map((link) => link.target.toLowerCase()));

  const added: string[] = [];
  for (const { path, title, terms } of candidates) {
    if (!title || path === notePath) continue;
    const alreadyLinked = terms.some((term) => existingTargets.has(term.toLowerCase()));
    if (alreadyLinked) continue;

    const isMentioned = terms.some((term) => {
      if (typeof term !== "string" || term.length < MIN_TERM_LENGTH) return false;
      // Ambiguous term: some other note answers to it too, so a bare
      // [[term]] would be a guess. Dropped rather than guessed at.
      if (owners.get(term.toLowerCase())?.size !== 1) return false;
      const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`, "i");
      return pattern.test(content);
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
): Promise<{ path: string; autoLinked: string[] }> {
  if (isTemplatePath(notePath)) {
    await writeNote(vaultPath, notePath, { frontmatter, body });
    return { path: notePath, autoLinked: [] };
  }

  const linked = await autoLinkScan(vaultPath, notePath, body);
  await writeNote(vaultPath, notePath, { frontmatter, body: linked.content });

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
