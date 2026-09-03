import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WebSocketServer } from "ws";
import type { ActivationTraceEvent } from "@vault-neural-links/core";

export interface ActivationSocketRegistration {
  host: string;
  port: number;
  pid: number;
  startedAt: string;
}

export interface ActivationSocketServer {
  port: number;
  host: string;
  broadcast(event: ActivationTraceEvent): void;
  close(): Promise<void>;
}

/** Loopback only — see `startActivationSocketServer` (VNL-002). */
export const ACTIVATION_SOCKET_HOST = "127.0.0.1";

export function activationSocketRegistrationPath(vaultDataDir: string, instanceId: string): string {
  return join(vaultDataDir, "activation-sockets", `${instanceId}.json`);
}

/**
 * Starts a WebSocket broadcast server for one mcp-server instance's
 * `activate()` events. Binds to an OS-assigned ephemeral port so that the
 * multiple concurrent mcp-server processes a user-scope MCP server spawns
 * (one per Claude Code session) never collide, and writes a small
 * registration file the Obsidian plugin can discover by polling a
 * directory — mirroring the existing `session/<instanceId>.json` convention
 * used for the priming buffer, rather than inventing a new discovery
 * * protocol.
 *
 * VNL-002: the socket binds to 127.0.0.1 only. It carries the vault's note
 * paths and titles, and the default `port: 0` bind would otherwise listen on
 * every interface — anyone on the same network could read the activation
 * trace of a private vault. Nothing but a local Obsidian plugin ever needs
 * to reach it.
 */
export async function startActivationSocketServer(
  vaultDataDir: string,
  instanceId: string,
): Promise<ActivationSocketServer> {
  const host = ACTIVATION_SOCKET_HOST;
  const wss = new WebSocketServer({ port: 0, host });

  await new Promise<void>((resolve, reject) => {
    wss.once("listening", () => resolve());
    wss.once("error", reject);
  });

  const address = wss.address();
  if (address === null || typeof address === "string") {
    throw new Error("activation socket server failed to bind to a port");
  }
  const port = address.port;

  const registrationPath = activationSocketRegistrationPath(vaultDataDir, instanceId);
  const registration: ActivationSocketRegistration = {
    host,
    port,
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };
  await mkdir(dirname(registrationPath), { recursive: true });
  await writeFile(registrationPath, JSON.stringify(registration), "utf8");

  return {
    host,
    port,
    broadcast(event: ActivationTraceEvent) {
      const payload = JSON.stringify(event);
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) {
          client.send(payload);
        }
      }
    },
    async close() {
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await rm(registrationPath, { force: true });
    },
  };
}
