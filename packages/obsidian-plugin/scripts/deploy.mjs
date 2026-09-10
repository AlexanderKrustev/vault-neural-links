#!/usr/bin/env node
// Copies the built plugin into the Obsidian vault it is meant to run in.
//
// Why this exists: `npm run build` writes main.js into the repo and stops
// there. Nothing propagates to the vault, so the installed plugin keeps
// running whatever bundle was last hand-copied — on 2026-09-10 that was
// six days and four tickets stale while the repo build had been current
// and committed the whole time. "Tests green, build succeeds, committed"
// is not the same as "live", and for the plugin the gap is total.
//
//   npm run deploy            # build, then copy into $CLAUDE_VAULT_PATH
//   npm run deploy -- <path>  # ...or into the vault given here
//
// The vault is resolved from CLAUDE_VAULT_PATH and never hardcoded: it
// moves. Obsidian holds the bundle in memory, so the copy is only half of
// a deploy — the reminder printed at the end is the other half.
import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const PLUGIN_ID = "vault-neural-links";
// manifest.json is copied too: Obsidian reads the installed copy, so a
// version bump that stays in the repo is invisible. It is deliberately not
// *edited* here — `version: 0.0.0` and `isDesktopOnly: false` are both
// wrong and both belong to AIBRAIN-43, not to a deploy step.
const ARTIFACTS = ["main.js", "manifest.json", "styles.css"];
// Only this one is worth keeping a copy of: the other two are small and
// versioned, while a bad main.js is what actually breaks someone's vault.
const BACKED_UP = new Set(["main.js"]);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function fail(message, ...detail) {
  console.error(`deploy: ${message}`);
  for (const line of detail) console.error(`  ${line}`);
  process.exit(1);
}

const vaultPath = process.argv[2] ?? process.env.CLAUDE_VAULT_PATH;
if (!vaultPath) {
  fail(
    "no vault path.",
    "Set CLAUDE_VAULT_PATH, or pass one: npm run deploy -- <vault path>",
  );
}

const pluginDir = join(resolve(vaultPath), ".obsidian", "plugins", PLUGIN_ID);
try {
  await stat(join(resolve(vaultPath), ".obsidian"));
} catch {
  fail(`${vaultPath} does not look like an Obsidian vault (no .obsidian/).`);
}

const hash = async (path) => createHash("sha256").update(await readFile(path)).digest("hex");
const today = new Date().toISOString().slice(0, 10);

await mkdir(pluginDir, { recursive: true });

let changed = 0;
for (const artifact of ARTIFACTS) {
  const source = join(packageRoot, artifact);
  const target = join(pluginDir, artifact);

  let sourceHash;
  try {
    sourceHash = await hash(source);
  } catch {
    fail(`${artifact} is missing from the build.`, "Run: npm run build");
  }

  const existingHash = await hash(target).catch(() => null);
  if (existingHash === sourceHash) {
    console.log(`  ${artifact.padEnd(14)} unchanged`);
    continue;
  }

  // One backup per day rather than one per deploy: enough to undo a bad
  // build, without quietly filling the user's plugin folder.
  if (existingHash && BACKED_UP.has(artifact)) {
    await copyFile(target, `${target}.bak-${today}`);
  }
  await copyFile(source, target);
  const { size } = await stat(target);
  console.log(`  ${artifact.padEnd(14)} updated (${size.toLocaleString()} bytes)`);
  changed++;
}

console.log(`\ndeployed to ${pluginDir}`);
if (changed === 0) {
  console.log("nothing changed — the vault was already running this build.");
} else {
  // Not optional: until this happens the vault is still executing the old
  // bundle, which is exactly the failure this script exists to prevent.
  console.log("\nObsidian is still running the previous bundle. To load this one:");
  console.log("  Settings -> Community plugins -> toggle Vault Neural Links off and on");
  console.log("  (or Ctrl+P -> \"Reload app without saving\")");
}
