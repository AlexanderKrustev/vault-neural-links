import type { EventLogEntry, HumanSignalConfig } from "./types.js";
import { DEFAULT_HUMAN_SIGNAL_CONFIG } from "./types.js";

/**
 * VNL-052. The engine's only learning signal used to be the agent's own MCP
 * traffic — measured at roughly two events a day in a real vault, which is
 * not enough for a usage-weighted graph to become informative (D9/D10). The
 * human moving around the same vault inside Obsidian generates far more, and
 * it was being thrown away.
 *
 * This is the decision half of that sensor, kept in core and free of any
 * Obsidian API so it can be tested: the plugin feeds it raw `file-open` /
 * `modify` callbacks, and it decides which of them are worth an edge and
 * what that edge is worth. See `HumanActivityWatcher` in the plugin for the
 * adapter.
 *
 * What it deliberately does not do: infer an edge from a single note. Every
 * event in the log is a pair, so a note opened with nothing before it in the
 * window produces nothing — the first open after Obsidian starts is not
 * evidence of a relationship between anything.
 */
export class HumanNavigationTracker {
  /** Most recent opens, newest first: [current, previous]. */
  private readonly recent: { path: string; at: number }[] = [];
  /** Edge key -> when this tracker last emitted an event for it, for throttling. */
  private readonly lastEmitted = new Map<string, number>();

  constructor(
    private readonly instanceId: string,
    private readonly config: HumanSignalConfig = DEFAULT_HUMAN_SIGNAL_CONFIG,
  ) {}

  /**
   * The user opened a note. Returns a `traverse` event when it followed
   * another note closely enough to be one act of navigation rather than two
   * unrelated visits, otherwise null.
   */
  noteOpened(path: string, now: Date = new Date()): EventLogEntry | null {
    const previous = this.recent[0];
    this.remember(path, now);

    if (!previous || previous.path === path) return null;
    if (now.getTime() - previous.at > this.config.coOpenWindowMs) return null;

    return this.emit("traverse", previous.path, path, this.config.openWeight, "human-open", now);
  }

  /**
   * The user edited the note they currently have open. Returns a `reinforce`
   * event crediting the path they took to get there, or null.
   *
   * Requiring `path` to be the currently-open note is what keeps this from
   * counting writes the user didn't make: the MCP server's own
   * `create_note`/`update_note`, and file-sync clients, both fire Obsidian's
   * `modify` event exactly like a keystroke does. The plugin additionally
   * gates on the window having focus (see HumanActivityWatcher) — belt and
   * braces, because a write to the open note while the user is elsewhere is
   * the one case this check alone can't catch.
   */
  noteModified(path: string, now: Date = new Date()): EventLogEntry | null {
    const [current, previous] = this.recent;
    if (!current || current.path !== path) return null;
    if (!previous || previous.path === path) return null;
    // Measured from the arrival at `path`, and deliberately not refreshed by
    // the edit itself: an hour of typing in one note is not an hour of
    // mounting evidence about the note the user came from.
    if (now.getTime() - current.at > this.config.coOpenWindowMs) return null;

    return this.emit("reinforce", previous.path, path, this.config.editWeight, "human-edit", now);
  }

  private remember(path: string, now: Date): void {
    if (this.recent[0]?.path === path) {
      // Re-focusing the same note isn't navigation, but it is the user still
      // being here, so keep the slot and leave its arrival time alone —
      // refreshing it would let a note stay "just arrived at" indefinitely.
      return;
    }
    this.recent.unshift({ path, at: now.getTime() });
    this.recent.length = Math.min(this.recent.length, 2);
  }

  private emit(
    type: "traverse" | "reinforce",
    from: string,
    to: string,
    weight: number,
    trigger: "human-open" | "human-edit",
    now: Date,
  ): EventLogEntry | null {
    // Flipping between two notes twenty times, or saving repeatedly while
    // writing, is one relationship — not twenty. Throttled per edge (not per
    // note) so it never suppresses genuinely new navigation.
    const key = `${type}:${[from, to].sort().join("|")}`;
    const last = this.lastEmitted.get(key);
    const throttleMs = type === "traverse" ? this.config.pairThrottleMs : this.config.editThrottleMs;
    if (last !== undefined && now.getTime() - last < throttleMs) return null;
    this.lastEmitted.set(key, now.getTime());

    return {
      ts: now.toISOString(),
      instance: this.instanceId,
      type,
      from,
      to,
      weight_delta: weight,
      trigger,
    };
  }
}
