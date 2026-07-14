import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "../src/logger.js";
import { compact } from "../src/compactor.js";
import { retrieveWithFallback } from "../src/fallback.js";

function event(overrides: { from: string; to: string; weight_delta: number }) {
  return {
    ts: new Date().toISOString(),
    instance: "inst-1",
    type: "traverse" as const,
    ...overrides,
  };
}

describe("retrieveWithFallback", () => {
  let dataDir: string;
  let vaultPath: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-fallback-data-"));
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-fallback-vault-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("serves from the activation tier when a usage-weighted edge exists", async () => {
    await appendEvent(dataDir, "inst-1", event({ from: "A", to: "B", weight_delta: 10 }));
    await compact(dataDir);

    const result = await retrieveWithFallback(dataDir, vaultPath, "A", 10);
    expect(result.tier).toBe("activation");
    expect(result.notes.map((n) => n.path)).toEqual(["B"]);
  });

  it("falls through to the keyword tier when the note has no edges but a title match exists", async () => {
    await writeFile(join(vaultPath, "A.md"), "body", "utf8");
    await writeFile(join(vaultPath, "A Sibling.md"), "body", "utf8");

    const result = await retrieveWithFallback(dataDir, vaultPath, "A", 10);
    expect(result.tier).toBe("keyword");
    expect(result.notes.map((n) => n.path)).toEqual(["A Sibling"]);
  });

  it("falls through to the recency tier as a last resort, excluding the origin note", async () => {
    // "Qrst" is chosen so it shares no substring with the other note titles
    // or their "body" content, ruling out a keyword-tier match.
    await writeFile(join(vaultPath, "Qrst.md"), "body", "utf8");
    await writeFile(join(vaultPath, "Foo.md"), "body", "utf8");
    await utimes(join(vaultPath, "Foo.md"), new Date("2020-01-01"), new Date("2020-01-01"));
    await writeFile(join(vaultPath, "Bar.md"), "body", "utf8");
    await utimes(join(vaultPath, "Bar.md"), new Date("2024-06-15"), new Date("2024-06-15"));

    const result = await retrieveWithFallback(dataDir, vaultPath, "Qrst", 10);
    expect(result.tier).toBe("recency");
    expect(result.notes.map((n) => n.path)).toEqual(["Bar", "Foo"]);
  });

  it("resolves to the recency tier with an empty array, rather than throwing, when the vault has only the origin note", async () => {
    await writeFile(join(vaultPath, "A.md"), "body", "utf8");

    const result = await retrieveWithFallback(dataDir, vaultPath, "A", 10);
    expect(result.tier).toBe("recency");
    expect(result.notes).toEqual([]);
  });
});
