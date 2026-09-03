import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  activationSocketFilePath,
  pruneStaleInstanceFiles,
  removeInstanceFiles,
} from "../src/sessionFiles.js";
import { persistSessionBuffer, SessionBuffer, sessionBufferFilePath } from "../src/priming.js";

async function writeAged(path: string, ageDays: number): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, "{}", "utf8");
  const when = new Date(Date.now() - ageDays * 86_400_000);
  await utimes(path, when, when);
}

describe("per-instance file housekeeping (VNL-009)", () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), "vnl-session-files-"));
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it("removeInstanceFiles deletes this instance's session buffer and socket registration", async () => {
    const buffer = new SessionBuffer();
    buffer.touch("A");
    await persistSessionBuffer(dataDir, "inst-1", buffer);
    await writeAged(activationSocketFilePath(dataDir, "inst-1"), 0);
    // A second instance's files must survive.
    await persistSessionBuffer(dataDir, "inst-2", buffer);

    await removeInstanceFiles(dataDir, "inst-1");

    expect(await readdir(join(dataDir, "session"))).toEqual(["inst-2.json"]);
    expect(await readdir(join(dataDir, "activation-sockets"))).toEqual([]);
  });

  it("removeInstanceFiles is a no-op when the files are already gone", async () => {
    await expect(removeInstanceFiles(dataDir, "never-existed")).resolves.toBeUndefined();
  });

  it("prunes stale session and socket files but keeps a live session's", async () => {
    await writeAged(sessionBufferFilePath(dataDir, "stale"), 5);
    await writeAged(sessionBufferFilePath(dataDir, "live"), 0);
    await writeAged(activationSocketFilePath(dataDir, "stale"), 5);
    await writeAged(activationSocketFilePath(dataDir, "live"), 0);

    const result = await pruneStaleInstanceFiles(dataDir);

    expect(result.removed.session).toBe(1);
    expect(result.removed["activation-sockets"]).toBe(1);
    expect(await readdir(join(dataDir, "session"))).toEqual(["live.json"]);
    expect(await readdir(join(dataDir, "activation-sockets"))).toEqual(["live.json"]);
  });

  it("keeps retrieval and search logs far longer than session state, then expires them", async () => {
    await writeAged(join(dataDir, "retrieval", "recent.jsonl"), 10);
    await writeAged(join(dataDir, "retrieval", "ancient.jsonl"), 200);
    await writeAged(join(dataDir, "search", "recent.jsonl"), 10);

    const result = await pruneStaleInstanceFiles(dataDir);

    expect(result.removed.retrieval).toBe(1);
    expect(result.removed.search).toBe(0);
    expect(await readdir(join(dataDir, "retrieval"))).toEqual(["recent.jsonl"]);
  });

  it("ignores directories that don't exist and files of other extensions", async () => {
    await writeAged(join(dataDir, "session", "notes.txt"), 30);

    const result = await pruneStaleInstanceFiles(dataDir);

    expect(result.removed).toEqual({
      session: 0,
      "activation-sockets": 0,
      retrieval: 0,
      search: 0,
    });
    expect(await readdir(join(dataDir, "session"))).toEqual(["notes.txt"]);
  });
});
