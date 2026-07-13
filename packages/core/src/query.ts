import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EdgeRecord, LinkWeightsFile, NoteTypeDecayConfig, WeightedNeighbor } from "./types.js";
import { decayWeight, resolveHalfLifeDays } from "./decay.js";
import { parseFrontmatter } from "./frontmatter.js";
import { primingBonus, type SessionBuffer } from "./priming.js";
import { readSupersession } from "./relations.js";

async function loadWeights(vaultDataDir: string): Promise<LinkWeightsFile | null> {
  try {
    const content = await readFile(join(vaultDataDir, "link-weights.json"), "utf8");
    return JSON.parse(content) as LinkWeightsFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}


async function readNoteType(vaultPath: string, notePath: string): Promise<string | undefined> {
  try {
    const raw = await readFile(join(vaultPath, `${notePath}.md`), "utf8");
    const { frontmatter } = parseFrontmatter(raw);
    return typeof frontmatter.type === "string" ? frontmatter.type : undefined;
  } catch {
    return undefined;
  }
}

function daysSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

/**
 * Applies exponential decay to an edge's baseStrength live, based on time
 * elapsed since it was last touched — replaces the old approach of decaying
 * forward at each compaction. `notePath` is the neighboring note whose
 * frontmatter `type` determines the decay tau (structural notes decay
 * slower than situational ones); vaultPath is optional so callers without
 * filesystem access to the vault still get the default tau.
 */
async function liveWeight(
  vaultPath: string | undefined,
  notePath: string,
  record: EdgeRecord,
  now: Date,
  decayConfig?: NoteTypeDecayConfig,
): Promise<number> {
  const noteType = vaultPath ? await readNoteType(vaultPath, notePath) : undefined;
  const halfLifeDays = resolveHalfLifeDays(noteType, decayConfig);
  // consolidatedScore is added undecayed — that's the whole point of the
  // long-term tier: once promoted, it resists the recent tier's decay
  // entirely rather than just decaying more slowly.
  return decayWeight(record.baseStrength, daysSince(record.lastTouched, now), { halfLifeDays }) + record.consolidatedScore;
}

/**
 * Reads link-weights.json and returns top-K neighbors for a note,
 * sorted by weight descending.
 */
/**
 * All of a note's direct neighbors with live-decayed weight applied, in no
 * particular order and with no topK cutoff or supersession lookup — the
 * shared building block for both single-hop retrieval (getWeightedNeighbors)
 * and multi-hop spreading activation (activation.ts), which each need a
 * different slice/decoration of the same raw edge scan.
 */
export async function computeLiveNeighborWeights(
  vaultDataDir: string,
  note: string,
  vaultPath?: string,
  sessionBuffer?: SessionBuffer,
): Promise<WeightedNeighbor[]> {
  const weights = await loadWeights(vaultDataDir);
  if (!weights) return [];

  const now = new Date();
  const neighbors: WeightedNeighbor[] = [];
  for (const [key, record] of Object.entries(weights.edges)) {
    const [a, b] = key.split("|");
    const other = a === note ? b : b === note ? a : undefined;
    if (other === undefined) continue;
    const baseWeight = await liveWeight(vaultPath, other, record, now);
    const weight = sessionBuffer ? baseWeight + primingBonus(other, sessionBuffer) : baseWeight;
    neighbors.push({ path: other, weight, lastTouched: record.lastTouched });
  }

  return neighbors;
}

/**
 * Reads link-weights.json and returns top-K neighbors for a note,
 * sorted by weight descending.
 */
export async function getWeightedNeighbors(
  vaultDataDir: string,
  note: string,
  topK = 10,
  vaultPath?: string,
  sessionBuffer?: SessionBuffer,
): Promise<WeightedNeighbor[]> {
  const neighbors = await computeLiveNeighborWeights(vaultDataDir, note, vaultPath, sessionBuffer);

  neighbors.sort((x, y) => y.weight - x.weight);
  const topNeighbors = neighbors.slice(0, topK);

  // Only checked for the final topK slice, not every candidate edge — a
  // note's usage weight/recency gives no hint it's outdated, so this is the
  // one signal that has to be looked up regardless of how fresh the edge is.
  if (vaultPath) {
    await Promise.all(
      topNeighbors.map(async (neighbor) => {
        neighbor.supersededBy = await readSupersession(vaultPath, neighbor.path);
      }),
    );
  }

  return topNeighbors;
}

export async function getEdgeWeight(
  vaultDataDir: string,
  noteA: string,
  noteB: string,
  vaultPath?: string,
): Promise<number | undefined> {
  const weights = await loadWeights(vaultDataDir);
  if (!weights) return undefined;
  const key = [noteA, noteB].sort().join("|");
  const record = weights.edges[key];
  if (!record) return undefined;
  return liveWeight(vaultPath, noteB, record, new Date());
}
