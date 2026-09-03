import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readNotesInBatches, writeNote } from "../src/notes.js";

// Counts how many readFile calls are in flight at once, so the batching is
// actually asserted rather than assumed (VNL-012).
const inFlight = { current: 0, peak: 0 };

vi.mock("node:fs/promises", async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      inFlight.current += 1;
      inFlight.peak = Math.max(inFlight.peak, inFlight.current);
      try {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return await actual.readFile(...args);
      } finally {
        inFlight.current -= 1;
      }
    },
  };
});

describe("readNotesInBatches (VNL-012)", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-batching-"));
    inFlight.current = 0;
    inFlight.peak = 0;
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("never holds more than `concurrency` reads open at once", async () => {
    const paths = Array.from({ length: 40 }, (_, i) => `Note ${i}`);
    for (const path of paths) await writeNote(vaultPath, path, { frontmatter: {}, body: "x" });
    inFlight.peak = 0;

    await readNotesInBatches(vaultPath, paths, 5);

    expect(inFlight.peak).toBeLessThanOrEqual(5);
    expect(inFlight.peak).toBeGreaterThan(1);
  });

  it("returns one aligned slot per path, null where the note is missing", async () => {
    await writeNote(vaultPath, "Present", { frontmatter: { type: "atomic" }, body: "hi" });

    const results = await readNotesInBatches(vaultPath, ["Missing", "Present"], 2);

    expect(results).toHaveLength(2);
    expect(results[0]).toBeNull();
    expect(results[1]?.frontmatter.type).toBe("atomic");
  });
});
