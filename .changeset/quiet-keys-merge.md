---
"@vault-neural-links/core": minor
---

`mergeFrontmatterRaw` — key-at-a-time frontmatter edits (VNL-060).

`update_note` could not touch frontmatter at all, so no agent could set
`status: superseded` / `superseded_by` — the one "this note is outdated"
signal `recall` surfaces could only be written by hand in Obsidian.

The merge edits the raw block line by line rather than re-serializing it, so
VNL-003's guarantee holds for every key the patch does not name: comments,
key order, block-sequence style and anything the minimal parser does not
understand stay byte-identical. A `null` value removes a key (with its
indented block); an array replacing a block sequence stays a block sequence;
a value containing a line break is refused rather than written as a broken
block. The mcp-server's `update_note` takes an optional `frontmatter` patch
and reports `frontmatterChanged`.
