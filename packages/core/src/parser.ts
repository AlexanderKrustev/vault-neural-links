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

/**
 * OKF/plain-markdown link extraction: `[label](path)` / `[label](path.md)`.
 * Skips images (`![label](path)`), in-page anchors (`[label](#heading)`),
 * and external links (any URI with a scheme, e.g. `http://`, `mailto:`).
 * A trailing " title" attribute (`[label](path "title")`) is dropped, not
 * parsed. Target is normalized the same way as wikilink targets and has
 * its `.md` extension stripped, so it lines up with the extension-less
 * note-path convention `SourceNode.id` already uses elsewhere.
 */
const MARKDOWN_LINK_RE = /(!)?\[([^\]]*)\]\(([^)]+)\)/g;
const EXTERNAL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export function extractOkfLinks(content: string): ParsedLink[] {
  const links: ParsedLink[] = [];

  for (const match of content.matchAll(MARKDOWN_LINK_RE)) {
    const isImage = match[1] === "!";
    if (isImage) continue;

    const label = match[2].trim();
    const rawTarget = match[3].trim().split(/\s+/)[0];
    if (!rawTarget || rawTarget.startsWith("#") || EXTERNAL_SCHEME_RE.test(rawTarget)) continue;

    const target = normalizeTarget(rawTarget).replace(/\.md$/i, "");
    if (!target) continue;

    const bareFilename = target.split("/").pop() ?? target;
    const alias = label && label.toLowerCase() !== bareFilename.toLowerCase() ? label : undefined;
    links.push(alias ? { target, alias } : { target });
  }

  return links;
}
