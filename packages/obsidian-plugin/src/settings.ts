export interface VaultNeuralLinksSettings {
  /** read-only mirror of core's decay half-life, in days */
  decayHalfLifeDays: number;
  colorScheme: "default" | "high-contrast";
  minWeightFilter: number;
}

export const DEFAULT_SETTINGS: VaultNeuralLinksSettings = {
  decayHalfLifeDays: 30,
  colorScheme: "default",
  minWeightFilter: 0,
};
