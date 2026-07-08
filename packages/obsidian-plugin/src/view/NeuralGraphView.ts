import { ItemView, WorkspaceLeaf } from "obsidian";

export const NEURAL_GRAPH_VIEW_TYPE = "vault-neural-links-view";

export class NeuralGraphView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return NEURAL_GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Neural Graph";
  }

  async onOpen(): Promise<void> {
    throw new Error("not implemented");
  }

  async onClose(): Promise<void> {
    throw new Error("not implemented");
  }
}
