import type { UsageReport } from "@vault-neural-links/core";
import { computeUsageReport } from "@vault-neural-links/core";

/**
 * AIBRAIN-68 — renders the personal usage report (session cadence, which
 * mechanisms actually fire, top-touched notes vs. importance) computed
 * on-demand from the events/retrieval/session JSONL logs already written
 * under vaultDataDir. Collapsed by default and computed lazily on refresh,
 * matching AblationPanel's lazy-compute pattern rather than polling.
 */
export class UsageReportPanel {
  private panelEl: HTMLDivElement | null = null;
  private resultsEl: HTMLDivElement | null = null;

  constructor(private readonly vaultDataDir: string) {}

  mount(container: HTMLElement): void {
    const panel = container.createDiv({ cls: "vault-neural-links-usage-panel is-collapsed" });
    this.panelEl = panel;

    const header = panel.createDiv({ cls: "vault-neural-links-usage-panel-header" });
    header.createSpan({ text: "Usage report" });
    const toggleBtn = header.createSpan({ cls: "vault-neural-links-usage-panel-toggle", text: "+" });
    toggleBtn.setAttr("aria-label", "Show usage report panel");
    toggleBtn.addEventListener("click", () => {
      const collapsed = panel.hasClass("is-collapsed");
      panel.toggleClass("is-collapsed", !collapsed);
      toggleBtn.setText(collapsed ? "×" : "+");
      toggleBtn.setAttr("aria-label", collapsed ? "Hide usage report panel" : "Show usage report panel");
    });

    const body = panel.createDiv({ cls: "vault-neural-links-usage-panel-body" });
    const refreshBtn = body.createEl("button", { text: "Refresh", cls: "vault-neural-links-usage-refresh-btn" });
    refreshBtn.addEventListener("click", () => void this.refresh());

    this.resultsEl = body.createDiv({ cls: "vault-neural-links-usage-results" });
  }

  unmount(): void {
    this.panelEl?.remove();
    this.panelEl = null;
    this.resultsEl = null;
  }

  private async refresh(): Promise<void> {
    if (!this.resultsEl) return;
    this.resultsEl.empty();
    this.resultsEl.createSpan({ text: "Computing…", cls: "vault-neural-links-usage-status" });

    let report: UsageReport;
    try {
      report = await computeUsageReport(this.vaultDataDir);
    } catch (err) {
      this.resultsEl.empty();
      this.resultsEl.createSpan({ text: `Usage report failed: ${String(err)}`, cls: "vault-neural-links-usage-status" });
      return;
    }

    this.render(report);
  }

  private render(report: UsageReport): void {
    if (!this.resultsEl) return;
    this.resultsEl.empty();

    const summary = this.resultsEl.createDiv({ cls: "vault-neural-links-usage-section" });
    summary.createDiv({ text: `${report.sessionCount} sessions logged`, cls: "vault-neural-links-usage-line" });
    summary.createDiv({
      text: `Typical session: ${report.typicalSessionMinutes !== null ? `${report.typicalSessionMinutes.toFixed(1)} min` : "not enough data"}`,
      cls: "vault-neural-links-usage-line",
    });

    // VNL-057, placed above the mechanism counts on purpose: this is the
    // number the project steers by, and everything below it is diagnostics
    // for why this number is what it is.
    const useful = this.resultsEl.createDiv({ cls: "vault-neural-links-usage-section" });
    useful.createDiv({ text: "Was it useful?", cls: "vault-neural-links-usage-section-title" });
    const rt = report.readThrough;
    if (rt.recalls === 0) {
      useful.createDiv({
        text: "No recall calls logged yet — this fills in once the assistant starts asking the vault questions.",
        cls: "vault-neural-links-usage-line",
      });
    } else {
      const pct = (value: number | null): string => (value === null ? "—" : `${Math.round(value * 100)}%`);
      useful.createDiv({
        text: `${rt.recalls} recalls · ${pct(rt.usefulRecallRate)} led to opening a result`,
        cls: "vault-neural-links-usage-line",
      });
      useful.createDiv({
        text: `${rt.resultsRead} of ${rt.resultsReturned} returned notes were opened (${pct(rt.resultReadRate)})`,
        cls: "vault-neural-links-usage-line",
      });
      // Reported apart from the two above because "a note was opened" and
      // "a note reached the work" are different claims — the distinction
      // AIBRAIN-134's taxonomy exists to keep.
      useful.createDiv({
        text: `${pct(rt.writeFollowRate)} were followed by writing a note`,
        cls: "vault-neural-links-usage-line",
      });
    }

    const mechanisms = this.resultsEl.createDiv({ cls: "vault-neural-links-usage-section" });
    mechanisms.createDiv({ text: "Mechanisms fired", cls: "vault-neural-links-usage-section-title" });
    mechanisms.createDiv({ text: `traverse: ${report.mechanismCounts.traverse}`, cls: "vault-neural-links-usage-line" });
    mechanisms.createDiv({
      text:
        `reinforce: ${report.mechanismCounts.reinforce.explicit} explicit / ` +
        `${report.mechanismCounts.reinforce.autoRetrieval} auto-retrieval / ` +
        `${report.mechanismCounts.reinforce.cited} cited`,
      cls: "vault-neural-links-usage-line",
    });
    // VNL-053: the term graph is a separate file from the link graph, so it
    // gets its own line rather than being counted as a reinforcement — the
    // number here is "a search result was read, and its query's words were
    // credited to it", not anything that happened to a note-to-note edge.
    mechanisms.createDiv({
      text:
        `learned terms: ${report.mechanismCounts.termLearn.searchRead} from search / ` +
        `${report.mechanismCounts.termLearn.recallRead} from recall`,
      cls: "vault-neural-links-usage-line",
    });
    mechanisms.createDiv({
      text: `activate: ${report.mechanismCounts.activate.activation} activation / ${report.mechanismCounts.activate.keyword} keyword / ${report.mechanismCounts.activate.recency} recency`,
      cls: "vault-neural-links-usage-line",
    });
    mechanisms.createDiv({
      text: `get_weighted_neighbors: ${report.mechanismCounts.getWeightedNeighbors}`,
      cls: "vault-neural-links-usage-line",
    });
    mechanisms.createDiv({ text: `search: ${report.mechanismCounts.search}`, cls: "vault-neural-links-usage-line" });
    // VNL-052: kept on its own line, not folded into traverse/reinforce
    // above — see computeUsageReport's own reasoning for why the two must
    // stay legible as separate numbers.
    mechanisms.createDiv({
      text:
        `your navigation: ${report.mechanismCounts.human.opens} opens / ${report.mechanismCounts.human.edits} edits` +
        (report.mechanismCounts.human.historyImported > 0
          ? ` (+${report.mechanismCounts.human.historyImported} imported from Obsidian history)`
          : ""),
      cls: "vault-neural-links-usage-line",
    });

    const notes = this.resultsEl.createDiv({ cls: "vault-neural-links-usage-section" });
    notes.createDiv({ text: "Most-touched notes", cls: "vault-neural-links-usage-section-title" });
    if (report.topTouchedNotes.length === 0) {
      notes.createDiv({ text: "No traverse/reinforce history yet.", cls: "vault-neural-links-usage-line" });
    } else {
      for (const note of report.topTouchedNotes) {
        const row = notes.createDiv({ cls: "vault-neural-links-usage-note-row" });
        row.createSpan({ cls: "vault-neural-links-usage-note-path", text: note.path });
        const importanceText = note.importance !== null ? note.importance.toFixed(2) : "—";
        row.createSpan({ cls: "vault-neural-links-usage-note-stats", text: `${note.touches}× · importance ${importanceText}` });
      }
      if (report.importanceOverlapPct !== null) {
        notes.createDiv({
          text: `${report.importanceOverlapPct.toFixed(0)}% of these also rank top-importance`,
          cls: "vault-neural-links-usage-line",
        });
      }
    }

    if (report.gaps.length > 0) {
      const gaps = this.resultsEl.createDiv({ cls: "vault-neural-links-usage-section" });
      gaps.createDiv({ text: "Gaps between intended and actual usage", cls: "vault-neural-links-usage-section-title" });
      for (const gap of report.gaps) {
        gaps.createDiv({ text: gap, cls: "vault-neural-links-usage-gap" });
      }
    }
  }
}
