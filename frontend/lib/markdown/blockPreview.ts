"use client";

/**
 * Fetching (and caching) the one block a citation points at.
 *
 * A chat answer cites `/brain/{noteId}#{blockId}` — the format
 * `services/retriever.py`'s `deep_link` emits. Hovering that link previews
 * the cited block; this module owns recognising such a link and getting the
 * block's BlockNote JSON, so the component stays about hover behaviour.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

export interface BlockPreviewData {
  note_id: string;
  note_title: string;
  note_icon: string;
  block_id: string;
  /** The cited block plus a few siblings either side, in document order. */
  blocks: AnyBlock[];
  /** Which of `blocks` was actually cited — the card marks that one. */
  target_index: number;
  /** ISO timestamp of the note's last save, if known. */
  updated_at?: string | null;
}

/** `/brain/{uuid}#{blockId}`, or `/brain/{uuid}` for a whole note — then the
 *  card shows the note's opening passage (block id `_top`, nothing marked).
 *  A bare `#anchor` and anything external fall through to `null` and keep
 *  the plain-link behaviour. */
const BLOCK_LINK =
  /^\/brain\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:#(.+))?$/i;
export const NOTE_TOP = "_top";

export function parseBlockLink(
  href: string | undefined
): { noteId: string; blockId: string } | null {
  if (!href) return null;
  const m = BLOCK_LINK.exec(href);
  return m ? { noteId: m[1], blockId: m[2] || NOTE_TOP } : null;
}

// Keyed by note+block, shared by every link on the page: two citations of the
// same block fetch once, and re-hovering a link never refetches. Holds the
// in-flight promise (not the resolved value) so two hovers racing the same
// first fetch also collapse into one request.
const cache = new Map<string, Promise<BlockPreviewData | null>>();

/** Resolves to the block, or to `null` when it can't be shown (the note or
 *  block is gone, the session expired, the backend is down). Never rejects —
 *  a hover card that fails is a plain link, not an error surface. */
export function fetchBlockPreview(
  noteId: string,
  blockId: string
): Promise<BlockPreviewData | null> {
  const key = `${noteId}#${blockId}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const pending = (async () => {
    const res = await fetch(
      `/api/ws/notes/${encodeURIComponent(noteId)}/blocks/${encodeURIComponent(blockId)}`
    );
    if (!res.ok) return null; // 404 (deleted/edited away), 401, 503 — all "no card"
    const data = (await res.json()) as BlockPreviewData;
    return data && data.blocks?.length ? data : null;
  })().catch(() => {
    // A transport failure (offline, backend restarting) is not a fact about
    // this block, so drop the entry — the next hover gets a fresh attempt.
    // A 4xx/5xx *response* stays cached above: it won't change mid-session,
    // and refetching it on every hover would be pure noise.
    cache.delete(key);
    return null;
  });

  cache.set(key, pending);
  return pending;
}

/** A model sometimes cites a note as a bare `[<uuid>#<block>]` (or
 *  `[/brain/<uuid>#<block>]`) instead of a markdown link — seen live on
 *  Nemotron. That renders as noise and opens nothing; turn it into a real
 *  link (so it also gets the hover card). Proper links `[..](..)` are left
 *  alone. */
const BARE_REF =
  /\[(?:\/brain\/)?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(#[\w-]+)?\](?!\()/gi;

export function linkBareNoteRefs(markdown: string): string {
  return markdown.replace(BARE_REF, (_m, id: string, hash = "") => `[↗ note](/brain/${id}${hash})`);
}

/** Test-only: drop everything fetched so far. */
export function __clearBlockPreviewCache() {
  cache.clear();
}
