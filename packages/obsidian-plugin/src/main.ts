import { Plugin, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, type VaultNeuralLinksSettings } from "./settings.js";
import { NEURAL_GRAPH_VIEW_TYPE, NeuralGraphView } from "./view/NeuralGraphView.js";
import { WeightsWatcher } from "./WeightsWatcher.js";

export default class VaultNeuralLinksPlugin extends Plugin {
  settings: VaultNeuralLinksSettings = DEFAULT_SETTINGS;
  private watcher: WeightsWatcher | null = null;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };

    this.registerView(NEURAL_GRAPH_VIEW_TYPE, (leaf: WorkspaceLeaf) => new NeuralGraphView(leaf));

    this.addRibbonIcon("git-fork", "Open Neural Graph", () => {
      throw new Error("not implemented");
    });

    this.addCommand({
      id: "open-neural-graph",
      name: "Open Neural Graph",
      callback: () => {
        throw new Error("not implemented");
      },
    });
  }

  onunload(): void {
    this.watcher?.stop();
  }
}
