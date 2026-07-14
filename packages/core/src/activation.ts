import { randomUUID } from "node:crypto";
import type { ActivatedNote, ActivationEventSink, SpreadingActivationConfig } from "./types.js";
import { DEFAULT_SPREADING_ACTIVATION_CONFIG } from "./types.js";
import { computeLiveNeighborWeights } from "./query.js";
import type { SessionBuffer } from "./priming.js";

/**
 * Spreads activation energy outward from `note` across bounded multi-hop
 * neighbors, so notes only indirectly linked (via an intermediate note) can
 * still surface at query time — direct-neighbor-only retrieval
 * (getWeightedNeighbors) has no way to represent that.
 *
 * At each hop, a node's incoming energy is discounted by
 * `energyEdgeWeightDecayPerHop` and then split across its live-weighted
 * neighbors in proportion to their edge weight (so a neighbor pulling half
 * the node's total outgoing weight gets half the propagated energy, not a
 * flat share). A node reached via multiple paths accumulates energy from
 * each — that accumulation, not just shortest-path distance, is what lets
 * a note strongly reachable through several indirect routes outrank one
 * weakly reachable through a single direct link.
 *
 * Propagation stops at `config.maxHops` or once a path's carried energy
 * drops below `config.minThreshold`, whichever comes first — otherwise a
 * single query would walk the entire graph instead of a local neighborhood.
 * Re-visiting an already-visited node within the same path is skipped (it
 * still accumulates energy from that path, it just doesn't fan back out from
 * there), which is what keeps a two-node mutual link from recursing forever
 * within the hop bound.
 */
export async function activate(
  vaultDataDir: string,
  note: string,
  energy: number,
  config: SpreadingActivationConfig = DEFAULT_SPREADING_ACTIVATION_CONFIG,
  vaultPath?: string,
  sessionBuffer?: SessionBuffer,
  onEvent?: ActivationEventSink,
): Promise<ActivatedNote[]> {
  const accumulated = new Map<string, { energy: number; hops: number }>();
  const runId = randomUUID();

  async function spread(current: string, currentEnergy: number, hop: number, visited: Set<string>): Promise<void> {
    if (hop > config.maxHops || currentEnergy < config.structuralMinThreshold) return;

    const neighbors = await computeLiveNeighborWeights(vaultDataDir, current, vaultPath, sessionBuffer);
    const totalWeight = neighbors.reduce((sum, n) => sum + Math.max(n.weight, 0), 0);
    if (totalWeight <= 0) return;

    for (const neighbor of neighbors) {
      if (neighbor.path === note || Math.max(neighbor.weight, 0) <= 0) continue;

      const share = neighbor.weight / totalWeight;
      const transferred = currentEnergy * config.energyEdgeWeightDecayPerHop * share;
      const threshold = neighbor.source === "structural" ? config.structuralMinThreshold : config.minThreshold;
      if (transferred < threshold) continue;

      onEvent?.({
        type: "edge_traversed",
        runId,
        origin: note,
        hop,
        from: current,
        to: neighbor.path,
        energy: transferred,
        ts: new Date().toISOString(),
      });

      const existing = accumulated.get(neighbor.path);
      if (existing) {
        existing.energy += transferred;
        existing.hops = Math.min(existing.hops, hop);
      } else {
        accumulated.set(neighbor.path, { energy: transferred, hops: hop });
      }

      onEvent?.({
        type: "node_activated",
        runId,
        origin: note,
        hop,
        node: neighbor.path,
        energy: transferred,
        ts: new Date().toISOString(),
      });

      if (!visited.has(neighbor.path)) {
        await spread(neighbor.path, transferred, hop + 1, new Set(visited).add(neighbor.path));
      }
    }
  }

  await spread(note, energy, 1, new Set([note]));

  return Array.from(accumulated.entries())
    .map(([path, { energy: e, hops }]) => ({ path, energy: e, hops }))
    .sort((a, b) => b.energy - a.energy);
}
