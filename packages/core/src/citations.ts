import { extractWikilinks } from "./parser.js";

/**
 * VNL-054 — the deterministic, MCP-visible half of AIBRAIN-134's *Referenced*
 * evidence state.
 *
 * An MCP server structurally cannot see the client model's final answer, so
 * it can never know for certain which retrieved notes actually contributed to
 * it (see the vault note "Usefulness Signal Roadmap"). But there is one case
 * where it does see the agent use a note: the agent read note X this session
 * and then wrote `[[X]]` into a note of its own. That is not an inference and
 * needs no voluntary tool call from the model — the citation is right there in
 * the body it just passed to create_note/update_note.
 *
 * This is the decision half, kept pure so it is testable without a vault:
 * given what the agent wrote and what it read, it says which edges that write
 * earned. The dedupe of repeated citations across a session belongs to the
 * caller (mcp-server's ToolContext), which is where session state already
 * lives.
 *
 * What it deliberately does not do: resolve a wikilink against the whole
 * vault. The candidate set is only the notes actually read this session,
 * because the signal being recorded is "the agent used what it read", not
 * "this note links to that one" — the latter is already the structural graph's
 * job (structuralLinks.ts) and gets no usage weight from a write.
 */
export function citedNotes(writtenPath: string, agentText: string, readThisSession: Iterable<string>): string[] {
  const byPathLower = new Map<string, string>();
  const byTitleLower = new Map<string, string[]>();
  for (const path of readThisSession) {
    byPathLower.set(path.toLowerCase(), path);
    const title = (path.split("/").pop() ?? path).toLowerCase();
    byTitleLower.set(title, [...(byTitleLower.get(title) ?? []), path]);
  }
  if (byPathLower.size === 0) return [];

  const cited: string[] = [];
  const seen = new Set<string>();
  for (const link of extractWikilinks(agentText)) {
    const norm = link.target.toLowerCase();
    const exact = byPathLower.get(norm);
    // Bare `[[Title]]` is how this vault writes most of its links, so a title
    // match has to be supported — but only when it is unambiguous, the same
    // discipline buildStructuralIndex applies. Two notes read this session
    // that share a filename (this vault has ~20 notes titled "Index") make the
    // citation unattributable, and a wrong attribution is worse than none.
    const titleMatches = byTitleLower.get(norm.split("/").pop() ?? norm);
    const resolved = exact ?? (titleMatches?.length === 1 ? titleMatches[0] : undefined);

    // A note citing itself is not evidence of a relationship between two
    // notes, and self-edges are meaningless to spreading activation.
    if (!resolved || resolved === writtenPath || seen.has(resolved)) continue;
    seen.add(resolved);
    cited.push(resolved);
  }
  return cited;
}
