import esbuild from "esbuild";
import process from "node:process";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  // AblationPanel is the first plugin module to import @vault-neural-links/core
  // at runtime (not just for types) — its compiled dist/ output (tsup) strips
  // the "node:" prefix off built-in imports, so those bare specifiers need
  // externalizing too, alongside the "node:"-prefixed ones already here.
  // accountAuth.ts (AIBRAIN-128) pulls in core's accountSession.ts, which also
  // imports node:os — "os"/"node:os" added here for the same reason.
  external: ["obsidian", "electron", "node:fs", "node:path", "node:os", "fs", "fs/promises", "path", "os", "crypto"],
  format: "cjs",
  target: "es2022",
  platform: "browser",
  outfile: "main.js",
  sourcemap: production ? false : "inline",
  minify: production,
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
