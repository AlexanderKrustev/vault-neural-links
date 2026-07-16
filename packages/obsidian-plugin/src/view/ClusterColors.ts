export interface ClusterAdjacency {
  a: number;
  b: number;
  weight: number;
}

/**
 * Greedy nearest-neighbor chain: builds a permutation of cluster indices so
 * that strongly inter-connected clusters (by summed edge weight between
 * their members, see ForceSim's computeClusterAdjacency) end up adjacent in
 * the resulting order. Mapping that order onto hue (computeClusterHues
 * below) puts related communities in the same color family instead of
 * scattering related clusters across the wheel by raw index, which is what
 * this replaced. Deterministic: ties prefer the lower cluster index, and a
 * chain end with no weighted connection to anything unvisited restarts at
 * the lowest remaining index rather than jumping to an arbitrary one.
 */
export function orderClustersByConnection(clusterCount: number, adjacency: readonly ClusterAdjacency[]): number[] {
  if (clusterCount <= 0) return [];
  if (clusterCount === 1) return [0];

  const weight = new Map<string, number>();
  for (const { a, b, weight: w } of adjacency) {
    if (a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    weight.set(key, (weight.get(key) ?? 0) + w);
  }
  const weightBetween = (a: number, b: number): number => weight.get(a < b ? `${a}|${b}` : `${b}|${a}`) ?? 0;

  const remaining = new Set<number>(Array.from({ length: clusterCount }, (_, i) => i));
  const order: number[] = [];

  let current = 0;
  remaining.delete(current);
  order.push(current);

  while (remaining.size > 0) {
    let best: number | null = null;
    let bestWeight = 0;
    for (const candidate of remaining) {
      const w = weightBetween(current, candidate);
      if (w > bestWeight || (best !== null && w === bestWeight && w > 0 && candidate < best)) {
        bestWeight = w;
        best = candidate;
      }
    }
    if (best === null) best = Math.min(...remaining);
    remaining.delete(best);
    order.push(best);
    current = best;
  }

  return order;
}

/**
 * Assigns each cluster index a hue (0-359) using the connection-aware
 * ordering above, evenly spaced around the wheel by that order's position
 * rather than by raw cluster index.
 */
export function computeClusterHues(clusterCount: number, adjacency: readonly ClusterAdjacency[]): Map<number, number> {
  const order = orderClustersByConnection(clusterCount, adjacency);
  const hues = new Map<number, number>();
  order.forEach((clusterIndex, position) => {
    hues.set(clusterIndex, (position / clusterCount) * 360);
  });
  return hues;
}
