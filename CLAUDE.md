# Project workflow rules — read every session

## Source of truth for progress, tasks, and priority: `docs/PLAN.md`

As of 2026-09-02 this project's tasks, status, priority and sequencing live
in **`docs/PLAN.md`** in this repo. Jira project AIBRAIN is retired; its
full export is frozen in `docs/BACKLOG-ARCHIVE.md` and every old key has a
disposition row in `docs/PLAN.md` §8. Do not read from or write to Jira for
this project unless the user explicitly asks.

- Before starting work, read `docs/PLAN.md` §1 (verified state), §2
  (decisions), and the phase you are working in (§3). Phases have explicit
  gates; do not start a phase whose gate is not met.
- When work starts, progresses, or finishes, update the item's status
  inline in `docs/PLAN.md` (`todo` · `doing` · `review` · `done` ·
  `dropped` · `deferred`) in the same change set as the code. Don't just
  report it in chat.
- New work discovered during implementation gets a new `VNL-nnn` row in
  the appropriate phase (next free ID is stated in §0), with effort and
  status — not just a mention in chat.
- Anything that changes a decision or a phase gets a dated line in §9
  (Changelog).
- Migrated items keep their `AIBRAIN-nn` key as a stable ID; do not renumber.
- Docs like `docs/*.docx`, `docs/spec.md` and Part 1 of
  `docs/PLAN-AND-ARCHITECTURE.md` are historical proposals/analysis, not the
  backlog. Part 2 of `PLAN-AND-ARCHITECTURE.md` remains the architecture
  reference.

## Source of truth for knowledge: the vault

Durable knowledge produced by this project (decisions, architecture
rationale, research findings, feasibility analysis, measurements) belongs
in the Obsidian vault at `$env:CLAUDE_VAULT_PATH`, per the global CLAUDE.md
`vault-memory` rules — not left only inside `docs/PLAN.md` or a chat
transcript.

- Use the `vault-memory` skill to write it, following its schema and
  search-before-create step.
- `docs/PLAN.md` *links* to the relevant vault note rather than duplicating
  the knowledge inline.

## Research and planning must start from the vault

Before proposing an approach, analysing feasibility, or writing a plan for
this project, check the vault first (`MOCs/VaultNeuralLinks`, then relevant
domain notes) for prior decisions, constraints, or analysis already
captured — same as the global CLAUDE.md's "before starting non-trivial
work" rule, called out explicitly here because this project accumulates a
lot of science/architecture rationale that shouldn't be re-derived from
scratch each session. The 2026-09-02 digest of every recorded decision is
in `docs/analysis/2026-09-02-vault-decision-digest.md`.

## Claims discipline

Every public claim about retrieval quality or scale must point at a
measured number from a script in `packages/core/scripts/` (or the CI
benchmark once `VNL-020` lands). See `docs/PLAN.md` D5/D6.
