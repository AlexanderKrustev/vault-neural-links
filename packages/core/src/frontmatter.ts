/**
 * Minimal frontmatter parse/stringify for the flat scalar/array shapes this
 * vault actually uses (strings, numbers, booleans, string arrays). Not a
 * general YAML implementation — schema shape is a prompt-level concern
 * (see the vault-memory skill), this just needs to round-trip what's here.
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(content: string): ParsedNote {
  const match = content.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: content };

  const frontmatter: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const parsed = parseLine(line);
    if (parsed) frontmatter[parsed.key] = parsed.value;
  }

  return { frontmatter, body: content.slice(match[0].length) };
}

function parseLine(line: string): { key: string; value: unknown } | undefined {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return undefined;

  const key = line.slice(0, colonIdx).trim();
  const rawValue = line.slice(colonIdx + 1).trim();
  if (!key) return undefined;

  return { key, value: parseScalarOrArray(rawValue) };
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
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${stringifyValue(value)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function stringifyValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stringifyArrayItem).join(", ")}]`;
  return String(value);
}

function stringifyArrayItem(value: unknown): string {
  if (typeof value === "string" && value.includes(",")) return `"${value}"`;
  return String(value);
}

export function serializeNote(note: ParsedNote): string {
  const fm = stringifyFrontmatter(note.frontmatter);
  const body = note.body.startsWith("\n") ? note.body : `\n${note.body}`;
  return `${fm}${body}`;
}
