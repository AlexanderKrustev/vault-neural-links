#!/usr/bin/env node
// The actual once-a-day scheduled job (cron / systemd timer / Windows Task
// Scheduler). Runs compaction first (folds any events since the last run
// into baseStrength/reactivationDays), then consolidation promotion —
// deliberately two steps, not one: compaction is safe to also run on-demand
// (via the compact_weights MCP tool), but consolidation promotion must only
// run on a real once-a-day cadence, or the reactivation threshold would be
// meaningless.
import { compact, resolveDataDir, runNightlyConsolidation } from "../dist/index.js";

const vaultPath = process.argv[2];
if (!vaultPath) {
  console.error("usage: vnl-nightly <vault-path>");
  process.exit(1);
}

const vaultDataDir = resolveDataDir(vaultPath);

compact(vaultDataDir)
  .then((compactionResult) => {
    console.log(`compacted ${compactionResult.edgeCount} edges at ${compactionResult.compactedAt}`);
    return runNightlyConsolidation(vaultDataDir);
  })
  .then((consolidationResult) => {
    console.log(
      `consolidation: ${consolidationResult.promotedCount}/${consolidationResult.edgeCount} edges promoted at ${consolidationResult.consolidatedAt}`,
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
