import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type Simulation,
  type Force,
} from "d3-force";
import type { LinkWeightsFile } from "@vault-neural-links/core";

export interface SimNode {
  id: string;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  /** pinned position while the user is dragging this node */
  fx?: number | null;
  fy?: number | null;
}

export interface NativeEdge {
  source: string;
  target: string;
}

export interface SimEdge {
  source: string | SimNode;
  target: string | SimNode;
  kind: "neural" | "native";
  /** usage weight; 0 for native (structural wikilink) edges */
  weight: number;
  /** ISO timestamp; "" for native edges, which have no usage recency */
  lastTouched: string;
}

const JITTER_STRENGTH = 0.6;
const JITTER_ALPHA_TARGET = 0.05;

export const NODE_BASE_RADIUS = 5;
const NODE_DEGREE_SCALE = 3;
const NODE_MAX_RADIUS = 22;
const ISOLATED_RING_MARGIN = 40;

/** Dot size grows with connection count — shared by layout collision and rendering. */
export function nodeRadius(degree: number): number {
  return Math.min(NODE_MAX_RADIUS, NODE_BASE_RADIUS + Math.log2(degree + 1) * NODE_DEGREE_SCALE);
}

function createJitterForce(): Force<SimNode, SimEdge> {
  let nodes: SimNode[] = [];
  const force: Force<SimNode, SimEdge> = () => {
    for (const node of nodes) {
      node.vx = (node.vx ?? 0) + (Math.random() - 0.5) * JITTER_STRENGTH;
      node.vy = (node.vy ?? 0) + (Math.random() - 0.5) * JITTER_STRENGTH;
    }
  };
  force.initialize = (initNodes) => {
    nodes = initNodes;
  };
  return force;
}

/**
 * Keeps isolated (degree-0) notes at or beyond the distance of the
 * farthest connected note, recomputed every tick since the connected
 * cluster's extent moves as it settles. Nodes already farther out than
 * that are left alone — only pulled inward gently to avoid drifting off
 * into space — so "closer" never means closer than the cluster's reach.
 */
function createIsolateRingForce(degree: Map<string, number>): Force<SimNode, SimEdge> {
  let nodes: SimNode[] = [];
  const force: Force<SimNode, SimEdge> = (alpha) => {
    let maxConnectedDist = 0;
    for (const n of nodes) {
      if ((degree.get(n.id) ?? 0) === 0) continue;
      if (n.x === undefined || n.y === undefined) continue;
      maxConnectedDist = Math.max(maxConnectedDist, Math.hypot(n.x, n.y));
    }
    const minRadius = maxConnectedDist + ISOLATED_RING_MARGIN;

    for (const n of nodes) {
      if ((degree.get(n.id) ?? 0) !== 0) continue;
      if (n.x === undefined || n.y === undefined) continue;
      const dist = Math.hypot(n.x, n.y) || 0.0001;
      const angle = Math.atan2(n.y, n.x);
      const diff = dist < minRadius ? minRadius - dist : (minRadius - dist) * 0.05;
      const k = 0.08 * alpha;
      n.vx = (n.vx ?? 0) + Math.cos(angle) * diff * k;
      n.vy = (n.vy ?? 0) + Math.sin(angle) * diff * k;
    }
  };
  force.initialize = (initNodes) => {
    nodes = initNodes;
  };
  return force;
}

/**
 * Thin wrapper around d3-force: nodes = vault notes, edges = weighted links.
 * Layout is left fully organic — no hardcoded folder-based clustering.
 *
 * Two edge kinds share the same layout: "neural" edges come from the
 * weighted usage graph, "native" edges mirror Obsidian's own [[wikilink]]
 * structure. Native edges pull layout only weakly so the usage-weighted
 * graph still dominates the shape.
 *
 * By default the simulation runs its normal cold-start "explode" animation
 * and then settles, matching Obsidian's own graph view. Continuous mode
 * (see setContinuousAnimation) keeps a small jitter force active forever so
 * nodes never fully come to rest.
 */
export class ForceSim {
  private simulation: Simulation<SimNode, SimEdge> | null = null;
  private edges: SimEdge[] = [];
  private maxWeight = 0;
  private degree = new Map<string, number>();
  private tickCallback: ((nodes: SimNode[]) => void) | null = null;
  private continuousAnimation = false;

  onTick(callback: (nodes: SimNode[]) => void): void {
    this.tickCallback = callback;
    this.simulation?.on("tick", () => callback(this.simulation!.nodes()));
  }

  getEdges(): SimEdge[] {
    return this.edges;
  }

  getMaxWeight(): number {
    return this.maxWeight;
  }

  getDegree(id: string): number {
    return this.degree.get(id) ?? 0;
  }

  /** Wake the simulation so it reorganizes around a change (e.g. a node drag). */
  reheat(alpha = 0.3): void {
    this.simulation?.alphaTarget(this.continuousAnimation ? JITTER_ALPHA_TARGET : 0).alpha(alpha).restart();
  }

  setContinuousAnimation(enabled: boolean): void {
    this.continuousAnimation = enabled;
    if (!this.simulation) return;
    if (enabled) {
      this.simulation.force("jitter", createJitterForce());
      this.simulation.alphaTarget(JITTER_ALPHA_TARGET).restart();
    } else {
      this.simulation.force("jitter", null);
      this.simulation.alphaTarget(0);
    }
  }

  setData(notePaths: string[], weights: LinkWeightsFile, nativeEdges: NativeEdge[] = []): void {
    const ids = new Set(notePaths);
    const neuralEdges: SimEdge[] = [];
    for (const [key, record] of Object.entries(weights.edges)) {
      const [source, target] = key.split("|");
      if (source === undefined || target === undefined) continue;
      // edge endpoints may not match a known note path (e.g. traversal events
      // logged with a bare wikilink name) — include them as nodes anyway so
      // forceLink never references a missing id.
      ids.add(source);
      ids.add(target);
      neuralEdges.push({ source, target, kind: "neural", weight: record.weight, lastTouched: record.lastTouched });
    }

    const nativeSimEdges: SimEdge[] = [];
    for (const { source, target } of nativeEdges) {
      ids.add(source);
      ids.add(target);
      nativeSimEdges.push({ source, target, kind: "native", weight: 0, lastTouched: "" });
    }

    const nodes: SimNode[] = [...ids].map((id) => ({ id }));
    const edges = [...nativeSimEdges, ...neuralEdges];
    this.edges = edges;
    this.maxWeight = neuralEdges.reduce((max, e) => Math.max(max, e.weight), 0);

    const degree = new Map<string, number>();
    for (const e of edges) {
      const source = e.source as string;
      const target = e.target as string;
      degree.set(source, (degree.get(source) ?? 0) + 1);
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
    this.degree = degree;

    this.simulation?.stop();
    this.simulation = forceSimulation(nodes)
      .force("charge", forceManyBody().strength(-90))
      .force(
        "link",
        forceLink<SimNode, SimEdge>(edges)
          .id((d) => d.id)
          .distance(55)
          .strength((d) => (d.kind === "native" ? 0.05 : 0.3)),
      )
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide((d) => nodeRadius(degree.get(d.id) ?? 0) + 3))
      // notes with no connections at all are kept at or beyond the reach of
      // the connected cluster, instead of drifting in among it
      .force("isolate", createIsolateRingForce(degree));

    if (this.continuousAnimation) {
      this.simulation.force("jitter", createJitterForce());
      this.simulation.alphaTarget(JITTER_ALPHA_TARGET);
    }

    if (this.tickCallback) {
      const callback = this.tickCallback;
      this.simulation.on("tick", () => callback(this.simulation!.nodes()));
    }
  }

  stop(): void {
    this.simulation?.stop();
  }
}
