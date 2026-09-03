import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "../src/logger.js";
import { compact } from "../src/compactor.js";
import { getEdgeWeight } from "../src/query.js";
import type { EventLogEntry } from "../src/types.js";

function event(overrides: Partial<EventLogEntry> = {}): EventLogEntry {
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

async function eventFiles(dataDir: string): Promise<string[]> {
  return (await readdir(join(dataDir, "events"))).filter((f) => f.endsWith(".jsonl"));
}

describe("compactor durability (VNL-004)", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-compact-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("claims event files by renaming, so an append made mid-compaction is not deleted unread", async () => {
    await appendEvent(dataDir, "inst-1", event({ weight_delta: 2 }));

    // Stand in for a live session appending while the compactor is reading:
    // claim the file the way compact() does, append to the original name, and
    // confirm the claimed copy is what gets folded and removed.
    const eventsDir = join(dataDir, "events");
    const { rename } = await import("node:fs/promises");
    await rename(join(eventsDir, "inst-1.jsonl"), join(eventsDir, "inst-1.jsonl.compacting-prev"));
    await appendEvent(dataDir, "inst-1", event({ weight_delta: 5 }));

    const first = await compact(dataDir);
    expect(first.edgeCount).toBe(1);
    // Both the orphaned claim and the freshly appended file are folded in and
    // then removed, and nothing is counted twice.
    expect(await getEdgeWeight(dataDir, "A", "B")).toBeCloseTo(7, 5);
    expect(await eventFiles(dataDir)).toEqual([]);

    const second = await compact(dataDir);
    expect(second.edgeCount).toBe(1);
    expect(await getEdgeWeight(dataDir, "A", "B")).toBeCloseTo(7, 5);
  });

  it("leaves no .compacting file behind after a successful run", async () => {
    await appendEvent(dataDir, "inst-1", event({}));
    await compact(dataDir);

    const remaining = await readdir(join(dataDir, "events"));
    expect(remaining.filter((f) => f.includes(".compacting"))).toEqual([]);
  });

  it("quarantines a malformed line instead of aborting, and folds the rest of the log", async () => {
    const eventsDir = join(dataDir, "events");
    await mkdir(eventsDir, { recursive: true });
    const good = JSON.stringify(event({ weight_delta: 3 }));
    const alsoGood = JSON.stringify(event({ from: "C", to: "D", weight_delta: 4 }));
    // A truncated final line is what a power cut mid-append actually leaves,
    // plus a well-formed JSON object that isn't an event at all.
    await writeFile(
      join(eventsDir, "inst-1.jsonl"),
      `${good}\n{"unrelated": true}\n${alsoGood}\n{"ts":"2026-01-0`,
      "utf8",
    );

    const result = await compact(dataDir);

    expect(result.quarantinedLines).toBe(2);
    expect(result.edgeCount).toBe(2);
    expect(await getEdgeWeight(dataDir, "A", "B")).toBeCloseTo(3, 5);
    expect(await getEdgeWeight(dataDir, "C", "D")).toBeCloseTo(4, 5);

    const quarantined = await readdir(join(eventsDir, "quarantine"));
    expect(quarantined).toHaveLength(1);
    const contents = await readFile(join(eventsDir, "quarantine", quarantined[0]), "utf8");
    expect(contents).toContain('{"unrelated": true}');
    expect(contents).toContain('{"ts":"2026-01-0');
  });

  it("skips the run rather than double-folding when another compactor holds the lock", async () => {
    await appendEvent(dataDir, "inst-1", event({ weight_delta: 2 }));
    await mkdir(dataDir, { recursive: true });
    await writeFile(
      join(dataDir, ".compact.lock"),
      JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }),
      "utf8",
    );

    const result = await compact(dataDir);

    expect(result.skipped).toBe(true);
    // Untouched: the event file is still there for the lock holder to fold.
    expect(await eventFiles(dataDir)).toEqual(["inst-1.jsonl"]);
    expect(await getEdgeWeight(dataDir, "A", "B")).toBeFalsy();
  });

  it("reclaims a stale lock left by a crashed compactor", async () => {
    await appendEvent(dataDir, "inst-1", event({ weight_delta: 2 }));
    await mkdir(dataDir, { recursive: true });
    const longAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    await writeFile(
      join(dataDir, ".compact.lock"),
      JSON.stringify({ pid: 999999, startedAt: longAgo }),
      "utf8",
    );

    const result = await compact(dataDir);

    expect(result.skipped).toBeUndefined();
    expect(await getEdgeWeight(dataDir, "A", "B")).toBeCloseTo(2, 5);
  });

  it("releases the lock at the end of a run, so the next run proceeds", async () => {
    await appendEvent(dataDir, "inst-1", event({}));
    await compact(dataDir);

    await expect(readFile(join(dataDir, ".compact.lock"), "utf8")).rejects.toThrow();

    await appendEvent(dataDir, "inst-1", event({ weight_delta: 1 }));
    const second = await compact(dataDir);
    expect(second.skipped).toBeUndefined();
    expect(await getEdgeWeight(dataDir, "A", "B")).toBeCloseTo(2, 5);
  });

  it("two concurrent compactions fold each event exactly once", async () => {
    for (let i = 0; i < 5; i += 1) {
      await appendEvent(dataDir, `inst-${i}`, event({ weight_delta: 1 }));
    }

    const [a, b] = await Promise.all([compact(dataDir), compact(dataDir)]);

    // Whichever lost the race did nothing; the winner folded all five.
    expect([a.skipped, b.skipped].filter(Boolean)).toHaveLength(1);
    expect(await getEdgeWeight(dataDir, "A", "B")).toBeCloseTo(5, 5);
  });
});
