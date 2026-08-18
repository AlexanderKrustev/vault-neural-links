/**
 * Subscription/account gate for the desktop app — a real OAuth 2.0 Authorization
 * Code + PKCE flow (oauth.ts) against a local mock authorization server (mockIdp.ts)
 * standing in for AIBRAIN-73's eventual real endpoint, not the earlier
 * email+password-direct-to-a-local-validator design it replaces.
 *
 * That earlier design took the password into this app and stored a non-expiring
 * session as plain JSON — both real weaknesses, flagged during AIBRAIN-64 work
 * (2026-08-18) since this app being compromised has a direct financial consequence
 * (subscription bypass). This design fixes both: the password is entered on the IdP's
 * own page (this app never sees it), and the long-lived refresh token is encrypted at
 * rest via Electron's `safeStorage` (OS keychain/DPAPI/libsecret) and never leaves this
 * process — the cross-app hand-off to the Obsidian plugin (core's accountSession.ts)
 * only ever carries a short-lived access token, so a leaked/forged copy of that shared
 * file is bounded to the access token's TTL, not indefinite.
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import { safeStorage } from "electron";
import {
  generatePkcePair,
  generateState,
  startLoopbackServer,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  type TokenResponse,
} from "./oauth.js";

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email?: string;
  plan?: string;
}

export interface LoginResult {
  ok: boolean;
  reason?: string;
  tokens?: StoredTokens;
}

const CLIENT_ID = "vault-neural-links-desktop";

export interface OAuthConfig {
  authHost: string;
}

/**
 * Runs one full browser-redirect login: opens the system browser to the authorization
 * URL, waits for the loopback redirect, exchanges the code for tokens. Whatever the
 * IdP asks for (a password, today just a one-click approval on the mock) happens on
 * that page, never inside this app.
 */
export async function loginWithBrowser(
  config: OAuthConfig,
  openExternal: (url: string) => Promise<void>,
): Promise<LoginResult> {
  const loopback = await startLoopbackServer();
  try {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    const state = generateState();
    const authorizeUrl = buildAuthorizeUrl({
      authHost: config.authHost,
      clientId: CLIENT_ID,
      redirectUri: loopback.redirectUri,
      codeChallenge,
      state,
    });

    await openExternal(authorizeUrl);
    const callback = await loopback.waitForCallback();
    if (callback.state !== state) {
      return { ok: false, reason: "Login response didn't match this login attempt (state mismatch)." };
    }

    const tokens = await exchangeCodeForTokens({
      authHost: config.authHost,
      clientId: CLIENT_ID,
      code: callback.code,
      codeVerifier,
      redirectUri: loopback.redirectUri,
    });

    return { ok: true, tokens };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    await loopback.close();
  }
}

export async function refreshTokens(config: OAuthConfig, refreshToken: string): Promise<TokenResponse> {
  return refreshAccessToken({ authHost: config.authHost, clientId: CLIENT_ID, refreshToken });
}

/**
 * Encrypted at rest via Electron's safeStorage where available (falls back to plain
 * JSON with a console warning rather than failing outright — safeStorage can be
 * unavailable in some Linux environments with no keyring). This is the app's own
 * long-lived refresh token, read/written only by this same app/process — cross-app
 * decryption is never needed here (and safeStorage doesn't reliably support it anyway;
 * macOS Keychain ACLs are typically scoped per requesting app).
 */
export async function readTokens(path: string): Promise<StoredTokens | null> {
  try {
    const raw = await readFile(path);
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString("utf8");
    return JSON.parse(json) as StoredTokens;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeTokens(path: string, tokens: StoredTokens): Promise<void> {
  const json = JSON.stringify(tokens);
  if (!safeStorage.isEncryptionAvailable()) {
    console.error("vault-neural-links: OS-level encryption unavailable, storing tokens as plain JSON.");
  }
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json, "utf8");
  await writeFile(path, data);
}

export async function clearTokens(path: string): Promise<void> {
  await rm(path, { force: true });
}
