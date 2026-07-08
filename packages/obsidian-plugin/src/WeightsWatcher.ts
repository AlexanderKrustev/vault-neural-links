import type { LinkWeightsFile } from "@vault-neural-links/core";

/**
 * Watches data/link-weights.json (fs.watch, with polling fallback),
 * debounces reloads (~500ms), and emits diffs against the previous
 * snapshot so the renderer can drive reinforcement-pulse animations.
 */
export class WeightsWatcher {
  constructor(private readonly filePath: string) {}

  start(_onChange: (current: LinkWeightsFile, previous: LinkWeightsFile | null) => void): void {
    throw new Error("not implemented");
  }

  stop(): void {
    throw new Error("not implemented");
  }
}
