import { App, PluginSettingTab, Setting } from "obsidian";
import type VaultNeuralLinksPlugin from "./main.js";

export class VaultNeuralLinksSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: VaultNeuralLinksPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Minimum edge weight")
      .setDesc(
        "Hide usage-weighted links below this weight in the graph view. Notes left with no " +
          "remaining edges are hidden entirely. Native wikilinks are unaffected.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(0, 20, 0.5)
          .setValue(this.plugin.settings.minWeightFilter)
          .setDynamicTooltip()
          .onChange((value) => {
            this.plugin.settings.minWeightFilter = value;
            void this.plugin.saveSettings();
            this.plugin.refreshGraphViews();
          }),
      );

    new Setting(containerEl)
      .setName("Color scheme")
      .setDesc("Palette used for the weight gradient on neural (usage-weighted) edges.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("default", "Default")
          .addOption("high-contrast", "High contrast")
          .setValue(this.plugin.settings.colorScheme)
          .onChange((value) => {
            this.plugin.settings.colorScheme = value as "default" | "high-contrast";
            void this.plugin.saveSettings();
            this.plugin.refreshGraphViews();
          }),
      );

    new Setting(containerEl)
      .setName("Decay half-life (days)")
      .setDesc(
        "Should match the vault-neural-link MCP server's decay half-life. Controls how quickly " +
          "edges fade toward 'stale' in the graph view — it does not change actual weight decay, " +
          "which happens server-side during compaction.",
      )
      .addText((text) =>
        text.setValue(String(this.plugin.settings.decayHalfLifeDays)).onChange((value) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed <= 0) return;
          this.plugin.settings.decayHalfLifeDays = parsed;
          void this.plugin.saveSettings();
          this.plugin.refreshGraphViews();
        }),
      );

    new Setting(containerEl)
      .setName("Continuous animation")
      .setDesc("Keep a gentle jitter running forever instead of letting the graph settle.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.continuousAnimation).onChange((value) => {
          this.plugin.settings.continuousAnimation = value;
          void this.plugin.saveSettings();
          this.plugin.refreshGraphViews();
        }),
      );
  }
}
