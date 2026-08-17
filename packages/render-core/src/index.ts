/**
 * AIBRAIN-63: shared graph-visualization codepath, extracted from
 * packages/obsidian-plugin (Renderer.ts/ForceSim.ts) so the Obsidian
 * plugin and the standalone desktop app stay on one rendering
 * implementation instead of two. Plain DOM/canvas + d3-force only — no
 * host-app APIs — see Renderer.ts's class doc for the specific fix
 * (Obsidian's addClass/setText prototype extensions replaced with
 * standard classList/textContent) that made this portable.
 */
export {
  ForceSim,
  nodeRadius,
  NODE_BASE_RADIUS,
  type SimNode,
  type SimEdge,
  type NativeEdge,
} from "./ForceSim.js";
export { Renderer, type ColorScheme } from "./Renderer.js";
export { computeClusters, rankClustersBySize, type ClusterEdge } from "./Clustering.js";
export { computeClusterHues, orderClustersByConnection, type ClusterAdjacency } from "./ClusterColors.js";
