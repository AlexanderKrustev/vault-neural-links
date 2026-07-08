import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LinkWeightsFile, WeightedNeighbor } from "./types.js";

async function loadWeights(vaultDataDir: string): Promise<LinkWeightsFile | null> {
  try {
    const content = await readFile(join(vaultDataDir, "link-weights.json"), "utf8");
    return JSON.parse(content) as LinkWeightsFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/**
 * Reads link-weights.json and returns top-K neighbors for a note,
 * sorted by weight descending.
 */
export async function getWeightedNeighbors(
  vaultDataDir: string,
  note: string,
  topK = 10,
): Promise<WeightedNeighbor[]> {
  const weights = await loadWeights(vaultDataDir);
  if (!weights) return [];

  const neighbors: WeightedNeighbor[] = [];
  for (const [key, record] of Object.entries(weights.edges)) {
    const [a, b] = key.split("|");
    const other = a === note ? b : b === note ? a : undefined;
    if (other === undefined) continue;
    neighbors.push({ path: other, weight: record.weight, lastTouched: record.lastTouched });
  }

  neighbors.sort((x, y) => y.weight - x.weight);
  return neighbors.slice(0, topK);
}

export async function getEdgeWeight(
  vaultDataDir: string,
  noteA: string,
  noteB: string,
): Promise<number | undefined> {
  const weights = await loadWeights(vaultDataDir);
  if (!weights) return undefined;
  const key = [noteA, noteB].sort().join("|");
  return weights.edges[key]?.weight;
}
