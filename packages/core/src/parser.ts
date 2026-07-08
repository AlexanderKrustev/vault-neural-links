/**
 * Wikilink extraction from raw note content.
 * Handles [[target]], [[target|alias]], [[target#heading]], [[target^block]],
 * and skips embeds (![[...]]).
 */
export interface ParsedLink {
  target: string;
  alias?: string;
}

const WIKILINK_RE = /(!)?\[\[([^\]]+)\]\]/g;

export function extractWikilinks(content: string): ParsedLink[] {
  const links: ParsedLink[] = [];

  for (const match of content.matchAll(WIKILINK_RE)) {
    const isEmbed = match[1] === "!";
    if (isEmbed) continue;

    const [rawTarget, rawAlias] = match[2].split("|");
    const target = normalizeTarget(stripHeadingAndBlockRef(rawTarget));
    if (!target) continue; // e.g. [[#heading]] self-link with no target note

    const alias = rawAlias?.trim();
    links.push(alias ? { target, alias } : { target });
  }

  return links;
}

function stripHeadingAndBlockRef(target: string): string {
  const headingIdx = target.indexOf("#");
  const blockIdx = target.indexOf("^");
  const cutIdx = [headingIdx, blockIdx].filter((i) => i !== -1).sort((a, b) => a - b)[0];
  return cutIdx === undefined ? target : target.slice(0, cutIdx);
}

function normalizeTarget(target: string): string {
  return target.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}
