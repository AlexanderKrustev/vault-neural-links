#!/usr/bin/env node
// Runs compaction independent of any Claude Code session (cron / systemd timer).
import { compact, rebuildStructuralIndex, resolveDataDir } from "../dist/index.js";

const vaultPath = process.argv[2];
if (!vaultPath) {
  console.error("usage: vnl-compact <vault-path>");
  process.exit(1);
}

const vaultDataDir = resolveDataDir(vaultPath);

compact(vaultDataDir)
  .then((result) => {
    console.log(`compacted ${result.edgeCount} edges at ${result.compactedAt}`);
    return rebuildStructuralIndex(vaultPath, vaultDataDir);
  })
  .then((structuralResult) => {
    console.log(
      `structural index: ${structuralResult.edgeCount} edges across ${structuralResult.noteCount} notes at ${structuralResult.builtAt}`,
    );
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
