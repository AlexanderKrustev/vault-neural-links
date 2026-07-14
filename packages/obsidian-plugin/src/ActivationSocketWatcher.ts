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
      if (this.sockets.has(instanceId)) continue;

      const raw = await new Promise<string | null>((resolve) => {
        fs.readFile(`${this.socketsDir}/${file}`, "utf-8", (err, data) => resolve(err ? null : data));
      });
      if (!raw) continue;

      let registration: ActivationSocketRegistration;
      try {
        registration = JSON.parse(raw) as ActivationSocketRegistration;
      } catch {
        continue;
      }

      this.connect(instanceId, registration.port);
    }
  }

  private connect(instanceId: string, port: number): void {
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

    const evict = () => {
      if (this.sockets.get(instanceId) === socket) this.sockets.delete(instanceId);
    };
    socket.addEventListener("close", evict);
    socket.addEventListener("error", evict);
  }
}
