import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import {
  activationSocketRegistrationPath,
  startActivationSocketServer,
  type ActivationSocketServer,
} from "../src/activationSocket.js";
import type { ActivationTraceEvent } from "@vault-neural-links/core";

function event(overrides: Partial<ActivationTraceEvent> = {}): ActivationTraceEvent {
  return {
    type: "node_activated",
    runId: "run-1",
    origin: "A",
    hop: 1,
    node: "B",
    energy: 5,
    ts: new Date().toISOString(),
    ...overrides,
  };
}

describe("activationSocket", () => {
  let vaultDataDir: string;
  let server: ActivationSocketServer | undefined;

  beforeEach(async () => {
    vaultDataDir = await mkdtemp(join(tmpdir(), "vnl-test-activation-socket-"));
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await rm(vaultDataDir, { recursive: true, force: true });
  });

  it("binds an ephemeral port and writes a registration file with the right shape", async () => {
    server = await startActivationSocketServer(vaultDataDir, "inst-1");
    expect(server.port).toBeGreaterThan(0);

    const registrationPath = activationSocketRegistrationPath(vaultDataDir, "inst-1");
    const registration = JSON.parse(await readFile(registrationPath, "utf8"));
    expect(registration).toMatchObject({
      host: "127.0.0.1",
      port: server.port,
      pid: process.pid,
    });
    expect(typeof registration.startedAt).toBe("string");
  });

  it("binds loopback only, so a non-loopback local address is refused (VNL-002)", async () => {
    server = await startActivationSocketServer(vaultDataDir, "inst-loopback");
    expect(server.host).toBe("127.0.0.1");

    const external = networkInterfaces();
    const externalAddress = Object.values(external)
      .flatMap((entries) => entries ?? [])
      .find((entry) => entry.family === "IPv4" && !entry.internal)?.address;
    if (externalAddress === undefined) {
      // A machine with no non-loopback IPv4 address can't distinguish the two
      // binds; the host assertion above is all this environment can check.
      return;
    }

    const client = new WebSocket(`ws://${externalAddress}:${server.port}`);
    const failure = await new Promise<Error | null>((resolve) => {
      client.once("open", () => resolve(null));
      client.once("error", (error) => resolve(error));
    });
    client.close();
    expect(failure).not.toBeNull();
  });

  it("a connected client receives a broadcast message", async () => {
    server = await startActivationSocketServer(vaultDataDir, "inst-2");
    const client = new WebSocket(`ws://127.0.0.1:${server.port}`);

    await new Promise<void>((resolve, reject) => {
      client.once("open", () => resolve());
      client.once("error", reject);
    });

    const received = new Promise<ActivationTraceEvent>((resolve) => {
      client.once("message", (data) => resolve(JSON.parse(data.toString())));
    });

    const sent = event();
    server.broadcast(sent);

    expect(await received).toEqual(sent);
    client.close();
  });

  it("close() removes the registration file", async () => {
    server = await startActivationSocketServer(vaultDataDir, "inst-3");
    const registrationPath = activationSocketRegistrationPath(vaultDataDir, "inst-3");

    await server.close();
    server = undefined;

    await expect(readFile(registrationPath, "utf8")).rejects.toThrow();
  });
});
