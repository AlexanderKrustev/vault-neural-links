import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { parseFrontmatter, serializeNote, type ParsedNote } from "./frontmatter.js";
import { getWeightedNeighbors } from "./query.js";
import { readSupersession } from "./relations.js";

// See searchNotes' weight-scoring step: caps how many textual hits get a
// disk-backed weight lookup, and how many of those run concurrently, so a
// broad query against a huge vault can't fan out into thousands of
// concurrent file reads (AIBRAIN-132).
const WEIGHT_SCORE_CAP = 500;
const WEIGHT_SCORE_CONCURRENCY = 25;
// Stopgap only — still an O(n) full-vault content scan on every search with
// no actual content index behind it (only note titles/links are indexed).
// Measured against sample-okf-large's 300k notes: 203s at concurrency 50,
// 129.5s at 250 — sublinear improvement, confirming the bottleneck is total
// disk/CPU work (reading + parsing every note), not descriptor-count, so
// pushing this constant further has diminishing returns (and risks EMFILE
// again at very high concurrency). A real fix needs a persisted content
// index, tracked separately rather than tuned here (AIBRAIN-133 follow-up).
const CONTENT_SCAN_CONCURRENCY = 250;

export interface NoteRef {
  path: string; // vault-relative, without .md extension
  frontmatter: Record<string, unknown>;
  body: string;
}

export function toFilePath(vaultPath: string, notePath: string): string {
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

export interface RecentNote {
  path: string;
  mtime: string;
}

/**
 * Notes sorted by file mtime, most recent first. Last-resort retrieval
 * fallback when a note has neither usage/structural edges nor a keyword
 * match — mtime is used rather than a frontmatter field since the vault has
 * no universal "updated" schema, but every note has a filesystem timestamp.
 */
export async function mostRecentNotes(vaultPath: string, topK = 10, exclude?: string): Promise<RecentNote[]> {
  const paths = (await listNotes(vaultPath)).filter((path) => path !== exclude);

  const withMtime = await Promise.all(
    paths.map(async (path) => {
      const stats = await stat(toFilePath(vaultPath, path));
      return { path, mtime: stats.mtime.toISOString() };
    }),
  );

  withMtime.sort((a, b) => (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
  return withMtime.slice(0, topK);
}

export interface SearchNotesOptions {
  topK?: number;
  vaultDataDir?: string;
  useWeights?: boolean;
}

export interface SearchHit {
  path: string;
  matched: "title" | "alias" | "content";
  /**
   * Relevance score used to rank hits (AIBRAIN-139): a match-kind tier
   * (title > alias > content) scaled by phrase-vs-token match quality. This
   * is the primary sort key — usage weight is blended in afterward only as
   * a small tie-breaker, never large enough to cross a tier. Exposed mainly
   * for debugging/tests; callers generally just want ranked order.
   */
  score: number;
  weight?: number;
  /** Set when this note's frontmatter marks it `status: superseded` — see relations.ts. */
  supersededBy?: string;
}

// AIBRAIN-139: previously `hits.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))`
// made usage weight the *only* ranking signal — an exact title match for the
// query could (and did, reproducibly) rank behind an unrelated hub note that
// merely mentioned the query text in passing, because the hub had more
// accumulated traversal weight. Tiers below give match quality the dominant
// say; weight is capped (WEIGHT_TIEBREAK_CAP) so it can only reorder hits
// within the same tier, never promote a weaker match over a stronger one.
const TITLE_TIER = 2000;
const ALIAS_TIER = 500;
const CONTENT_TIER = 100;
const WEIGHT_TIEBREAK_CAP = 10;

// AIBRAIN-138: the query used to be treated as one literal contiguous
// substring, so a query whose words were all present in a note but not
// contiguous (e.g. out of the note's own word order) returned no hits at
// all — indistinguishable from the note not existing. Tokenizing and
// accepting an all-tokens-present match (scored lower than an exact phrase
// match, never higher) fixes that without weakening exact-phrase relevance.
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

interface FieldMatch {
  hit: boolean;
  /** 0 (no match) .. ~1.25 (exact phrase, repeated). Multiply by a tier to rank. */
  quality: number;
}

function matchField(fieldText: string, needle: string, needleTokens: string[]): FieldMatch {
  if (needleTokens.length === 0) return { hit: false, quality: 0 };
  const lower = fieldText.toLowerCase();

  if (needle && lower.includes(needle)) {
    const occurrences = lower.split(needle).length - 1;
    // Small, capped bonus for repetition — a note that says the thing five
    // times is a somewhat better match than one that says it once, but this
    // must never be able to out-rank a title match against a content match.
    return { hit: true, quality: 1 + Math.min(occurrences - 1, 5) * 0.05 };
  }

  if (needleTokens.every((t) => lower.includes(t))) {
    return { hit: true, quality: 0.6 };
  }

  return { hit: false, quality: 0 };
}

/**
 * Text search over note titles, frontmatter aliases, and body content.
 * When vaultDataDir + useWeights are given, blends in weighted-neighbor
 * data as a bounded tie-breaker on top of match relevance (see
 * WEIGHT_TIEBREAK_CAP) so frequently-traversed notes edge out equally
 * relevant ones, without a heavily-used note ever out-ranking a genuinely
 * better textual match.
 */
export async function searchNotes(
  vaultPath: string,
  query: string,
  opts: SearchNotesOptions = {},
): Promise<SearchHit[]> {
  const { topK = 10, vaultDataDir, useWeights = true } = opts;
  const needle = query.toLowerCase();
  const needleTokens = tokenize(query);
  const paths = await listNotes(vaultPath);

  // Text-matching pass, run in bounded concurrent batches rather than one
  // note at a time: a title match is free (no disk read), but anything that
  // needs the alias/content check does a full readNote per path, and doing
  // that strictly sequentially over every note in the vault (no index covers
  // note bodies) made a single search against sample-okf-large (300k notes)
  // take minutes of blocking main-process work with zero feedback — looked
  // exactly like the app had hung. Batches preserve path order (each batch
  // resolves in the order its Promise.all was given), so results are
  // unchanged from a fully sequential scan, just far faster. See AIBRAIN-132.
  async function matchNote(path: string): Promise<SearchHit | null> {
    const title = path.split("/").pop() ?? path;
    const titleMatch = matchField(title, needle, needleTokens);
    if (titleMatch.hit) {
      return { path, matched: "title", score: TITLE_TIER * titleMatch.quality };
    }

    // Title alone didn't satisfy the query — only now pay for a disk read.
    const note = await readNote(vaultPath, path);
    if (!note) return null;

    const aliases = Array.isArray(note.frontmatter.aliases) ? (note.frontmatter.aliases as string[]) : [];
    const aliasMatch = matchField(aliases.join(" "), needle, needleTokens);
    if (aliasMatch.hit) {
      return { path, matched: "alias", score: ALIAS_TIER * aliasMatch.quality };
    }

    const contentMatch = matchField(note.body, needle, needleTokens);
    if (contentMatch.hit) {
      return { path, matched: "content", score: CONTENT_TIER * contentMatch.quality };
    }

    return null;
  }

  const hits: SearchHit[] = [];
  for (let i = 0; i < paths.length; i += CONTENT_SCAN_CONCURRENCY) {
    const batch = paths.slice(i, i + CONTENT_SCAN_CONCURRENCY);
    const batchHits = await Promise.all(batch.map(matchNote));
    for (const hit of batchHits) if (hit) hits.push(hit);
  }

  // Relevance-first: rank by match score before any weight lookup even
  // happens, so the WEIGHT_SCORE_CAP slice below (when a query produces more
  // hits than the cap) keeps the most textually relevant hits rather than an
  // arbitrary prefix in path order.
  hits.sort((a, b) => b.score - a.score);

  if (vaultDataDir && useWeights) {
    // Use each note's strongest edge as a relevance proxy — a heavily
    // traversed/reinforced note is more likely the "real" match among
    // several text hits.
    //
    // Only the first WEIGHT_SCORE_CAP hits are scored, and in bounded
    // batches rather than one giant Promise.all: a broad query against a
    // large vault (e.g. sample-okf-large, 300k notes) can produce thousands
    // of textual hits, but only `topK` (default 10) are ever returned —
    // scoring every hit concurrently was pure waste and the actual cause of
    // a real crash: each getWeightedNeighbors call independently re-reads
    // link-weights.json/note-importance.json/structural-links.json from
    // disk, so thousands of concurrent calls opened thousands of concurrent
    // file handles (EMFILE) and held that many parsed copies of those files
    // in memory at once (OOM). See AIBRAIN-132.
    const scoredHits = hits.length > WEIGHT_SCORE_CAP ? hits.slice(0, WEIGHT_SCORE_CAP) : hits;
    for (let i = 0; i < scoredHits.length; i += WEIGHT_SCORE_CONCURRENCY) {
      const batch = scoredHits.slice(i, i + WEIGHT_SCORE_CONCURRENCY);
      await Promise.all(
        batch.map(async (hit) => {
          const neighbors = await getWeightedNeighbors(vaultDataDir, hit.path, 1, vaultPath);
          hit.weight = neighbors[0]?.weight;
        }),
      );
    }
    // Weight only ever nudges within a tier (capped at WEIGHT_TIEBREAK_CAP,
    // far smaller than the gap between tiers) — see the AIBRAIN-139 comment
    // above for why this replaced sorting on weight alone.
    hits.sort(
      (a, b) =>
        b.score + Math.min(b.weight ?? 0, WEIGHT_TIEBREAK_CAP) - (a.score + Math.min(a.weight ?? 0, WEIGHT_TIEBREAK_CAP)),
    );
  }

  const topHits = hits.slice(0, topK);

  // Only checked for the final topK slice — a note's usage weight/recency
  // gives no hint it's outdated, so this signal has to be looked up
  // regardless of match kind or ranking.
  await Promise.all(
    topHits.map(async (hit) => {
      hit.supersededBy = await readSupersession(vaultPath, hit.path);
    }),
  );

  return topHits;
}
