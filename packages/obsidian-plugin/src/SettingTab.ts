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

    // AIBRAIN-128: cross-app auth hand-off status. Shows the cached state immediately
    // (set at plugin load), then re-reads the session file in the background — it's a
    // cheap local file read, not a network call, and the desktop app rewrites it on
    // every silent token refresh while it's open and logged in.
    const accountStatus = new Setting(containerEl)
      .setName("Desktop app account")
      .setDesc(this.describeAccountAuth());
    void this.plugin.refreshAccountAuth().then((state) => {
      accountStatus.setDesc(this.describeAccountAuth(state));
    });

    // VNL-052. Worth being plain about what this records, since it is the
    // user's own navigation history: it stays in the vault folder, it is
    // never sent anywhere, and deleting `.vault-neural-links/` removes it.
    new Setting(containerEl)
      .setName("Learn from my navigation")
      .setDesc(
        "Record which notes you open one after another, and which you edit, so the weighted " +
          "graph learns from how you actually use the vault and not only from what the AI " +
          "assistant reads. Saved to .vault-neural-links/ inside this vault — nothing is sent " +
          "anywhere. Turning this on takes effect after Obsidian reloads.",
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.logHumanNavigation).onChange((value) => {
          this.plugin.settings.logHumanNavigation = value;
          void this.plugin.saveSettings();
          this.plugin.startHumanActivityWatcher();
        }),
      );

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

    new Setting(containerEl)
      .setName("Activation playback speed")
      .setDesc(
        "Live plays activation pulses at real ms-scale timing; Study staggers each hop ~150-300ms apart " +
          "so it's watchable. Rendering pace only — the underlying retrieval timing is never altered.",
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOption("live", "Live")
          .addOption("study", "Study")
          .setValue(this.plugin.settings.playbackMode)
          .onChange((value) => {
            this.plugin.settings.playbackMode = value as "live" | "study";
            void this.plugin.saveSettings();
            this.plugin.refreshGraphViews();
          }),
      );
  }

  /** Human-readable summary of the AIBRAIN-128 cross-app auth state, for the settings tab. */
  private describeAccountAuth(state = this.plugin.accountAuth): string {
    if (state.source === "desktop-app") {
      const who = state.session.email ?? "an account";
      return `Connected to the desktop app — logged in as ${who}.`;
    }
    return "Not connected to the desktop app. Log in there (or via a vault opened through it) to share your account session with this plugin.";
  }
}
