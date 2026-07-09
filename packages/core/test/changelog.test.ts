import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendChangelogEntry } from "../src/changelog.js";

describe("appendChangelogEntry", () => {
  let vaultPath: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-changelog-test-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  it("appends a JSON line with a generated timestamp", async () => {
    await appendChangelogEntry(vaultPath, { action: "create", file: "Foo.md", reason: "test" });

    const content = await readFile(join(vaultPath, "changes.jsonl"), "utf8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(1);

    const entry = JSON.parse(lines[0]);
    expect(entry).toMatchObject({ action: "create", file: "Foo.md", reason: "test" });
    expect(typeof entry.ts).toBe("string");
  });

  it("appends multiple entries across calls", async () => {
    await appendChangelogEntry(vaultPath, { action: "create", file: "A.md", reason: "r1" });
    await appendChangelogEntry(vaultPath, { action: "update", file: "A.md", reason: "r2" });

    const content = await readFile(join(vaultPath, "changes.jsonl"), "utf8");
    expect(content.trim().split("\n")).toHaveLength(2);
  });
});
