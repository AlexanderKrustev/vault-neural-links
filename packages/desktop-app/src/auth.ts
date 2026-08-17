/**
 * Subscription/account gate for the desktop app (AIBRAIN-73/75 territory,
 * pulled forward as a desktop-app-specific email+password login rather
 * than the Obsidian plugin's license-key model — those are two different
 * product surfaces and don't have to share one auth UX).
 *
 * `SubscriptionValidator` is the swap seam: `createMockValidator()` is a
 * local, no-network stand-in so the login screen itself is verifiable
 * today, before AIBRAIN-73's real hosted verification endpoint exists.
 * A future `createRemoteValidator(apiUrl)` implements the same interface
 * and calling code (main.ts's IPC handlers) doesn't change at swap time.
 */
import { readFile, writeFile, rm } from "node:fs/promises";

export interface StoredSession {
  email: string;
  plan: string;
  loggedInAt: string;
}

export interface LoginResult {
  ok: boolean;
  reason?: string;
  session?: StoredSession;
}

export interface SubscriptionValidator {
  login(email: string, password: string): Promise<LoginResult>;
}

/**
 * MOCK — not a real subscription check. One seeded demo account so the
 * screen is testable immediately without any backend. Replace with a
 * real implementation once AIBRAIN-73's verification endpoint exists.
 */
export function createMockValidator(): SubscriptionValidator {
  const DEMO_ACCOUNTS = new Map<string, string>([["demo@vaultneurallinks.dev", "demo1234"]]);

  return {
    async login(email: string, password: string): Promise<LoginResult> {
      const normalizedEmail = email.trim().toLowerCase();
      const expectedPassword = DEMO_ACCOUNTS.get(normalizedEmail);
      if (!expectedPassword) return { ok: false, reason: "No account found for that email." };
      if (expectedPassword !== password) return { ok: false, reason: "Incorrect password." };
      return {
        ok: true,
        session: { email: normalizedEmail, plan: "demo", loggedInAt: new Date().toISOString() },
      };
    },
  };
}

export async function readSession(sessionPath: string): Promise<StoredSession | null> {
  try {
    return JSON.parse(await readFile(sessionPath, "utf8")) as StoredSession;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function writeSession(sessionPath: string, session: StoredSession): Promise<void> {
  await writeFile(sessionPath, JSON.stringify(session, null, 2), "utf8");
}

export async function clearSession(sessionPath: string): Promise<void> {
  await rm(sessionPath, { force: true });
}
