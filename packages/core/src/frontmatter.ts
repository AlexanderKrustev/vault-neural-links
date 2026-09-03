/**
 * Minimal frontmatter parse/stringify for the shapes an Obsidian vault
 * actually uses: flat scalars, inline arrays, block sequences (`aliases:`
 * followed by indented `- item` lines) and one level of nested map. Not a
 * general YAML implementation — schema shape is a prompt-level concern
 * (see the vault-memory skill), this just needs to round-trip what's here.
 *
 * VNL-003: because it is not a full YAML parser, anything it *does* fail to
 * understand must still survive a write. `parseFrontmatter` therefore keeps
 * the frontmatter block's exact source text in `raw`, and `serializeNote`
 * re-emits that text verbatim unless a caller explicitly supplies new
 * frontmatter. A body-only `update_note` can no longer silently rewrite a
 * user's frontmatter into the parser's own dialect.
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
  /**
   * The frontmatter block's source text, without the `---` fences and
   * without a trailing newline. Present only when the note had a
   * frontmatter block. Callers that mean to *change* frontmatter drop this;
   * callers that only touch the body pass it through so the block is
   * re-emitted byte for byte.
   */
  raw?: string;
}

export function parseFrontmatter(content: string): ParsedNote {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: content };

  const lines = match[1].split(/\r?\n/);
  const { value } = parseMap(lines, 0, indentOf(lines[0] ?? ""));

  return { frontmatter: value, body: content.slice(match[0].length), raw: match[1] };
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function isBlank(line: string): boolean {
  return line.trim() === "" || line.trimStart().startsWith("#");
}

/**
 * Parses consecutive `key: value` lines at exactly `indent`, descending into
 * a nested block sequence or block map wherever the value is empty.
 * Returns the index of the first line that no longer belongs to this map.
 */
function parseMap(
  lines: string[],
  start: number,
  indent: number,
): { value: Record<string, unknown>; next: number } {
  const value: Record<string, unknown> = {};
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    if (indentOf(line) !== indent) break;

    const parsed = parseLine(line);
    if (!parsed) break;
    i += 1;

    if (parsed.rawValue === "") {
      const child = parseChildBlock(lines, i, indent);
      if (child) {
        value[parsed.key] = child.value;
        i = child.next;
        continue;
      }
    }
    value[parsed.key] = parseScalarOrArray(parsed.rawValue);
  }

  return { value, next: i };
}

/** A block sequence or nested map indented deeper than its parent key. */
function parseChildBlock(
  lines: string[],
  start: number,
  parentIndent: number,
): { value: unknown; next: number } | undefined {
  let i = start;
  while (i < lines.length && isBlank(lines[i])) i += 1;
  if (i >= lines.length) return undefined;

  const childIndent = indentOf(lines[i]);
  // Obsidian writes block sequences flush with the parent key, so `- item`
  // at the parent's own indentation is still this key's list.
  const isSequence = lines[i].trimStart().startsWith("- ");
  if (!isSequence && childIndent <= parentIndent) return undefined;
  if (isSequence && childIndent < parentIndent) return undefined;

  if (isSequence) return parseSequence(lines, i, childIndent);
  return parseMap(lines, i, childIndent);
}

function parseSequence(
  lines: string[],
  start: number,
  indent: number,
): { value: unknown[]; next: number } {
  const value: unknown[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i += 1;
      continue;
    }
    const trimmed = line.trimStart();
    if (indentOf(line) !== indent || !trimmed.startsWith("- ")) break;
    value.push(parseScalar(trimmed.slice(2).trim()));
    i += 1;
  }

  return { value, next: i };
}

function parseLine(line: string): { key: string; rawValue: string } | undefined {
  const trimmed = line.trimStart();
  if (trimmed.startsWith("- ")) return undefined;

  const colonIdx = trimmed.indexOf(":");
  if (colonIdx === -1) return undefined;

  const key = trimmed.slice(0, colonIdx).trim();
  if (!key) return undefined;

  return { key, rawValue: trimmed.slice(colonIdx + 1).trim() };
}

function parseScalarOrArray(raw: string): unknown {
  if (raw === "") return "";
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return splitArrayItems(inner).map((item) => parseScalar(item.trim()));
  }
  return parseScalar(raw);
}

// Splits on commas that aren't inside a quoted string, so an item like
// "Smith, John" survives round-tripping instead of becoming two items.
function splitArrayItems(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;

  for (const ch of inner) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === ",") {
      items.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  items.push(current);
  return items;
}

function parseScalar(raw: string): unknown {
  const unquoted = unquote(raw);
  if (unquoted !== raw) return unquoted; // was quoted — always a string, no coercion

  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function stringifyFrontmatter(frontmatter: Record<string, unknown>): string {
  return `---\n${stringifyEntries(frontmatter, "").join("\n")}\n---\n`;
}

function stringifyEntries(frontmatter: Record<string, unknown>, indent: string): string[] {
  return Object.entries(frontmatter).flatMap(([key, value]) => {
    if (isPlainObject(value)) {
      return [`${indent}${key}:`, ...stringifyEntries(value, `${indent}  `)];
    }
    return [`${indent}${key}: ${stringifyValue(value)}`];
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringifyValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stringifyArrayItem).join(", ")}]`;
  // A string starting with "[" (e.g. a wikilink "[[Target]]") would otherwise
  // round-trip as a one-element array on the next parse, since the parser
  // has no other way to tell a literal array from a bracketed string.
  if (typeof value === "string" && value.startsWith("[")) return `"${value}"`;
  return String(value);
}

function stringifyArrayItem(value: unknown): string {
  if (typeof value === "string" && value.includes(",")) return `"${value}"`;
  return String(value);
}

export function serializeNote(note: ParsedNote): string {
  // VNL-003: `raw` wins over the parsed object. It is only ever set by
  // `parseFrontmatter`, so its presence means "this block came off disk and
  // nobody asked to change it" — re-emit it exactly, including block lists,
  // nested maps, comments and key order the parser cannot reproduce.
  const fm = note.raw !== undefined ? `---\n${note.raw}\n---\n` : stringifyFrontmatter(note.frontmatter);
  const body = note.body.startsWith("\n") ? note.body : `\n${note.body}`;
  return `${fm}${body}`;
}
