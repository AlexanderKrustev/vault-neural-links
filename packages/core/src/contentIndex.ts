import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ContentIndexFile } from "./types.js";
import { createObsidianAdapter, type SourceAdapter, type SourceNode } from "./adapters.js";
import { tokenize } from "./tokenize.js";

const CONTENT_INDEX_FILE_VERSION = 1;
const CONTENT_INDEX_FILE_NAME = "content-index.json";

/**
 * Scans every note's title, frontmatter aliases, and body via the source
 * adapter (AIBRAIN-33's existing seam — already batched/scale-tested at
 * 300k notes for AIBRAIN-118) and builds a token -> note-paths inverted
 * index. One Set per token while building (dedup is cheap); serialized to
 * sorted arrays for a deterministic, diff-friendly persisted file.
 */
export async function buildContentIndex(
  vaultPath: string,
  adapter: SourceAdapter = createObsidianAdapter(vaultPath),
  prebuiltNodes?: SourceNode[],
): Promise<ContentIndexFile> {
  // Accepts an already-fetched node list so a caller building both this and
  // the structural index in the same pass (nightlyScheduler.ts) doesn't pay
  // for adapter.listNodes() twice — same reasoning as buildStructuralIndex's
  // own prebuiltNodes param.
  const nodes = prebuiltNodes ?? (await adapter.listNodes());
  const postings = new Map<string, Set<string>>();

  function indexField(path: string, text: string): void {
    for (const token of tokenize(text)) {
      let paths = postings.get(token);
      if (!paths) {
        paths = new Set();
        postings.set(token, paths);
      }
      paths.add(path);
    }
  }

  for (const node of nodes) {
    const title = node.id.split("/").pop() ?? node.id;
    indexField(node.id, title);
    indexField(node.id, node.aliases.join(" "));
    indexField(node.id, node.body);
  }

  const postingsRecord: Record<string, string[]> = {};
  for (const [token, paths] of postings) {
    postingsRecord[token] = [...paths].sort();
  }

  return {
    version: CONTENT_INDEX_FILE_VERSION,
    builtAt: new Date().toISOString(),
    coveredPaths: nodes.map((n) => n.id).sort(),
    postings: postingsRecord,
  };
}

export async function loadContentIndex(vaultDataDir: string): Promise<ContentIndexFile | null> {
  try {
    const content = await readFile(join(vaultDataDir, CONTENT_INDEX_FILE_NAME), "utf8");
    return JSON.parse(content) as ContentIndexFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function persistContentIndex(vaultDataDir: string, index: ContentIndexFile): Promise<void> {
  await mkdir(vaultDataDir, { recursive: true });
  const targetPath = join(vaultDataDir, CONTENT_INDEX_FILE_NAME);
  const tmpPath = join(vaultDataDir, `.${CONTENT_INDEX_FILE_NAME}.${randomUUID()}.tmp`);
  // Compact, not pretty-printed like structural-links.json — this file can
  // be far larger (a token->paths entry per unique word across every note's
  // title/aliases/body, at real-vault-to-300k-note scale), and nothing
  // hand-edits it, so the 2-4x size a `null, 2` indent adds is pure waste.
  await writeFile(tmpPath, JSON.stringify(index), "utf8");
  await rename(tmpPath, targetPath);
}

/** Rebuilds the content index from scratch and persists it atomically. */
export async function rebuildContentIndex(
  vaultPath: string,
  vaultDataDir: string,
  adapter?: SourceAdapter,
  prebuiltIndex?: ContentIndexFile,
): Promise<{ noteCount: number; tokenCount: number; builtAt: string }> {
  const index = prebuiltIndex ?? (await buildContentIndex(vaultPath, adapter));
  await persistContentIndex(vaultDataDir, index);
  return { noteCount: index.coveredPaths.length, tokenCount: Object.keys(index.postings).length, builtAt: index.builtAt };
}

/**
 * Candidate note paths that could possibly match every one of
 * `needleTokens` — the intersection of each token's postings, since
 * searchNotes's "all tokens present" match (AIBRAIN-138) requires every
 * token to appear somewhere in the note, and an exact-phrase match is a
 * strict subset of that (a note containing the phrase necessarily contains
 * every token in it). A guaranteed superset of true matches: matchField()
 * still re-derives the real tier/quality from live content, this only
 * narrows what's worth reading. Returns an empty set (not null) when
 * `needleTokens` is non-empty but nothing in the index satisfies all of
 * them — a real, useful answer, distinct from "no index available."
 */
export function candidatesFromIndex(index: ContentIndexFile, needleTokens: string[]): Set<string> {
  if (needleTokens.length === 0) return new Set();

  // Intersect rarest-token-first: a token that appears in far fewer notes
  // gives a much smaller starting set to filter subsequent tokens against,
  // and if it's the query's most selective term the intersection can only
  // shrink from there. Doesn't help when every token is common (a corpus
  // with heavily repeated vocabulary can still leave a large surviving
  // candidate set no ordering fixes — see AIBRAIN-133's follow-up notes),
  // but costs nothing and is strictly better than query order otherwise.
  const byRarity = [...needleTokens].sort(
    (a, b) => (index.postings[a]?.length ?? 0) - (index.postings[b]?.length ?? 0),
  );

  let result: Set<string> = new Set(index.postings[byRarity[0]] ?? []);
  for (let i = 1; i < byRarity.length && result.size > 0; i++) {
    const postings = new Set(index.postings[byRarity[i]] ?? []);
    const intersection: Set<string> = new Set();
    for (const path of result) {
      if (postings.has(path)) intersection.add(path);
    }
    result = intersection;
  }
  return result;
}
