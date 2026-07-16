import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "../src/logger.js";
import { compact } from "../src/compactor.js";
import { rebuildStructuralIndex } from "../src/structuralLinks.js";
import { runImportanceComputation } from "../src/importance.js";
import { SessionBuffer } from "../src/priming.js";
import { runAblationComparison } from "../src/ablation.js";
import type { EventLogEntry } from "../src/types.js";

function event(overrides: Partial<EventLogEntry>): EventLogEntry {
  return {
    ts: new Date().toISOString(),
    instance: "inst-1",
    type: "traverse",
    from: "A",
    to: "B",
    weight_delta: 1,
    ...overrides,
  };
}

describe("runAblationComparison", () => {
  let dataDir: string;
  let vaultPath: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-ablation-data-"));
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-ablation-vault-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("disabling structuralFallback removes structural-only neighbors from the ablated run", async () => {
    await writeFile(join(vaultPath, "A.md"), "linked to [[B]]", "utf8");
    await writeFile(join(vaultPath, "B.md"), "body", "utf8");
    await rebuildStructuralIndex(vaultPath, dataDir);

    const result = await runAblationComparison(dataDir, "A", 10, { structuralFallback: false }, undefined, vaultPath);

    expect(result.baseline.find((n) => n.path === "B")).toBeDefined();
    expect(result.ablated.find((n) => n.path === "B")).toBeUndefined();
    expect(result.diff).toContainEqual(expect.objectContaining({ path: "B", status: "removed" }));
  });

  it("disabling consolidation lowers a promoted edge's energy and shows up as reranked", async () => {
    // A competing neighbor C with fixed weight is needed so B's share of A's
    // outgoing energy actually shifts when B's consolidatedScore is
    // ablated — with only one neighbor its share is always 1 regardless of
    // its weight.
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "C", weight_delta: 10 }));
    await compact(dataDir);

    const raw = JSON.parse(await readFile(join(dataDir, "link-weights.json"), "utf8"));
    raw.edges["A|B"].consolidatedScore = 50;
    await writeFile(join(dataDir, "link-weights.json"), JSON.stringify(raw), "utf8");

    const result = await runAblationComparison(dataDir, "A", 10, { consolidation: false });

    const baselineB = result.baseline.find((n) => n.path === "B")!;
    const ablatedB = result.ablated.find((n) => n.path === "B")!;
    expect(baselineB).toBeDefined();
    expect(ablatedB).toBeDefined();
    expect(ablatedB.energy).toBeLessThan(baselineB.energy);
    expect(result.diff).toContainEqual(
      expect.objectContaining({ path: "B", status: "reranked", baselineEnergy: baselineB.energy, ablatedEnergy: ablatedB.energy }),
    );
  });

  it("disabling importance lowers a hub neighbor's energy relative to baseline", async () => {
    // Leaf is A's competing neighbor with equal usage weight but no
    // incoming links (no importance) — needed so Hub's share of A's
    // outgoing energy actually shifts when its importance boost is ablated.
    await writeFile(join(vaultPath, "A.md"), "linked to [[Hub]] and [[Leaf]]", "utf8");
    await writeFile(join(vaultPath, "Hub.md"), "body", "utf8");
    await writeFile(join(vaultPath, "Leaf.md"), "body", "utf8");
    await writeFile(join(vaultPath, "Other1.md"), "linked to [[Hub]]", "utf8");
    await writeFile(join(vaultPath, "Other2.md"), "linked to [[Hub]]", "utf8");
    await rebuildStructuralIndex(vaultPath, dataDir);
    await runImportanceComputation(dataDir);

    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "Hub", weight_delta: 5 }));
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "Leaf", weight_delta: 5 }));
    await compact(dataDir);

    const result = await runAblationComparison(dataDir, "A", 10, { importance: false }, undefined, vaultPath);

    const baselineHub = result.baseline.find((n) => n.path === "Hub")!;
    const ablatedHub = result.ablated.find((n) => n.path === "Hub")!;
    expect(ablatedHub.energy).toBeLessThan(baselineHub.energy);
  });

  it("disabling priming lowers a session-primed neighbor's energy relative to baseline", async () => {
    // C is a competing, unprimed neighbor with equal usage weight — needed
    // so B's share of A's outgoing energy actually shifts when its priming
    // bonus is ablated.
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "C", weight_delta: 10 }));
    await compact(dataDir);

    const sessionBuffer = new SessionBuffer();
    sessionBuffer.touch("B");

    const result = await runAblationComparison(dataDir, "A", 10, { priming: false }, undefined, undefined, sessionBuffer);

    const baselineB = result.baseline.find((n) => n.path === "B")!;
    const ablatedB = result.ablated.find((n) => n.path === "B")!;
    expect(ablatedB.energy).toBeLessThan(baselineB.energy);
  });

  it("produces an empty diff when no layers are disabled", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await compact(dataDir);

    const result = await runAblationComparison(dataDir, "A", 10, {});
    expect(result.diff).toEqual([]);
    expect(result.baseline).toEqual(result.ablated);
  });
});
