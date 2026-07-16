import type { AblationDiffEntry, AblationDiffResult, AblationLayers, SpreadingActivationConfig } from "./types.js";
import { DEFAULT_ABLATION_LAYERS } from "./types.js";
import { activate } from "./activation.js";
import type { SessionBuffer } from "./priming.js";

const ENERGY_EPSILON = 1e-9;

/**
 * Runs activate() twice — once with every scoring layer on (baseline) and
 * once with `disabledLayers` turned off — and diffs the two result sets, so
 * a reviewer can see concretely what a layer (priming, importance,
 * consolidation, structural fallback) actually contributes to retrieval for
 * a given note, rather than taking the mechanism's existence on faith
 * (AIBRAIN-27).
 *
 * A note can go "removed" (baseline-only — that layer was the only thing
 * surfacing it), "added" (ablated-only — ablating a layer changes energy
 * shares among the *remaining* neighbors, which can pull a previously
 * sub-threshold note above threshold), or "reranked" (present in both but
 * with a materially different energy, i.e. its retrieval strength itself
 * depended partly on the ablated layer even though it still cleared
 * threshold). Notes whose energy is unchanged (within floating-point
 * epsilon) are omitted from the diff — they're unaffected by the ablation.
 */
export async function runAblationComparison(
  vaultDataDir: string,
  note: string,
  energy: number,
  disabledLayers: Partial<AblationLayers>,
  config?: SpreadingActivationConfig,
  vaultPath?: string,
  sessionBuffer?: SessionBuffer,
): Promise<AblationDiffResult> {
  const ablatedLayers: AblationLayers = { ...DEFAULT_ABLATION_LAYERS, ...disabledLayers };

  const [baseline, ablated] = await Promise.all([
    activate(vaultDataDir, note, energy, config, vaultPath, sessionBuffer, undefined, undefined, DEFAULT_ABLATION_LAYERS),
    activate(vaultDataDir, note, energy, config, vaultPath, sessionBuffer, undefined, undefined, ablatedLayers),
  ]);

  const baselineByPath = new Map(baseline.map((n) => [n.path, n]));
  const ablatedByPath = new Map(ablated.map((n) => [n.path, n]));
  const allPaths = new Set([...baselineByPath.keys(), ...ablatedByPath.keys()]);

  const diff: AblationDiffEntry[] = [];
  for (const path of allPaths) {
    const before = baselineByPath.get(path);
    const after = ablatedByPath.get(path);

    if (before && !after) {
      diff.push({ path, status: "removed", baselineEnergy: before.energy, baselineHops: before.hops });
    } else if (!before && after) {
      diff.push({ path, status: "added", ablatedEnergy: after.energy, ablatedHops: after.hops });
    } else if (before && after && Math.abs(before.energy - after.energy) > ENERGY_EPSILON) {
      diff.push({
        path,
        status: "reranked",
        baselineEnergy: before.energy,
        ablatedEnergy: after.energy,
        baselineHops: before.hops,
        ablatedHops: after.hops,
      });
    }
  }

  diff.sort((a, b) => (b.baselineEnergy ?? b.ablatedEnergy ?? 0) - (a.baselineEnergy ?? a.ablatedEnergy ?? 0));

  return { note, disabledLayers, baseline, ablated, diff };
}
