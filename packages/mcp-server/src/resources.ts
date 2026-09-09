import { buildBriefing, formatBriefing } from "@vault-neural-links/core";
import type { ToolContext } from "./tools.js";

/**
 * VNL-055 — the session briefing, as an MCP resource and a prompt.
 *
 * Everything else this server exposes is a tool, which means it only ever
 * runs if the model decides mid-task that consulting the vault is worth a
 * call. The measured record on voluntary calls is bad enough that the
 * project stopped relying on them entirely: `reinforce_link` was invoked
 * zero times in its whole life (AIBRAIN-69), and every learning signal since
 * has been made deterministic instead.
 *
 * A resource inverts that. The client attaches it — at session start, or
 * when the user picks it — and the content arrives without the model having
 * chosen anything. Resources and prompts are base-protocol, not Claude
 * extensions, so this works on Codex and Gemini too, which is the
 * portability commitment in D3.
 *
 * Two URIs rather than one:
 * - `vault://briefing` scopes itself from the server's working directory,
 *   which for a CLI agent is the repository being worked in. The common case
 *   needs no argument at all.
 * - `vault://briefing/{project}` names the project explicitly, for when the
 *   directory is not the project's name or the vault should be read from
 *   somewhere else entirely.
 */

const BRIEFING_DESCRIPTION =
  "What this vault knows about the project you are working in, before you ask it anything: the " +
  "notes recently worked with, the ones that changed most recently, the ones the vault's own link " +
  "structure ranks as central, matching maps-of-content, and any unprocessed inbox items. Scoped " +
  "by matching the working directory's name against the vault's folder names. Notes marked " +
  "superseded are flagged with their successor, so a briefing never quietly recommends a decision " +
  "that has been reversed.";

async function briefingText(ctx: ToolContext, project?: string): Promise<string> {
  const briefing = await buildBriefing(ctx.vaultPath, ctx.vaultDataDir, project ? { project } : {});
  return formatBriefing(briefing);
}

export const briefingResource = {
  name: "vault-briefing",
  uri: "vault://briefing",
  config: {
    title: "Vault briefing (this project)",
    description: BRIEFING_DESCRIPTION,
    mimeType: "text/markdown",
  },
  handler: (ctx: ToolContext) => async (uri: URL) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: await briefingText(ctx) }],
  }),
};

export const briefingByProjectResource = {
  name: "vault-briefing-by-project",
  // A template rather than a second fixed URI, so a client can offer the
  // project as a completable argument instead of the user hand-writing URIs.
  template: "vault://briefing/{project}",
  config: {
    title: "Vault briefing (named project)",
    description:
      BRIEFING_DESCRIPTION +
      " This form takes the project name explicitly, for when the working directory is not named " +
      "after it.",
    mimeType: "text/markdown",
  },
  handler: (ctx: ToolContext) => async (uri: URL, variables: Record<string, string | string[]>) => {
    const raw = variables.project;
    const project = Array.isArray(raw) ? raw[0] : raw;
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: await briefingText(ctx, decodeURIComponent(project ?? "")),
        },
      ],
    };
  },
};

/**
 * The same briefing as a prompt, because the two are surfaced differently by
 * clients: a resource is attached to context, a prompt is something a person
 * picks from a menu and sends. A user who wants to *start* a session by
 * catching up wants the second, and having only the resource would mean the
 * feature exists but nobody can reach it deliberately.
 */
export const briefingPrompt = {
  name: "vault-briefing",
  config: {
    title: "Catch me up on this project",
    description:
      "Loads the vault's briefing for the current project — recent work, recent changes, central " +
      "notes, maps of content — as a starting point for the session.",
    // No `argsSchema`, deliberately. Declaring even an empty one makes the
    // SDK treat this as a prompt that takes arguments and then reject any
    // request whose `arguments` is absent — which is exactly what a client
    // sends for a zero-argument prompt, so every real invocation failed with
    // -32602. Caught by the protocol-level integration test; invisible to a
    // unit test that calls the handler directly.
  },
  handler: (ctx: ToolContext) => async () => ({
    messages: [
      {
        role: "user" as const,
        content: {
          type: "text" as const,
          text:
            "Here is what the vault knows about the project I am working in. Read it, then tell me " +
            "in two or three sentences where things stand and what looks unfinished. Do not open " +
            "every note — use `recall` if you need to go deeper on something.\n\n" +
            (await briefingText(ctx)),
        },
      },
    ],
  }),
};
