#!/usr/bin/env node
// One-off check that exchangeCodeForTokens actually times out (and gives
// a clear error) against an authHost that never responds, instead of
// hanging forever — 10.255.255.1 is a non-routable TEST-NET-adjacent
// address commonly used to simulate a network black hole.
import { createServer } from "node:http";
import { exchangeCodeForTokens } from "../dist/oauth.js";

const server = createServer(() => {
  // Deliberately never calls res.end() — simulates a request the network
  // (e.g. a proxy) swallows silently, so the request just hangs, the real
  // scenario this fix targets (not a fast connection-refused error).
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

const t0 = Date.now();
try {
  await exchangeCodeForTokens({
    authHost: `http://127.0.0.1:${port}`,
    clientId: "x",
    code: "x",
    codeVerifier: "x",
    redirectUri: "http://127.0.0.1:1/callback",
  });
  console.log("UNEXPECTED: resolved without error");
} catch (err) {
  console.log(`Failed after ${Date.now() - t0}ms as expected: ${err.message}`);
} finally {
  server.close();
}
