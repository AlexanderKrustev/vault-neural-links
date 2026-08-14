import type { ActivationTraceEvent } from "@vault-neural-links/core";

const POLL_INTERVAL_MS = 2000;

interface ActivationSocketRegistration {
  port: number;
  pid: number;
  startedAt: string;
}

type NodeFs = {
  readdir(path: string, cb: (err: unknown, files: string[]) => void): void;
  readFile(path: string, encoding: "utf-8", cb: (err: unknown, data: string) => void): void;
  unlink(path: string, cb: (err: unknown) => void): void;
};

function loadFs(): NodeFs | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("node:fs") as NodeFs;
  } catch {
    return null;
  }
}

/**
 * Polls `.vault-neural-links/activation-sockets/*.json` — one file per live
 * mcp-server instance's activation WebSocket server — and opens a live
 * connection to each newly-seen instance, forwarding parsed
 * ActivationTraceEvent messages from any of them into a single callback.
 * Mirrors PrimedWatcher's polling-directory shape, but liveness is judged
 * by the connection itself (evicted on close/error), not by registration-
 * file age — a long-running Claude Code session must not be treated as
 * stale the way PrimedWatcher's staleness window correctly does for the
 * priming buffer.
 */
export class ActivationSocketWatcher {
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private sockets = new Map<string, WebSocket>();
  // instanceIds that failed to connect at least once — every MCP server
  // process gets a fresh instanceId (see packages/mcp-server/src/index.ts),
  // so a dead port here is dead forever; without this set, a stale
  // registration file whose deletion races or fails would otherwise be
  // retried on every single poll tick indefinitely.
  private deadInstanceIds = new Set<string>();
  private onEvent: ((event: ActivationTraceEvent) => void) | null = null;

  constructor(private readonly socketsDir: string) {}

  start(onEvent: (event: ActivationTraceEvent) => void): void {
    this.onEvent = onEvent;
    void this.reload();
    this.pollHandle = setInterval(() => void this.reload(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    this.deadInstanceIds.clear();
    this.onEvent = null;
  }

  private async reload(): Promise<void> {
    const fs = loadFs();
    if (!fs) return;

    const files = await new Promise<string[]>((resolve) => {
      fs.readdir(this.socketsDir, (err, entries) => resolve(err ? [] : entries));
    });

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const instanceId = file.slice(0, -".json".length);
      if (this.sockets.has(instanceId) || this.deadInstanceIds.has(instanceId)) continue;

      const registrationPath = `${this.socketsDir}/${file}`;
      const raw = await new Promise<string | null>((resolve) => {
        fs.readFile(registrationPath, "utf-8", (err, data) => resolve(err ? null : data));
      });
      if (!raw) continue;

      let registration: ActivationSocketRegistration;
      try {
        registration = JSON.parse(raw) as ActivationSocketRegistration;
      } catch {
        continue;
      }

      this.connect(instanceId, registration.port, registrationPath);
    }
  }

  private connect(instanceId: string, port: number, registrationPath: string): void {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    this.sockets.set(instanceId, socket);

    socket.addEventListener("message", (evt) => {
      try {
        const event = JSON.parse(evt.data as string) as ActivationTraceEvent;
        this.onEvent?.(event);
      } catch {
        // malformed frame — skip it, not worth tearing down the connection over
      }
    });

    // Fires on a clean server-side close (session ended normally) as well
    // as a failed/refused connection (stale registration file left behind
    // by a session that didn't shut down cleanly) — either way this
    // instanceId's port is never coming back, so mark it dead and clean up
    // the file rather than letting `reload()` retry it every poll tick.
    const giveUp = () => {
      if (this.sockets.get(instanceId) === socket) this.sockets.delete(instanceId);
      this.deadInstanceIds.add(instanceId);
      const fs = loadFs();
      fs?.unlink(registrationPath, () => {
        // best-effort — if this races with another cleanup or the file's
        // already gone, there's nothing further to do
      });
    };
    socket.addEventListener("close", giveUp);
    socket.addEventListener("error", giveUp);
  }
}
