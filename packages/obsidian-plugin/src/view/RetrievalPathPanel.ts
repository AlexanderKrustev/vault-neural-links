import type { ActivationTraceEvent } from "@vault-neural-links/core";

const MAX_RUNS = 20;

interface RunState {
  lastHop: number;
  rowEl: HTMLDivElement;
}

/**
 * Small scrollable side panel logging the actual retrieval path text for
 * each activate() run (e.g. "M+S Hydraulic → SAP Sales Cloud → [2 hops] →
 * Discovery Phase template"), so the activation mechanism is auditable, not
 * just decorative pulses. Only edge_traversed events build the path text —
 * node_activated events carry the same "to" note redundantly.
 */
export class RetrievalPathPanel {
  private listEl: HTMLDivElement | null = null;
  private runs = new Map<string, RunState>();
  private order: string[] = []; // runIds, newest first

  mount(container: HTMLElement): void {
    const panel = container.createDiv({ cls: "vault-neural-links-retrieval-panel" });
    const header = panel.createDiv({ cls: "vault-neural-links-retrieval-panel-header" });
    header.createSpan({ text: "Retrieval path" });
    const toggleBtn = header.createSpan({
      cls: "vault-neural-links-retrieval-panel-toggle",
      text: "×",
    });
    toggleBtn.setAttr("aria-label", "Hide retrieval path panel");
    this.listEl = panel.createDiv({ cls: "vault-neural-links-retrieval-panel-body" });
    toggleBtn.addEventListener("click", () => {
      const collapsed = panel.hasClass("is-collapsed");
      panel.toggleClass("is-collapsed", !collapsed);
      toggleBtn.setText(collapsed ? "×" : "+");
      toggleBtn.setAttr("aria-label", collapsed ? "Hide retrieval path panel" : "Show retrieval path panel");
    });
  }

  unmount(): void {
    this.listEl?.parentElement?.remove();
    this.listEl = null;
    this.runs.clear();
    this.order = [];
  }

  logEvent(event: ActivationTraceEvent): void {
    if (event.type !== "edge_traversed" || !this.listEl || !event.to) return;

    const existing = this.runs.get(event.runId);
    if (existing) {
      const gap = event.hop - existing.lastHop;
      const segment = gap > 1 ? ` → [${gap} hops] → ${event.to}` : ` → ${event.to}`;
      existing.rowEl.appendText(segment);
      existing.lastHop = event.hop;
      return;
    }

    const rowEl = this.listEl.createDiv({ cls: "vault-neural-links-retrieval-panel-row" });
    rowEl.setText(`${event.origin} → ${event.to}`);
    this.listEl.prepend(rowEl);

    this.runs.set(event.runId, { lastHop: event.hop, rowEl });
    this.order.unshift(event.runId);

    while (this.order.length > MAX_RUNS) {
      const evicted = this.order.pop();
      if (!evicted) break;
      const state = this.runs.get(evicted);
      state?.rowEl.remove();
      this.runs.delete(evicted);
    }
  }
}
