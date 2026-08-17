import esbuild from "esbuild";
import process from "node:process";

const production = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/renderer.ts"],
  bundle: true,
  // Renderer process only — main.ts/preload.ts are separately built by tsc
  // straight to CommonJS and run under Electron's real Node, no bundling
  // needed there. This is the one piece that runs in the browser-like
  // renderer world and needs an npm dependency (@vault-neural-links/
  // render-core) pulled in.
  format: "iife",
  target: "es2022",
  platform: "browser",
  outfile: "renderer/bundle.js",
  sourcemap: production ? false : "inline",
  minify: production,
});

if (production) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
