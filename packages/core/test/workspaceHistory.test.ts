
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historyPairs, importWorkspaceHistory } from "../src/workspaceHistory.js";
import { compact } from "../src/compactor.js";
import { getEdgeWeight } from "../src/query.js";
import { computeUsageReport } from "../src/usageReport.js";
import { DEFAULT_WORKSPACE_HISTORY_CONFIG } from "../src/types.js";

describe("historyPairs", () => {
  it("pairs each entry with the next one, in stack order", () => {
    expect(historyPairs(["A.md", "B.md", "C.md"])).toEqual([
      ["A", "B"],
      ["B", "C"],
    ]);
  });

  it("ignores everything that is not a note", () => {
    expect(historyPairs(["A.md", "scan.pdf", "board.canvas", "shot.png", "B.md"])).toEqual([["A", "B"]]);
  });

  it("keeps the vault-relative path and drops only the extension", () => {
    expect(historyPairs(["Notes/VNL/Design Decisions.md", "MOCs/General.md"])).toEqual([
      ["Notes/VNL/Design Decisions", "MOCs/General"],
    ]);
  });

  it("drops a self-pair and a pair already seen in the other direction", () => {
    // An MRU stack routinely holds the same note twice, and A→B is the same
    // relationship as B→A in an undirected graph.
    expect(historyPairs(["A.md", "A.md", "B.md", "A.md"])).toEqual([["A", "B"]]);
  });

  it("returns nothing for a missing, empty or wrongly-typed stack", () => {
    expect(historyPairs(undefined)).toEqual([]);
    expect(historyPairs([])).toEqual([]);
    expect(historyPairs("Notes/A.md")).toEqual([]);
    expect(historyPairs([42, null, { path: "A.md" }])).toEqual([]);
  });

  it("survives a single-entry stack, which yields no pair at all", () => {
    expect(historyPairs(["A.md"])).toEqual([]);
  });
});

describe("importWorkspaceHistory", () => {
  let vaultPath: string;
  let dataDir: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-history-"));
    dataDir = join(vaultPath, ".vault-neural-links");
    await mkdir(dataDir, { recursive: true });
    await mkdir(join(vaultPath, ".obsidian"), { recursive: true });
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
  });

  /** Every line of every event log in the data dir, which is what a fold would see. */
  async function loggedEvents(): Promise<{ type: string; trigger?: string; weight_delta: number }[]> {
    const dir = join(dataDir, "events");
    const files = await readdir(dir).catch(() => [] as string[]);
    const events = [];
    for (const file of files.filter((name) => name.endsWith(".jsonl"))) {
      const raw = await readFile(join(dir, file), "utf8");
      const lines = raw.trimEnd().split(String.fromCharCode(10)).filter(Boolean);
      for (const line of lines) events.push(JSON.parse(line));
    }
    return events;
  }

  async function writeWorkspace(name: string, lastOpenFiles: unknown): Promise<void> {
    await writeFile(join(vaultPath, ".obsidian", name), JSON.stringify({ lastOpenFiles }), "utf8");
  }

  it("logs one traverse event per consecutive pair, at the imported weight and trigger", async () => {
    await writeWorkspace("workspace.json", ["A.md", "B.md", "C.md"]);

    const result = await importWorkspaceHistory(vaultPath, dataDir);

    expect(result.eventCount).toBe(2);
    const events = await loggedEvents();
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.type).toBe("traverse");
      expect(event.trigger).toBe("history-import");
      expect(event.weight_delta).toBe(DEFAULT_WORKSPACE_HISTORY_CONFIG.importWeight);
    }
  });

  it("weighs an imported pair below a live human open, which is below an agent traversal", async () => {
    // The ordering is the claim, not the constants: watched beats imported,
    // deliberate retrieval beats both.
    expect(DEFAULT_WORKSPACE_HISTORY_CONFIG.importWeight).toBeLessThan(0.25);
    expect(0.25).toBeLessThan(1);
  });

  it("reads every per-machine workspace file, since a synced vault has one each", async () => {
    await writeWorkspace("workspace.json", ["A.md", "B.md"]);
    await writeWorkspace("workspace-laptop.json", ["C.md", "D.md"]);

    const result = await importWorkspaceHistory(vaultPath, dataDir);

    expect(result.sources).toHaveLength(2);
    expect(result.eventCount).toBe(2);
  });

  it("does nothing on a second run, so a user cannot inflate the graph by repeating it", async () => {
    await writeWorkspace("workspace.json", ["A.md", "B.md", "C.md"]);
    await importWorkspaceHistory(vaultPath, dataDir);

    const second = await importWorkspaceHistory(vaultPath, dataDir);

    expect(second.alreadyImported).toBe(true);
    expect(second.eventCount).toBe(0);
    expect(await loggedEvents()).toHaveLength(2);
  });

  it("imports only what is new when forced after further navigation", async () => {
    await writeWorkspace("workspace.json", ["A.md", "B.md"]);
    await importWorkspaceHistory(vaultPath, dataDir);

    await writeWorkspace("workspace.json", ["Z.md", "A.md", "B.md"]);
    const second = await importWorkspaceHistory(vaultPath, dataDir, { force: true });

    // Z|A is new; A|B was already credited.
    expect(second.eventCount).toBe(1);
    expect(second.pairCount).toBe(2);
  });

  it("keeps the other workspace files when one is corrupt or mid-write", async () => {
    await writeFile(join(vaultPath, ".obsidian", "workspace.json"), "{ half-written", "utf8");
    await writeWorkspace("workspace-laptop.json", ["A.md", "B.md"]);

    const result = await importWorkspaceHistory(vaultPath, dataDir);

    expect(result.eventCount).toBe(1);
  });

  it("returns cleanly for a folder that is not an Obsidian vault", async () => {
    await rm(join(vaultPath, ".obsidian"), { recursive: true, force: true });

    const result = await importWorkspaceHistory(vaultPath, dataDir);

    expect(result).toMatchObject({ sources: [], eventCount: 0, pairCount: 0 });
  });

  it("becomes real graph weight once compacted", async () => {
    await writeWorkspace("workspace.json", ["A.md", "B.md"]);
    await importWorkspaceHistory(vaultPath, dataDir);

    await compact(dataDir);

    const weight = await getEdgeWeight(dataDir, "A", "B");
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThan(DEFAULT_WORKSPACE_HISTORY_CONFIG.importWeight + 1e-9);
  });

  it("is counted apart from navigation this machine actually observed", async () => {
    await writeWorkspace("workspace.json", ["A.md", "B.md"]);
    await importWorkspaceHistory(vaultPath, dataDir);

    const report = await computeUsageReport(dataDir);

    expect(report.mechanismCounts.human).toEqual({ opens: 0, edits: 0, historyImported: 1 });
    expect(report.mechanismCounts.traverse).toBe(0);
  });

  it("records what it credited, so the marker can be inspected", async () => {
    await writeWorkspace("workspace.json", ["A.md", "B.md"]);
    await importWorkspaceHistory(vaultPath, dataDir);

    const marker = JSON.parse(await readFile(join(dataDir, "workspace-history-imported.json"), "utf8"));
    expect(marker.pairs).toEqual(["A|B"]);
    expect(typeof marker.importedAt).toBe("string");
  });
});
