import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface CommitResult {
  committed: boolean;
  reason?: string;
}

/**
 * Stages and commits all pending changes in the vault repo. Fails open:
 * any error (not a git repo, git not installed, nothing to commit) is
 * reported back rather than thrown, so a git problem never blocks the
 * note write that already happened — mirrors vault-postwrite.ps1's
 * try/catch-and-continue approach.
 */
export async function commitVaultChanges(vaultPath: string, message: string): Promise<CommitResult> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: vaultPath });
    if (!stdout.trim()) return { committed: false, reason: "nothing to commit" };

    await execFileAsync("git", ["add", "-A"], { cwd: vaultPath });
    await execFileAsync("git", ["commit", "-q", "-m", message], { cwd: vaultPath });
    return { committed: true };
  } catch (err) {
    return { committed: false, reason: (err as Error).message };
  }
}
