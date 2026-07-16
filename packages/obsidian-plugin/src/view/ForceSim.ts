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
import { computeClusters, rankClustersBySize } from "./Clustering.js";

// baseStrength is undecayed — decay is applied live here rather than at
// compaction (see packages/core/src/query.ts for the same formula, used by
// MCP-driven queries). Inlined rather than importing @vault-neural-links/core's
// runtime code, since that package's index bundles Node-only fs/path/crypto
// modules that can't resolve in this browser-bundled plugin; only its types
// are safe to import here. The plugin has no synchronous access to each
// note's frontmatter type, so it applies the global default half-life
// instead of per-note-type tau.
const DEFAULT_HALF_LIFE_DAYS = 30;

function liveWeight(baseStrength: number, lastTouched: string, consolidatedScore = 0): number {
  const daysSince = (Date.now() - new Date(lastTouched).getTime()) / (1000 * 60 * 60 * 24);
  // consolidatedScore is added undecayed — same rule as query.ts's liveWeight
  // — so a long-term "consolidated" edge doesn't fade even though its
  // recent-tier baseStrength still does.
  if (daysSince <= 0) return baseStrength + consolidatedScore;
  const lambda = Math.LN2 / DEFAULT_HALF_LIFE_DAYS;
  return baseStrength * Math.exp(-lambda * daysSince) + consolidatedScore;
}

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

export const NODE_BASE_RADIUS = 6;
const NODE_DEGREE_SCALE = 3;
const NODE_MAX_RADIUS = 22;
const ISOLATED_RING_MARGIN = 24;
// A note with peak importance (1.0, the single most-linked note vault-wide,
// see note-importance.json / AIBRAIN-21) renders up to this much larger
// than its degree alone would draw it — degree reflects local connectivity
// in this rendered subgraph, importance reflects hub status across the
// whole structural graph, so a locally sparse but globally central note
// still stands out.
const IMPORTANCE_RADIUS_BOOST = 1.2;

/** Dot size grows with connection count and (optionally) PageRank-style importance — shared by layout collision and rendering. */
export function nodeRadius(degree: number, importance = 0): number {
  const degreeRadius = Math.min(NODE_MAX_RADIUS, NODE_BASE_RADIUS + Math.log2(degree + 1) * NODE_DEGREE_SCALE);
  const clampedImportance = Math.max(0, Math.min(1, importance));
  return degreeRadius * (1 + clampedImportance * IMPORTANCE_RADIUS_BOOST);
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

const ISOLATED_RING_BAND = 45;

/**
 * Keeps isolated (degree-0) notes within a narrow band just beyond the
 * typical reach of the connected cluster, recomputed every tick since the
 * cluster's extent moves as it settles. Sized off the 75th-percentile
 * connected distance rather than the true max — a single outlier connected
 * note (e.g. one pulled out by the cluster-anchor force) would otherwise
 * blow the ring radius out for every isolated dot. The band is enforced
 * symmetrically (pulled in if too close, pulled back if too far) so
 * isolated notes settle into one tight ring rather than scattering to
 * whatever distance they happened to drift out to.
 */
function createIsolateRingForce(degree: Map<string, number>): Force<SimNode, SimEdge> {
  let nodes: SimNode[] = [];
  const force: Force<SimNode, SimEdge> = (alpha) => {
    const connectedDists: number[] = [];
    for (const n of nodes) {
      if ((degree.get(n.id) ?? 0) === 0) continue;
      if (n.x === undefined || n.y === undefined) continue;
      connectedDists.push(Math.hypot(n.x, n.y));
    }
    connectedDists.sort((a, b) => a - b);
    const percentileIdx = Math.floor(connectedDists.length * 0.75);
    const typicalConnectedDist = connectedDists[Math.min(percentileIdx, connectedDists.length - 1)] ?? 0;
    const minRadius = typicalConnectedDist + ISOLATED_RING_MARGIN;
    const maxRadius = minRadius + ISOLATED_RING_BAND;

    for (const n of nodes) {
      if ((degree.get(n.id) ?? 0) !== 0) continue;
      if (n.x === undefined || n.y === undefined) continue;
      const dist = Math.hypot(n.x, n.y) || 0.0001;
      const angle = Math.atan2(n.y, n.x);
      const target = dist < minRadius ? minRadius : dist > maxRadius ? maxRadius : dist;
      const diff = target - dist;
      const k = 0.12 * alpha;
      n.vx = (n.vx ?? 0) + Math.cos(angle) * diff * k;
      n.vy = (n.vy ?? 0) + Math.sin(angle) * diff * k;
    }
  };
  force.initialize = (initNodes) => {
    nodes = initNodes;
  };
  return force;
}

const CLUSTER_FORCE_STRENGTH = 0.025;
const CLUSTER_ANCHOR_SPACING = 55;

/**
 * Nudges each connected node toward an anchor point shared by its detected
 * community (see Clustering.ts), so distinct topic groups spatially
 * separate into their own blobs instead of collapsing into one hairball.
 * Deliberately weak relative to charge/link/collide — it biases layout,
 * it doesn't dictate it, so within-cluster structure stays organic.
 */
function createClusterForce(clusterOf: Map<string, number>, clusterCount: number): Force<SimNode, SimEdge> {
  let nodes: SimNode[] = [];
  const radius = CLUSTER_ANCHOR_SPACING * Math.max(1, Math.sqrt(clusterCount));
  const anchors: [number, number][] = [];
  for (let i = 0; i < clusterCount; i++) {
    const angle = (2 * Math.PI * i) / clusterCount;
    anchors.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }

  const force: Force<SimNode, SimEdge> = (alpha) => {
    const k = CLUSTER_FORCE_STRENGTH * alpha;
    for (const n of nodes) {
      const cluster = clusterOf.get(n.id);
      if (cluster === undefined || n.x === undefined || n.y === undefined) continue;
      const [ax, ay] = anchors[cluster];
      n.vx = (n.vx ?? 0) + (ax - n.x) * k;
      n.vy = (n.vy ?? 0) + (ay - n.y) * k;
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
  /** most recent lastTouched among each note's incident "neural" (usage) edges — native wikilinks don't carry recency */
  private lastTouched = new Map<string, string>();
  /** max consolidatedScore across each note's incident neural edges — >0 means "consolidated into long-term memory" */
  private consolidated = new Map<string, number>();
  /** min-max normalized PageRank score per note, from note-importance.json (see setGraphMetadata); 0 for notes not yet scored. */
  private importance = new Map<string, number>();
  /** real Louvain assignment from note-clusters.json (see setGraphMetadata), null until the nightly job has run at least once. */
  private backendClusters: Record<string, string> | null = null;
  /** small integer cluster index per node id, ranked by descending cluster size — recomputed in setData from either backendClusters or the client-side computeClusters fallback. */
  private clusterOf = new Map<string, number>();
  private clusterCount = 0;
  private tickCallback: ((nodes: SimNode[]) => void) | null = null;
  private continuousAnimation = false;
  /** carried across setData calls so unchanged notes keep their position instead of re-exploding */
  private nodesById = new Map<string, SimNode>();
  /** transient push-based state fed by live activate() events, not recomputed on setData */
  private activating = new Map<string, { hop: number; start: number }>();
  /** keyed by directional edge, not a growing log — a later traversal of the same edge just refreshes its start time */
  private activatingEdges = new Map<string, { key: string; start: number }>();

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

  /** ISO timestamp of the most recent usage touch on this note, or undefined if it has none. */
  getLastTouched(id: string): string | undefined {
    return this.lastTouched.get(id);
  }

  /** Highest consolidatedScore across this note's incident neural edges; 0 if never promoted. */
  getConsolidatedScore(id: string): number {
    return this.consolidated.get(id) ?? 0;
  }

  /** Min-max normalized PageRank importance (0-1); 0 for notes not yet scored by the nightly job. */
  getImportance(id: string): number {
    return this.importance.get(id) ?? 0;
  }

  /** Small integer cluster index (0 = largest community), or undefined if this node isn't part of any detected cluster. */
  getCluster(id: string): number | undefined {
    return this.clusterOf.get(id);
  }

  getClusterCount(): number {
    return this.clusterCount;
  }

  /**
   * Feeds in the latest note-importance.json / note-clusters.json snapshots
   * (see GraphMetadataWatcher). Only updates the maps the renderer reads for
   * node size/color — doesn't touch layout/positions, so this can land at
   * any time independent of setData's own (much more frequent) weights-file
   * driven updates.
   */
  setGraphMetadata(importance: Record<string, number> | null, clusters: Record<string, string> | null): void {
    this.importance = new Map(Object.entries(importance ?? {}));
    this.backendClusters = clusters && Object.keys(clusters).length > 0 ? clusters : null;
  }

  /** Records a live node_activated event for the activation ring to render; expiry/filtering by age is Renderer's job. */
  markNodeActivated(id: string, hop: number): void {
    this.activating.set(id, { hop, start: performance.now() });
  }

  /** Records a live edge_traversed event. Directional (unlike edgeKey()'s sorted key) — direction is the point of the animation. */
  markEdgeTraversed(from: string, to: string): void {
    const key = `${from}->${to}`;
    this.activatingEdges.set(key, { key, start: performance.now() });
  }

  getActivating(id: string): { hop: number; start: number } | undefined {
    return this.activating.get(id);
  }

  getActivatingEdges(): readonly { key: string; start: number }[] {
    return [...this.activatingEdges.values()];
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

  setData(notePaths: string[], weights: LinkWeightsFile, nativeEdges: NativeEdge[] = [], minWeight = 0): void {
    const ids = new Set(notePaths);
    const neuralEdges: SimEdge[] = [];
    const consolidated = new Map<string, number>();
    for (const [key, record] of Object.entries(weights.edges)) {
      const weight = liveWeight(record.baseStrength, record.lastTouched, record.consolidatedScore);
      if (weight < minWeight) continue;
      const [source, target] = key.split("|");
      if (source === undefined || target === undefined) continue;
      // edge endpoints may not match a known note path (e.g. traversal events
      // logged with a bare wikilink name) — include them as nodes anyway so
      // forceLink never references a missing id.
      ids.add(source);
      ids.add(target);
      neuralEdges.push({ source, target, kind: "neural", weight, lastTouched: record.lastTouched });

      if (record.consolidatedScore > (consolidated.get(source) ?? 0)) consolidated.set(source, record.consolidatedScore);
      if (record.consolidatedScore > (consolidated.get(target) ?? 0)) consolidated.set(target, record.consolidatedScore);
    }
    this.consolidated = consolidated;

    const nativeSimEdges: SimEdge[] = [];
    for (const { source, target } of nativeEdges) {
      ids.add(source);
      ids.add(target);
      nativeSimEdges.push({ source, target, kind: "native", weight: 0, lastTouched: "" });
    }

    // reuse existing node objects by id so notes unaffected by this update keep
    // their current x/y/velocity instead of the whole graph re-exploding from
    // a cold layout every time the weights file changes
    const wasFirstLoad = this.simulation === null;
    const nodes: SimNode[] = [...ids].map((id) => this.nodesById.get(id) ?? { id });
    this.nodesById = new Map(nodes.map((n) => [n.id, n]));

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

    let clusterOf: Map<string, number>;
    if (this.backendClusters) {
      // real Louvain assignment (AIBRAIN-22) — nodes missing from it (added
      // since the last nightly run, or with no structural links yet) are
      // simply left unassigned, same as computeClusters omitting degree-0 ids.
      const label = new Map<string, string>();
      for (const id of ids) {
        const l = this.backendClusters[id];
        if (l !== undefined) label.set(id, l);
      }
      clusterOf = rankClustersBySize(label);
    } else {
      const clusterEdges = edges.map((e) => ({
        source: e.source as string,
        target: e.target as string,
        // native (wikilink) edges carry no usage weight — treat them as a
        // fixed moderate pull so structural links still shape communities
        weight: e.kind === "native" ? 1 : e.weight,
      }));
      clusterOf = computeClusters([...ids], clusterEdges);
    }
    const clusterCount = new Set(clusterOf.values()).size;
    this.clusterOf = clusterOf;
    this.clusterCount = clusterCount;

    const lastTouched = new Map<string, string>();
    for (const e of neuralEdges) {
      const source = e.source as string;
      const target = e.target as string;
      if (!lastTouched.has(source) || e.lastTouched > lastTouched.get(source)!) lastTouched.set(source, e.lastTouched);
      if (!lastTouched.has(target) || e.lastTouched > lastTouched.get(target)!) lastTouched.set(target, e.lastTouched);
    }
    this.lastTouched = lastTouched;

    this.simulation?.stop();
    this.simulation = forceSimulation(nodes)
      .alphaDecay(0.012)
      .velocityDecay(0.35)
      // isolated notes get much weaker mutual repulsion so they pack close
      // together into a tight ring instead of spreading out around it
      .force(
        "charge",
        forceManyBody<SimNode>()
          .strength((d) => (degree.get(d.id) ?? 0) === 0 ? -30 : -220)
          .distanceMax(400),
      )
      .force(
        "link",
        forceLink<SimNode, SimEdge>(edges)
          .id((d) => d.id)
          .distance(75)
          .strength((d) => (d.kind === "native" ? 0.05 : 0.25)),
      )
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide((d) => nodeRadius(degree.get(d.id) ?? 0, this.importance.get(d.id) ?? 0) + 8))
      // notes with no connections at all are kept at or beyond the reach of
      // the connected cluster, instead of drifting in among it
      .force("isolate", createIsolateRingForce(degree))
      // pulls each detected community toward its own anchor so topic groups
      // visually separate instead of collapsing into one dense hairball
      .force("cluster", clusterCount > 1 ? createClusterForce(clusterOf, clusterCount) : null);

    // incremental updates start from a mild reheat, not a full cold-start alpha=1,
    // since reused nodes already have sensible positions
    if (!wasFirstLoad) this.simulation.alpha(0.3);

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
