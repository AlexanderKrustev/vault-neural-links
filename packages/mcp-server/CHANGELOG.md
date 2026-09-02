# @vault-neural-links/mcp-server

## 0.1.0

Initial public release baseline (AIBRAIN-40) — versions from here on are
managed by [Changesets](https://github.com/changesets/changesets); see
`.changeset/README.md`.

### Fixes

- Benefits directly from `@vault-neural-links/core@0.1.0`'s retrieval
  fixes — see that package's changelog.

### Packaging

- `@vault-neural-links/core` is now bundled straight into this package's
  own build output instead of being a runtime dependency resolved only
  via the npm workspace symlink, so `npx -y @vault-neural-links/mcp-server`
  works standalone (AIBRAIN-41). Verified with a real `npm pack` +
  install-from-tarball into an unrelated project.
- Added `LICENSE` (MIT), `publishConfig.access: "public"`, and repository
  metadata for npm publishing (AIBRAIN-40).
