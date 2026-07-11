import type { LinkWeightsFile } from "@vault-neural-links/core";

const POLL_INTERVAL_MS = 2000;
const DEBOUNCE_MS = 500;

type FSWatcher = { close(): void };
type NodeFs = {
  watch(path: string, callback: (event: string) => void): FSWatcher;
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
 * Watches data/link-weights.json (fs.watch, with polling fallback),
 * debounces reloads (~500ms), and emits diffs against the previous
 * snapshot so the renderer can drive reinforcement-pulse animations.
 */
export class WeightsWatcher {
  private fsWatcher: FSWatcher | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private previous: LinkWeightsFile | null = null;
  private onChange: ((current: LinkWeightsFile, previous: LinkWeightsFile | null) => void) | null = null;
  private onError: ((err: NodeJS.ErrnoException | unknown) => void) | null = null;

  constructor(private readonly filePath: string) {}

  start(
    onChange: (current: LinkWeightsFile, previous: LinkWeightsFile | null) => void,
    onError?: (err: NodeJS.ErrnoException | unknown) => void,
  ): void {
    this.onChange = onChange;
    this.onError = onError ?? null;
    void this.reload();

    const fs = loadFs();
    if (fs) {
      try {
        this.fsWatcher = fs.watch(this.filePath, () => this.scheduleReload());
        return;
      } catch {
        this.fsWatcher = null;
      }
    }

    this.pollHandle = setInterval(() => void this.reload(), POLL_INTERVAL_MS);
  }

  stop(): void {
    this.fsWatcher?.close();
    this.fsWatcher = null;
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    this.onChange = null;
    this.onError = null;
  }

  private scheduleReload(): void {
    if (this.debounceHandle !== null) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => void this.reload(), DEBOUNCE_MS);
  }

  private async reload(): Promise<void> {
    const fs = loadFs();
    if (!fs) return;
    fs.readFile(this.filePath, "utf-8", (err, data) => {
      if (err) {
        this.onError?.(err);
        return;
      }
      let parsed: LinkWeightsFile;
      try {
        parsed = JSON.parse(data) as LinkWeightsFile;
      } catch (parseErr) {
        this.onError?.(parseErr);
        return;
      }
      if (this.previous?.compactedAt === parsed.compactedAt) return;
      const previous = this.previous;
      this.previous = parsed;
      this.onChange?.(parsed, previous);
    });
  }
}
