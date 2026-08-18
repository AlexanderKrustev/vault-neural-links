import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accountSessionPath, clearAccountSession, readAccountSession, writeAccountSession } from "../src/accountSession.js";

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vnl-account-session-"));
  path = join(dir, "account-session.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("accountSessionPath", () => {
  it("points at a fixed, well-known location under the home directory", () => {
    expect(accountSessionPath()).toMatch(/\.vault-neural-links[/\\]account-session\.json$/);
  });
});

describe("readAccountSession", () => {
  it("returns null when no session file exists yet", async () => {
    expect(await readAccountSession(path)).toBeNull();
  });

  it("round-trips a written session (access token only, no refresh token field)", async () => {
    const session = { accessToken: "opaque-access-token", expiresAt: "2026-08-18T12:05:00.000Z", email: "demo@vaultneurallinks.dev", plan: "demo" };
    await writeAccountSession(path, session);
    expect(await readAccountSession(path)).toEqual(session);
  });

  it("creates the parent directory on first write", async () => {
    const nestedPath = join(dir, "nested", "account-session.json");
    await writeAccountSession(nestedPath, { accessToken: "tok", expiresAt: "2026-08-18T12:05:00.000Z" });
    expect(await readAccountSession(nestedPath)).not.toBeNull();
  });
});

describe("clearAccountSession", () => {
  it("removes an existing session file", async () => {
    await writeAccountSession(path, { accessToken: "tok", expiresAt: "2026-08-18T12:05:00.000Z" });
    await clearAccountSession(path);
    expect(await readAccountSession(path)).toBeNull();
  });

  it("is a no-op when no session file exists", async () => {
    await expect(clearAccountSession(path)).resolves.not.toThrow();
  });
});
