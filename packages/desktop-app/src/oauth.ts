/**
 * OAuth 2.0 Authorization Code + PKCE, loopback redirect — the same class of flow
 * Claude Code/Desktop, `gh auth login`, and `gcloud auth login` use for native apps.
 * The password (or whatever the real IdP asks for) is entered on a page the browser
 * loads directly from the auth host; this app only ever sees an opaque authorization
 * code delivered over localhost, then exchanges it for tokens itself.
 *
 * Deliberately generic over `authHost` — points at the local mock IdP (mockIdp.ts)
 * today, swaps to AIBRAIN-73's real endpoint later with no change to this file.
 */
import { randomBytes, createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

export function generatePkcePair(): PkcePair {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash("sha256").update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

export function generateState(): string {
  return base64url(randomBytes(16));
}

export interface LoopbackCallback {
  code: string;
  state: string;
}

export interface LoopbackServer {
  redirectUri: string;
  waitForCallback(timeoutMs?: number): Promise<LoopbackCallback>;
  close(): Promise<void>;
}

type PendingResult = { kind: "callback"; value: LoopbackCallback } | { kind: "error"; value: Error };

/**
 * Binds an ephemeral loopback port, serves exactly one redirect, then the caller
 * closes it. The redirect can arrive before `waitForCallback()` is ever called — the
 * caller's own await chain (open the browser, *then* await the callback) has a real
 * gap between "browser navigation kicked off" and "listener attached," and unlike a
 * human clicking through a real login page, that gap is not reliably wide: it's a
 * genuine race, not a hypothetical one (caught by this file's own local dev-flow
 * verification: an instant synthetic "click" lost the race every time). A result
 * that arrives first is buffered and handed to the very next `waitForCallback()` call
 * instead of being silently dropped.
 */
export function startLoopbackServer(): Promise<LoopbackServer> {
  return new Promise((resolve, reject) => {
    let pending: PendingResult | null = null;
    let waiter: { resolve: (cb: LoopbackCallback) => void; reject: (err: Error) => void } | null = null;

    function deliver(result: PendingResult): void {
      if (waiter) {
        if (result.kind === "callback") waiter.resolve(result.value);
        else waiter.reject(result.value);
        waiter = null;
      } else {
        pending = result;
      }
    }

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      res.writeHead(200, { "Content-Type": "text/html" });
      if (error) {
        res.end(`<html><body><p>Login failed: ${error}. You can close this tab.</p></body></html>`);
        deliver({ kind: "error", value: new Error(error) });
        return;
      }
      if (!code || !state) {
        res.end("<html><body><p>Missing authorization code. You can close this tab.</p></body></html>");
        return;
      }
      res.end("<html><body><p>Logged in — you can close this tab.</p></body></html>");
      deliver({ kind: "callback", value: { code, state } });
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("loopback server failed to bind to a port"));
        return;
      }
      const { port } = address;
      resolve({
        redirectUri: `http://127.0.0.1:${port}/callback`,
        waitForCallback(timeoutMs = 5 * 60 * 1000) {
          return new Promise<LoopbackCallback>((res, rej) => {
            if (pending) {
              const result = pending;
              pending = null;
              if (result.kind === "callback") res(result.value);
              else rej(result.value);
              return;
            }
            waiter = { resolve: res, reject: rej };
            setTimeout(() => {
              if (waiter) {
                waiter = null;
                rej(new Error("Timed out waiting for browser login."));
              }
            }, timeoutMs);
          });
        },
        close() {
          return new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}

export function buildAuthorizeUrl(opts: {
  authHost: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const url = new URL("/oauth/authorize", opts.authHost);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", opts.state);
  return url.toString();
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  email?: string;
  plan?: string;
}

export async function exchangeCodeForTokens(opts: {
  authHost: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  const res = await fetch(new URL("/oauth/token", opts.authHost), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: opts.clientId,
      code: opts.code,
      code_verifier: opts.codeVerifier,
      redirect_uri: opts.redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(opts: { authHost: string; clientId: string; refreshToken: string }): Promise<TokenResponse> {
  const res = await fetch(new URL("/oauth/token", opts.authHost), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: opts.clientId,
      refresh_token: opts.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}
