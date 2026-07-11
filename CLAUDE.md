# Project workflow rules — read every session

## Source of truth for progress, tasks, and priority: Jira

This project's tasks, status, and priority live in Jira project **AIBRAIN**
(`brainspace-dev.atlassian.net`), not in local notes, TODOs, or planning
docs. Docs like `docs/*.docx` are proposals/analysis, not the backlog.

- Before starting work, check Jira for the relevant epic/story/subtask
  (`getVisibleJiraProjects`, `searchJiraIssuesUsingJql`,
  `getJiraIssue`) rather than assuming from a doc or memory what's next.
- When work starts, progresses, or finishes, reflect that in Jira
  (status transitions, comments, description updates) — don't just report
  it in chat and leave the issue stale.
- Priority ordering lives on the Jira `priority` field. If a doc's
  phase/sequence conflicts with Jira's priority field, Jira wins unless
  the user explicitly says otherwise.
- New work discovered during implementation (gaps, missing tasks,
  follow-ups) gets created as a Jira issue, not just mentioned in chat.

## Source of truth for knowledge: the vault

Durable knowledge produced by this project (decisions, architecture
rationale, research findings, feasibility analysis) belongs in the
Obsidian vault at `$env:CLAUDE_VAULT_PATH`, per the global CLAUDE.md
`vault-memory` rules — not left only inside a Jira comment or a chat
transcript.

- Use the `vault-memory` skill to write it, following its schema and
  search-before-create step.
- Jira issues can *link* to the relevant vault note (e.g. in a comment)
  rather than duplicating the knowledge inline.

## Research and planning must start from the vault

Before proposing an approach, analysing feasibility, or writing a plan for
this project, check the vault first (`MOCs/*.md`, then relevant domain
notes) for prior decisions, constraints, or analysis already captured —
same as the global CLAUDE.md's "before starting non-trivial work" rule,
called out explicitly here because this project accumulates a lot of
science/architecture rationale that shouldn't be re-derived from scratch
each session.
