import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * VNL-063 — which branch the working directory is on, read straight from
 * `.git`.
 *
 * No git binary and no dependency: `.git/HEAD` is a one-line text file, and
 * shelling out would make the briefing depend on git being installed and on
 * a subprocess completing, for information that is one `readFile` away. It
 * also keeps this usable from the Obsidian plugin, where spawning processes
 * is not available.
 *
 * Every failure returns null rather than throwing. A briefing must work in a
 * directory that is not a repository at all, which is the majority of them.
 */

/** Branch prefixes that say what kind of work it is, not what it is about. */
const BRANCH_NOISE = new Set([
  "feature",
  "features",
  "feat",
  "fix",
  "bugfix",
  "hotfix",
  "chore",
  "refactor",
  "release",
  "wip",
  "task",
  "story",
  "dev",
  "develop",
  "main",
  "master",
  "trunk",
]);

/**
 * Walks up from `cwd` looking for `.git`, and returns the checked-out branch.
 *
 * Returns null on a detached HEAD: there is no branch name to reason about,
 * and inventing one from the commit hash would be worse than having none.
 * Handles the `.git`-as-a-file form too, which is what worktrees and
 * submodules use — a briefing is exactly the sort of thing someone runs
 * inside a worktree.
 */
export async function detectGitBranch(cwd: string): Promise<string | null> {
  let dir = resolve(cwd);

  for (;;) {
    const candidate = join(dir, ".git");
    try {
      const info = await stat(candidate);
      const gitDir = info.isDirectory() ? candidate : await resolveGitFile(candidate);
      if (gitDir) {
        const branch = await readHead(gitDir);
        if (branch) return branch;
      }
      return null;
    } catch {
      // No .git here; keep walking up.
    }

    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `.git` as a file: `gitdir: <path>`, absolute or relative to the file's directory. */
async function resolveGitFile(gitFile: string): Promise<string | null> {
  try {
    const content = await readFile(gitFile, "utf8");
    const match = /^gitdir:\s*(.+)$/m.exec(content);
    if (!match) return null;
    const target = match[1].trim();
    return isAbsolute(target) ? target : resolve(dirname(gitFile), target);
  } catch {
    return null;
  }
}

async function readHead(gitDir: string): Promise<string | null> {
  try {
    const head = await readFile(join(gitDir, "HEAD"), "utf8");
    const match = /^ref:\s*refs\/heads\/(.+)$/m.exec(head.trim());
    return match ? match[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * The parts of a branch name worth matching notes against.
 *
 * `feature/BUN-42-b2b-cutover` yields `bun`, `42`, `b2b`, `cutover` — the
 * workflow prefix is dropped because every branch has one and it says nothing
 * about subject matter, and single characters go because they match
 * everything. Order is preserved so the most specific segment of a branch
 * name (usually the last) can be weighted by a caller if it wants to.
 */
export function branchTokens(branch: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of branch.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2) continue;
    if (BRANCH_NOISE.has(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    tokens.push(raw);
  }
  return tokens;
}
