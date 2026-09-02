# @vault-neural-links/core

## 0.1.0

Initial public release baseline (AIBRAIN-40) — versions from here on are
managed by [Changesets](https://github.com/changesets/changesets); see
`.changeset/README.md`. Includes the retrieval-hardening work leading up
to this release:

### Fixes

- `searchNotes` tokenizes queries instead of requiring one literal
  contiguous substring, and ranks by match-kind relevance (title > alias
  > content) instead of by usage weight alone (AIBRAIN-138, AIBRAIN-139).
- `computeLiveNeighborWeights`/`getWeightedNeighbors`: a note the current
  session already touched no longer loses to a generically popular note
  with more historical usage weight — fixed a real inversion where real
  usage history was ranking worse than a zeroed baseline (AIBRAIN-130).
- Session priming now decays with time since a note was touched (20-minute
  half-life) instead of staying at full strength for as long as it's in
  the session buffer (AIBRAIN-141).
- `searchNotes` no longer scans every note in the vault on every query —
  a persisted content index narrows candidates first, verified against a
  300k-note corpus (336s → 2.1s on a selective query) (AIBRAIN-133).
- `SourceAdapter`'s `SourceNode` now carries frontmatter `aliases`.

### Packaging

- Added `LICENSE` (MIT), `publishConfig.access: "public"`, and repository
  metadata for npm publishing (AIBRAIN-40).
