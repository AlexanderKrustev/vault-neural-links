import { accountSessionPath, isAccountSessionActive, readAccountSession, type AccountSession } from "@vault-neural-links/core";

/**
 * Read half of the cross-app auth hand-off (AIBRAIN-128). The write half
 * (packages/desktop-app, via packages/core's accountSession.ts) lets the Electron
 * desktop app be the single auth/subscription surface: when a user reaches this plugin
 * via the desktop app's "existing Obsidian vault" companion screen, the plugin should
 * pick up that session instead of prompting its own separate login.
 *
 * There is no independent plugin-only login built yet (AIBRAIN-75, not started) — today
 * "no active desktop-app session" just means the plugin runs exactly as it always has,
 * unauthenticated. Once AIBRAIN-75 ships a standalone license-key flow, "none" is where
 * that flow's own check belongs; this module only answers "is the desktop app currently
 * logged in," it doesn't gate anything on its own (that's AIBRAIN-129, separate scope).
 *
 * The plugin never attempts to refresh an expired session itself — there is no refresh
 * token in this file by design (see accountSessionPath()'s doc comment in core). An
 * expired, not-yet-rewritten session is treated exactly like no session at all.
 */
export type AccountAuthState = { source: "desktop-app"; session: AccountSession } | { source: "none" };

export async function getAccountAuthState(): Promise<AccountAuthState> {
  const session = await readAccountSession(accountSessionPath());
  return isAccountSessionActive(session) ? { source: "desktop-app", session } : { source: "none" };
}
