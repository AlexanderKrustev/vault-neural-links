import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

/**
 * The account/subscription session the Electron desktop app establishes on login is
 * the single auth surface across both product surfaces (2026-08-18 architecture
 * decision — see vault note "Standalone Decoupled Product Direction - Open
 * Question"). It's kept at a fixed, OS-level location outside any particular vault
 * folder, so a client that doesn't know a given vault's path — the Obsidian plugin,
 * running inside a specific vault, or the desktop app's own "existing Obsidian vault"
 * companion screen, which deliberately never reads the vault folder — can still find
 * it by convention alone, with no IPC channel or file hand-off step between the two
 * apps.
 *
 * Mirrors packages/desktop-app's auth.ts readTokens/writeTokens/clearTokens shape
 * (functions take an explicit path rather than hardcoding one internally, so callers
 * can point tests at a temp path instead of the real home directory) — this module
 * only adds accountSessionPath() as the one fixed, well-known location production
 * code should actually use.
 *
 * Deliberately carries only a short-lived **access token**, never the refresh token —
 * the refresh token stays in the desktop app's own safeStorage-encrypted, same-process
 * token file (packages/desktop-app's auth.ts) and never touches this cross-app file. A
 * leaked or forged copy of this file is bounded to the access token's TTL; the thing
 * that actually matters long-term (the refresh token) is never exposed here.
 *
 * This module only defines the shared shape and read/write helpers; it doesn't decide
 * *who* trusts the file. Today only the desktop app writes it (packages/desktop-app's
 * auth.ts calls these on login/logout/refresh, alongside its own per-app token file).
 * Making the Obsidian plugin read this and skip its own license-key login is separate,
 * not-yet-built follow-on work (tracked as AIBRAIN-128) — that work should re-validate
 * the access token against AIBRAIN-73's real endpoint (or its expiry) rather than
 * trusting the file's mere presence, since presence alone proves nothing on its own.
 */
export interface AccountSession {
  accessToken: string;
  expiresAt: string;
  email?: string;
  plan?: string;
}

const ACCOUNT_SESSION_DIR_NAME = ".vault-neural-links";
const ACCOUNT_SESSION_FILE_NAME = "account-session.json";

export function accountSessionPath(): string {
  return join(homedir(), ACCOUNT_SESSION_DIR_NAME, ACCOUNT_SESSION_FILE_NAME);
}

export async function readAccountSession(path: string): Promise<AccountSession | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as AccountSession;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeAccountSession(path: string, session: AccountSession): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(session, null, 2), "utf8");
}

export async function clearAccountSession(path: string): Promise<void> {
  await rm(path, { force: true });
}

/**
 * Whether a session read from accountSessionPath() should be trusted as "the desktop
 * app is currently logged in" — i.e. its access token hasn't outlived `expiresAt`.
 *
 * There's no refresh token in this file (by design, see the module doc comment above),
 * so a caller (the Obsidian plugin, per AIBRAIN-128) must never attempt to refresh an
 * expired session itself — it can only treat expired-and-not-yet-rewritten exactly like
 * absent, and fall back to whatever its own standalone auth is. The desktop app keeps
 * this file fresh on its own by rewriting it on every silent token refresh while it's
 * open and logged in.
 */
export function isAccountSessionActive(session: AccountSession | null, now: Date = new Date()): session is AccountSession {
  return session !== null && new Date(session.expiresAt).getTime() > now.getTime();
}
