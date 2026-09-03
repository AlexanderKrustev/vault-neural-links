import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { sessionBufferFilePath } from "./priming.js";

/**
 * VNL-009 — housekeeping for the per-instance files under the vault's data
 * directory.
 *
 * `session/<instanceId>.json` and `activation-sockets/<instanceId>.json`
 * describe *live* state: which notes an MCP session has primed, and which
 * port its activation socket is listening on. Nothing deleted them, so a
 * real vault accumulated 84 stale session files, every one of which the
 * plugin still had to read and date-check, and each stale socket file
 * advertised a port that no longer exists. They are removed on clean
 * shutdown, and pruned by age on the nightly run for the sessions that did
 * not exit cleanly.
 *
 * `retrieval/` and `search/` are append-only *logs* the usage report reads,
 * so they get an ordinary retention window rather than the short one.
 */
export const EPHEMERAL_STALE_DAYS = 2;
export const LOG_RETENTION_DAYS = 90;

export function activationSocketFilePath(vaultDataDir: string, instanceId: string): string {
  return join(vaultDataDir, "activation-sockets", `${instanceId}.json`);
}

/**
 * Deletes the files describing one MCP instance's live state. Called on
 * SIGINT/SIGTERM/stdin-close; best-effort by design, since a shutdown path
 * that throws is worse than a leftover file the nightly prune will collect.
 */
export async function removeInstanceFiles(vaultDataDir: string, instanceId: string): Promise<void> {
  await Promise.all(
    [sessionBufferFilePath(vaultDataDir, instanceId), activationSocketFilePath(vaultDataDir, instanceId)].map((path) =>
      rm(path, { force: true }).catch(() => {}),
    ),
  );
}

export interface PruneResult {
  /** Files removed, by directory name. */
  removed: Record<string, number>;
}

export interface PruneOptions {
  ephemeralStaleDays?: number;
  logRetentionDays?: number;
  now?: Date;
}

/**
 * Removes per-instance files no live session can still own. Age is taken
 * from mtime: a running session rewrites its session file on every touch,
 * and its socket registration is recreated at startup, so an untouched file
 * belongs to a session that is gone.
 */
export async function pruneStaleInstanceFiles(
  vaultDataDir: string,
  options: PruneOptions = {},
): Promise<PruneResult> {
  const {
    ephemeralStaleDays = EPHEMERAL_STALE_DAYS,
    logRetentionDays = LOG_RETENTION_DAYS,
    now = new Date(),
  } = options;

  const targets: { dir: string; maxAgeDays: number; suffix: string }[] = [
    { dir: "session", maxAgeDays: ephemeralStaleDays, suffix: ".json" },
    { dir: "activation-sockets", maxAgeDays: ephemeralStaleDays, suffix: ".json" },
    { dir: "retrieval", maxAgeDays: logRetentionDays, suffix: ".jsonl" },
    { dir: "search", maxAgeDays: logRetentionDays, suffix: ".jsonl" },
  ];

  const removed: Record<string, number> = {};
  for (const target of targets) {
    removed[target.dir] = await pruneDir(join(vaultDataDir, target.dir), target, now);
  }
  return { removed };
}

async function pruneDir(
  dirPath: string,
  target: { maxAgeDays: number; suffix: string },
  now: Date,
): Promise<number> {
  let files: string[];
  try {
    files = await readdir(dirPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }

  let count = 0;
  for (const file of files) {
    if (!file.endsWith(target.suffix)) continue;
    const filePath = join(dirPath, file);
    try {
      const stats = await stat(filePath);
      const ageDays = (now.getTime() - stats.mtimeMs) / 86_400_000;
      if (ageDays < target.maxAgeDays) continue;
      await rm(filePath, { force: true });
      count += 1;
    } catch {
      // A file that vanished under us (or that we may not delete) is not
      // worth failing the nightly run over.
    }
  }
  return count;
}
