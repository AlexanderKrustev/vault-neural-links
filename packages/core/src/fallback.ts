import { activate } from "./activation.js";
import { mostRecentNotes, searchNotes } from "./notes.js";
import type { RecentNote, SearchHit } from "./notes.js";
import type { SessionBuffer } from "./priming.js";
import type { ActivatedNote, ActivationEventSink, SpreadingActivationConfig } from "./types.js";

const KEYWORD_FALLBACK_TOPK = 10;
const RECENCY_FALLBACK_TOPK = 10;

export type RetrievalResult =
  | { tier: "activation"; notes: ActivatedNote[] }
  | { tier: "keyword"; notes: SearchHit[] }
  | { tier: "recency"; notes: RecentNote[] };

/**
 * Guarantees a retrieval call never comes back empty. `activate` already
 * blends usage-weighted and structural-only (floor-weight) edges, so most
 * queries resolve there; when a note has no edges of either kind at all
 * (freshly created, or genuinely disconnected), this falls through to a
 * keyword/title match over the vault, and — as a last resort, since even a
 * keyword match can miss — to the most recently touched notes, so callers
 * always get *something* to work with instead of having to special-case an
 * empty response.
 */
export async function retrieveWithFallback(
  vaultDataDir: string,
  vaultPath: string,
  note: string,
  energy: number,
  config?: SpreadingActivationConfig,
  sessionBuffer?: SessionBuffer,
  onEvent?: ActivationEventSink,
): Promise<RetrievalResult> {
  const activated = await activate(vaultDataDir, note, energy, config, vaultPath, sessionBuffer, onEvent);
  if (activated.length > 0) {
    return { tier: "activation", notes: activated };
  }

  const keyword = note.split("/").pop() ?? note;
  const hits = (
    await searchNotes(vaultPath, keyword, { topK: KEYWORD_FALLBACK_TOPK, vaultDataDir, useWeights: true })
  ).filter((hit) => hit.path !== note);
  if (hits.length > 0) {
    return { tier: "keyword", notes: hits };
  }

  const recent = await mostRecentNotes(vaultPath, RECENCY_FALLBACK_TOPK, note);
  return { tier: "recency", notes: recent };
}
