import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { consolidate, runNightlyConsolidation } from "../src/consolidation.js";
import type { EdgeRecord, LinkWeightsFile } from "../src/types.js";

function record(overrides: Partial<EdgeRecord> = {}): EdgeRecord {
  return {
    baseStrength: 5,
    lastTouched: new Date().toISOString(),
    traverseCount: 1,
    reinforceCount: 0,
    reactivationDays: [],
    consolidatedScore: 0,
    ...overrides,
  };
}

function weightsFile(edges: Record<string, EdgeRecord>): LinkWeightsFile {
  return { version: 1, compactedAt: new Date().toISOString(), edges };
}

describe("consolidate", () => {
  it("promotes an edge reactivated on enough distinct days within the window", () => {
    const now = new Date("2026-07-13T00:00:00.000Z");
    const days = ["2026-07-08", "2026-07-10", "2026-07-12"];
    const weights = weightsFile({ "A|B": record({ reactivationDays: days }) });

    const { weights: updated, promotedCount } = consolidate(weights, now, {
      reactivationThreshold: 3,
      windowDays: 7,
      promotionIncrement: 2,
    });

    expect(promotedCount).toBe(1);
    expect(updated.edges["A|B"].consolidatedScore).toBe(2);
  });

  it("does not promote when reactivation count is below the threshold", () => {
    const now = new Date("2026-07-13T00:00:00.000Z");
    const weights = weightsFile({ "A|B": record({ reactivationDays: ["2026-07-12", "2026-07-11"] }) });

    const { weights: updated, promotedCount } = consolidate(weights, now, {
      reactivationThreshold: 3,
      windowDays: 7,
      promotionIncrement: 2,
    });

    expect(promotedCount).toBe(0);
    expect(updated.edges["A|B"].consolidatedScore).toBe(0);
  });

  it("ignores reactivation days outside the trailing window", () => {
    const now = new Date("2026-07-13T00:00:00.000Z");
    // Only one of these three days falls within a 3-day window.
    const weights = weightsFile({
      "A|B": record({ reactivationDays: ["2026-06-01", "2026-06-15", "2026-07-12"] }),
    });

    const { promotedCount } = consolidate(weights, now, {
      reactivationThreshold: 2,
      windowDays: 3,
      promotionIncrement: 1,
    });

    expect(promotedCount).toBe(0);
  });

  it("keeps deepening consolidatedScore on repeated qualifying runs", () => {
    const now = new Date("2026-07-13T00:00:00.000Z");
    const days = ["2026-07-08", "2026-07-10", "2026-07-12"];
    const weights = weightsFile({ "A|B": record({ reactivationDays: days }) });
    const config = { reactivationThreshold: 3, windowDays: 7, promotionIncrement: 1 };

    const first = consolidate(weights, now, config);
    const second = consolidate(first.weights, now, config);

    expect(second.weights.edges["A|B"].consolidatedScore).toBe(2);
  });
});

describe("runNightlyConsolidation", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-consolidation-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns a zero result when no weights file exists yet", async () => {
    const result = await runNightlyConsolidation(dataDir);
    expect(result).toEqual({ edgeCount: 0, promotedCount: 0, consolidatedAt: result.consolidatedAt });
  });

  it("writes promoted scores back to link-weights.json atomically", async () => {
    const now = new Date("2026-07-13T00:00:00.000Z");
    const weights = weightsFile({
      "A|B": record({ reactivationDays: ["2026-07-08", "2026-07-10", "2026-07-12"] }),
    });
    await writeFile(join(dataDir, "link-weights.json"), JSON.stringify(weights), "utf8");

    const result = await runNightlyConsolidation(
      dataDir,
      { reactivationThreshold: 3, windowDays: 7, promotionIncrement: 1 },
      now,
    );

    expect(result).toEqual({ edgeCount: 1, promotedCount: 1, consolidatedAt: now.toISOString() });

    const raw = JSON.parse(await readFile(join(dataDir, "link-weights.json"), "utf8")) as LinkWeightsFile;
    expect(raw.edges["A|B"].consolidatedScore).toBe(1);
  });
});
