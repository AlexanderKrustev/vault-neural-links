import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // VNL-005: this package ships an executable (`vnl-mcp`), not a library —
  // nobody imports its types, and the sourcemap tripled the tarball. Both are
  // off so the published artifact stays ~20 KB.
  dts: false,
  clean: true,
  sourcemap: false,
  // AIBRAIN-41: "@vault-neural-links/core": "*" only resolves via the npm
  // workspace symlink during a monorepo build — it would not resolve at
  // all for a user who installs @vault-neural-links/mcp-server standalone
  // (e.g. via `npx -y @vault-neural-links/mcp-server`), since core is a
  // devDependency here (kept only so the workspace build can bundle it),
  // not a published runtime dependency of this package. Bundling core
  // straight into this package's own dist output means a standalone
  // install never needs to resolve it separately at all.
  noExternal: ["@vault-neural-links/core"],
  banner: {
    js: "#!/usr/bin/env node",
  },
});
