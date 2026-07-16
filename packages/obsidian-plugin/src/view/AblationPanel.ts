import type { AblationDiffResult, AblationLayers } from "@vault-neural-links/core";
import { runAblationComparison, SessionBuffer } from "@vault-neural-links/core";

const DEFAULT_ENERGY = 10;

type LayerKey = keyof AblationLayers;

const LAYER_LABELS: Record<LayerKey, string> = {
  priming: "Session priming",
  importance: "PageRank importance",
  consolidation: "Long-term consolidation",
  structuralFallback: "Structural (wikilink) fallback",
};

/**
 * Reviewer-facing "why was this retrieved" panel (AIBRAIN-27): lets a
 * reviewer pick a note, toggle off one or more scoring layers, and see the
 * before/after diff between a full-layer baseline activate() run and an
 * ablated one — turning "we think priming/importance/consolidation/the
 * structural fallback helps" into something concretely inspectable, rather
 * than a mechanism the demo just has to be taken on faith for.
 *
 * Deliberately a separate panel from RetrievalPathPanel (which logs live
 * activate() traversal as it happens) — this one runs its own on-demand
 * comparison queries against core directly (the plugin already depends on
 * @vault-neural-links/core in-process, same as WeightsWatcher's file reads),
 * independent of whatever's animating in the graph.
 */
export class AblationPanel {
  private noteInput: HTMLInputElement | null = null;
  private resultsEl: HTMLDivElement | null = null;
  private panelEl: HTMLDivElement | null = null;
  private layerCheckboxes = new Map<LayerKey, HTMLInputElement>();

  constructor(
    private readonly vaultDataDir: string,
    private readonly vaultPath: string,
    private readonly getPrimedNotes: () => ReadonlySet<string>,
  ) {}

  mount(container: HTMLElement): void {
    const panel = container.createDiv({ cls: "vault-neural-links-ablation-panel is-collapsed" });
    this.panelEl = panel;

    const header = panel.createDiv({ cls: "vault-neural-links-ablation-panel-header" });
    header.createSpan({ text: "Ablation diff" });
    const toggleBtn = header.createSpan({ cls: "vault-neural-links-ablation-panel-toggle", text: "+" });
    toggleBtn.setAttr("aria-label", "Show ablation diff panel");
    toggleBtn.addEventListener("click", () => {
      const collapsed = panel.hasClass("is-collapsed");
      panel.toggleClass("is-collapsed", !collapsed);
      toggleBtn.setText(collapsed ? "×" : "+");
      toggleBtn.setAttr("aria-label", collapsed ? "Hide ablation diff panel" : "Show ablation diff panel");
    });

    const body = panel.createDiv({ cls: "vault-neural-links-ablation-panel-body" });

    this.noteInput = body.createEl("input", {
      type: "text",
      placeholder: "Note path (e.g. MOCs/General)",
      cls: "vault-neural-links-ablation-note-input",
    });

    const layersEl = body.createDiv({ cls: "vault-neural-links-ablation-layers" });
    for (const key of Object.keys(LAYER_LABELS) as LayerKey[]) {
      const label = layersEl.createEl("label", { cls: "vault-neural-links-ablation-layer-toggle" });
      const checkbox = label.createEl("input", { type: "checkbox" });
      label.createSpan({ text: ` Disable ${LAYER_LABELS[key]}` });
      this.layerCheckboxes.set(key, checkbox);
    }

    const compareBtn = body.createEl("button", { text: "Compare", cls: "vault-neural-links-ablation-compare-btn" });
    compareBtn.addEventListener("click", () => void this.runComparison());

    this.resultsEl = body.createDiv({ cls: "vault-neural-links-ablation-results" });
  }

  unmount(): void {
    this.panelEl?.remove();
    this.panelEl = null;
    this.noteInput = null;
    this.resultsEl = null;
    this.layerCheckboxes.clear();
  }

  /** Pre-fills the note input, e.g. when a reviewer clicks a node in the graph. */
  setNote(path: string): void {
    if (this.noteInput) this.noteInput.value = path;
  }

  private async runComparison(): Promise<void> {
    if (!this.resultsEl || !this.noteInput) return;
    const note = this.noteInput.value.trim();
    if (!note) return;

    const disabledLayers: Partial<AblationLayers> = {};
    for (const [key, checkbox] of this.layerCheckboxes) {
      if (checkbox.checked) disabledLayers[key] = false;
    }

    this.resultsEl.empty();
    this.resultsEl.createSpan({ text: "Comparing…", cls: "vault-neural-links-ablation-status" });

    // Approximates the querying session's live SessionBuffer from the same
    // primed-note set the graph view already polls for the warm-ring
    // visualization (see PrimedWatcher) — the plugin process has no direct
    // access to any MCP server instance's real in-memory buffer.
    const sessionBuffer = new SessionBuffer();
    for (const primed of this.getPrimedNotes()) sessionBuffer.touch(primed);

    let result: AblationDiffResult;
    try {
      result = await runAblationComparison(this.vaultDataDir, note, DEFAULT_ENERGY, disabledLayers, undefined, this.vaultPath, sessionBuffer);
    } catch (err) {
      this.resultsEl.empty();
      this.resultsEl.createSpan({ text: `Ablation comparison failed: ${String(err)}`, cls: "vault-neural-links-ablation-status" });
      return;
    }

    this.renderDiff(result);
  }

  private renderDiff(result: AblationDiffResult): void {
    if (!this.resultsEl) return;
    this.resultsEl.empty();

    if (result.diff.length === 0) {
      this.resultsEl.createSpan({ text: "No difference — this layer contributed nothing to this note's retrieval.", cls: "vault-neural-links-ablation-status" });
      return;
    }

    for (const entry of result.diff) {
      const row = this.resultsEl.createDiv({ cls: `vault-neural-links-ablation-row is-${entry.status}` });
      const sign = entry.status === "removed" ? "−" : entry.status === "added" ? "+" : "±";
      row.createSpan({ cls: "vault-neural-links-ablation-row-sign", text: sign });
      row.createSpan({ cls: "vault-neural-links-ablation-row-path", text: entry.path });
      const before = entry.baselineEnergy?.toFixed(2) ?? "—";
      const after = entry.ablatedEnergy?.toFixed(2) ?? "—";
      row.createSpan({ cls: "vault-neural-links-ablation-row-energy", text: `${before} → ${after}` });
    }
  }
}
