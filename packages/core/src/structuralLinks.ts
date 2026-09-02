import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { StructuralLinksFile } from "./types.js";
import { createObsidianAdapter, type SourceAdapter, type SourceNode } from "./adapters.js";

const STRUCTURAL_LINKS_FILE_VERSION = 1;
const STRUCTURAL_LINKS_FILE_NAME = "structural-links.json";

/**
 * Scans every note's raw wikilinks and builds a bidirectional adjacency
 * graph, independent of any usage/traversal history. A wikilink target is
 * only resolved when it uniquely identifies one note — either an exact
 * vault-relative path or an unambiguous title match. Ambiguous titles (this
 * vault has many notes named "Index" or "CLAUDE" across different project
 * folders) are dropped rather than guessed at, since a wrong resolution
 * would silently wire unrelated notes together.
 */
export async function buildStructuralIndex(
  vaultPath: string,
  adapter: SourceAdapter = createObsidianAdapter(vaultPath),
  prebuiltNodes?: SourceNode[],
): Promise<StructuralLinksFile> {
  // AIBRAIN-133: accepts an already-fetched node list so a caller building
  // both this and the content index in the same pass (nightlyScheduler.ts)
  // doesn't pay for adapter.listNodes() twice — at 300k-note scale that's a
  // real, previously-measured cost (~17s, AIBRAIN-131), not a rounding error.
  const nodes = prebuiltNodes ?? (await adapter.listNodes());

  const byPathLower = new Map<string, string>();
  const byTitleLower = new Map<string, string[]>();
  for (const node of nodes) {
    byPathLower.set(node.id.toLowerCase(), node.id);
    const title = (node.id.split("/").pop() ?? node.id).toLowerCase();
    byTitleLower.set(title, [...(byTitleLower.get(title) ?? []), node.id]);
  }

  function resolveTarget(target: string): string | undefined {
    const norm = target.toLowerCase();
    const exact = byPathLower.get(norm);
    if (exact) return exact;

    const titleKey = norm.split("/").pop() ?? norm;
    const titleMatches = byTitleLower.get(titleKey);
    return titleMatches?.length === 1 ? titleMatches[0] : undefined;
  }

  const adjacency = new Map<string, Set<string>>();
  function addEdge(a: string, b: string): void {
    if (a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }

  for (const node of nodes) {
    for (const target of adapter.extractExplicitLinkTargets(node)) {
      const resolved = resolveTarget(target);
      if (resolved) addEdge(node.id, resolved);
    }
  }

  const edges: Record<string, string[]> = {};
  for (const [path, neighbors] of adjacency) {
    edges[path] = [...neighbors].sort();
  }

  return { version: STRUCTURAL_LINKS_FILE_VERSION, builtAt: new Date().toISOString(), edges };
}

export async function loadStructuralIndex(vaultDataDir: string): Promise<StructuralLinksFile | null> {
  try {
    const content = await readFile(join(vaultDataDir, STRUCTURAL_LINKS_FILE_NAME), "utf8");
    return JSON.parse(content) as StructuralLinksFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function persistStructuralIndex(vaultDataDir: string, index: StructuralLinksFile): Promise<void> {
  await mkdir(vaultDataDir, { recursive: true });
  const targetPath = join(vaultDataDir, STRUCTURAL_LINKS_FILE_NAME);
  const tmpPath = join(vaultDataDir, `.${STRUCTURAL_LINKS_FILE_NAME}.${randomUUID()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(index, null, 2), "utf8");
  await rename(tmpPath, targetPath);
}

/** Rebuilds the structural index from scratch and persists it atomically. */
export async function rebuildStructuralIndex(
  vaultPath: string,
  vaultDataDir: string,
  adapter: SourceAdapter = createObsidianAdapter(vaultPath),
  prebuiltIndex?: StructuralLinksFile,
): Promise<{ noteCount: number; edgeCount: number; builtAt: string }> {
  // Accepts an already-built index so a caller that needed one anyway
  // (e.g. the desktop app's workspace:load-folder, which builds one for
  // its own summary) doesn't pay for a second full buildStructuralIndex()
  // pass just to get this one persisted — at real-vault scale that's
  // invisible, but at a synthetic 300k-note corpus it was a needless
  // extra ~13s and ~150MB of peak RSS on top of an already memory-heavy
  // operation (see AIBRAIN-118).
  const index = prebuiltIndex ?? (await buildStructuralIndex(vaultPath, adapter));
  await persistStructuralIndex(vaultDataDir, index);
  return { noteCount: Object.keys(index.edges).length, edgeCount: countEdges(index), builtAt: index.builtAt };
}

function countEdges(index: StructuralLinksFile): number {
  let total = 0;
  for (const neighbors of Object.values(index.edges)) total += neighbors.length;
  return total / 2;
}
