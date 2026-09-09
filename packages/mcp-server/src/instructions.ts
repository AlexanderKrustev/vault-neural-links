import { buildBriefing, formatBriefing } from "@vault-neural-links/core";
import type { ToolContext } from "./tools.js";

/**
 * VNL-064 — the briefing, delivered by the protocol itself.
 *
 * VNL-055 shipped the briefing as an MCP resource and called it
 * "delivered, not requested". Starting a fresh session showed that claim was
 * half true: a resource is *offered* by the server and *attached* by the
 * client, and no client attaches every resource by default — in Claude Code
 * they are reached by `@` mention. So the model chooses nothing, but a person
 * still has to.
 *
 * A SessionStart hook would fix that, and is what AIBRAIN-45 planned, but a
 * hook is per-machine, lives outside the repository, and exists only in one
 * client — the opposite of the portability commitment in D3.
 *
 * `initialize`'s `instructions` field is the protocol's own answer. The
 * server returns it at connection time, the client puts it in front of the
 * model, and nobody has attached, mentioned or called anything. It is base
 * protocol, so it behaves the same on Codex and Gemini, and it is the one
 * place in MCP where a server may speak before it is spoken to.
 *
 * Three constraints this is built under, because it lands in *every* session:
 *
 * 1. **It must be cheap.** Measured on the real 494-note vault: 25-35 ms and
 *    about 520 tokens at `sectionSize` 5. That is the budget; a briefing that
 *    grows past a screen has stopped being a briefing.
 * 2. **It must fail open.** A vault that cannot be read, an index mid-write,
 *    a permission error — none may stop the server from starting. Failure
 *    means the static half is sent alone.
 * 3. **It must be bounded in time.** A pathological vault must not hang
 *    session start, so the briefing races a deadline and loses gracefully.
 */

/** Past this, the briefing is abandoned and the server starts without it. */
const BRIEFING_DEADLINE_MS = 3000;

/** Notes per section — smaller than the resource's default, since this is unconditional. */
const BRIEFING_SECTION_SIZE = 5;

/**
 * The hard cap a client applies to a server's `instructions`, observed
 * rather than guessed:
 *
 *   MCP server "vault-neural-link": Server instructions truncated
 *     from 2285 to 2048 chars
 *
 * from `claude --debug` at session start. The same 2048 appears against tool
 * descriptions elsewhere in that log, so it is a general limit on
 * server-supplied text rather than anything specific to this server.
 *
 * The first attempt budgeted only the briefing half, at 1,800, which still
 * overran once the static half was prepended — so the client cut it, and what
 * it cut was the end. Budgeting anything less than the whole string is
 * budgeting the wrong thing.
 */
const CLIENT_INSTRUCTIONS_LIMIT = 2048;

/**
 * Left free below the cap. A limit met exactly is a limit exceeded by the
 * next word added to the prose above, and the failure mode is silent
 * truncation of whatever happens to be last.
 */
const INSTRUCTIONS_SAFETY_MARGIN = 48;

/** Separates the static half from the briefing. */
const INSTRUCTIONS_SEPARATOR = "\n\n---\n\n";

/**
 * What the server says about itself, independent of any vault content. This
 * half is always sent, including when the briefing fails.
 */
const STATIC_INSTRUCTIONS =
  "This vault is a weighted-link memory, not a folder of files. Prefer `recall` for any question " +
  "about what is known or was decided — it takes the question itself, blends text relevance with " +
  "how this user's own notes are actually used together, and returns snippets plus a `why` for " +
  "each hit, so a result can be judged without opening it. Hits carry `warnings` when a note is " +
  "outdated or has not been read in months; a note marked superseded arrives with its replacement " +
  "alongside it. Reading a result afterwards is what teaches the engine, so open the ones you use.";

/**
 * Builds the `instructions` string for `initialize`: how to use this server,
 * followed by what the vault currently knows about the project the server was
 * started in.
 */
export async function buildServerInstructions(
  ctx: ToolContext,
  opts: { cwd?: string } = {},
): Promise<string> {
  // Which project this is comes from the server process's working directory,
  // which for a stdio MCP server is the directory the client launched it in —
  // the repository being worked on. Overridable so a test can state it rather
  // than inherit whatever directory the test runner happens to be in.
  const briefing = await withDeadline(
    buildBriefing(ctx.vaultPath, ctx.vaultDataDir, {
      sectionSize: BRIEFING_SECTION_SIZE,
      ...(opts.cwd !== undefined && { cwd: opts.cwd }),
    }),
    BRIEFING_DEADLINE_MS,
  ).catch(() => null);

  if (!briefing) return STATIC_INSTRUCTIONS;

  const parts = [STATIC_INSTRUCTIONS];

  // A briefing that matched no project is a list of whatever the vault
  // touched most recently, which is noise in front of every session — so the
  // project half waits until it has something to say about *this* project.
  // Whatever the static half and the separator do not use is what the
  // briefing gets — computed rather than fixed, so editing the prose above
  // can never silently push the whole string past the cap.
  const budget =
    CLIENT_INSTRUCTIONS_LIMIT -
    INSTRUCTIONS_SAFETY_MARGIN -
    STATIC_INSTRUCTIONS.length -
    INSTRUCTIONS_SEPARATOR.length;
  if (briefing.project) parts.push(formatBriefing(briefing, { maxChars: Math.max(budget, 0) }));

  // The inbox flag is deliberately outside that condition. It is the one
  // thing here that is true of the vault rather than of the project, and the
  // SessionStart hook this replaced always emitted it — dropping it whenever
  // no project resolved would be a quiet regression against the behaviour
  // being retired. `inboxCount` is computed over the whole vault rather than
  // the project scope, for the same reason.
  if (briefing.inboxCount > 0 && !briefing.project) {
    parts.push(
      `${briefing.inboxCount} unprocessed note${briefing.inboxCount === 1 ? "" : "s"} are waiting in ` +
        "`Inbox/`. Mention this and suggest `/process-inbox`, unless the user's own first message is " +
        "already about the inbox.",
    );
  }

  return parts.join(INSTRUCTIONS_SEPARATOR);
}

/**
 * Resolves with the promise's value, or rejects once `ms` has passed.
 *
 * The losing promise is not cancelled — nothing here can cancel a filesystem
 * walk — it is simply abandoned, and its result discarded when it arrives.
 */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("briefing timed out")), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
