import { readFile, stat } from "node:fs/promises";

/**
 * In-process, mtime-keyed cache for the nightly-built index files
 * (VNL-030). Every one of them is written whole by a nightly job and read
 * on every single query: before this, one `computeLiveNeighborWeights`
 * call re-read and re-parsed `link-weights.json`, `structural-links.json`,
 * `note-importance.json` and `seed-weights.json` from disk, and `recall`
 * does that once per seed. At real vault size the JSON parse is the cost;
 * at the 300k-note scale VNL-031 is meant to handle it is prohibitive.
 *
 * The cache is keyed by absolute path and validated by a `stat()` — one
 * syscall replacing a read plus a parse. It is deliberately *not* a
 * time-based TTL: the file either changed or it did not, and mtime is what
 * says so.
 *
 * Two honest limits:
 *
 * - **mtime granularity.** A file rewritten within the same filesystem
 *   timestamp tick, to the same byte length, is not detected. Writers
 *   inside this process close that gap by calling `invalidateCachedFile`
 *   after they persist (the atomic-rename helpers all do); across
 *   processes the window is one tick, and the only writer is a nightly job.
 * - **Identity is shared.** Callers get the same parsed object back, so
 *   nothing may mutate a loaded index in place. Nothing does today; the
 *   derived-value helper below exists so that stays true for computed
 *   structures too.
 */
interface CacheEntry {
  mtimeMs: number;
  size: number;
  value: unknown;
}

const fileCache = new Map<string, CacheEntry>();

/**
 * Values computed *from* a loaded index (an adjacency map, say), attached
 * to the parsed object's identity rather than to its path. A reload
 * produces a new object, so the stale derivation becomes unreachable and
 * is collected with it — there is no second invalidation rule to keep in
 * sync with the first, which is the usual way a cache like this goes wrong.
 */
const derivedCache = new WeakMap<object, Map<string, unknown>>();

/**
 * Reads and parses a JSON index, reusing the parsed object while the file
 * on disk is unchanged. Returns null when the file does not exist, matching
 * every loader this replaced; a malformed file throws, as before, rather
 * than being cached as a failure.
 */
export async function loadCachedJson<T>(filePath: string): Promise<T | null> {
  let stats;
  try {
    stats = await stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      fileCache.delete(filePath);
      return null;
    }
    throw err;
  }

  const cached = fileCache.get(filePath);
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.value as T;
  }

  const content = await readFile(filePath, "utf8");
  const value = JSON.parse(content) as T;
  fileCache.set(filePath, { mtimeMs: stats.mtimeMs, size: stats.size, value });
  return value;
}

/**
 * Memoizes a structure computed from a loaded index, for the lifetime of
 * that exact loaded object. `build` runs once per (object, key) pair.
 */
export function derived<T extends object, D>(owner: T, key: string, build: (value: T) => D): D {
  let byKey = derivedCache.get(owner);
  if (!byKey) {
    byKey = new Map();
    derivedCache.set(owner, byKey);
  }
  if (!byKey.has(key)) byKey.set(key, build(owner));
  return byKey.get(key) as D;
}

/**
 * Drops one file's cached parse. Called by the writers immediately after
 * they replace a file, so a rebuild is visible to this process without
 * waiting on filesystem timestamp granularity.
 */
export function invalidateCachedFile(filePath: string): void {
  fileCache.delete(filePath);
}

/** Drops everything. For tests and for a long-lived process that has just rebuilt the whole pipeline. */
export function clearIndexCache(): void {
  fileCache.clear();
}
