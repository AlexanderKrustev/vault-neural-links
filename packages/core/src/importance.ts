import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ImportanceConfig, ImportanceResult, NoteImportanceFile, StructuralLinksFile } from "./types.js";
import { DEFAULT_IMPORTANCE_CONFIG } from "./types.js";
import { loadStructuralIndex } from "./structuralLinks.js";

const NOTE_IMPORTANCE_FILE_VERSION = 1;
const NOTE_IMPORTANCE_FILE_NAME = "note-importance.json";

/**
 * Standard PageRank over the structural (wikilink) adjacency graph —
 * deliberately not the usage-weighted graph, since the whole point is
 * surfacing hub notes "even when not recently touched" by usage decay.
 * buildStructuralIndex stores each link bidirectionally, so every edge is
 * walked as a reciprocal directed link. Dangling-node mass (a note with no
 * outgoing links) is redistributed uniformly across all nodes each
 * iteration, per the standard formulation — in practice this graph rarely
 * has any, since buildStructuralIndex only adds a node once it has at
 * least one resolved edge.
 */
export function computePageRank(
  structural: StructuralLinksFile,
  config: ImportanceConfig = DEFAULT_IMPORTANCE_CONFIG,
): Record<string, number> {
  const nodes = Object.keys(structural.edges).sort();
  const nodeCount = nodes.length;
  if (nodeCount === 0) return {};

  let scores = new Map<string, number>(nodes.map((node) => [node, 1 / nodeCount]));

  for (let iter = 0; iter < config.iterations; iter++) {
    let danglingMass = 0;
    for (const node of nodes) {
      if ((structural.edges[node] ?? []).length === 0) danglingMass += scores.get(node)!;
    }

    const base = (1 - config.dampingFactor) / nodeCount + (config.dampingFactor * danglingMass) / nodeCount;
    const next = new Map<string, number>(nodes.map((node) => [node, base]));

    for (const node of nodes) {
      const neighbors = structural.edges[node] ?? [];
      if (neighbors.length === 0) continue;
      const share = (config.dampingFactor * scores.get(node)!) / neighbors.length;
      for (const neighbor of neighbors) {
        next.set(neighbor, (next.get(neighbor) ?? 0) + share);
      }
    }

    let delta = 0;
    for (const node of nodes) delta += Math.abs(next.get(node)! - scores.get(node)!);
    scores = next;
    if (delta < config.convergenceTolerance) break;
  }

  return Object.fromEntries(scores);
}

/**
 * Min-max scales raw PageRank mass so the single most-linked note in the
 * vault reads as 1.0 and the least-linked reads as 0 — raw PageRank mass
 * shrinks toward 1/nodeCount as the vault grows, which would make a fixed
 * blendLambda mean something different at every vault size.
 */
export function normalizeImportance(rawScores: Record<string, number>): Record<string, number> {
  const values = Object.values(rawScores);
  if (values.length === 0) return {};
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;
  if (range === 0) return Object.fromEntries(Object.keys(rawScores).map((key) => [key, 0]));
  return Object.fromEntries(Object.entries(rawScores).map(([key, value]) => [key, (value - min) / range]));
}

export async function loadNoteImportance(vaultDataDir: string): Promise<NoteImportanceFile | null> {
  try {
    const content = await readFile(join(vaultDataDir, NOTE_IMPORTANCE_FILE_NAME), "utf8");
    return JSON.parse(content) as NoteImportanceFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function persistNoteImportance(vaultDataDir: string, file: NoteImportanceFile): Promise<void> {
  await mkdir(vaultDataDir, { recursive: true });
  const targetPath = join(vaultDataDir, NOTE_IMPORTANCE_FILE_NAME);
  const tmpPath = join(vaultDataDir, `.${NOTE_IMPORTANCE_FILE_NAME}.${randomUUID()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(file, null, 2), "utf8");
  await rename(tmpPath, targetPath);
}

/**
 * Reads the already-built structural-links.json, computes PageRank over it,
 * and persists the normalized result atomically. Meant to run periodically
 * (see bin/vnl-nightly.js) right after rebuildStructuralIndex, not per
 * query — the ticket's "computed periodically (batch, not per-query)".
 */
export async function runImportanceComputation(
  vaultDataDir: string,
  config: ImportanceConfig = DEFAULT_IMPORTANCE_CONFIG,
  now: Date = new Date(),
): Promise<ImportanceResult> {
  const structural = await loadStructuralIndex(vaultDataDir);
  if (!structural) {
    return { noteCount: 0, computedAt: now.toISOString() };
  }

  const raw = computePageRank(structural, config);
  const normalized = normalizeImportance(raw);
  const file: NoteImportanceFile = {
    version: NOTE_IMPORTANCE_FILE_VERSION,
    computedAt: now.toISOString(),
    scores: normalized,
  };
  await persistNoteImportance(vaultDataDir, file);

  return { noteCount: Object.keys(normalized).length, computedAt: file.computedAt };
}
