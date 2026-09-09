import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, utimes, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildBriefing, formatBriefing, normalizeProjectKey, scopesForProject } from "../src/briefing.js";
import { branchTokens, detectGitBranch } from "../src/gitBranch.js";
import { runImportanceComputation } from "../src/importance.js";
import { rebuildStructuralIndex } from "../src/structuralLinks.js";
import { compact } from "../src/compactor.js";
import { appendEvent } from "../src/logger.js";
import { writeNote, toFilePath } from "../src/notes.js";

describe("session briefing (VNL-055)", () => {
  let vaultPath: string;
  let dataDir: string;

  beforeEach(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), "vnl-test-briefing-vault-"));
    dataDir = await mkdtemp(join(tmpdir(), "vnl-test-briefing-data-"));
  });

  afterEach(async () => {
    await rm(vaultPath, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  async function note(path: string, body: string, frontmatter: Record<string, unknown> = {}) {
    await writeNote(vaultPath, path, { frontmatter, body });
  }

  async function traverse(from: string, to: string, weight = 10) {
    await appendEvent(dataDir, "inst-1", {
      ts: new Date().toISOString(),
      instance: "inst-1",
      type: "traverse",
      from,
      to,
      weight_delta: weight,
    });
  }

  describe("project scoping", () => {
    it("collapses naming styles onto the same key", () => {
      expect(normalizeProjectKey("vault-neural-link")).toBe(normalizeProjectKey("Vault Neural Link"));
      expect(normalizeProjectKey("VaultNeuralLink")).toBe(normalizeProjectKey("vault_neural_link"));
      expect(normalizeProjectKey("Bunit2")).toBe("bunit2");
    });

    it("matches a folder at any depth, and tolerates a trailing plural", () => {
      const paths = [
        "Notes/VaultNeuralLinks/Some Decision",
        "02-Projects PPS/Bulstrad/Bunit2/Bugs/A Bug",
        "01-Personal/Personal/Home/Cooking",
      ];
      // The repo is "vault-neural-link"; the vault folder is "VaultNeuralLinks".
      expect(scopesForProject(paths, "vault-neural-link")).toEqual(["Notes/VaultNeuralLinks"]);
      expect(scopesForProject(paths, "Bunit2")).toEqual(["02-Projects PPS/Bulstrad/Bunit2"]);
    });

    it("never matches on a note's own name, only on folders", () => {
      // "Cooking" is a note, not a folder — scoping to it would produce a
      // scope that contains exactly one note and excludes everything else.
      expect(scopesForProject(["01-Personal/Personal/Home/Cooking"], "Cooking")).toEqual([]);
    });

    it("refuses to match on a key too short to mean anything", () => {
      expect(scopesForProject(["ab/Note"], "ab")).toEqual([]);
    });

    it("says so rather than guessing when nothing matches", async () => {
      await note("Notes/General/Anything", "text");

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "no-such-project", branch: null });

      expect(briefing.project).toBeNull();
      expect(briefing.matchedBy).toBe("none");
      expect(briefing.scopes).toEqual([]);
      expect(formatBriefing(briefing)).toContain("No vault folder matches");
    });

    it("reports how the project was resolved", async () => {
      await note("Notes/Widgets/One", "text");

      const explicit = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: null });
      expect(explicit.matchedBy).toBe("explicit");

      const fromCwd = await buildBriefing(vaultPath, dataDir, { cwd: "/home/me/code/widgets", branch: null });
      expect(fromCwd.matchedBy).toBe("cwd");
      expect(fromCwd.project).toBe("widgets");
    });
  });

  describe("content", () => {
    it("lists the notes the usage graph says this project worked with", async () => {
      await note("Notes/Widgets/Used A", "one");
      await note("Notes/Widgets/Used B", "two");
      await note("Notes/Other/Unrelated", "three");
      await traverse("Notes/Widgets/Used A", "Notes/Widgets/Used B");
      await compact(dataDir);

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: null });

      const paths = briefing.recentlyUsed.map((entry) => entry.path);
      expect(paths).toContain("Notes/Widgets/Used A");
      expect(paths).toContain("Notes/Widgets/Used B");
      // Scoping is the whole point: another project's notes must not appear.
      expect(paths).not.toContain("Notes/Other/Unrelated");
    });

    // Found running the briefing against the real vault: notes read minutes
    // earlier were reported as "last used 7 days ago", because usage weights
    // only move when the nightly job folds the event log. A session-start
    // briefing that is a day stale about what you were just doing has lost
    // most of its point.
    it("counts work done since the last compaction, not just folded weights", async () => {
      await note("Notes/Widgets/Touched Today", "text");
      await note("Notes/Widgets/Untouched", "text");
      await traverse("Notes/Widgets/Touched Today", "Notes/Widgets/Untouched", 5);
      // Deliberately no compact() — this is the uncompacted case.

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: null });

      const today = briefing.recentlyUsed.find((entry) => entry.path === "Notes/Widgets/Touched Today");
      expect(today).toBeDefined();
      expect(today!.note).toBe("last used today");
    });

    it("does not double-count events a compactor has already claimed", async () => {
      await note("Notes/Widgets/A", "text");
      await note("Notes/Widgets/B", "text");
      await traverse("Notes/Widgets/A", "Notes/Widgets/B", 5);
      await compact(dataDir);
      // compact() renames the log as it consumes it; anything left behind with
      // a .compacting suffix belongs to a run in flight and is already
      // represented in link-weights.json.
      await writeFile(
        join(dataDir, "events", "inst-2.jsonl.compacting-abc"),
        JSON.stringify({
          ts: new Date().toISOString(),
          instance: "inst-2",
          type: "traverse",
          from: "Notes/Widgets/A",
          to: "Notes/Widgets/B",
          weight_delta: 999,
        }) + "\n",
        "utf8",
      );

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: null });

      // Present from the compacted weights, but the 999 must not have landed.
      expect(briefing.recentlyUsed.map((e) => e.path)).toContain("Notes/Widgets/A");
    });

    it("survives a malformed line in the event log", async () => {
      await note("Notes/Widgets/A", "text");
      await mkdir(join(dataDir, "events"), { recursive: true });
      await writeFile(join(dataDir, "events", "inst-bad.jsonl"), "{not json at all\n", "utf8");

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: null });

      expect(briefing.recentlyChanged.map((e) => e.path)).toContain("Notes/Widgets/A");
    });

    it("excludes out-of-scope notes from every section, not just one", async () => {
      await note("Notes/Widgets/Mine", "in scope");
      await note("Notes/Gadgets/Theirs", "out of scope");
      await rebuildStructuralIndex(vaultPath, dataDir);
      await runImportanceComputation(dataDir);

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: null });

      for (const section of [briefing.recentlyUsed, briefing.recentlyChanged, briefing.central]) {
        expect(section.map((entry) => entry.path)).not.toContain("Notes/Gadgets/Theirs");
      }
    });

    it("orders recently changed by file modification time", async () => {
      await note("Notes/Widgets/Old", "old");
      await note("Notes/Widgets/New", "new");
      const old = new Date(Date.now() - 30 * 86_400_000);
      await utimes(toFilePath(vaultPath, "Notes/Widgets/Old"), old, old);

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: null });

      expect(briefing.recentlyChanged[0].path).toBe("Notes/Widgets/New");
      expect(briefing.recentlyChanged.map((e) => e.path)).toContain("Notes/Widgets/Old");
      // 30 days reads as "4 weeks ago", not "1 month ago" — weeks stay
      // readable up to 60 days, which is the range most stale notes fall in.
      expect(briefing.recentlyChanged.find((e) => e.path === "Notes/Widgets/Old")?.note).toContain("weeks ago");
    });

    // A briefing is read as current by virtue of being in the briefing, so a
    // reversed decision appearing in it unflagged is worse than it not
    // appearing at all.
    it("flags a superseded note with its successor", async () => {
      await note("Notes/Widgets/Old Decision", "we will charge from day one", {
        status: "superseded",
        superseded_by: "[[Notes/Widgets/New Decision]]",
      });
      await note("Notes/Widgets/New Decision", "free first");

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: null });

      const old = briefing.recentlyChanged.find((entry) => entry.path === "Notes/Widgets/Old Decision");
      expect(old?.supersededBy).toBeTruthy();
      expect(formatBriefing(briefing)).toContain("superseded by");
    });

    it("counts unprocessed inbox items", async () => {
      await note("Inbox/Scribble", "raw");
      await note("Inbox/Another", "raw");
      await note("Notes/Widgets/Real", "text");

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: null });

      expect(briefing.inboxCount).toBe(2);
      expect(formatBriefing(briefing)).toContain("2 unprocessed items");
    });

    it("surfaces a map-of-content note named after the project", async () => {
      await note("MOCs/Widgets", "the index for widgets");
      await note("Notes/Widgets/One", "text");

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: null });

      expect(briefing.mocs).toContain("MOCs/Widgets");
    });
  });

  // VNL-063. Which branch you are on is often a sharper statement of what
  // you are working on than which repository is. The founder's own case: on
  // a Bunit2 project, a `b2b` branch and a `test` branch want completely
  // different notes, and filling the context with the wrong half is worse
  // than filling it with nothing.
  describe("git branch", () => {
    it("keeps only the meaningful parts of a branch name", () => {
      expect(branchTokens("feature/BUN-42-b2b-cutover")).toEqual(["bun", "42", "b2b", "cutover"]);
      // Workflow prefixes say what kind of work it is, not what it is about.
      expect(branchTokens("main")).toEqual([]);
      expect(branchTokens("hotfix/x")).toEqual([]);
    });

    it("narrows to a subfolder when the branch names one", async () => {
      await note("Notes/Bunit2/b2b/Cutover Plan", "b2b work");
      await note("Notes/Bunit2/Analysis/Something Else", "unrelated work");

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Bunit2", branch: "b2b" });

      expect(briefing.branchUsedAs).toBe("scope");
      expect(briefing.scopes).toEqual(["Notes/Bunit2/b2b"]);
      const paths = briefing.recentlyChanged.map((entry) => entry.path);
      expect(paths).toContain("Notes/Bunit2/b2b/Cutover Plan");
      expect(paths).not.toContain("Notes/Bunit2/Analysis/Something Else");
      expect(formatBriefing(briefing)).toContain("Narrowed to branch");
    });

    // The common case: branches are usually named after tickets, not folders.
    // Narrowing on those would empty the briefing, which is the failure mode
    // worth avoiding.
    it("falls back to highlighting, never narrowing, when the branch names no folder", async () => {
      await note("Notes/Widgets/VNL-063 Design", "about the ticket");
      await note("Notes/Widgets/Unrelated", "other work");

      const briefing = await buildBriefing(vaultPath, dataDir, {
        project: "Widgets",
        branch: "feature/VNL-063-git-branch",
      });

      expect(briefing.branchUsedAs).toBe("filter");
      expect(briefing.scopes).toEqual(["Notes/Widgets"]);
      // Nothing was removed...
      expect(briefing.recentlyChanged.map((e) => e.path)).toContain("Notes/Widgets/Unrelated");
      // ...and the matching note is called out.
      expect(briefing.branchRelated.map((e) => e.path)).toContain("Notes/Widgets/VNL-063 Design");
      expect(formatBriefing(briefing)).toContain("it names no folder here");
    });

    it("never lets a branch jump the scope into another project's folder", async () => {
      await note("Notes/Widgets/Mine", "in scope");
      await note("Notes/Gadgets/b2b/Theirs", "another project entirely");

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: "b2b" });

      expect(briefing.scopes).toEqual(["Notes/Widgets"]);
      expect(briefing.recentlyChanged.map((e) => e.path)).not.toContain("Notes/Gadgets/b2b/Theirs");
    });

    it("does not narrow to the project scope itself when the branch is named after the project", async () => {
      await note("Notes/Widgets/One", "text");

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: "widgets" });

      // Reporting "narrowed" while changing nothing would be a lie.
      expect(briefing.branchUsedAs).not.toBe("scope");
      expect(briefing.scopes).toEqual(["Notes/Widgets"]);
    });

    it("ignores the branch entirely when the caller passes null", async () => {
      await note("Notes/Bunit2/b2b/Cutover Plan", "b2b work");
      await note("Notes/Bunit2/Analysis/Something Else", "unrelated");

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Bunit2", branch: null });

      expect(briefing.branch).toBeNull();
      expect(briefing.branchUsedAs).toBe("none");
      expect(briefing.scopes).toEqual(["Notes/Bunit2"]);
    });

    it("reads the branch from a real .git directory, and reports none when detached", async () => {
      const repo = await mkdtemp(join(tmpdir(), "vnl-test-repo-"));
      await mkdir(join(repo, ".git"), { recursive: true });
      await writeFile(join(repo, ".git", "HEAD"), "ref: refs/heads/feature/b2b\n", "utf8");
      expect(await detectGitBranch(repo)).toBe("feature/b2b");

      // Walks up from a subdirectory, the way a build in packages/x does.
      await mkdir(join(repo, "packages", "core"), { recursive: true });
      expect(await detectGitBranch(join(repo, "packages", "core"))).toBe("feature/b2b");

      await writeFile(join(repo, ".git", "HEAD"), "9f1c2b3d4e5f\n", "utf8");
      expect(await detectGitBranch(repo)).toBeNull();

      await rm(repo, { recursive: true, force: true });
    });

    it("resolves the .git-as-a-file form used by worktrees", async () => {
      const root = await mkdtemp(join(tmpdir(), "vnl-test-worktree-"));
      const realGit = join(root, "actual-git");
      await mkdir(realGit, { recursive: true });
      await writeFile(join(realGit, "HEAD"), "ref: refs/heads/wt-branch\n", "utf8");

      const worktree = join(root, "wt");
      await mkdir(worktree, { recursive: true });
      await writeFile(join(worktree, ".git"), `gitdir: ${realGit}\n`, "utf8");

      expect(await detectGitBranch(worktree)).toBe("wt-branch");

      await rm(root, { recursive: true, force: true });
    });

    it("returns no branch outside a repository", async () => {
      expect(await detectGitBranch(vaultPath)).toBeNull();
    });
  });

  describe("degradation", () => {
    // This runs before the agent has done anything, on a vault that may never
    // have had a nightly run. A thin briefing is fine; a failed one is not.
    it("produces a briefing on a vault with no indexes and no usage history", async () => {
      await note("Notes/Widgets/Only Note", "text");

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: null });

      expect(briefing.recentlyUsed).toEqual([]);
      expect(briefing.central).toEqual([]);
      expect(briefing.recentlyChanged.map((e) => e.path)).toEqual(["Notes/Widgets/Only Note"]);
      expect(formatBriefing(briefing)).toContain("Only Note");
    });

    it("says there is nothing to report rather than rendering empty headings", async () => {
      await mkdir(join(vaultPath, "Notes", "Widgets"), { recursive: true });
      // A folder with no notes in it: the scope resolves, the content does not.
      await writeFile(join(vaultPath, "Notes", "Widgets", "placeholder.txt"), "not a note", "utf8");

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", branch: null });
      const text = formatBriefing(briefing);

      expect(text).toContain("Nothing to report yet");
      expect(text).not.toContain("## Recently worked with");
    });

    it("keeps each section short enough to be read", async () => {
      for (let i = 0; i < 30; i++) await note(`Notes/Widgets/Note ${i}`, "text");

      const briefing = await buildBriefing(vaultPath, dataDir, { project: "Widgets", sectionSize: 3, branch: null });

      expect(briefing.recentlyChanged.length).toBe(3);
    });
  });
});
