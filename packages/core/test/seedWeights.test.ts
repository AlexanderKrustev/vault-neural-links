import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildSeedWeights,
  linkSpecificity,
  liveSeedBonus,
  loadSeedWeights,
  rebuildSeedWeights,
  seedKey,
} from "../src/seedWeights.js";
import { rebuildStructuralIndex } from "../src/structuralLinks.js";
import { computeLiveNeighborWeights } from "../src/query.js";
import {
  DEFAULT_COLD_START_SEED_CONFIG,
  DEFAULT_STRUCTURAL_FALLBACK_CONFIG,
  HOT_PATH_ABLATION_LAYERS,
} from "../src/types.js";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const FRESH = "2026-09-10T11:00:00.000Z";

function ageIso(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("buildSeedWeights", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-seed-vault-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  /** Every note stat'd as freshly edited, so a test isolates one variable at a time. */
  const allFresh = { mtimeOf: async () => FRESH, now: NOW };

  it("scores a reciprocated link above a one-way one", async () => {
    await writeFile(join(vaultPath, "A.md"), "links [[B]] and [[C]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "links back to [[A]]", "utf8");
    await writeFile(join(vaultPath, "C.md"), "mentions nobody", "utf8");

    const seeds = await buildSeedWeights(vaultPath, undefined, undefined, allFresh);

    const mutual = seeds.edges[seedKey("A", "B")].strength;
    const oneWay = seeds.edges[seedKey("A", "C")].strength;
    expect(mutual).toBeGreaterThan(oneWay);
    expect(oneWay).toBeCloseTo(mutual * DEFAULT_COLD_START_SEED_CONFIG.oneWayFactor, 10);
  });

  it("discounts a link to a hub that half the vault links to", async () => {
    // Hub is linked from everything; Specific is linked only from A. Both
    // links are one-way and equally fresh, so degree is the only difference.
    await writeFile(join(vaultPath, "A.md"), "see [[Hub]] and [[Specific]]", "utf8");
    await writeFile(join(vaultPath, "Specific.md"), "body", "utf8");
    await writeFile(join(vaultPath, "Hub.md"), "body", "utf8");
    for (const other of ["B", "C", "D", "E"]) {
      await writeFile(join(vaultPath, `${other}.md`), "see [[Hub]]", "utf8");
    }

    const seeds = await buildSeedWeights(vaultPath, undefined, undefined, allFresh);

    expect(seeds.edges[seedKey("A", "Hub")].strength).toBeLessThan(seeds.edges[seedKey("A", "Specific")].strength);
  });

  it("dates each prior by the target note's own mtime, not the origin's", async () => {
    await writeFile(join(vaultPath, "A.md"), "see [[Old]] and [[New]]", "utf8");
    await writeFile(join(vaultPath, "Old.md"), "body", "utf8");
    await writeFile(join(vaultPath, "New.md"), "body", "utf8");

    const mtimes: Record<string, string> = { A: FRESH, Old: ageIso(120), New: FRESH };
    const seeds = await buildSeedWeights(vaultPath, undefined, undefined, {
      mtimeOf: async (path) => mtimes[path],
      now: NOW,
    });

    expect(seeds.edges[seedKey("A", "Old")].recencyAt).toBe(ageIso(120));
    expect(seeds.edges[seedKey("A", "New")].recencyAt).toBe(FRESH);
    // Undecayed strength is identical — recency only bites in liveSeedBonus,
    // so a rebuilt file stays valid as the notes age underneath it.
    expect(seeds.edges[seedKey("A", "Old")].strength).toBeCloseTo(seeds.edges[seedKey("A", "New")].strength, 10);
  });

  it("keeps a prior for a note it cannot stat, dated now rather than dropped", async () => {
    await writeFile(join(vaultPath, "A.md"), "see [[B]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "body", "utf8");

    const seeds = await buildSeedWeights(vaultPath, undefined, undefined, {
      mtimeOf: async () => undefined,
      now: NOW,
    });

    expect(seeds.edges[seedKey("A", "B")].recencyAt).toBe(NOW.toISOString());
  });

  it("stores priors directionally, since only the target can separate candidates", async () => {
    await writeFile(join(vaultPath, "A.md"), "see [[B]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "see [[A]]", "utf8");

    const seeds = await buildSeedWeights(vaultPath, undefined, undefined, allFresh);

    expect(seeds.edges[seedKey("A", "B")]).toBeDefined();
    expect(seeds.edges[seedKey("B", "A")]).toBeDefined();
  });

  it("never exceeds the configured ceiling, so a prior cannot approach a usage touch", async () => {
    await writeFile(join(vaultPath, "A.md"), "see [[B]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "see [[A]]", "utf8");

    const seeds = await buildSeedWeights(vaultPath, undefined, undefined, allFresh);

    for (const record of Object.values(seeds.edges)) {
      expect(record.strength).toBeLessThanOrEqual(DEFAULT_COLD_START_SEED_CONFIG.maxBonus);
    }
  });

  it("drops a self-link and an ambiguous title, same rule as the structural index", async () => {
    await mkdir(join(vaultPath, "One"), { recursive: true });
    await mkdir(join(vaultPath, "Two"), { recursive: true });
    await writeFile(join(vaultPath, "A.md"), "self [[A]] and ambiguous [[Index]]", "utf8");
    await writeFile(join(vaultPath, "One", "Index.md"), "body", "utf8");
    await writeFile(join(vaultPath, "Two", "Index.md"), "body", "utf8");

    const seeds = await buildSeedWeights(vaultPath, undefined, undefined, allFresh);

    expect(Object.keys(seeds.edges)).toEqual([]);
  });
});

describe("liveSeedBonus", () => {
  it("halves the prior after one half-life and keeps fading after that", () => {
    const record = { strength: 0.1, recencyAt: ageIso(DEFAULT_COLD_START_SEED_CONFIG.halfLifeDays) };
    expect(liveSeedBonus(record, NOW)).toBeCloseTo(0.05, 6);

    const older = { strength: 0.1, recencyAt: ageIso(DEFAULT_COLD_START_SEED_CONFIG.halfLifeDays * 2) };
    expect(liveSeedBonus(older, NOW)).toBeCloseTo(0.025, 6);
  });

  it("fades faster than the usage tier's default half-life, so a guess stops competing first", () => {
    const days = 30;
    const seeded = liveSeedBonus({ strength: 1, recencyAt: ageIso(days) }, NOW);
    const usageLike = Math.pow(0.5, days / 30);
    expect(seeded).toBeLessThan(usageLike);
  });

  it("returns 0 for an absent or unparseable record rather than a negative", () => {
    expect(liveSeedBonus(undefined, NOW)).toBe(0);
    expect(liveSeedBonus({ strength: 0.1, recencyAt: "not a date" }, NOW)).toBe(0);
  });

  it("does not inflate a prior dated in the future", () => {
    const future = { strength: 0.1, recencyAt: new Date(NOW.getTime() + 86_400_000).toISOString() };
    expect(liveSeedBonus(future, NOW)).toBe(0.1);
  });
});

describe("linkSpecificity", () => {
  it("is 1 for a note linked by nothing else and falls monotonically with degree", () => {
    expect(linkSpecificity(1)).toBe(1);
    expect(linkSpecificity(4)).toBeLessThan(linkSpecificity(2));
    expect(linkSpecificity(100)).toBeLessThan(linkSpecificity(10));
    expect(linkSpecificity(1000)).toBeGreaterThan(0);
  });
});

describe("cold-start priors in retrieval", () => {
  let vaultPath: string;
  let dataDir: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-seed-query-"));
    dataDir = join(vaultPath, ".vault-neural-links");
    await mkdir(dataDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  async function buildVault(): Promise<void> {
    // Mutual with A, and linked by nobody else — the strongest prior available.
    await writeFile(join(vaultPath, "A.md"), "links [[Mutual]] and [[Hub]]", "utf8");
    await writeFile(join(vaultPath, "Mutual.md"), "links back to [[A]]", "utf8");
    await writeFile(join(vaultPath, "Hub.md"), "body", "utf8");
    for (const other of ["B", "C", "D", "E"]) {
      await writeFile(join(vaultPath, `${other}.md`), "see [[Hub]]", "utf8");
    }
    await rebuildStructuralIndex(vaultPath, dataDir);
  }

  const weightOf = (neighbors: { path: string; weight: number }[], path: string) =>
    neighbors.find((n) => n.path === path)!.weight;

  // The priors are deliberately out of the serving path (see
  // HOT_PATH_ABLATION_LAYERS), so every test that wants to see them has to
  // ask for them — the same shape importance and consolidation have.
  const SEEDED = { ...HOT_PATH_ABLATION_LAYERS, coldStartSeed: true };
  const withSeeds = (dataDir: string, note: string, vaultPath: string) =>
    computeLiveNeighborWeights(dataDir, note, vaultPath, undefined, undefined, undefined, SEEDED);

  it("orders structural-only neighbours that were previously tied at the flat floor", async () => {
    await buildVault();
    await rebuildSeedWeights(vaultPath, dataDir, undefined, undefined, { mtimeOf: async () => FRESH, now: NOW });

    const neighbors = await withSeeds(dataDir, "A", vaultPath);

    expect(weightOf(neighbors, "Mutual")).toBeGreaterThan(weightOf(neighbors, "Hub"));
  });

  it("only ever adds to the floor, never erodes it", async () => {
    await buildVault();
    // Every target last edited a year ago: the priors have faded to
    // essentially nothing, which must leave pre-VNL-021 behaviour exactly.
    await rebuildSeedWeights(vaultPath, dataDir, undefined, undefined, {
      mtimeOf: async () => ageIso(365),
      now: NOW,
    });

    const neighbors = await withSeeds(dataDir, "A", vaultPath);

    for (const neighbor of neighbors) {
      expect(neighbor.weight).toBeGreaterThanOrEqual(DEFAULT_STRUCTURAL_FALLBACK_CONFIG.floorWeight);
      expect(neighbor.weight).toBeCloseTo(DEFAULT_STRUCTURAL_FALLBACK_CONFIG.floorWeight, 3);
    }
  });

  it("falls back to the flat floor when the nightly job has never run", async () => {
    await buildVault();

    const neighbors = await withSeeds(dataDir, "A", vaultPath);

    expect(neighbors.length).toBeGreaterThan(0);
    for (const neighbor of neighbors) {
      expect(neighbor.weight).toBe(DEFAULT_STRUCTURAL_FALLBACK_CONFIG.floorWeight);
    }
  });

  it("is out of the serving path by default, measured at no effect (VNL-021)", async () => {
    await buildVault();
    await rebuildSeedWeights(vaultPath, dataDir, undefined, undefined, { mtimeOf: async () => FRESH, now: NOW });

    const served = await computeLiveNeighborWeights(dataDir, "A", vaultPath);

    for (const neighbor of served) {
      expect(neighbor.weight).toBe(DEFAULT_STRUCTURAL_FALLBACK_CONFIG.floorWeight);
    }
  });

  it("is ablatable on its own, leaving the structural floor in place", async () => {
    await buildVault();
    await rebuildSeedWeights(vaultPath, dataDir, undefined, undefined, { mtimeOf: async () => FRESH, now: NOW });

    const neighbors = await computeLiveNeighborWeights(dataDir, "A", vaultPath, undefined, undefined, undefined, {
      ...HOT_PATH_ABLATION_LAYERS,
      coldStartSeed: false,
    });

    expect(neighbors.length).toBeGreaterThan(0);
    for (const neighbor of neighbors) {
      expect(neighbor.weight).toBe(DEFAULT_STRUCTURAL_FALLBACK_CONFIG.floorWeight);
    }
  });

  it("stays an order of magnitude below a single usage touch", async () => {
    await buildVault();
    await rebuildSeedWeights(vaultPath, dataDir, undefined, undefined, { mtimeOf: async () => FRESH, now: NOW });

    const neighbors = await withSeeds(dataDir, "A", vaultPath);

    for (const neighbor of neighbors) {
      expect(neighbor.weight).toBeLessThan(0.3);
    }
  });

  it("persists and reloads through the data dir", async () => {
    await buildVault();
    const result = await rebuildSeedWeights(vaultPath, dataDir, undefined, undefined, {
      mtimeOf: async () => FRESH,
      now: NOW,
    });

    const loaded = await loadSeedWeights(dataDir);
    expect(loaded?.edges[seedKey("A", "Mutual")]).toBeDefined();
    expect(Object.keys(loaded!.edges)).toHaveLength(result.edgeCount);
  });

  it("returns null, not a throw, when the file does not exist", async () => {
    expect(await loadSeedWeights(dataDir)).toBeNull();
  });
});
