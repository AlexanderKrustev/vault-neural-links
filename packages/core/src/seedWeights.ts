import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { ColdStartSeedConfig, SeedRecord, SeedWeightsFile } from "./types.js";
import { DEFAULT_COLD_START_SEED_CONFIG } from "./types.js";
import { createObsidianAdapter, type SourceAdapter, type SourceNode } from "./adapters.js";
import { decayWeight } from "./decay.js";
import { toFilePath } from "./notes.js";
import { buildDirectedAdjacency } from "./structuralLinks.js";
import { invalidateCachedFile, loadCachedJson } from "./indexCache.js";

const SEED_WEIGHTS_FILE_VERSION = 1;
const SEED_WEIGHTS_FILE_NAME = "seed-weights.json";
/** Matches notes.ts's NOTE_READ_CONCURRENCY — same reason (no unbounded fan-out over a 300k-note vault). */
const STAT_CONCURRENCY = 64;

/** Directional key, `from|to`. Unlike link-weights.json's pairs these are not sorted — see SeedWeightsFile. */
export function seedKey(from: string, to: string): string {
  return `${from}|${to}`;
}

/**
 * How much a link to `to` says about `to` specifically, as a function of how
 * many notes it is connected to. A link to a MOC that half the vault links
 * to carries almost no information about the origin's subject — this is the
 * same "Index is linked into everything" problem VNL-012 fixed in the
 * auto-linker, arriving here as ranking noise instead of link noise.
 *
 * Note this is the opposite of the literal reading of D9 ("initial
 * baseStrength from backlink count"), where more backlinks would mean more
 * weight. A note's own hub-ness is what PageRank importance already scores,
 * and VNL-058 measured that at no effect on this corpus; what a *ranking*
 * prior needs is the discriminating half of the same signal, so degree is
 * used as an idf-style discount rather than a bonus. VNL-020 settles it.
 */
export function linkSpecificity(degree: number): number {
  if (degree <= 1) return 1;
  return 1 / Math.log2(degree + 1);
}

export interface BuildSeedWeightsOptions {
  config?: ColdStartSeedConfig;
  /** Injected in tests; defaults to a real stat() of each note file. */
  mtimeOf?: (notePath: string) => Promise<string | undefined>;
  now?: Date;
}

/**
 * Computes a cold-start prior for every resolved wikilink, in the direction
 * it will be consumed (see SeedWeightsFile). Cheap by construction: one
 * pass over the already-fetched node list plus one stat() per note, sharing
 * the nightly pipeline's existing `nodes` read rather than re-walking the
 * vault.
 */
export async function buildSeedWeights(
  vaultPath: string,
  adapter: SourceAdapter = createObsidianAdapter(vaultPath),
  prebuiltNodes?: SourceNode[],
  options: BuildSeedWeightsOptions = {},
): Promise<SeedWeightsFile> {
  const config = options.config ?? DEFAULT_COLD_START_SEED_CONFIG;
  const now = options.now ?? new Date();
  const nodes = prebuiltNodes ?? (await adapter.listNodes());
  const directed = buildDirectedAdjacency(nodes, adapter);

  // Undirected degree: a link is evidence about the pair regardless of who
  // wrote it, so an inbound-only hub is just as unspecific as an outbound one.
  const degree = new Map<string, Set<string>>();
  function touch(a: string, b: string): void {
    if (!degree.has(a)) degree.set(a, new Set());
    degree.get(a)!.add(b);
  }
  for (const [from, targets] of directed) {
    for (const to of targets) {
      touch(from, to);
      touch(to, from);
    }
  }

  const mtimeOf = options.mtimeOf ?? defaultMtimeReader(vaultPath);
  const linked = [...degree.keys()];
  const mtimes = await statInBatches(linked, mtimeOf);

  const edges: Record<string, SeedRecord> = {};
  for (const [from, targets] of directed) {
    for (const to of targets) {
      const mutual = directed.get(to)?.has(from) ?? false;
      const strength =
        config.maxBonus * linkSpecificity(degree.get(to)?.size ?? 1) * (mutual ? 1 : config.oneWayFactor);
      // A note whose file cannot be stat'd (deleted between the listing and
      // this pass, or unreadable) keeps the prior but dates it now: the
      // alternative is dropping a real link because of a transient I/O
      // failure, and an over-fresh timestamp costs at most one half-life.
      edges[seedKey(from, to)] = { strength, recencyAt: mtimes.get(to) ?? now.toISOString() };
    }
  }

  return { version: SEED_WEIGHTS_FILE_VERSION, builtAt: now.toISOString(), edges };
}

function defaultMtimeReader(vaultPath: string): (notePath: string) => Promise<string | undefined> {
  return async (notePath) => {
    try {
      const stats = await stat(toFilePath(vaultPath, notePath));
      return stats.mtime.toISOString();
    } catch {
      return undefined;
    }
  };
}

async function statInBatches(
  paths: string[],
  mtimeOf: (notePath: string) => Promise<string | undefined>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (let start = 0; start < paths.length; start += STAT_CONCURRENCY) {
    const batch = paths.slice(start, start + STAT_CONCURRENCY);
    const stats = await Promise.all(batch.map(async (path) => [path, await mtimeOf(path)] as const));
    for (const [path, mtime] of stats) {
      if (mtime) result.set(path, mtime);
    }
  }
  return result;
}

export async function loadSeedWeights(vaultDataDir: string): Promise<SeedWeightsFile | null> {
  return loadCachedJson<SeedWeightsFile>(join(vaultDataDir, SEED_WEIGHTS_FILE_NAME));
}

async function persistSeedWeights(vaultDataDir: string, file: SeedWeightsFile): Promise<void> {
  await mkdir(vaultDataDir, { recursive: true });
  const targetPath = join(vaultDataDir, SEED_WEIGHTS_FILE_NAME);
  const tmpPath = join(vaultDataDir, `.${SEED_WEIGHTS_FILE_NAME}.${randomUUID()}.tmp`);
  await writeFile(tmpPath, JSON.stringify(file, null, 2), "utf8");
  await rename(tmpPath, targetPath);
  invalidateCachedFile(targetPath);
}

/** Rebuilds the seed priors from scratch and persists them atomically. */
export async function rebuildSeedWeights(
  vaultPath: string,
  vaultDataDir: string,
  adapter: SourceAdapter = createObsidianAdapter(vaultPath),
  prebuiltNodes?: SourceNode[],
  options: BuildSeedWeightsOptions = {},
): Promise<{ edgeCount: number; builtAt: string }> {
  const file = await buildSeedWeights(vaultPath, adapter, prebuiltNodes, options);
  await persistSeedWeights(vaultDataDir, file);
  return { edgeCount: Object.keys(file.edges).length, builtAt: file.builtAt };
}

/**
 * The prior as of `now`: the stored strength faded on the seed half-life
 * since the target note was last edited. Pure, so query.ts can apply it per
 * candidate without another file read.
 *
 * Returns 0 rather than a negative or a floor of its own — the caller adds
 * this to `structuralFallback.floorWeight`, and a seed that has fully faded
 * has to leave that floor exactly where VNL-058 measured it.
 */
export function liveSeedBonus(
  record: SeedRecord | undefined,
  now: Date,
  config: ColdStartSeedConfig = DEFAULT_COLD_START_SEED_CONFIG,
): number {
  if (!record) return 0;
  const ageDays = (now.getTime() - new Date(record.recencyAt).getTime()) / 86_400_000;
  if (!Number.isFinite(ageDays)) return 0;
  return decayWeight(record.strength, ageDays, { halfLifeDays: config.halfLifeDays });
}
