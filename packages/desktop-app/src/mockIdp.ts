/**
 * Dev-only stand-in for AIBRAIN-73's real OAuth authorization server. Implements the
 * actual authorize+token HTTP protocol shape (not just a login(email,password)
 * function, like the earlier createMockValidator() design it replaces) so swapping in
 * the real endpoint later is a base-URL change in oauth.ts's caller, not a rewrite of
 * the client-side flow.
 *
 * One seeded demo account, auto-approved on the authorize page — there's no real
 * password check here, this is scaffolding for exercising the PKCE/loopback/
 * token-exchange mechanics end to end, not a security boundary of its own.
 *
 * Tokens are opaque random strings, not unsigned JWTs — deliberately, so nothing here
 * invites treating a token as offline-verifiable. A real client always has to ask this
 * server (or AIBRAIN-73's real one) whether a token is still good; refresh tokens are
 * rotated (single-use) on every refresh so a captured one is only ever good once.
 */
import { randomBytes, createHash } from "node:crypto";
import { createServer, type Server } from "node:http";

interface PendingAuthorization {
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
}

const DEMO_ACCOUNT = { email: "demo@vaultneurallinks.dev", plan: "demo" };
const ACCESS_TOKEN_TTL_MS = 5 * 60 * 1000;

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(): string {
  return base64url(randomBytes(32));
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

export interface MockIdp {
  authHost: string;
  close(): Promise<void>;
}

export function startMockIdp(): Promise<MockIdp> {
  const pendingCodes = new Map<string, PendingAuthorization>();
  const refreshTokenAccounts = new Map<string, typeof DEMO_ACCOUNT>();

  function issueTokens() {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    refreshTokenAccounts.set(refreshToken, DEMO_ACCOUNT);
    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_MS).toISOString(),
      email: DEMO_ACCOUNT.email,
      plan: DEMO_ACCOUNT.plan,
    };
  }

  return new Promise((resolve, reject) => {
    const server: Server = createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");

        if (req.method === "GET" && url.pathname === "/oauth/authorize") {
          const codeChallenge = url.searchParams.get("code_challenge") ?? "";
          const redirectUri = url.searchParams.get("redirect_uri") ?? "";
          const clientId = url.searchParams.get("client_id") ?? "";
          const state = url.searchParams.get("state") ?? "";
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            `<html><body style="font-family: system-ui; padding: 40px; text-align: center;">
              <h2>Vault Neural Links (dev login)</h2>
              <p>Mock authorization server — stands in for AIBRAIN-73.</p>
              <form method="POST" action="/oauth/approve">
                <input type="hidden" name="code_challenge" value="${codeChallenge}" />
                <input type="hidden" name="redirect_uri" value="${redirectUri}" />
                <input type="hidden" name="client_id" value="${clientId}" />
                <input type="hidden" name="state" value="${state}" />
                <button type="submit">Log in as ${DEMO_ACCOUNT.email}</button>
              </form>
            </body></html>`,
          );
          return;
        }

        if (req.method === "POST" && url.pathname === "/oauth/approve") {
          const params = new URLSearchParams(await readBody(req));
          const codeChallenge = params.get("code_challenge") ?? "";
          const redirectUri = params.get("redirect_uri") ?? "";
          const clientId = params.get("client_id") ?? "";
          const state = params.get("state") ?? "";
          const code = randomToken();
          pendingCodes.set(code, { codeChallenge, redirectUri, clientId });
          const redirect = new URL(redirectUri);
          redirect.searchParams.set("code", code);
          redirect.searchParams.set("state", state);
          res.writeHead(302, { Location: redirect.toString() });
          res.end();
          return;
        }

        if (req.method === "POST" && url.pathname === "/oauth/token") {
          let payload: Record<string, string>;
          try {
            payload = JSON.parse(await readBody(req)) as Record<string, string>;
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_request" }));
            return;
          }
          if (payload.grant_type === "authorization_code") {
            const pending = pendingCodes.get(payload.code);
            pendingCodes.delete(payload.code); // single-use
            const expectedChallenge = base64url(createHash("sha256").update(payload.code_verifier ?? "").digest());
            if (
              !pending ||
              pending.redirectUri !== payload.redirect_uri ||
              pending.clientId !== payload.client_id ||
              expectedChallenge !== pending.codeChallenge
            ) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "invalid_grant" }));
              return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(issueTokens()));
            return;
          }

          if (payload.grant_type === "refresh_token") {
            const account = refreshTokenAccounts.get(payload.refresh_token);
            refreshTokenAccounts.delete(payload.refresh_token); // rotate: old refresh token is single-use
            if (!account) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "invalid_grant" }));
              return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(issueTokens()));
            return;
          }

          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "unsupported_grant_type" }));
          return;
        }

        res.writeHead(404);
        res.end();
      })();
    });

    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("mock IdP failed to bind to a port"));
        return;
      }
      resolve({
        authHost: `http://127.0.0.1:${address.port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}
