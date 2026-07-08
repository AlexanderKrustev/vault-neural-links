#!/usr/bin/env node
// Runs compaction independent of any Claude Code session (cron / systemd timer).
import { compact, resolveDataDir } from "../dist/index.js";

const vaultPath = process.argv[2];
if (!vaultPath) {
  console.error("usage: vnl-compact <vault-path>");
  process.exit(1);
}

compact(resolveDataDir(vaultPath))
  .then((result) => {
    console.log(`compacted ${result.edgeCount} edges at ${result.compactedAt}`);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
