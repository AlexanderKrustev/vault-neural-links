import { Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, type VaultNeuralLinksSettings } from "./settings.js";
import { NEURAL_GRAPH_VIEW_TYPE, NeuralGraphView } from "./view/NeuralGraphView.js";

export default class VaultNeuralLinksPlugin extends Plugin {
  settings: VaultNeuralLinksSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };

    this.registerView(NEURAL_GRAPH_VIEW_TYPE, (leaf: WorkspaceLeaf) => new NeuralGraphView(leaf, this));

    this.addRibbonIcon("git-fork", "Open Neural Graph", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-neural-graph",
      name: "Open Neural Graph",
      callback: () => {
        void this.activateView();
      },
    });
  }

  onunload(): void {}

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
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
