import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ClusteringConfig, ClusteringResult, NoteClustersFile, StructuralLinksFile } from "./types.js";
import { DEFAULT_CLUSTERING_CONFIG } from "./types.js";
import { loadStructuralIndex } from "./structuralLinks.js";

const NOTE_CLUSTERS_FILE_VERSION = 1;
const NOTE_CLUSTERS_FILE_NAME = "note-clusters.json";
const MAX_LOCAL_MOVING_PASSES = 100;

interface WeightedGraph {
  nodes: string[];
  adj: Map<string, Map<string, number>>;
}

function buildWeightedGraph(structural: StructuralLinksFile): WeightedGraph {
  const nodes = Object.keys(structural.edges).sort();
  const adj = new Map<string, Map<string, number>>(nodes.map((node) => [node, new Map<string, number>()]));
  for (const node of nodes) {
    for (const neighbor of structural.edges[node] ?? []) {
      if (!adj.has(neighbor)) continue;
      const row = adj.get(node)!;
      row.set(neighbor, (row.get(neighbor) ?? 0) + 1);
    }
  }
  return { nodes, adj };
}

/**
 * One pass of Louvain's local-moving phase: repeatedly reassigns each node
 * to whichever neighboring community maximizes modularity gain, until no
 * node moves or MAX_LOCAL_MOVING_PASSES is hit. Uses the standard
 * ΔQ ∝ k_i,in - resolution * Σtot(C) * k_i / 2m comparison — additive
 * constants that don't vary across candidate communities are dropped since
 * only the relative ranking matters here.
 */
function localMoving(graph: WeightedGraph, resolution: number): Map<string, string> {
  const { nodes, adj } = graph;
  const degree = new Map<string, number>();
  let m2 = 0;
  for (const node of nodes) {
    let d = 0;
    for (const w of adj.get(node)!.values()) d += w;
    degree.set(node, d);
    m2 += d;
  }

  const community = new Map<string, string>(nodes.map((n) => [n, n]));
  if (m2 === 0) return community;

  const communityDegree = new Map<string, number>(nodes.map((n) => [n, degree.get(n)!]));

  let improved = true;
  let pass = 0;
  while (improved && pass < MAX_LOCAL_MOVING_PASSES) {
    improved = false;
    pass++;
    for (const node of nodes) {
      const currentCommunity = community.get(node)!;
      const nodeDegree = degree.get(node)!;

      communityDegree.set(currentCommunity, communityDegree.get(currentCommunity)! - nodeDegree);

      const neighborCommunityWeights = new Map<string, number>();
      for (const [neighbor, weight] of adj.get(node)!) {
        if (neighbor === node) continue;
        const c = community.get(neighbor)!;
        neighborCommunityWeights.set(c, (neighborCommunityWeights.get(c) ?? 0) + weight);
      }

      let bestCommunity = currentCommunity;
      let bestGain =
        (neighborCommunityWeights.get(currentCommunity) ?? 0) -
        (resolution * (communityDegree.get(currentCommunity) ?? 0) * nodeDegree) / m2;

      for (const [candidate, kIn] of neighborCommunityWeights) {
        if (candidate === currentCommunity) continue;
        const gain = kIn - (resolution * (communityDegree.get(candidate) ?? 0) * nodeDegree) / m2;
        if (gain > bestGain) {
          bestGain = gain;
          bestCommunity = candidate;
        }
      }

      community.set(node, bestCommunity);
      communityDegree.set(bestCommunity, (communityDegree.get(bestCommunity) ?? 0) + nodeDegree);
      if (bestCommunity !== currentCommunity) improved = true;
    }
  }

  return community;
}

/** Collapses each community from a local-moving pass into a single super-node for the next level. */
function aggregateGraph(graph: WeightedGraph, community: Map<string, string>): WeightedGraph {
  const nodes = Array.from(new Set(community.values())).sort();
  const adj = new Map<string, Map<string, number>>(nodes.map((n) => [n, new Map<string, number>()]));
  for (const node of graph.nodes) {
    const cNode = community.get(node)!;
    for (const [neighbor, weight] of graph.adj.get(node)!) {
      const cNeighbor = community.get(neighbor)!;
      const row = adj.get(cNode)!;
      row.set(cNeighbor, (row.get(cNeighbor) ?? 0) + weight);
    }
  }
  return { nodes, adj };
}

/**
 * Multi-level Louvain community detection over the structural (wikilink)
 * graph, mirroring computePageRank's structure in importance.ts: standard
 * algorithm, hand-rolled rather than pulling in a graph library for a single
 * batch job. Runs local-moving + aggregation levels until a level produces
 * no further merging (every node still its own community) or maxLevels is
 * hit, then composes each level's assignment back onto the original nodes.
 */
export function runLouvain(
  structural: StructuralLinksFile,
  config: ClusteringConfig = DEFAULT_CLUSTERING_CONFIG,
): Record<string, string> {
  const nodes = Object.keys(structural.edges).sort();
  if (nodes.length === 0) return {};

  let currentGraph = buildWeightedGraph(structural);
  const assignment = new Map<string, string>(nodes.map((n) => [n, n]));

  for (let level = 0; level < config.maxLevels; level++) {
    const localCommunities = localMoving(currentGraph, config.resolution);
    const distinctCommunities = new Set(localCommunities.values());
    if (distinctCommunities.size === currentGraph.nodes.length) break;

    for (const node of assignment.keys()) {
      assignment.set(node, localCommunities.get(assignment.get(node)!)!);
    }

    if (distinctCommunities.size === 1) break;

    currentGraph = aggregateGraph(currentGraph, localCommunities);
  }

  return Object.fromEntries(assignment);
}

export async function loadNoteClusters(vaultDataDir: string): Promise<NoteClustersFile | null> {
  try {
    const content = await readFile(join(vaultDataDir, NOTE_CLUSTERS_FILE_NAME), "utf8");
    return JSON.parse(content) as NoteClustersFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function persistNoteClusters(vaultDataDir: string, file: NoteClustersFile): Promise<void> {
  await mkdir(vaultDataDir, { recursive: true });
  const targetPath = join(vaultDataDir, NOTE_CLUSTERS_FILE_NAME);
  const tmpPath = join(vaultDataDir, `.${NOTE_CLUSTERS_FILE_NAME}.${randomUUID()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(file, null, 2), "utf8");
  await rename(tmpPath, targetPath);
}

/**
 * Reads the already-built structural-links.json, runs Louvain over it, and
 * persists the assignment atomically. Meant to run periodically (see
 * bin/vnl-nightly.js) alongside runImportanceComputation, not per query —
 * the ticket's "periodic clustering job."
 */
export async function runClusterComputation(
  vaultDataDir: string,
  config: ClusteringConfig = DEFAULT_CLUSTERING_CONFIG,
  now: Date = new Date(),
): Promise<ClusteringResult> {
  const structural = await loadStructuralIndex(vaultDataDir);
  if (!structural) {
    return { noteCount: 0, clusterCount: 0, computedAt: now.toISOString() };
  }

  const clusters = runLouvain(structural, config);
  const file: NoteClustersFile = {
    version: NOTE_CLUSTERS_FILE_VERSION,
    computedAt: now.toISOString(),
    clusters,
  };
  await persistNoteClusters(vaultDataDir, file);

  return {
    noteCount: Object.keys(clusters).length,
    clusterCount: new Set(Object.values(clusters)).size,
    computedAt: file.computedAt,
  };
}
