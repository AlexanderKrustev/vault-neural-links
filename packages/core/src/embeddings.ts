import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { SourceNode } from "./adapters.js";
import type { EmbeddingsFile } from "./types.js";

/**
 * VNL-051 — local, optional semantic vectors.
 *
 * BM25 (VNL-050) scores a note by which query *tokens* literally occur in
 * it, so "kill process by port" cannot reach a note that says "terminate a
 * service listening on a socket": zero shared tokens, zero score. The
 * weighted graph can only re-rank what some other signal already pointed
 * at, and VNL-053's term learning only fires on associations this user has
 * already made. Nothing in the engine so far can match on *meaning* the
 * first time.
 *
 * An embedding model maps text to a fixed-length vector positioned so that
 * texts meaning similar things land close together; comparing two texts is
 * then one dot product. That closes the gap without an API key: the model
 * (all-MiniLM-L6-v2, ~23 MB quantized, ONNX/CPU) runs in-process and the
 * vectors live in `.vault-neural-links/`, so the local-files and
 * no-owned-key constraints in docs/PLAN.md D10 both hold.
 *
 * Three shapes this module deliberately takes:
 *
 * 1. **The model is an optional peer dependency, loaded dynamically.**
 *    `@huggingface/transformers` pulls `onnxruntime-node`, a ~100 MB native
 *    binary; making it a hard dependency would put that in front of every
 *    `npx @vault-neural-links/mcp-server` install for a feature that is off
 *    by default. When it is not installed, `loadTransformersProvider`
 *    returns null and every caller degrades to the pre-VNL-051 behaviour.
 *
 * 2. **Everything except the model runs behind `EmbeddingProvider`**, so
 *    the index format, the incremental rebuild and the scoring are all
 *    testable with a fake provider — no download in CI, and the blend math
 *    is verifiable independently of whatever the model actually says.
 *
 * 3. **Vectors are stored L2-normalized**, so cosine similarity is a plain
 *    dot product at query time and no per-query normalization is needed.
 */

export const EMBEDDINGS_FILE_NAME = "embeddings.json";
export const EMBEDDINGS_FILE_VERSION = 1;

/**
 * Quality-per-megabyte baseline for local semantic search: 6 layers, ~22M
 * parameters, 384 dimensions, ~23 MB quantized. Not the strongest model
 * available — the strongest ones are gigabytes — but the one that can be
 * downloaded silently on a laptop, and the de-facto default across local
 * vector tooling.
 */
export const DEFAULT_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

/**
 * Above this many notes the nightly job will not build embeddings unless
 * explicitly forced. Embedding is O(notes) CPU once, but the index is
 * loaded whole and scanned per query, which is the same monolithic-JSON
 * problem D5 already flagged for the content index — it gets fixed for both
 * by VNL-031's SQLite store, not here.
 */
export const DEFAULT_EMBEDDING_NOTE_LIMIT = 50_000;

/**
 * Characters of a note fed to the model. MiniLM's window is 256 tokens
 * (~1000-1500 characters of prose); text past it is truncated by the
 * tokenizer anyway, so sending more only costs time. A long note is
 * therefore represented by its opening — which for a vault note is title,
 * frontmatter context and lead paragraph, i.e. the part that says what it
 * is about. Per-section chunking would represent long notes better and is
 * left as follow-up work rather than smuggled into this item.
 */
export const EMBEDDING_TEXT_LIMIT = 1200;

/** Notes embedded per provider call. Bounded so a big vault can't build one huge batch. */
export const DEFAULT_EMBEDDING_BATCH_SIZE = 32;

/**
 * Absolute noise guard: below this cosine, nothing counts as a match no
 * matter how the rest of the query scored. Deliberately low, because it is
 * not the instrument doing the real work — `DEFAULT_SEMANTIC_RELATIVE_CUT`
 * is. Its only job is to stop a query that genuinely matches nothing from
 * promoting the least-irrelevant note in the vault.
 *
 * Measured against the real 494-note vault (2026-09-09), which is why this
 * is 0.2 and not the 0.35 it shipped as for one afternoon: the whole cosine
 * distribution for real queries lands in **0.19-0.46**, not the 0-1 range a
 * fixed threshold implies. A short question against a note's 1200-character
 * opening is an *asymmetric* comparison, and MiniLM compresses those hard —
 * the same model scores two short paraphrases 0.64. At 0.35, two of four
 * real queries admitted nothing at all and the axis was silently inert.
 */
export const DEFAULT_SEMANTIC_FLOOR = 0.2;

/**
 * A note must score at least this fraction of the *best* cosine in the same
 * query to survive. This, not the absolute floor, is what separates signal
 * from noise here.
 *
 * The measurement that forced it: on "paying for the product" the correct
 * note scored 0.446 and the runner-up 0.244 — an enormous separation
 * sitting entirely inside a band that any single absolute threshold either
 * admits whole or rejects whole. Where the distribution *sits* is a
 * function of query and document length; what identifies the right note is
 * how far it stands above the rest of its own distribution. So the cut is
 * relative and travels with the query.
 *
 * 0.6 from four real queries, which is not a tuned number — VNL-020 sweeps
 * this and the floor together.
 */
export const DEFAULT_SEMANTIC_RELATIVE_CUT = 0.6;

/** How many semantic hits are allowed to enter the blend for one query. */
export const DEFAULT_SEMANTIC_CANDIDATES = 20;

/**
 * The seam every model sits behind. `embed` takes a batch because model
 * inference amortizes badly one string at a time, and returns vectors in
 * the same order.
 */
export interface EmbeddingProvider {
  /** Model identifier, persisted so an index built by a different model is not silently reused. */
  readonly model: string;
  /** Vector length; every vector this provider returns must have exactly this many elements. */
  readonly dim: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

/**
 * Loads `@huggingface/transformers` if the host has it installed, and wraps
 * it as an `EmbeddingProvider`. Returns null when the package is absent —
 * the expected case, since it is an optional peer dependency.
 *
 * The specifier is held in a variable on purpose: a literal would make
 * TypeScript resolve the module at compile time (it is not installed here)
 * and make bundlers try to inline a native addon. Both are wrong for an
 * optional runtime dependency.
 */
export async function loadTransformersProvider(
  model: string = DEFAULT_EMBEDDING_MODEL,
  specifier = process.env.VNL_EMBEDDINGS_MODULE ?? "@huggingface/transformers",
): Promise<EmbeddingProvider | null> {
  let pipeline: unknown;
  try {
    const mod = await import(specifier);
    pipeline = (mod as { pipeline?: unknown }).pipeline;
  } catch {
    // Not installed, or installed but unloadable on this platform (the ONNX
    // runtime ships per-platform binaries). Either way there is nothing to
    // report: embeddings are optional and the caller falls back.
    return null;
  }
  if (typeof pipeline !== "function") return null;

  // `dtype: "q8"` selects the int8-quantized weights — the ~23 MB download
  // rather than the ~90 MB float32 one, at a cosine difference well inside
  // the noise for retrieval ranking.
  const extractor = (await (pipeline as (...args: unknown[]) => Promise<unknown>)(
    "feature-extraction",
    model,
    { dtype: "q8" },
  )) as (texts: string[], opts: Record<string, unknown>) => Promise<{ data: ArrayLike<number>; dims: number[] }>;

  let dim = 0;
  return {
    model,
    get dim() {
      return dim;
    },
    async embed(texts: string[]): Promise<Float32Array[]> {
      if (texts.length === 0) return [];
      // `pooling: "mean"` collapses per-token vectors into one per text;
      // `normalize: true` returns them L2-normalized, which is the form
      // this module stores.
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      const width = output.dims[output.dims.length - 1];
      dim = width;
      const vectors: Float32Array[] = [];
      for (let i = 0; i < texts.length; i++) {
        const vector = new Float32Array(width);
        for (let j = 0; j < width; j++) vector[j] = output.data[i * width + j];
        vectors.push(vector);
      }
      return vectors;
    },
  };
}

let sharedProvider: Promise<EmbeddingProvider | null> | null = null;

/**
 * The process-wide provider, loaded at most once.
 *
 * Constructing a provider downloads (first time) and then decodes the model
 * into memory — tens of megabytes and hundreds of milliseconds. A per-query
 * load would make the semantic axis cost more than the whole rest of
 * `recall`, so the promise is cached, including a cached `null` when the
 * optional package is absent: the answer will not change within a process,
 * and retrying the failed import on every query is pure latency.
 */
export function getSharedEmbeddingProvider(model?: string): Promise<EmbeddingProvider | null> {
  sharedProvider ??= loadTransformersProvider(model);
  return sharedProvider;
}

/** Test seam: drops the cached provider (and lets a fake be installed). */
export function setSharedEmbeddingProvider(provider: EmbeddingProvider | null | undefined): void {
  sharedProvider = provider === undefined ? null : Promise.resolve(provider);
}

/**
 * What actually gets embedded for a note: its title, then its aliases, then
 * its body, truncated together. The title leads because it is the densest
 * statement of what a vault note is about, and because a body-only vector
 * makes two notes with the same boilerplate opening look identical.
 */
export function embeddingText(node: SourceNode): string {
  const title = node.id.split("/").pop()?.replace(/\.md$/i, "") ?? node.id;
  const parts = [title, node.aliases.join(" "), node.body].filter((part) => part.trim().length > 0);
  return parts.join("\n").slice(0, EMBEDDING_TEXT_LIMIT);
}

/**
 * Identity of the text a stored vector was built from, so a rebuild can
 * skip notes that have not changed. Content-derived rather than mtime-based:
 * a vault synced between machines rewrites mtimes without changing text,
 * and re-embedding the whole vault on every sync is the expensive mistake.
 */
export function embeddingHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Float32Array -> base64. ~1.4 KB per 384-dim vector, vs ~4 KB as JSON numbers. */
export function encodeVector(vector: Float32Array): string {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("base64");
}

/** Inverse of `encodeVector`. Returns null if the payload isn't a whole number of floats. */
export function decodeVector(encoded: string): Float32Array | null {
  const buffer = Buffer.from(encoded, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength % 4 !== 0) return null;
  // Copy rather than view: Buffer.from(base64) can hand back a slice of a
  // pooled ArrayBuffer whose byteOffset isn't 4-byte aligned, which
  // Float32Array's constructor rejects.
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return new Float32Array(copy.buffer);
}

/**
 * Dot product, which for two L2-normalized vectors is their cosine
 * similarity. Mismatched lengths score 0 rather than throwing: an index
 * built by a different model is a stale-file problem, not a crash.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

export interface BuildEmbeddingsOptions {
  /** A previous index; unchanged notes keep their stored vector instead of being re-embedded. */
  existing?: EmbeddingsFile | null;
  batchSize?: number;
  /** Called after each batch, for progress reporting on a first full build. */
  onProgress?: (embedded: number, total: number) => void;
  now?: Date;
}

/**
 * Builds (or incrementally refreshes) the embedding index over `nodes`.
 *
 * Notes are dropped from the index when they disappear from `nodes`, so the
 * file cannot accumulate vectors for deleted notes. A stored vector is
 * reused only when the note's text hash *and* the model both match — a
 * model change invalidates every vector, since two models' vector spaces
 * are unrelated and mixing them silently produces nonsense similarities.
 */
export async function buildEmbeddingIndex(
  nodes: SourceNode[],
  provider: EmbeddingProvider,
  opts: BuildEmbeddingsOptions = {},
): Promise<EmbeddingsFile> {
  const { existing, batchSize = DEFAULT_EMBEDDING_BATCH_SIZE, onProgress, now = new Date() } = opts;
  const reusable = existing && existing.model === provider.model ? existing.notes : {};

  const notes: EmbeddingsFile["notes"] = {};
  const pending: { path: string; hash: string; text: string }[] = [];

  for (const node of nodes) {
    const text = embeddingText(node);
    const hash = embeddingHash(text);
    const previous = reusable[node.id];
    if (previous && previous.hash === hash) {
      notes[node.id] = previous;
      continue;
    }
    pending.push({ path: node.id, hash, text });
  }

  let dim = existing && existing.model === provider.model ? existing.dim : 0;
  let embedded = 0;
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    const vectors = await provider.embed(batch.map((entry) => entry.text));
    for (let j = 0; j < batch.length; j++) {
      const vector = vectors[j];
      if (!vector) continue;
      if (dim === 0) dim = vector.length;
      notes[batch[j].path] = { hash: batch[j].hash, vector: encodeVector(vector) };
    }
    embedded += batch.length;
    onProgress?.(embedded, pending.length);
  }

  return {
    version: EMBEDDINGS_FILE_VERSION,
    model: provider.model,
    dim,
    builtAt: now.toISOString(),
    notes,
  };
}

export async function loadEmbeddings(vaultDataDir: string): Promise<EmbeddingsFile | null> {
  try {
    const content = await readFile(join(vaultDataDir, EMBEDDINGS_FILE_NAME), "utf8");
    const parsed = JSON.parse(content) as EmbeddingsFile;
    if (parsed.version !== EMBEDDINGS_FILE_VERSION) return null;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    // A truncated or hand-mangled index must not take retrieval down with
    // it: embeddings are an optional axis, so a corrupt file means "no
    // semantic signal", exactly like an absent one.
    if (err instanceof SyntaxError) return null;
    throw err;
  }
}

async function persistEmbeddings(vaultDataDir: string, index: EmbeddingsFile): Promise<void> {
  await mkdir(vaultDataDir, { recursive: true });
  const targetPath = join(vaultDataDir, EMBEDDINGS_FILE_NAME);
  const tmpPath = join(vaultDataDir, `.${EMBEDDINGS_FILE_NAME}.${randomUUID()}.tmp`);
  // Compact and atomically renamed, same as the content index: large,
  // machine-written, and a half-written file must never be readable.
  await writeFile(tmpPath, JSON.stringify(index), "utf8");
  await rename(tmpPath, targetPath);
}

/** Builds the embedding index and persists it atomically. */
export async function rebuildEmbeddings(
  vaultDataDir: string,
  nodes: SourceNode[],
  provider: EmbeddingProvider,
  opts: BuildEmbeddingsOptions = {},
): Promise<{ noteCount: number; embeddedCount: number; model: string; builtAt: string }> {
  const existing = opts.existing !== undefined ? opts.existing : await loadEmbeddings(vaultDataDir);
  let embeddedCount = 0;
  const index = await buildEmbeddingIndex(nodes, provider, {
    ...opts,
    existing,
    onProgress: (embedded, total) => {
      embeddedCount = embedded;
      opts.onProgress?.(embedded, total);
    },
  });
  await persistEmbeddings(vaultDataDir, index);
  return {
    noteCount: Object.keys(index.notes).length,
    embeddedCount,
    model: index.model,
    builtAt: index.builtAt,
  };
}

export interface SemanticScoreOptions {
  /** Absolute cosine below which nothing counts, whatever the rest of the query did. */
  floor?: number;
  /** Fraction of this query's best cosine a note must reach. 0 disables the relative cut. */
  relativeCut?: number;
  topN?: number;
}

/**
 * Cosine of `queryVector` against every stored note vector, filtered by both
 * an absolute floor and a cut relative to this query's own best score, and
 * capped at `topN`. A linear scan: at real-vault scale (494 notes x 384
 * dims) this is ~190k multiply-adds, well under a millisecond, and the note
 * limit above keeps it from being run where it would not be.
 *
 * Two filters rather than one because they answer different questions. The
 * floor answers "did this query match anything at all"; the relative cut
 * answers "which of these is actually the answer", and only it survives the
 * fact that the distribution's location moves with query and document
 * length. See the constants for the measurements behind both.
 */
export function semanticScores(
  index: EmbeddingsFile,
  queryVector: Float32Array,
  opts: SemanticScoreOptions = {},
): Map<string, number> {
  const {
    floor = DEFAULT_SEMANTIC_FLOOR,
    relativeCut = DEFAULT_SEMANTIC_RELATIVE_CUT,
    topN = DEFAULT_SEMANTIC_CANDIDATES,
  } = opts;
  const scored: { path: string; score: number }[] = [];
  for (const [path, entry] of Object.entries(index.notes)) {
    const vector = decodeVector(entry.vector);
    // A vector of the wrong length is a stale or damaged entry, not a
    // zero-similarity match: `cosine` would score it 0, which a floor of 0
    // still admits, letting it take a slot from a real result. Base64
    // decoding does not reliably reject a mangled payload either — it drops
    // invalid characters and can hand back a plausible-length buffer — so
    // the dimension check is what actually catches this.
    if (!vector || vector.length !== queryVector.length) continue;
    const score = cosine(queryVector, vector);
    if (score >= floor) scored.push({ path, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0]?.score ?? 0;
  const threshold = best * relativeCut;
  return new Map(
    scored
      .filter((entry) => entry.score >= threshold)
      .slice(0, topN)
      .map((entry) => [entry.path, entry.score]),
  );
}
