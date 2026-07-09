import { FileSystemAdapter, ItemView, WorkspaceLeaf } from "obsidian";
import type { LinkWeightsFile } from "@vault-neural-links/core";
import type VaultNeuralLinksPlugin from "../main.js";
import { WeightsWatcher } from "../WeightsWatcher.js";
import { ForceSim, type NativeEdge } from "./ForceSim.js";
import { Renderer } from "./Renderer.js";

export const NEURAL_GRAPH_VIEW_TYPE = "vault-neural-links-view";

export class NeuralGraphView extends ItemView {
  private canvas: HTMLCanvasElement | null = null;
  private sim: ForceSim | null = null;
  private renderer: Renderer | null = null;
  private watcher: WeightsWatcher | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: VaultNeuralLinksPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return NEURAL_GRAPH_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Neural Graph";
  }

  getIcon(): string {
    return "git-fork";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass("vault-neural-links-view");

    this.canvas = container.createEl("canvas");
    this.sim = new ForceSim();
    this.sim.setContinuousAnimation(this.plugin.settings.continuousAnimation);
    this.renderer = new Renderer(this.canvas, this.sim);
    this.renderer.onNodeClicked((path) => this.openNote(path));
    this.renderer.start();

    const controls = container.createDiv({ cls: "vault-neural-links-zoom-controls" });
    const renderer = this.renderer;
    const sim = this.sim;
    controls.createEl("button", { text: "+" }).addEventListener("click", () => renderer.zoomIn());
    controls.createEl("button", { text: "−" }).addEventListener("click", () => renderer.zoomOut());
    controls.createEl("button", { text: "⟲" }).addEventListener("click", () => renderer.resetView());

    const animateBtn = controls.createEl("button", {
      text: "🌊",
      cls: this.plugin.settings.continuousAnimation ? "is-active" : "",
    });
    animateBtn.setAttr("aria-label", "Toggle continuous animation");
    animateBtn.addEventListener("click", () => {
      const enabled = !this.plugin.settings.continuousAnimation;
      this.plugin.settings.continuousAnimation = enabled;
      void this.plugin.saveSettings();
      sim.setContinuousAnimation(enabled);
      animateBtn.toggleClass("is-active", enabled);
    });

    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      container.createEl("div", {
        text: "Vault Neural Links requires the desktop file system — this view is unavailable here.",
      });
      return;
    }

    const weightsPath = `${adapter.getBasePath()}/.vault-neural-links/link-weights.json`;
    this.watcher = new WeightsWatcher(weightsPath);
    this.watcher.start((current, previous) => this.onWeightsChanged(current, previous));
  }

  async onClose(): Promise<void> {
    this.watcher?.stop();
    this.watcher = null;
    this.renderer?.stop();
    this.renderer = null;
    this.sim = null;
  }

  private onWeightsChanged(current: LinkWeightsFile, previous: LinkWeightsFile | null): void {
    if (!this.sim) return;
    const notePaths = this.app.vault.getMarkdownFiles().map((f) => f.path.replace(/\.md$/, ""));
    try {
      this.sim.setData(notePaths, current, this.getNativeEdges());
    } catch (err) {
      console.error("Vault Neural Links: failed to render graph", err);
      return;
    }

    if (!previous || !this.renderer) return;
    for (const [key, record] of Object.entries(current.edges)) {
      const prevRecord = previous.edges[key];
      if (!prevRecord || prevRecord.reinforceCount !== record.reinforceCount) {
        const [source, target] = key.split("|");
        if (source && target) this.renderer.pulseEdge(source, target);
      }
    }
  }

  /** Obsidian's own [[wikilink]] graph, deduped to one undirected edge per pair. */
  private getNativeEdges(): NativeEdge[] {
    const resolved = this.app.metadataCache.resolvedLinks;
    const seen = new Set<string>();
    const edges: NativeEdge[] = [];
    for (const [sourcePath, targets] of Object.entries(resolved)) {
      const source = sourcePath.replace(/\.md$/, "");
      for (const targetPath of Object.keys(targets)) {
        if (!targetPath.endsWith(".md")) continue;
        const target = targetPath.replace(/\.md$/, "");
        if (source === target) continue;
        const key = [source, target].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ source, target });
      }
    }
    return edges;
  }

  private openNote(path: string): void {
    const file = this.app.vault.getMarkdownFiles().find((f) => f.path.replace(/\.md$/, "") === path);
    if (file) void this.app.workspace.getLeaf(false).openFile(file);
  }
}
