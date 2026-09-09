import { stat } from "node:fs/promises";
import { activate } from "./activation.js";
import { candidatesFromIndex, loadContentIndex } from "./contentIndex.js";
import {
  DEFAULT_SEMANTIC_CANDIDATES,
  DEFAULT_SEMANTIC_FLOOR,
  DEFAULT_SEMANTIC_RELATIVE_CUT,
  getSharedEmbeddingProvider,
  loadEmbeddings,
  semanticScores,
  type EmbeddingProvider,
} from "./embeddings.js";
import { listNotes, readNotesInBatches, searchNotes, toFilePath, type NoteRef } from "./notes.js";
import type { SessionBuffer } from "./priming.js";
import { readSupersession } from "./relations.js";
import { liveTermScores } from "./termWeights.js";
import { tokenize } from "./tokenize.js";
import type {
  ActivationEventSink,
  ContentIndexFile,
  EmbeddingsFile,
  SpreadingActivationConfig,
} from "./types.js";
import { DEFAULT_SPREADING_ACTIVATION_CONFIG } from "./types.js";

/**
 * VNL-050. The engine's entry point used to be a *note* (`activate(note)`),
 * but an agent's real question is a *query* ("what should I read for this
 * task?") — so the weighted graph never got to improve a real search, it
 * could only re-rank things it was already pointed at (D10 in docs/PLAN.md).
 *
 * `recall` closes that: lexical relevance (BM25) answers *what matches*, and
 * the weighted graph answers *what this user actually uses together*, by
 * spreading activation out of the top lexical hits and blending the two
 * scores. Notes that no query term touches can therefore still surface, if
 * the graph says they belong with the ones that did.
 */

/** How many candidate notes get read from disk and BM25-scored, at most. */
const DEFAULT_CANDIDATE_CAP = 200;
/** How many top lexical hits are used as spreading-activation origins. */
const DEFAULT_SEED_COUNT = 3;
/** Total energy split across the seeds, in proportion to their lexical score. */
const DEFAULT_SEED_ENERGY = 10;
/**
 * Weight of the (normalized) graph score relative to the (normalized)
 * lexical score in the final blend. Below 1 on purpose: with the signal
 * volume measured in a real vault after 8 weeks (122 usage edges), the graph
 * is a re-ranker and an expander, not a retriever — it must not be able to
 * push a note nothing in the query matched above a strong textual match.
 * Kept as an option so VNL-020's benchmark can sweep it instead of guessing.
 */
const DEFAULT_GRAPH_WEIGHT = 0.5;
/**
 * Weight of the (normalized) learned-term score relative to lexical, in the
 * same additive blend as graphWeight (VNL-053). Deliberately below 1: this
 * is what "kill process by port" has meant for this user in the past, which
 * is real evidence but personal and easily stale — it must not be able to
 * override what the query's words plainly say today. An opening position,
 * not a measurement; VNL-020 is where it gets earned.
 */
const DEFAULT_TERM_WEIGHT = 0.4;
/**
 * Weight of the (normalized) semantic score in the same additive blend
 * (VNL-051). Higher than the graph and term axes because, unlike them, this
 * is an actual relevance model rather than a usage signal — it can be
 * trusted on a query it has never seen, which is the whole reason for
 * adding it. Still below 1: BM25 on an exact term match is the more
 * precise signal when it fires at all, and a 384-dimension sentence
 * embedding of a note's opening 1200 characters is a lossy summary that
 * happily calls two different project notes similar. Unmeasured opening
 * position; VNL-020 sweeps it.
 */
const DEFAULT_SEMANTIC_WEIGHT = 0.6;
/**
 * How many semantic hits may also become spreading-activation origins
 * (VNL-061). Fewer than the lexical `seedCount` on purpose: a semantic hit
 * is a softer claim than a term match — measured against the real vault,
 * every cosine including the correct answer's lands in a narrow 0.19-0.46
 * band — and each origin costs a full activation pass against the shared
 * `budgetMs`. Set to 0 to restore the pre-VNL-061 lexical-only seeding.
 */
const DEFAULT_SEMANTIC_SEED_COUNT = 2;
/** Wall-clock bound on the whole graph-expansion phase (all seeds together). */
const DEFAULT_GRAPH_BUDGET_MS = 1000;
/** Characters of body returned per hit so the agent needn't call read_note to triage. */
const SNIPPET_LENGTH = 240;

// BM25 free parameters, at the standard defaults — tf saturation and length
// normalization respectively. Not tuned; VNL-020 is where tuning gets
// evidence, per D6/"claims discipline" in CLAUDE.md.
const BM25_K1 = 1.2;
const BM25_B = 0.75;

/**
 * Occurrences in a note's title and aliases count for more than occurrences
 * in its body, mirroring searchNotes' title > alias > content tiering — but
 * as a term-frequency multiplier rather than a hard tier, so a body that
 * genuinely discusses the query can still beat an incidental title word.
 */
const TITLE_TF_BOOST = 3;
const ALIAS_TF_BOOST = 2;
/**
 * Query terms coming from `context` (the caller's task description or
 * current file, not their actual question) contribute at a fraction of a
 * real query term's weight — they are there to disambiguate between
 * otherwise-equal matches, not to become the query.
 */
const CONTEXT_TERM_WEIGHT = 0.3;
/**
 * A query term is dropped from scoring when its idf is below this fraction
 * of the most selective term's idf in the same query — a corpus-derived
 * stopword rule rather than a hardcoded English list, so it works for a
 * vault in any language or jargon.
 *
 * Non-negative idf (see bm25) never reaches zero, so without this the
 * function words in a natural-language question ("what did we decide about
 * a…") each contribute a little and, summed, pull in notes that match
 * nothing else — observed live on the real vault, where two unrelated notes
 * made the top 5 on function words alone.
 *
 * Relative to the query rather than an absolute share of the vault: a fixed
 * "appears in more than X% of notes" cutoff was tried first and did not work
 * on the real vault, where "did"/"about"/"through" sit well under any share
 * that doesn't also discard real topic terms. What actually distinguishes
 * them is that the same query contains something far rarer. A query whose
 * terms are all equally common keeps all of them, and still returns its best
 * matches rather than nothing.
 */
const MIN_IDF_RATIO = 0.25;

export interface RecallWhy {
  /** Query (and context) terms that actually occur in this note. */
  matchedTerms: string[];
  /** BM25 score against the query; 0 for a hit the graph alone produced. */
  lexicalScore: number;
  /** Accumulated spreading-activation energy, if the graph reached this note. */
  graphEnergy?: number;
  /** The lexical seed note the graph reached this note from, if any. */
  via?: string;
  /** Hops from `via` to this note (1 = direct neighbor). */
  hops?: number;
  /** Days since the note's file was last modified — VNL-056 will surface this in prose. */
  staleDays?: number;
  /** Set when the note's frontmatter marks it `status: superseded` (see relations.ts). */
  supersededBy?: string;
  /** True if this note is in the session buffer, i.e. already seen this session. */
  primed?: boolean;
  /**
   * Live-decayed score from what this user's past searches have taught the
   * engine these query terms mean (VNL-053) — set only when at least one
   * query term has a learned association with this note.
   */
  termScore?: number;
  /** Which query terms contributed to `termScore`, strongest first. */
  learnedTerms?: string[];
  /**
   * Cosine similarity between the query's embedding and this note's, in
   * [0,1] (VNL-051) — set only when the optional embedding index exists and
   * this note cleared the similarity floor. Unlike every other axis here it
   * is comparable across queries, so it is the one number in `why` worth
   * reading on its own: ~0.8 is a paraphrase, ~0.5 is the same topic, and
   * anything the floor let through below that is a weak association.
   */
  semanticScore?: number;
}

export interface RecallHit {
  path: string;
  /** Blended lexical + graph score, comparable only within one result set. */
  score: number;
  /**
   * Which signal produced this hit. "term" means the note surfaced purely
   * because this user's own history associates a query term with it — no
   * text in the note matches today and the graph didn't reach it either.
   * "semantic" means it matched on meaning alone (VNL-051): no query term
   * occurs in it, but its embedding is close to the query's.
   *
   * Reported strongest-evidence-first, so a note that both matched text and
   * was reached semantically reads as "lexical", not "semantic" — the label
   * answers "why is this here at all", and `why` carries every axis'
   * individual score for a caller that needs the full picture.
   */
  source: "lexical" | "graph" | "both" | "semantic" | "term";
  /** Leading body text (around the first matched term), so triage needs no read_note round trip. */
  snippet: string;
  why: RecallWhy;
}

export interface RecallOptions {
  topK?: number;
  /**
   * Free text describing what the caller is doing (task, current file,
   * project). Its terms are scored like query terms but at
   * CONTEXT_TERM_WEIGHT.
   */
  context?: string;
  sessionBuffer?: SessionBuffer;
  /** Max notes read from disk and scored. Lowering it trades recall for latency. */
  candidateCap?: number;
  seedCount?: number;
  seedEnergy?: number;
  graphWeight?: number;
  /** Weight of learned query-term associations in the blend (VNL-053, default 0.4). */
  termWeight?: number;
  /**
   * Weight of the semantic axis in the blend (VNL-051, default 0.6). Set to
   * 0 to skip the semantic phase entirely — no index read, no model load.
   */
  semanticWeight?: number;
  /**
   * Absolute cosine floor a note must clear to count as a semantic match at
   * all (default 0.2) — a noise guard for a query that matches nothing.
   */
  semanticFloor?: number;
  /**
   * Fraction of this query's best cosine a note must reach (default 0.6).
   * The filter that does the real work; 0 disables it.
   */
  semanticRelativeCut?: number;
  /** How many semantic hits may enter the blend (default 20). */
  semanticCandidates?: number;
  /**
   * How many semantic hits may also seed spreading activation (VNL-061,
   * default 2). 0 restores lexical-only seeding.
   */
  semanticSeedCount?: number;
  /**
   * The embedding index to score against. Omitted, it is loaded from
   * `vaultDataDir` — absent file means the vault never opted in and the
   * semantic phase is skipped. Pass `false` to skip it explicitly, or an
   * index directly to avoid the per-call read (a benchmark sweeping
   * weights, say).
   */
  embeddings?: EmbeddingsFile | null | false;
  /**
   * Model used to embed the *query*. Defaults to the process-wide shared
   * provider, which is null unless the optional `@huggingface/transformers`
   * peer is installed.
   */
  embeddingProvider?: EmbeddingProvider | null;
  /** Wall-clock bound for the graph phase; lexical scoring always completes. */
  budgetMs?: number;
  activationConfig?: SpreadingActivationConfig;
  onEvent?: ActivationEventSink;
  now?: Date;
}

export interface RecallResult {
  query: string;
  hits: RecallHit[];
  /** Lexical hits used as spreading-activation origins, best first. */
  seeds: string[];
  /** How many notes were read and BM25-scored (i.e. how much of the vault this saw). */
  candidatesScored: number;
  /** True if the graph phase hit its time budget and stopped early — hits may lack graph signal. */
  timedOut: boolean;
}

interface WeightedTerm {
  token: string;
  /** 1 for a query term, CONTEXT_TERM_WEIGHT for a context term. */
  weight: number;
}

/**
 * Query terms first, then any context term not already in the query. A term
 * present in both stays a full-weight query term rather than being counted
 * twice.
 */
function weightedTerms(query: string, context?: string): WeightedTerm[] {
  const terms: WeightedTerm[] = tokenize(query).map((token) => ({ token, weight: 1 }));
  const seen = new Set(terms.map((t) => t.token));
  for (const token of context ? tokenize(context) : []) {
    if (seen.has(token)) continue;
    seen.add(token);
    terms.push({ token, weight: CONTEXT_TERM_WEIGHT });
  }
  return terms;
}

/**
 * The notes worth reading for this query: every note containing at least one
 * query term (BM25 is OR-semantics, unlike searchNotes' all-tokens-present
 * match), rarest term first and capped — a common word must not be able to
 * drag the entire vault into a per-query disk read.
 *
 * Notes the index doesn't cover yet (created or renamed since the last
 * nightly rebuild) are always unioned back in, the same accepted-staleness
 * handling searchNotes uses, so a note written minutes ago is still findable.
 */
function lexicalCandidates(index: ContentIndexFile, terms: WeightedTerm[], cap: number): string[] {
  const byRarity = [...terms].sort(
    (a, b) => (index.postings[a.token]?.length ?? 0) - (index.postings[b.token]?.length ?? 0),
  );

  const candidates = new Set<string>();
  for (const term of byRarity) {
    for (const path of index.postings[term.token] ?? []) {
      if (candidates.size >= cap) break;
      candidates.add(path);
    }
    if (candidates.size >= cap) break;
  }
  return [...candidates];
}

/**
 * Lucene's non-negative idf variant: the textbook Robertson idf goes
 * negative for a term in more than half the corpus, which would let a very
 * common term *subtract* from the score of a note that contains it.
 */
function inverseDocumentFrequency(df: number, totalNotes: number): number {
  const safeDf = Math.max(df, 1);
  return Math.log(1 + (totalNotes - safeDf + 0.5) / (safeDf + 0.5));
}

/**
 * Query terms with enough selectivity to be worth scoring — see
 * MIN_IDF_RATIO. Falls back to every term when none stands out, so a query
 * of uniformly common words still retrieves.
 */
function selectiveTerms(
  terms: WeightedTerm[],
  documentFrequency: (token: string) => number,
  totalNotes: number,
): WeightedTerm[] {
  const idfs = terms.map((term) => inverseDocumentFrequency(documentFrequency(term.token), totalNotes));
  const maxIdf = Math.max(...idfs);
  const selective = terms.filter((_, i) => idfs[i] >= MIN_IDF_RATIO * maxIdf);
  return selective.length > 0 ? selective : terms;
}

interface ScoredNote {
  note: NoteRef;
  score: number;
  matchedTerms: string[];
}

/**
 * Term frequency per token for one note, with title and alias occurrences
 * boosted, plus the note's length in tokens for BM25's length
 * normalization.
 */
function termFrequencies(note: NoteRef): { tf: Map<string, number>; length: number } {
  const tf = new Map<string, number>();
  let length = 0;

  function add(text: string, boost: number): void {
    for (const token of tokenize(text)) {
      tf.set(token, (tf.get(token) ?? 0) + boost);
      length += boost;
    }
  }

  const title = note.path.split("/").pop() ?? note.path;
  const aliases = Array.isArray(note.frontmatter.aliases) ? (note.frontmatter.aliases as string[]) : [];
  add(title, TITLE_TF_BOOST);
  add(aliases.filter((a) => typeof a === "string").join(" "), ALIAS_TF_BOOST);
  add(note.body, 1);

  return { tf, length };
}

/**
 * Standard BM25 with the document frequencies taken from the persisted
 * content index (which stores postings per token, so df is free) and the
 * term frequencies computed live from the candidate notes — the index has no
 * per-note counts and giving it some would multiply its size, which VNL-031
 * (SQLite-backed store) is the right place to change, not this ticket.
 *
 * `averageLength` is therefore the mean over the *candidates*, not the whole
 * vault. That is a real approximation: it only matters as the yardstick for
 * "is this note long for its corpus", and every candidate is measured
 * against the same yardstick, so ordering within one query is unaffected.
 */
function bm25(
  candidates: NoteRef[],
  terms: WeightedTerm[],
  documentFrequency: (token: string) => number,
  totalNotes: number,
): ScoredNote[] {
  const frequencies = candidates.map((note) => ({ note, ...termFrequencies(note) }));
  const totalLength = frequencies.reduce((sum, f) => sum + f.length, 0);
  const averageLength = frequencies.length > 0 ? totalLength / frequencies.length : 1;

  return frequencies.map(({ note, tf, length }) => {
    let score = 0;
    const matchedTerms: string[] = [];

    for (const term of terms) {
      const frequency = tf.get(term.token) ?? 0;
      if (frequency === 0) continue;
      matchedTerms.push(term.token);

      const idf = inverseDocumentFrequency(documentFrequency(term.token), totalNotes);
      const norm = frequency * (BM25_K1 + 1);
      const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * (length / (averageLength || 1)));
      score += term.weight * idf * (norm / denominator);
    }

    return { note, score, matchedTerms };
  });
}

/** A snippet centred on the first matched term, or the note's opening otherwise. */
function snippetFor(body: string, matchedTerms: string[]): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SNIPPET_LENGTH) return collapsed;

  const lower = collapsed.toLowerCase();
  let at = -1;
  for (const term of matchedTerms) {
    const found = lower.indexOf(term);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1) return `${collapsed.slice(0, SNIPPET_LENGTH)}…`;

  const start = Math.max(0, at - Math.floor(SNIPPET_LENGTH / 3));
  const end = Math.min(collapsed.length, start + SNIPPET_LENGTH);
  return `${start > 0 ? "…" : ""}${collapsed.slice(start, end)}${end < collapsed.length ? "…" : ""}`;
}

async function staleDays(vaultPath: string, notePath: string, now: Date): Promise<number | undefined> {
  try {
    const stats = await stat(toFilePath(vaultPath, notePath));
    return Math.floor((now.getTime() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24));
  } catch {
    return undefined;
  }
}

/**
 * One call that answers "what should I read for this task?": BM25 over the
 * content index picks the seed set, spreading activation over the weighted
 * graph expands and re-ranks it, and each hit comes back with a snippet and
 * a `why` (matched terms, hop path, energy, staleness, supersession) so the
 * agent can triage without N `read_note` round trips.
 */
interface SemanticPhaseOptions {
  semanticWeight: number;
  semanticFloor: number;
  semanticRelativeCut: number;
  semanticCandidates: number;
  embeddings?: EmbeddingsFile | null | false;
  embeddingProvider?: EmbeddingProvider | null;
}

/**
 * Cosine similarity of the query against the stored note vectors, or an
 * empty map when the semantic axis isn't available (VNL-051).
 *
 * Every reason to have no answer is a normal state, not a failure: the
 * feature is off by default, the optional model may not be installed, and
 * an index built by a different model must be ignored rather than compared
 * against — two models' vector spaces are unrelated, so cosine between them
 * is a meaningless number that would still sort. Anything the model itself
 * throws is swallowed for the same reason it is optional: a broken ONNX
 * runtime must degrade `recall` to its pre-VNL-051 behaviour, never fail
 * the query.
 *
 * Only the query text is embedded, not `context`. Context terms exist to
 * break ties between otherwise-equal lexical matches at CONTEXT_TERM_WEIGHT;
 * concatenating them into the embedded text has no equivalent volume knob —
 * a paragraph of context would simply become the query, and the vector
 * would describe the caller's situation rather than their question.
 */
async function semanticPhase(
  vaultDataDir: string,
  query: string,
  opts: SemanticPhaseOptions,
): Promise<Map<string, number>> {
  const empty = new Map<string, number>();
  if (opts.semanticWeight <= 0 || opts.embeddings === false) return empty;

  try {
    const index = opts.embeddings ?? (await loadEmbeddings(vaultDataDir));
    if (!index || Object.keys(index.notes).length === 0) return empty;

    const provider = opts.embeddingProvider ?? (await getSharedEmbeddingProvider());
    if (!provider || provider.model !== index.model) return empty;

    const [queryVector] = await provider.embed([query]);
    if (!queryVector) return empty;

    return semanticScores(index, queryVector, {
      floor: opts.semanticFloor,
      relativeCut: opts.semanticRelativeCut,
      topN: opts.semanticCandidates,
    });
  } catch {
    return empty;
  }
}

/** A spreading-activation origin, with the energy share it has earned. */
interface Seed {
  path: string;
  /**
   * Share of the best score on this seed's own axis, discounted by
   * `semanticWeight` for a semantic seed. Comparable across axes; the raw
   * per-axis scores are not.
   */
  strength: number;
  /** Which axis nominated it — reported so `why.via` can be traced back to a mechanism. */
  origin: "lexical" | "semantic";
}

/**
 * The origins for the graph phase, drawn from both retrieval axes (VNL-061).
 *
 * Lexical seeds come first and keep their existing behaviour exactly.
 * Semantic seeds are appended, skipping any note the lexical axis already
 * nominated — a note both axes found is one seed with lexical strength, not
 * two spreads from the same place.
 *
 * Fewer semantic seeds than lexical ones by default: a semantic hit is a
 * softer claim (see DEFAULT_SEMANTIC_SEED_COUNT), and each additional origin
 * costs a full spreading-activation pass against the shared time budget.
 */
function buildSeeds(
  scored: ScoredNote[],
  semantic: Map<string, number>,
  opts: { seedCount: number; semanticSeedCount: number; semanticWeight: number },
): Seed[] {
  const maxLexical = scored[0]?.score ?? 0;
  const seeds: Seed[] = scored.slice(0, opts.seedCount).map((entry) => ({
    path: entry.note.path,
    strength: maxLexical > 0 ? entry.score / maxLexical : 0,
    origin: "lexical" as const,
  }));

  if (opts.semanticSeedCount <= 0 || opts.semanticWeight <= 0 || semantic.size === 0) return seeds;

  const taken = new Set(seeds.map((seed) => seed.path));
  const ranked = [...semantic.entries()].sort((a, b) => b[1] - a[1]);
  const maxSemantic = ranked[0]?.[1] ?? 0;

  let added = 0;
  for (const [path, score] of ranked) {
    if (added >= opts.semanticSeedCount) break;
    if (taken.has(path)) continue;
    added++;
    seeds.push({
      path,
      strength: maxSemantic > 0 ? opts.semanticWeight * (score / maxSemantic) : 0,
      origin: "semantic",
    });
  }
  return seeds;
}

export async function recall(
  vaultPath: string,
  vaultDataDir: string,
  query: string,
  opts: RecallOptions = {},
): Promise<RecallResult> {
  const {
    topK = 10,
    context,
    sessionBuffer,
    candidateCap = DEFAULT_CANDIDATE_CAP,
    seedCount = DEFAULT_SEED_COUNT,
    seedEnergy = DEFAULT_SEED_ENERGY,
    graphWeight = DEFAULT_GRAPH_WEIGHT,
    termWeight = DEFAULT_TERM_WEIGHT,
    semanticWeight = DEFAULT_SEMANTIC_WEIGHT,
    semanticFloor = DEFAULT_SEMANTIC_FLOOR,
    semanticRelativeCut = DEFAULT_SEMANTIC_RELATIVE_CUT,
    semanticCandidates = DEFAULT_SEMANTIC_CANDIDATES,
    semanticSeedCount = DEFAULT_SEMANTIC_SEED_COUNT,
    embeddings,
    embeddingProvider,
    budgetMs = DEFAULT_GRAPH_BUDGET_MS,
    activationConfig = DEFAULT_SPREADING_ACTIVATION_CONFIG,
    onEvent,
    now = new Date(),
  } = opts;

  const terms = weightedTerms(query, context);
  if (terms.length === 0) {
    return { query, hits: [], seeds: [], candidatesScored: 0, timedOut: false };
  }

  // --- Lexical phase -------------------------------------------------------
  const index = await loadContentIndex(vaultDataDir);
  let candidatePaths: string[];
  let totalNotes: number;
  let documentFrequency: (token: string) => number;

  if (index) {
    const covered = new Set(index.coveredPaths);
    const uncovered = (await listNotes(vaultPath)).filter((path) => !covered.has(path));
    candidatePaths = [...new Set([...lexicalCandidates(index, terms, candidateCap), ...uncovered])];
    totalNotes = covered.size + uncovered.length;
    documentFrequency = (token) => index.postings[token]?.length ?? 0;
  } else {
    // No index yet (fresh vault, or before the first nightly run): reuse
    // searchNotes' existing bounded full-scan to pick candidates rather than
    // reading the whole vault here. Its all-tokens-present matching is
    // stricter than BM25's, so this branch recalls less — correct behaviour
    // for an un-indexed vault, and it disappears after one nightly run.
    const hits = await searchNotes(vaultPath, query, { topK: candidateCap, vaultDataDir, useWeights: false });
    candidatePaths = hits.map((hit) => hit.path);
    totalNotes = Math.max((await listNotes(vaultPath)).length, 1);
    // Without postings there is no corpus-wide df; every candidate matched,
    // so df is at least the candidate count. Flat across terms, which makes
    // idf a constant here — BM25 degenerates to tf/length ranking, which is
    // still a better ordering than searchNotes' tiers alone.
    const flat = Math.max(candidatePaths.length, 1);
    documentFrequency = () => flat;
  }

  const scoringTerms = selectiveTerms(terms, documentFrequency, totalNotes);

  const candidates = (await readNotesInBatches(vaultPath, candidatePaths)).filter(
    (note): note is NoteRef => note !== null,
  );
  const scored = bm25(candidates, scoringTerms, documentFrequency, totalNotes)
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  // --- Learned-term phase (VNL-053) -----------------------------------------
  // What this user's own past searches associate these terms with — the same
  // selective terms BM25 scored, so a stopword can't have a learned
  // association either. Independent of whether the lexical/graph phases
  // found anything: this is how a personal shorthand ("kill process by
  // port" meaning one specific note) surfaces even when the note's own text
  // doesn't obviously match.
  const termScores = await liveTermScores(
    vaultDataDir,
    scoringTerms.map((term) => term.token),
    now,
  );

  // --- Semantic phase (VNL-051) --------------------------------------------
  // What the query *means*, independent of which words it used. This is the
  // only phase that can reach a note sharing no vocabulary with the query at
  // all, so it runs over the whole embedding index rather than over the
  // lexical candidate set — narrowing it to notes BM25 already found would
  // defeat the point.
  //
  // Entirely optional: the index only exists if the vault opted in and the
  // nightly job built it, and embedding the query needs the optional model.
  // Either missing means "no semantic axis", not an error.
  const semantic = await semanticPhase(vaultDataDir, query, {
    semanticWeight,
    semanticFloor,
    semanticRelativeCut,
    semanticCandidates,
    embeddings,
    embeddingProvider,
  });

  // --- Graph phase ---------------------------------------------------------
  // Origins come from both retrieval axes (VNL-061). Taking them from the
  // lexical top-N alone meant that on a query whose words appear nowhere in
  // the vault — exactly the query the semantic axis exists to answer —
  // there were no seeds at all and the graph contributed nothing, so the two
  // mechanisms ran side by side instead of compounding.
  //
  // The two axes' raw scores are not comparable (BM25 is unbounded, cosine
  // against real notes lands in a narrow 0.19-0.46 band), so each seed's
  // strength is its share of the best score *on its own axis*, and semantic
  // strengths are then scaled by `semanticWeight` — the same discount the
  // blend applies, for the same reason: a note found on meaning alone is
  // weaker evidence than one the query's words actually hit, so it should
  // spread less far.
  //
  // Because each axis is normalized against its own maximum, a query with no
  // semantic seeds distributes energy exactly as it did before this change:
  // dividing every lexical score by the same constant leaves the shares
  // untouched.
  const seeds = buildSeeds(scored, semantic, { seedCount, semanticSeedCount, semanticWeight });
  const seedTotal = seeds.reduce((sum, seed) => sum + seed.strength, 0);
  const deadline = Date.now() + budgetMs;

  interface GraphHit {
    energy: number;
    /** The seed this note was reached from; absent on a seed's own self-activation. */
    via?: string;
    /** Hops from `via`; absent on a seed's own self-activation. */
    hops?: number;
  }
  const graph = new Map<string, GraphHit>();
  let timedOut = false;

  for (const seed of seeds) {
    if (Date.now() >= deadline) {
      timedOut = true;
      break;
    }
    // Energy proportional to the seed's share of the total, so a weak third
    // seed doesn't spread as far as the best match does.
    const share = seedTotal > 0 ? seed.strength / seedTotal : 1 / Math.max(seeds.length, 1);
    const originEnergy = seedEnergy * share;

    // The origin of a spread keeps its own activation. Without this a seed
    // scores 0 on the graph axis while every neighbor it fed scores above 0,
    // so a well-connected hub one hop away (a MOC, typically) outranked the
    // note that actually answered the query — reproduced against the real
    // 474-note vault before this line existed. A spread never transfers more
    // energy outward than it started with, so this also makes the origin the
    // graph-axis maximum for its own neighborhood rather than an arbitrary
    // extra boost.
    const self = graph.get(seed.path);
    if (self) self.energy += originEnergy;
    else graph.set(seed.path, { energy: originEnergy });

    const activated = await activate(
      vaultDataDir,
      seed.path,
      originEnergy,
      activationConfig,
      vaultPath,
      sessionBuffer,
      onEvent,
      deadline,
    );

    for (const node of activated) {
      const existing = graph.get(node.path);
      if (existing) {
        // Energy accumulates across seeds — a note several seeds all reach is
        // more likely the one the query is really about than one only the
        // best seed reaches, which is the whole point of doing this per-seed.
        existing.energy += node.energy;
        if (existing.hops === undefined || node.hops < existing.hops) {
          existing.hops = node.hops;
          existing.via = seed.path;
        }
      } else {
        graph.set(node.path, { energy: node.energy, via: seed.path, hops: node.hops });
      }
    }
  }

  // --- Blend ---------------------------------------------------------------
  // Both signals are normalized to [0,1] against the best value in *this*
  // result set before blending: BM25 scores and activation energies have no
  // common unit, and both vary by orders of magnitude with query length and
  // graph density, so any fixed blending constant over the raw numbers would
  // silently mean something different per query.
  const maxLexical = scored[0]?.score ?? 0;
  const maxEnergy = Math.max(0, ...[...graph.values()].map((g) => g.energy));
  const maxTermScore = Math.max(0, ...[...termScores.values()].map((t) => t.score));

  const byPath = new Map<string, ScoredNote>(scored.map((entry) => [entry.note.path, entry]));
  const allPaths = new Set<string>([
    ...byPath.keys(),
    ...graph.keys(),
    ...termScores.keys(),
    ...semantic.keys(),
  ]);

  const ranked = [...allPaths]
    .map((path) => {
      const lexical = byPath.get(path);
      const graphHit = graph.get(path);
      const termHit = termScores.get(path);
      const semanticHit = semantic.get(path);
      const lexicalNorm = lexical && maxLexical > 0 ? lexical.score / maxLexical : 0;
      const graphNorm = graphHit && maxEnergy > 0 ? graphHit.energy / maxEnergy : 0;
      const termNorm = termHit && maxTermScore > 0 ? termHit.score / maxTermScore : 0;
      // Used raw, unlike every other axis, which is divided by the best
      // value in this result set.
      //
      // The original reason given here was that cosine is bounded and
      // comparable across queries. Measured against the real vault, that is
      // only true of *symmetric* comparisons: two short paraphrases score
      // 0.64, while the same model comparing a short question to a note's
      // 1200-character opening puts every result — right and wrong alike —
      // between 0.19 and 0.46. So the absolute value does not mean what a
      // fixed scale would imply.
      //
      // It is still not normalized, for the opposite reason: normalizing
      // would hand the best of a uniformly poor set a full-strength score.
      // Instead `semanticScores` has already applied a relative cut against
      // this query's own best, which is where the compressed distribution is
      // actually handled — so what arrives here is a survivor of that cut,
      // and its raw magnitude only modulates a signal already judged real.
      const semanticNorm = semanticHit ?? 0;
      // Semantic is checked before graph, not after (VNL-061). Once a
      // semantic hit can seed spreading activation, it self-activates and so
      // always carries graph energy — labelling that "graph" would credit
      // the mechanism that echoed the find to the mechanism that made it.
      // The graph energy on such a note is downstream of the semantic
      // match: without it the note would never have been an origin.
      const source: RecallHit["source"] =
        lexical && graphHit
          ? "both"
          : lexical
            ? "lexical"
            : semanticHit !== undefined
              ? "semantic"
              : graphHit
                ? "graph"
                : "term";
      return {
        path,
        lexical,
        graphHit,
        termHit,
        semanticHit,
        score:
          lexicalNorm + graphWeight * graphNorm + termWeight * termNorm + semanticWeight * semanticNorm,
        source,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // Bodies for graph-only hits (never read during the lexical phase), so
  // every returned hit carries a snippet. Only the topK slice pays for this.
  const missing = ranked.filter((entry) => !entry.lexical).map((entry) => entry.path);
  const fetched = new Map<string, NoteRef>();
  for (const note of await readNotesInBatches(vaultPath, missing)) {
    if (note) fetched.set(note.path, note);
  }

  const hits: RecallHit[] = await Promise.all(
    ranked.map(async (entry) => {
      const note = entry.lexical?.note ?? fetched.get(entry.path);
      const matchedTerms = entry.lexical?.matchedTerms ?? [];
      const why: RecallWhy = {
        matchedTerms,
        lexicalScore: entry.lexical?.score ?? 0,
        ...(entry.graphHit && { graphEnergy: entry.graphHit.energy, via: entry.graphHit.via, hops: entry.graphHit.hops }),
        ...(entry.termHit && { termScore: entry.termHit.score, learnedTerms: entry.termHit.terms }),
        ...(entry.semanticHit !== undefined && { semanticScore: entry.semanticHit }),
        ...(sessionBuffer?.has(entry.path) && { primed: true }),
      };

      const [days, supersededBy] = await Promise.all([
        staleDays(vaultPath, entry.path, now),
        readSupersession(vaultPath, entry.path),
      ]);
      if (days !== undefined) why.staleDays = days;
      if (supersededBy) why.supersededBy = supersededBy;

      return {
        path: entry.path,
        score: entry.score,
        source: entry.source,
        snippet: note ? snippetFor(note.body, matchedTerms) : "",
        why,
      };
    }),
  );

  return {
    query,
    hits,
    seeds: seeds.map((seed) => seed.path),
    candidatesScored: candidates.length,
    timedOut,
  };
}
