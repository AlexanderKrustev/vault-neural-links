import type { SessionBufferFile } from "@vault-neural-links/core";

const POLL_INTERVAL_MS = 2000;
// There's no clean-shutdown hook when an MCP server instance's session
// ends, so a session-buffer file lingers on disk forever otherwise. Treat
// files not updated within this window as belonging to an ended session.
const STALE_MS = 15 * 60 * 1000;

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
 * Polls `.vault-neural-links/session/*.json` — one file per live MCP
 * server instance's in-memory SessionBuffer (see packages/core/src/priming.ts)
 * — and unions the notes from non-stale files into a single "primed" set
 * for the graph view to ring. Polls rather than fs.watch on the directory
 * since watching a directory for content changes in files it contains
 * isn't reliable cross-platform, and this mirrors WeightsWatcher's own
 * polling fallback interval.
 */
export class PrimedWatcher {
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private previousKey = "";
  private onChange: ((primed: ReadonlySet<string>) => void) | null = null;

  constructor(private readonly sessionDir: string) {}

  start(onChange: (primed: ReadonlySet<string>) => void): void {
    this.onChange = onChange;
    void this.reload();
    this.pollHandle = setInterval(() => void this.reload(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.onChange = null;
  }

  private async reload(): Promise<void> {
    const fs = loadFs();
    if (!fs) return;

    const files = await new Promise<string[]>((resolve) => {
      fs.readdir(this.sessionDir, (err, entries) => resolve(err ? [] : entries));
    });

    const now = Date.now();
    const primed = new Set<string>();
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const raw = await new Promise<string | null>((resolve) => {
        fs.readFile(`${this.sessionDir}/${file}`, "utf-8", (err, data) => resolve(err ? null : data));
      });
      if (!raw) continue;

      let parsed: SessionBufferFile;
      try {
        parsed = JSON.parse(raw) as SessionBufferFile;
      } catch {
        continue;
      }
      if (now - Date.parse(parsed.updatedAt) > STALE_MS) continue;
      for (const note of parsed.notes) primed.add(note);
    }

    const key = [...primed].sort().join("|");
    if (key === this.previousKey) return;
    this.previousKey = key;
    this.onChange?.(primed);
  }
}
