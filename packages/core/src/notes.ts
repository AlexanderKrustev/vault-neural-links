import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { parseFrontmatter, serializeNote, type ParsedNote } from "./frontmatter.js";
import { getWeightedNeighbors } from "./query.js";

export interface NoteRef {
  path: string; // vault-relative, without .md extension
  frontmatter: Record<string, unknown>;
  body: string;
}

function toFilePath(vaultPath: string, notePath: string): string {
  const withExt = notePath.endsWith(".md") ? notePath : `${notePath}.md`;
  return join(vaultPath, withExt);
}

function toNotePath(vaultPath: string, filePath: string): string {
  return relative(vaultPath, filePath).replace(/\.md$/, "").split(sep).join("/");
}

export async function readNote(vaultPath: string, notePath: string): Promise<NoteRef | null> {
  try {
    const raw = await readFile(toFilePath(vaultPath, notePath), "utf8");
    const { frontmatter, body } = parseFrontmatter(raw);
    return { path: notePath, frontmatter, body };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export interface WriteNoteResult {
  path: string;
  created: boolean;
  content: string;
}

/**
 * Writes a note's frontmatter+body as-is (whole-file replace). Reports
 * whether the file previously existed, so callers can log create vs update.
 */
export async function writeNote(
  vaultPath: string,
  notePath: string,
  note: ParsedNote,
): Promise<WriteNoteResult> {
  const filePath = toFilePath(vaultPath, notePath);
  const existing = await readNote(vaultPath, notePath);
  const content = serializeNote(note);

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");

  return { path: notePath, created: existing === null, content };
}

export interface AppendUnderHeadingOptions {
  heading: string;
  text: string;
  /** Insert new content immediately after the heading (most-recent-first). Default true. */
  prepend?: boolean;
}

/**
 * Appends text under a heading (creating it at the end of the body if
 * absent), matching the `## Updates` / `## Related` append-only convention
 * used throughout this vault.
 */
export function appendUnderHeading(body: string, opts: AppendUnderHeadingOptions): string {
  const { heading, text, prepend = true } = opts;
  const headingRe = new RegExp(`(^|\\n)(${escapeRegExp(heading)})[ \\t]*\\r?\\n`);
  const match = body.match(headingRe);

  if (!match) {
    const trimmed = body.trimEnd();
    return `${trimmed}\n\n${heading}\n${text}\n`;
  }

  const insertAt = (match.index ?? 0) + match[0].length;
  if (prepend) {
    return body.slice(0, insertAt) + `${text}\n` + body.slice(insertAt);
  }

  // Append at the end of this section (before the next heading or EOF).
  const rest = body.slice(insertAt);
  const nextHeadingIdx = rest.search(/\r?\n#{1,6} /);
  const sectionEnd = nextHeadingIdx === -1 ? rest.length : nextHeadingIdx;
  return (
    body.slice(0, insertAt) +
    rest.slice(0, sectionEnd).replace(/\s*$/, "") +
    `\n${text}\n` +
    rest.slice(sectionEnd)
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface ListNotesOptions {
  folder?: string;
}

export async function listNotes(vaultPath: string, opts: ListNotesOptions = {}): Promise<string[]> {
  const root = opts.folder ? join(vaultPath, opts.folder) : vaultPath;
  const results: string[] = [];

  async function walk(dir: string) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "Templates") continue;
        await walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        results.push(toNotePath(vaultPath, full));
      }
    }
  }

  await walk(root);
  return results.sort();
}

export interface SearchNotesOptions {
  topK?: number;
  vaultDataDir?: string;
  useWeights?: boolean;
}

export interface SearchHit {
  path: string;
  matched: "title" | "alias" | "content";
  weight?: number;
}

/**
 * Text search over note titles, frontmatter aliases, and body content.
 * When vaultDataDir + useWeights are given, blends in weighted-neighbor
 * data so frequently-traversed notes matching the query surface higher.
 */
export async function searchNotes(
  vaultPath: string,
  query: string,
  opts: SearchNotesOptions = {},
): Promise<SearchHit[]> {
  const { topK = 10, vaultDataDir, useWeights = true } = opts;
  const needle = query.toLowerCase();
  const paths = await listNotes(vaultPath);

  const hits: SearchHit[] = [];
  for (const path of paths) {
    const title = path.split("/").pop() ?? path;
    if (title.toLowerCase().includes(needle)) {
      hits.push({ path, matched: "title" });
      continue;
    }

    const note = await readNote(vaultPath, path);
    if (!note) continue;

    const aliases = Array.isArray(note.frontmatter.aliases) ? (note.frontmatter.aliases as string[]) : [];
    if (aliases.some((a) => a.toLowerCase().includes(needle))) {
      hits.push({ path, matched: "alias" });
      continue;
    }

    if (note.body.toLowerCase().includes(needle)) {
      hits.push({ path, matched: "content" });
    }
  }

  if (vaultDataDir && useWeights) {
    // Use each note's strongest edge as a relevance proxy — a heavily
    // traversed/reinforced note is more likely the "real" match among
    // several text hits. Fetched concurrently since each lookup is
    // independent.
    await Promise.all(
      hits.map(async (hit) => {
        const neighbors = await getWeightedNeighbors(vaultDataDir, hit.path, 1, vaultPath);
        hit.weight = neighbors[0]?.weight;
      }),
    );
    hits.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
  }

  return hits.slice(0, topK);
}
