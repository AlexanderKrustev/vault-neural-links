import type { LinkWeightsFile } from "@vault-neural-links/core";

export interface SimNode {
  id: string;
  x?: number;
  y?: number;
}

export interface SimEdge {
  source: string;
  target: string;
  weight: number;
}

/**
 * Thin wrapper around d3-force: nodes = vault notes, edges = weighted links.
 * Layout is left fully organic — no hardcoded folder-based clustering.
 */
export class ForceSim {
  onTick(_callback: (nodes: SimNode[]) => void): void {
    throw new Error("not implemented");
  }

  setData(_notePaths: string[], _weights: LinkWeightsFile): void {
    throw new Error("not implemented");
  }
}
