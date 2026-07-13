import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ConsolidationConfig, ConsolidationResult, LinkWeightsFile } from "./types.js";
import { DEFAULT_CONSOLIDATION_CONFIG } from "./types.js";

function daysSinceDayKey(day: string, now: Date): number {
  return (now.getTime() - new Date(`${day}T00:00:00.000Z`).getTime()) / 86_400_000;
}

/**
 * Promotes edges into the long-term "consolidated" tier once they've been
 * reactivated on at least `reactivationThreshold` distinct days within the
 * trailing `windowDays` — modeling spaced repetition/sleep-dependent
 * consolidation rather than a single burst of activity. Pure function over
 * an already-loaded weights file so it's cheap to unit test; promotion is
 * a running total (each qualifying night adds another `promotionIncrement`)
 * rather than a one-time event, so sustained reactivation keeps deepening
 * an edge's resistance to decay.
 */
export function consolidate(
  weights: LinkWeightsFile,
  now: Date = new Date(),
  config: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG,
): { weights: LinkWeightsFile; promotedCount: number } {
  let promotedCount = 0;
  const edges = Object.fromEntries(
    Object.entries(weights.edges).map(([key, record]) => {
      const recentReactivations = record.reactivationDays.filter(
        (day) => daysSinceDayKey(day, now) <= config.windowDays,
      );
      if (recentReactivations.length < config.reactivationThreshold) return [key, record];

      promotedCount += 1;
      return [key, { ...record, consolidatedScore: record.consolidatedScore + config.promotionIncrement }];
    }),
  );
  return { weights: { ...weights, edges }, promotedCount };
}

/**
 * Reads link-weights.json, promotes qualifying edges, and writes the result
 * back atomically. Meant to be invoked by a real once-a-day scheduled job
 * (see bin/vnl-nightly.js) — never by on-demand compaction, since repeatedly
 * calling this from an ad-hoc `compact_weights` MCP call would make the
 * reactivation threshold meaningless (every call would re-check and
 * re-promote in the same day).
 */
export async function runNightlyConsolidation(
  vaultDataDir: string,
  config: ConsolidationConfig = DEFAULT_CONSOLIDATION_CONFIG,
  now: Date = new Date(),
): Promise<ConsolidationResult> {
  const weightsFilePath = join(vaultDataDir, "link-weights.json");

  let weights: LinkWeightsFile;
  try {
    weights = JSON.parse(await readFile(weightsFilePath, "utf8")) as LinkWeightsFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { edgeCount: 0, promotedCount: 0, consolidatedAt: now.toISOString() };
    }
    throw err;
  }

  const { weights: updated, promotedCount } = consolidate(weights, now, config);

  await mkdir(vaultDataDir, { recursive: true });
  const tmpPath = join(vaultDataDir, `.link-weights.${randomUUID()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(updated, null, 2), "utf8");
  await rename(tmpPath, weightsFilePath);

  return { edgeCount: Object.keys(updated.edges).length, promotedCount, consolidatedAt: now.toISOString() };
}
