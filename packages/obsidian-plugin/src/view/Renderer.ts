import type { ForceSim } from "./ForceSim.js";

/**
 * Canvas draw loop consuming ForceSim positions.
 * - Edge thickness ∝ weight (log-scaled)
 * - Edge opacity/color fades toward muted as lastTouched ages, independent of weight
 * - Reinforcement pulse: brief animation when a reinforce event lands
 * - Interaction: click node → open note; hover edge → tooltip (weight, traverseCount, lastTouched)
 */
export class Renderer {
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sim: ForceSim,
  ) {}

  start(): void {
    throw new Error("not implemented");
  }

  stop(): void {
    throw new Error("not implemented");
  }

  pulseEdge(_source: string, _target: string): void {
    throw new Error("not implemented");
  }
}
