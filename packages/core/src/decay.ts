import type { DecayConfig, NoteTypeDecayConfig } from "./types.js";
import { DEFAULT_DECAY_CONFIG, DEFAULT_NOTE_TYPE_DECAY_CONFIG } from "./types.js";

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

  const { halfLifeDays, fastWindowDays, fastHalfLifeDays } = config;
  if (!fastWindowDays || !fastHalfLifeDays || fastWindowDays <= 0) {
    const lambda = Math.LN2 / halfLifeDays;
    return weight * Math.exp(-lambda * daysSinceLastTouched);
  }

  const fastLambda = Math.LN2 / fastHalfLifeDays;
  if (daysSinceLastTouched <= fastWindowDays) {
    return weight * Math.exp(-fastLambda * daysSinceLastTouched);
  }

  // Past the fast window: continue from wherever the fast phase left off,
  // at the normal (slower) rate.
  const weightAtWindowEnd = weight * Math.exp(-fastLambda * fastWindowDays);
  const normalLambda = Math.LN2 / halfLifeDays;
  return weightAtWindowEnd * Math.exp(-normalLambda * (daysSinceLastTouched - fastWindowDays));
}


export function resolveHalfLifeDays(
  noteType: string | undefined,
  config: NoteTypeDecayConfig = DEFAULT_NOTE_TYPE_DECAY_CONFIG,
): number {
  if (noteType && noteType in config.byType) return config.byType[noteType];
  return config.defaultHalfLifeDays;
}
