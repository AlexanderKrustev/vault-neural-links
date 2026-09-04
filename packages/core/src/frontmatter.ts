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

/**
 * VNL-060: sets or removes individual frontmatter keys while leaving every
 * other key byte-identical.
 *
 * The reason this edits the raw block line by line instead of patching the
 * parsed object and re-serializing: re-serializing would rewrite the whole
 * block in this file's minimal dialect, which is exactly what VNL-003 was
 * fixed to stop. Comments, key order, block-sequence style and anything the
 * parser above does not understand all survive a merge, because the lines
 * carrying them are never touched.
 *
 * `patch` values are written with the same rules as `stringifyFrontmatter`;
 * a `null` or `undefined` value removes the key (and its indented block, if
 * it has one). An array replacing an existing block sequence stays a block
 * sequence, so setting `tags` on an Obsidian-styled note does not flip it to
 * inline form. Only top-level keys are addressable — a nested map is
 * replaced wholesale, not merged into.
 *
 * `raw` is undefined for a note with no frontmatter block at all, in which
 * case the patch becomes the whole block.
 */
export function mergeFrontmatterRaw(raw: string | undefined, patch: Record<string, unknown>): string {
  if (Object.keys(patch).length === 0) return raw ?? "";
  if (raw === undefined || raw.trim() === "") {
    return Object.entries(withoutRemovals(patch))
      .flatMap(([key, value]) => renderKey(key, value, "", undefined))
      .join("\n");
  }

  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(/\r?\n/);
  const spans = topLevelKeySpans(lines);

  // Collected as edits and applied back-to-front, so an earlier span's
  // replacement can't shift the indices of a later one.
  const edits: { start: number; end: number; lines: string[] }[] = [];
  const appended: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    const span = spans.get(key);
    const removing = value === null || value === undefined;
    if (span) {
      edits.push({
        start: span.start,
        end: span.end,
        lines: removing ? [] : renderKey(key, value, span.indent, span.sequenceIndent),
      });
    } else if (!removing) {
      appended.push(...renderKey(key, value, baseIndentOf(lines), undefined));
    }
  }

  const merged = [...lines];
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    merged.splice(edit.start, edit.end - edit.start, ...edit.lines);
  }
  return [...merged, ...appended].join(eol);
}

function withoutRemovals(patch: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== null && v !== undefined));
}

function baseIndentOf(lines: string[]): string {
  const first = lines.find((line) => !isBlank(line));
  return first === undefined ? "" : first.slice(0, indentOf(first));
}

/**
 * Where each top-level key's lines start and end, including any indented
 * block sequence or nested map that belongs to it — the unit a patch has to
 * replace or delete as a whole. `sequenceIndent` records the `- item`
 * indentation so a replacement list can be written back in the same style.
 */
function topLevelKeySpans(
  lines: string[],
): Map<string, { start: number; end: number; indent: string; sequenceIndent?: string }> {
  const spans = new Map<string, { start: number; end: number; indent: string; sequenceIndent?: string }>();
  const base = indentOf(lines.find((line) => !isBlank(line)) ?? "");
  let current: { key: string; start: number; lastContent: number; indent: string; sequenceIndent?: string } | undefined;

  const close = () => {
    if (current) {
      // Ends at the key's last content line, not at the next key: a comment
      // or blank line sitting between two keys belongs to neither, and
      // swallowing it into the earlier span would delete it on replacement.
      spans.set(current.key, {
        start: current.start,
        end: current.lastContent + 1,
        indent: current.indent,
        sequenceIndent: current.sequenceIndent,
      });
    }
    current = undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line)) continue;

    const trimmed = line.trimStart();
    const isSequenceItem = trimmed.startsWith("- ");
    if (current && (indentOf(line) > base || (isSequenceItem && indentOf(line) === base))) {
      // Still inside the current key's block. A `- item` flush with the key
      // is Obsidian's own list style, not a new key (see parseChildBlock).
      if (isSequenceItem && current.sequenceIndent === undefined) {
        current.sequenceIndent = line.slice(0, indentOf(line));
      }
      current.lastContent = i;
      continue;
    }
    if (indentOf(line) !== base) continue;

    const parsed = parseLine(line);
    if (!parsed) continue;
    close();
    current = { key: parsed.key, start: i, lastContent: i, indent: line.slice(0, base) };
  }
  close();

  return spans;
}

function renderKey(key: string, value: unknown, indent: string, sequenceIndent: string | undefined): string[] {
  const rendered =
    Array.isArray(value) && sequenceIndent !== undefined
      ? [`${indent}${key}:`, ...value.map((item) => `${sequenceIndent}- ${stringifyArrayItem(item)}`)]
      : isPlainObject(value)
        ? [`${indent}${key}:`, ...stringifyEntries(value, `${indent}  `)]
        : [`${indent}${key}: ${stringifyValue(value)}`];

  // A newline inside a value would silently turn one key into two (or into
  // garbage), and this writer has no block-scalar syntax to express it. The
  // caller is now an LLM, so this fails loudly rather than corrupting a note
  // the user cannot easily see was corrupted.
  if (rendered.some((line) => /[\r\n]/.test(line))) {
    throw new Error(`Frontmatter value for "${key}" contains a line break, which cannot be written as YAML here.`);
  }
  return rendered;
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
