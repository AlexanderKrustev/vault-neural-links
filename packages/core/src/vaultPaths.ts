import { isAbsolute, join, resolve, sep } from "node:path";

// Runtime data lives inside the vault itself, mirroring how Obsidian nests
// its own .obsidian/ config folder.
const DATA_DIR_NAME = ".vault-neural-links";

export function resolveDataDir(vaultPath: string): string {
  return join(vaultPath, DATA_DIR_NAME);
}

// Folders that hold tool/editor state rather than notes. Neither is a legal
// target for a note path argument: the data dir is this tool's own storage
// (a write there corrupts the weight/index files) and .obsidian/ is the
// user's editor config.
const RESERVED_SEGMENTS = new Set([DATA_DIR_NAME, ".obsidian"]);

/**
 * Thrown when a caller-supplied path argument is not a safe vault-relative
 * note/folder path. Carries the offending input so tool handlers can report
 * it without leaking the resolved absolute path.
 */
export class VaultPathError extends Error {
  constructor(
    readonly inputPath: string,
    readonly reason: string,
  ) {
    super(`Invalid vault-relative path ${JSON.stringify(inputPath)}: ${reason}`);
    this.name = "VaultPathError";
  }
}

/**
 * Validates a caller-supplied vault-relative path and returns it normalized
 * to forward slashes. Rejects absolute paths (POSIX, Windows drive-letter and
 * UNC), `..` escapes, NUL bytes, and anything targeting a reserved folder.
 *
 * Segments are split on both separators, so `..\\escape` is rejected on
 * POSIX too — a note path is always `/`-separated by contract, and treating
 * a backslash as a plain filename character would let a Windows-shaped
 * traversal survive validation on one platform and take effect on another.
 */
export function assertVaultRelativePath(inputPath: string): string {
  if (typeof inputPath !== "string") throw new VaultPathError(String(inputPath), "not a string");
  if (inputPath.includes("\0")) throw new VaultPathError(inputPath, "contains a NUL byte");
  if (inputPath.trim() === "") throw new VaultPathError(inputPath, "is empty");
  if (isAbsolute(inputPath) || /^[a-zA-Z]:/.test(inputPath) || /^[\\/]/.test(inputPath)) {
    throw new VaultPathError(inputPath, "must be vault-relative, not absolute");
  }

  const segments: string[] = [];
  for (const segment of inputPath.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") throw new VaultPathError(inputPath, "must not escape the vault with '..'");
    if (RESERVED_SEGMENTS.has(segment.toLowerCase())) {
      throw new VaultPathError(inputPath, `must not target the reserved folder '${segment}'`);
    }
    segments.push(segment);
  }

  if (segments.length === 0) throw new VaultPathError(inputPath, "is empty");
  return segments.join("/");
}

/** True if `assertVaultRelativePath` would accept the path. For zod refinements. */
export function isVaultRelativePath(inputPath: string): boolean {
  try {
    assertVaultRelativePath(inputPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a vault-relative path to an absolute one, guaranteeing the result
 * stays inside the vault. Validation of the input is the first line of
 * defence; the resolved-prefix check is the second, so a symlink-free escape
 * that slipped past segment checking still cannot produce a path outside.
 */
export function resolveInsideVault(vaultPath: string, inputPath: string): string {
  const relative = assertVaultRelativePath(inputPath);
  const root = resolve(vaultPath);
  const full = resolve(root, relative);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new VaultPathError(inputPath, "resolves outside the vault");
  }
  return full;
}

/**
 * Resolves a vault-relative note path (with or without the `.md` extension)
 * to the absolute file path of that note, inside the vault.
 */
export function resolveNoteFile(vaultPath: string, notePath: string): string {
  // Validate before appending the extension, so `""` fails as an empty path
  // rather than resolving to a note literally named ".md".
  const relative = assertVaultRelativePath(notePath);
  return resolveInsideVault(vaultPath, relative.endsWith(".md") ? relative : `${relative}.md`);
}
