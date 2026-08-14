import { Plugin, WorkspaceLeaf } from "obsidian";
import { VaultNeuralLinksSettingTab } from "./SettingTab.js";
import { DEFAULT_SETTINGS, type VaultNeuralLinksSettings } from "./settings.js";
import { NEURAL_GRAPH_VIEW_TYPE, NeuralGraphView } from "./view/NeuralGraphView.js";
import { NightlyScheduler } from "./NightlyScheduler.js";

export default class VaultNeuralLinksPlugin extends Plugin {
  settings: VaultNeuralLinksSettings = DEFAULT_SETTINGS;
  private nightlyScheduler: NightlyScheduler | null = null;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };

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
  }

  onunload(): void {
    this.nightlyScheduler?.stop();
    this.nightlyScheduler = null;
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
