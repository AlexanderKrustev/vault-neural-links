import { Plugin, WorkspaceLeaf } from "obsidian";
import { VaultNeuralLinksSettingTab } from "./SettingTab.js";
import { DEFAULT_SETTINGS, type VaultNeuralLinksSettings } from "./settings.js";
import { NEURAL_GRAPH_VIEW_TYPE, NeuralGraphView } from "./view/NeuralGraphView.js";
import { NightlyScheduler } from "./NightlyScheduler.js";
import { HumanActivityWatcher } from "./HumanActivityWatcher.js";
import { getAccountAuthState, type AccountAuthState } from "./accountAuth.js";

export default class VaultNeuralLinksPlugin extends Plugin {
  settings: VaultNeuralLinksSettings = DEFAULT_SETTINGS;
  /** Cross-app auth hand-off state (AIBRAIN-128) — refreshed via refreshAccountAuth(). */
  accountAuth: AccountAuthState = { source: "none" };
  private nightlyScheduler: NightlyScheduler | null = null;
  private humanActivityWatcher: HumanActivityWatcher | null = null;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
    this.accountAuth = await getAccountAuthState();

    this.registerView(NEURAL_GRAPH_VIEW_TYPE, (leaf: WorkspaceLeaf) => new NeuralGraphView(leaf, this));
    this.addSettingTab(new VaultNeuralLinksSettingTab(this.app, this));

    this.addRibbonIcon("brain", "Open Neural Graph", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-neural-graph",
      name: "Open Neural Graph",
      callback: () => {
        void this.activateView();
      },
    });

    // Sole trigger for the daily compact/consolidate/reindex/importance/
    // cluster pipeline (AIBRAIN-46) — no OS scheduled task, no Claude Code /
    // MCP-server-startup trigger. See NightlyScheduler for the idempotency
    // guarantee (delegated to core's file-marker-based runNightlyIfStale).
    this.nightlyScheduler = new NightlyScheduler(this.app);
    this.nightlyScheduler.start();

    // VNL-052: the plugin is the engine's main sensor. Agent MCP traffic
    // alone measured ~2 events/day in a real vault, which no amount of
    // tuning turns into a usable usage-weighted graph; the human using the
    // same vault produces far more. Writes to the same local event log, and
    // nothing leaves the machine.
    this.startHumanActivityWatcher();
  }

  onunload(): void {
    this.nightlyScheduler?.stop();
    this.nightlyScheduler = null;
    this.humanActivityWatcher?.stop();
    this.humanActivityWatcher = null;
  }

  /**
   * Starts (or stops) the human-navigation sensor to match the current
   * setting. Obsidian detaches `registerEvent` handlers only on unload, so
   * turning the setting off mid-session drops the tracker — already-queued
   * callbacks then become no-ops — and turning it back on needs a reload to
   * re-register. Called on load and from the settings tab.
   */
  startHumanActivityWatcher(): void {
    if (!this.settings.logHumanNavigation) {
      this.humanActivityWatcher?.stop();
      return;
    }
    if (this.humanActivityWatcher) return;
    this.humanActivityWatcher = new HumanActivityWatcher(this.app, this);
    if (!this.humanActivityWatcher.start()) this.humanActivityWatcher = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /**
   * Re-reads the cross-app account session (AIBRAIN-128) and returns the fresh state.
   * The desktop app rewrites its session file on every silent token refresh while it's
   * open and logged in, so this is a cheap file read, not a network call — safe to call
   * whenever current status needs to be shown (e.g. each time the settings tab opens).
   */
  async refreshAccountAuth(): Promise<AccountAuthState> {
    this.accountAuth = await getAccountAuthState();
    return this.accountAuth;
  }

  /** Re-applies current settings to every open Neural Graph view without waiting for a data change. */
  refreshGraphViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(NEURAL_GRAPH_VIEW_TYPE)) {
      if (leaf.view instanceof NeuralGraphView) leaf.view.applySettings();
    }
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(NEURAL_GRAPH_VIEW_TYPE)[0];
    if (existing) {
      workspace.revealLeaf(existing);
      return;
    }

    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type: NEURAL_GRAPH_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }
}
