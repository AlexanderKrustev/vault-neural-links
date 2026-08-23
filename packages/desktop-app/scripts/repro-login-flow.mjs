#!/usr/bin/env node
// Reproduces the full OAuth PKCE login flow headlessly (mock IdP + loopback
// server + code exchange), simulating exactly what a browser does when the
// user submits the mock IdP's "Log in as..." form, without needing Electron
// or a real browser. Written to debug a user report of the desktop app
// hanging on "Waiting for browser..." after clicking through approval.
import { startMockIdp } from "../dist/mockIdp.js";
import { startLoopbackServer, generatePkcePair, generateState, buildAuthorizeUrl, exchangeCodeForTokens } from "../dist/oauth.js";

const CLIENT_ID = "vault-neural-links-desktop";

async function main() {
  console.log("Starting mock IdP...");
  const idp = await startMockIdp();
  console.log(`  authHost: ${idp.authHost}`);

  console.log("Starting loopback server...");
  const loopback = await startLoopbackServer();
  console.log(`  redirectUri: ${loopback.redirectUri}`);

  const { codeVerifier, codeChallenge } = generatePkcePair();
  const state = generateState();
  const authorizeUrl = buildAuthorizeUrl({ authHost: idp.authHost, clientId: CLIENT_ID, redirectUri: loopback.redirectUri, codeChallenge, state });
  console.log(`Authorize URL: ${authorizeUrl}`);

  // Simulate the browser: GET the authorize page (as a real browser would),
  // then simulate clicking "Log in as..." by POSTing the same form fields
  // the rendered <form> carries as hidden inputs.
  const authorizePage = await fetch(authorizeUrl);
  console.log(`GET /oauth/authorize -> ${authorizePage.status}`);
  await authorizePage.text();

  console.log("Simulating approval click (POST /oauth/approve)...");
  const approveRes = await fetch(new URL("/oauth/approve", idp.authHost), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code_challenge: codeChallenge, redirect_uri: loopback.redirectUri, client_id: CLIENT_ID, state }),
    redirect: "follow", // follows the 302 to the loopback server, exactly like a browser would
  });
  console.log(`POST /oauth/approve (followed redirect) -> ${approveRes.status}, final url: ${approveRes.url}`);
  console.log(`Loopback page body: ${(await approveRes.text()).trim()}`);

  console.log("Waiting for loopback callback to be delivered...");
  const callback = await loopback.waitForCallback(10_000);
  console.log(`  callback: code=${callback.code.slice(0, 8)}... state matches=${callback.state === state}`);

  console.log("Exchanging code for tokens...");
  const tokens = await exchangeCodeForTokens({ authHost: idp.authHost, clientId: CLIENT_ID, code: callback.code, codeVerifier, redirectUri: loopback.redirectUri });
  console.log("SUCCESS:", tokens);

  await loopback.close();
  await idp.close();
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
