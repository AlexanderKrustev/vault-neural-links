import type { DecayConfig } from "./types.js";
import { DEFAULT_DECAY_CONFIG } from "./types.js";

/**
 * Exponential decay: weight = weight * exp(-lambda * daysSinceLastTouched)
 * lambda is derived from the configured half-life.
 */
export function decayWeight(
  weight: number,
  daysSinceLastTouched: number,
  config: DecayConfig = DEFAULT_DECAY_CONFIG,
): number {
  if (daysSinceLastTouched <= 0) return weight;
  const lambda = Math.LN2 / config.halfLifeDays;
  return weight * Math.exp(-lambda * daysSinceLastTouched);
}
