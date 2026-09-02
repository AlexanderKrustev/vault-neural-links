# Changesets

This directory gets auto-populated when running `npx changeset`. See
[changesets/changesets](https://github.com/changesets/changesets) for docs
on what a changeset is, and why we recommend using them.

## Workflow for this repo (AIBRAIN-41/42)

1. After a change to `packages/core` or `packages/mcp-server` that should
   ship a new version, run `npx changeset` (from the repo root) and answer
   the prompts — which package(s) changed, patch/minor/major, and a short
   summary. This writes a small markdown file under `.changeset/`.
2. Commit that file alongside your change and push.
3. On merge to `main`, the `release.yml` GitHub Actions workflow opens (or
   updates) a "Version Packages" PR that applies the changeset(s) —
   bumping versions and updating each package's `CHANGELOG.md`.
4. Merging that PR triggers the same workflow to build and
   `npx changeset publish` to npm, using the repo's `NPM_TOKEN` secret.

Only `packages/core` and `packages/mcp-server` are published — see
`ignore` in `config.json`. `packages/obsidian-plugin` ships via the
Obsidian community store submission process instead (AIBRAIN-39), not npm.
