export interface VaultNeuralLinksSettings {
  /** read-only mirror of core's decay half-life, in days */
  decayHalfLifeDays: number;
  colorScheme: "default" | "high-contrast";
  minWeightFilter: number;
  /** keep a gentle jitter running forever instead of settling after the initial layout */
  continuousAnimation: boolean;
  /**
   * VNL-052: record which notes you open one after another, and which you
   * edit, into `.vault-neural-links/events/` so the weighted graph learns
   * from your own navigation and not only from the agent's. Local files
   * only — nothing is ever sent anywhere.
   */
  logHumanNavigation: boolean;
  /** rendering-only pacing for live activation events — "study" staggers hops ~150-300ms apart; engine timing itself is never altered */
  playbackMode: "live" | "study";
}

export const DEFAULT_SETTINGS: VaultNeuralLinksSettings = {
  decayHalfLifeDays: 30,
  colorScheme: "default",
  minWeightFilter: 0,
  continuousAnimation: false,
  logHumanNavigation: true,
  playbackMode: "live",
};
