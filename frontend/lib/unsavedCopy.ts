// A note's edits that have not reached the server yet, kept in this browser so a failed save,
// a closed tab or a crash never loses them (ArtCraft study C1: "a copy left behind means the
// save never happened"). The copy is written before every save and dropped only when the
// server confirms that exact save.
//
// Restoring never trusts the browser clock. Each copy remembers `base`: a hash of the content
// the server last confirmed in that session. On open:
//   - the copy equals the server's content  → it was saved after all; drop it;
//   - the server still holds `base`          → nothing changed elsewhere; restore the copy;
//   - the server holds something else        → edited on another device since; keep the copy
//                                              (never deleted unseen) and overwrite nothing.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

export interface UnsavedCopy {
  blocks: AnyBlock[];
  plainText: string;
  /** Hash of the content the server last confirmed when this copy was written. */
  base: string;
  /** When the copy was written (ms) — for the message only, never for decisions. */
  at: number;
}

export type RestorePlan =
  | { action: "none" }
  | { action: "restore"; copy: UnsavedCopy }
  | { action: "conflict"; copy: UnsavedCopy };

const key = (noteId: string) => `unsaved-note-${noteId}`;

/** A short, stable hash of a document (FNV-1a over its JSON). */
export function contentHash(blocks: unknown): string {
  const s = JSON.stringify(blocks ?? []);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ":" + s.length.toString(36);
}

export function keepCopy(noteId: string, copy: UnsavedCopy): boolean {
  try {
    localStorage.setItem(key(noteId), JSON.stringify(copy));
    return true;
  } catch {
    return false; // storage full or blocked: the save itself still runs
  }
}

export function readCopy(noteId: string): UnsavedCopy | null {
  try {
    const raw = localStorage.getItem(key(noteId));
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || !Array.isArray(c.blocks) || typeof c.base !== "string") return null;
    return { blocks: c.blocks, plainText: typeof c.plainText === "string" ? c.plainText : "",
             base: c.base, at: typeof c.at === "number" ? c.at : 0 };
  } catch {
    return null;
  }
}

/** Drop the copy — but only the one written at `at`, so a save confirming older content
 *  never removes a newer copy written while it was in flight. Without `at`, drop any. */
export function dropCopy(noteId: string, at?: number): void {
  try {
    if (at !== undefined && readCopy(noteId)?.at !== at) return;
    localStorage.removeItem(key(noteId));
  } catch { /* blocked */ }
}

/** What to do with this browser's copy when the note opens with `serverContent`. */
export function planRestore(copy: UnsavedCopy | null, serverContent: unknown): RestorePlan {
  if (!copy) return { action: "none" };
  const server = contentHash(serverContent);
  if (contentHash(copy.blocks) === server) return { action: "none" };
  if (copy.base === server) return { action: "restore", copy };
  return { action: "conflict", copy };
}

/** Backoff between retries of a failed save: 2 s, 4 s, 8 s … capped at 30 s. */
export function retryDelay(attempt: number): number {
  return Math.min(2000 * 2 ** Math.max(0, attempt), 30_000);
}

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

export interface NoteSaverOptions {
  noteId: string;
  /** The content the server holds when the note opens. */
  serverContent: unknown;
  /** Sends one save; resolves true only when the server confirmed it. May throw. */
  send: (blocks: AnyBlock[], plainText: string) => Promise<boolean>;
  onStatus: (s: SaveStatus) => void;
  /** Called after a confirmed save with what was saved. */
  onSaved?: (blocks: AnyBlock[], ok: boolean) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/** The note page's save loop: copy first, send, drop the copy on confirmation, retry with
 *  backoff on failure. Sends never overlap — the server applies requests in arrival order, so
 *  two in flight could let an older one land last. While one is in flight only the newest
 *  edit waits behind it (the copy always holds the newest). */
export function createNoteSaver(o: NoteSaverOptions) {
  const now = o.now ?? Date.now;
  const setTimer = o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let base = contentHash(o.serverContent);
  let attempt = 0;
  let timer: unknown = null;
  let disposed = false;
  let inFlight = false;
  let queued: { blocks: AnyBlock[]; plainText: string } | null = null;

  const stopRetry = () => { if (timer !== null) { clearTimer(timer); timer = null; } };
  const nextAt = () => Math.max(now(), (readCopy(o.noteId)?.at ?? 0) + 1);

  // A save after dispose() still runs (the editor flushes its last edit as the page unmounts);
  // dispose only stops the retries.
  async function save(blocks: AnyBlock[], plainText: string): Promise<void> {
    stopRetry();
    const at = nextAt();
    keepCopy(o.noteId, { blocks, plainText, base, at });
    if (inFlight) { queued = { blocks, plainText }; return; }
    inFlight = true;
    o.onStatus("saving");
    let ok = false;
    try { ok = await o.send(blocks, plainText); } catch { ok = false; }
    inFlight = false;
    if (ok) {
      base = contentHash(blocks);
      dropCopy(o.noteId, at);
    }
    o.onSaved?.(blocks, ok);
    if (queued) { // sent even after dispose(): it is the page's last edit
      const q = queued;
      queued = null;
      return save(q.blocks, q.plainText);
    }
    if (disposed) return;
    if (ok) {
      attempt = 0;
      o.onStatus("saved");
    } else {
      o.onStatus("failed");
      timer = setTimer(() => { timer = null; void retryNow(); }, retryDelay(attempt++));
    }
  }

  /** Re-send the kept copy now (the browser came back online, or the retry timer fired). */
  async function retryNow(): Promise<void> {
    const c = readCopy(o.noteId);
    if (c && !disposed) await save(c.blocks, c.plainText);
  }

  /** Write the current document as the copy without sending (the tab is closing). */
  function keepNow(blocks: AnyBlock[], plainText: string): void {
    keepCopy(o.noteId, { blocks, plainText, base, at: nextAt() });
  }

  function dispose(): void { disposed = true; stopRetry(); }

  return { save, retryNow, keepNow, dispose, hasPending: () => readCopy(o.noteId) !== null };
}
