export interface ClusterEdge {
  source: string;
  target: string;
  weight: number;
}

/**
 * Turns an arbitrary label-per-node map (community labels, string cluster
 * ids, whatever) into small integer indices ordered by descending cluster
 * size — shared by computeClusters below and by ForceSim when it has a
 * real Louvain assignment (see note-clusters.json / AIBRAIN-22) to rank,
 * so both sources feed the cluster-anchor force and node color the same
 * deterministic way.
 */
export function rankClustersBySize(labelOf: ReadonlyMap<string, string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of labelOf.values()) counts.set(l, (counts.get(l) ?? 0) + 1);
  const sortedLabels = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([l]) => l);
  const clusterIndex = new Map<string, number>();
  sortedLabels.forEach((l, i) => clusterIndex.set(l, i));

  const result = new Map<string, number>();
  for (const [id, l] of labelOf) result.set(id, clusterIndex.get(l)!);
  return result;
}

/**
 * Deterministic (unshuffled) label-propagation community detection: cheap
 * approximation of the real modularity-optimizing Louvain now computed
 * server-side in note-clusters.json (see packages/core/src/clustering.ts,
 * AIBRAIN-22). ForceSim prefers that real assignment when it's loaded and
 * only falls back to this client-side approximation when it isn't yet
 * available (nightly job hasn't run, or a note is missing from its
 * output) — this still gives the force layout distinct blobs to pull
 * toward instead of one hairball in that case. Iteration order is fixed by
 * sorted id rather than randomized so the same graph yields the same
 * partition on every call — random shuffling would make the layout
 * reshuffle its clusters on every weights-file update.
 *
 * Returns a map from node id to a small integer cluster index, ordered by
 * descending cluster size (0 = largest), for every id in `ids` that has at
 * least one edge. Degree-0 ids are omitted — isolated notes are already
 * handled by the isolate-ring force and shouldn't be pulled toward a
 * cluster anchor.
 */
export function computeClusters(ids: readonly string[], edges: readonly ClusterEdge[], iterations = 8): Map<string, number> {
  const neighbors = new Map<string, { id: string; weight: number }[]>();
  for (const id of ids) neighbors.set(id, []);
  for (const e of edges) {
    if (!neighbors.has(e.source) || !neighbors.has(e.target)) continue;
    neighbors.get(e.source)!.push({ id: e.target, weight: e.weight });
    neighbors.get(e.target)!.push({ id: e.source, weight: e.weight });
  }

  const connected = [...ids].filter((id) => (neighbors.get(id)?.length ?? 0) > 0).sort();
  const label = new Map<string, string>();
  for (const id of connected) label.set(id, id);

  for (let iter = 0; iter < iterations; iter++) {
    let changed = false;
    for (const id of connected) {
      const neigh = neighbors.get(id);
      if (!neigh || neigh.length === 0) continue;
      const scores = new Map<string, number>();
      for (const { id: neighborId, weight } of neigh) {
        const neighborLabel = label.get(neighborId);
        if (neighborLabel === undefined) continue;
        scores.set(neighborLabel, (scores.get(neighborLabel) ?? 0) + weight);
      }
      let bestLabel = label.get(id)!;
      let bestScore = -Infinity;
      // Map iteration order is insertion order, not sorted — sort candidate
      // labels so ties resolve the same way on every call.
      for (const candidate of [...scores.keys()].sort()) {
        const score = scores.get(candidate)!;
        if (score > bestScore) {
          bestScore = score;
          bestLabel = candidate;
        }
      }
      if (bestLabel !== label.get(id)) {
        label.set(id, bestLabel);
        changed = true;
      }
    }
    if (!changed) break;
  }

  return rankClustersBySize(label);
}
