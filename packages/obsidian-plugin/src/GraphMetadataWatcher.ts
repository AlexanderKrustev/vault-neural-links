import type { NoteClustersFile, NoteImportanceFile } from "@vault-neural-links/core";

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

export interface GraphMetadata {
  importance: NoteImportanceFile | null;
  clusters: NoteClustersFile | null;
}

/**
 * Watches note-importance.json and note-clusters.json (fs.watch, with
 * polling fallback) — the two periodic batch-job outputs (AIBRAIN-21 and
 * AIBRAIN-22) that drive node size (PageRank importance) and node color
 * (Louvain cluster) in the graph view. Bundled into one watcher rather
 * than two separate WeightsWatcher-style classes since both files are
 * only ever consumed together for node styling and are written back to
 * back by the same nightly run.
 */
export class GraphMetadataWatcher {
  private importanceFsWatcher: FSWatcher | null = null;
  private clustersFsWatcher: FSWatcher | null = null;
  private pollHandle: ReturnType<typeof setInterval> | null = null;
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private onChange: ((metadata: GraphMetadata) => void) | null = null;
  private importance: NoteImportanceFile | null = null;
  private clusters: NoteClustersFile | null = null;

  constructor(
    private readonly importancePath: string,
    private readonly clustersPath: string,
  ) {}

  start(onChange: (metadata: GraphMetadata) => void): void {
    this.onChange = onChange;
    void this.reload();

    const fs = loadFs();
    if (fs) {
      try {
        this.importanceFsWatcher = fs.watch(this.importancePath, () => this.scheduleReload());
        this.clustersFsWatcher = fs.watch(this.clustersPath, () => this.scheduleReload());
        return;
      } catch {
        this.importanceFsWatcher?.close();
        this.clustersFsWatcher?.close();
        this.importanceFsWatcher = null;
        this.clustersFsWatcher = null;
      }
    }

    this.pollHandle = setInterval(() => void this.reload(), POLL_INTERVAL_MS);
  }

  stop(): void {
    this.importanceFsWatcher?.close();
    this.importanceFsWatcher = null;
    this.clustersFsWatcher?.close();
    this.clustersFsWatcher = null;
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    this.onChange = null;
  }

  private scheduleReload(): void {
    if (this.debounceHandle !== null) clearTimeout(this.debounceHandle);
    this.debounceHandle = setTimeout(() => void this.reload(), DEBOUNCE_MS);
  }

  private readJson<T>(fs: NodeFs, path: string): Promise<T | null> {
    return new Promise((resolve) => {
      fs.readFile(path, "utf-8", (err, data) => {
        if (err) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(data) as T);
        } catch {
          resolve(null);
        }
      });
    });
  }

  private async reload(): Promise<void> {
    const fs = loadFs();
    if (!fs) return;

    const [importance, clusters] = await Promise.all([
      this.readJson<NoteImportanceFile>(fs, this.importancePath),
      this.readJson<NoteClustersFile>(fs, this.clustersPath),
    ]);

    if (importance?.computedAt === this.importance?.computedAt && clusters?.computedAt === this.clusters?.computedAt) {
      return;
    }
    this.importance = importance;
    this.clusters = clusters;
    this.onChange?.({ importance, clusters });
  }
}
