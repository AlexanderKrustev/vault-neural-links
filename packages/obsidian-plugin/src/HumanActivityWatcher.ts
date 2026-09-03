import { FileSystemAdapter, TFile, type App, type Plugin } from "obsidian";
import {
  appendEvent,
  HumanNavigationTracker,
  resolveDataDir,
  type EventLogEntry,
} from "@vault-neural-links/core";

/**
 * VNL-052 — the Obsidian plugin as the engine's primary sensor.
 *
 * Until now the graph only ever learned from the agent's MCP traffic, which
 * a real vault produced about twice a day. The person using that same vault
 * navigates it constantly, and none of it was recorded. This watches
 * `file-open` and `modify`, and appends the pairs worth keeping to the same
 * `.vault-neural-links/events/*.jsonl` log the MCP server writes, so the
 * nightly compaction folds both into the same weights with no other change
 * anywhere in the pipeline.
 *
 * Everything stays on disk inside the vault. This sends nothing anywhere and
 * has no network code — the opt-in/self-hosted rule in the telemetry
 * decision governs phoning home, which this does not do. It is still the
 * user's navigation history, so it is disclosed in the README and can be
 * switched off in settings.
 *
 * The interesting decisions (what counts as one act of navigation, what an
 * edge is worth, throttling) live in core's `HumanNavigationTracker`, which
 * is unit-tested; this class is the Obsidian adapter around it.
 */
export class HumanActivityWatcher {
  private tracker: HumanNavigationTracker | null = null;
  private vaultDataDir: string | null = null;
  private instanceId = "";

  constructor(
    private readonly app: App,
    private readonly plugin: Plugin,
  ) {}

  /**
   * Returns false when this vault can't be watched — a mobile/remote vault
   * with no filesystem path, the same desktop-only constraint
   * WeightsWatcher and NightlyScheduler already carry.
   */
  start(): boolean {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return false;

    // One instance id per plugin load, matching how an MCP server instance
    // owns its own events file: two writers never share a file, so appends
    // can't interleave and the compactor can claim each one independently
    // (VNL-004).
    this.instanceId = `obsidian-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    this.vaultDataDir = resolveDataDir(adapter.getBasePath());
    this.tracker = new HumanNavigationTracker(this.instanceId);

    this.plugin.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        // null means the user focused something that isn't a file (the graph
        // view, settings). That's not navigation away from anywhere, so the
        // previous note is deliberately left in place rather than cleared.
        if (file && isVaultNote(file)) this.record(this.tracker?.noteOpened(notePath(file)));
      }),
    );

    this.plugin.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || !isVaultNote(file)) return;
        // A write to the open note while the window is in the background is
        // the MCP server or a sync client, not the user typing. The tracker
        // also requires the modified file to be the currently open one; this
        // is the half of the guard only the plugin can see.
        if (!isWindowFocused()) return;
        this.record(this.tracker?.noteModified(notePath(file)));
      }),
    );

    return true;
  }

  stop(): void {
    // The event handlers themselves are owned by Plugin.registerEvent and
    // are detached on unload; dropping the tracker just makes any late
    // callback a no-op.
    this.tracker = null;
  }

  private record(event: EventLogEntry | null | undefined): void {
    if (!event || !this.vaultDataDir) return;
    // Fire-and-forget: a failed append must never surface as an error in the
    // editor or delay a keystroke. The console line is enough for a user who
    // comes asking why their graph stopped growing.
    void appendEvent(this.vaultDataDir, this.instanceId, event).catch((err) => {
      console.error("vault-neural-links: failed to log human navigation event:", err);
    });
  }
}

/**
 * Markdown notes only, and nothing under a dot-directory — the graph is a
 * graph of notes, and `.vault-neural-links/`'s own files are not notes.
 */
function isVaultNote(file: TFile): boolean {
  return file.extension === "md" && !file.path.split("/").some((segment) => segment.startsWith("."));
}

/** Vault-relative path without the `.md` extension, matching wikilink targets. */
function notePath(file: { path: string }): string {
  return file.path.replace(/\.md$/, "");
}

function isWindowFocused(): boolean {
  return typeof document === "undefined" || document.hasFocus();
}
