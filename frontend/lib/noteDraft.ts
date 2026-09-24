// Handing a generated draft (a /study-guide result…) from the AI side panel to
// a note page. User decision (2026-09-24): skills run from the side panel on
// files attached there; the result is previewed as a card and reaches a note
// only when the user clicks — like Notion AI's Insert / Create page.
//
// Two routes, one shape:
//  - the note is open → an event the note page answers (it applies the draft
//    to its live editor, so autosave cannot overwrite it a second later);
//  - it is not → the draft is staged in sessionStorage and the note page takes
//    it on mount, exactly as if the event had arrived.

export interface NoteDraft {
  noteId: string;
  html: string;
  /** The note's sources in [n] order — how the draft's page anchors resolve. */
  sourceIds: string[];
  /** "replace" fills an EMPTY note; on a note with any text the page appends
   *  instead — the user's words are never replaced by a draft. */
  mode: "replace" | "append";
}

export type UndoOutcome = "undone" | "edited" | "gone";

export const DRAFT_EVENT = "note-draft";
export const UNDO_EVENT = "note-draft-undo";

const key = (noteId: string) => `note-draft-${noteId}`;

export function stageDraft(d: NoteDraft): void {
  try { sessionStorage.setItem(key(d.noteId), JSON.stringify(d)); } catch { /* full or blocked */ }
}

/** Returns the staged draft and clears it, so a remount cannot apply it twice. */
export function takeStagedDraft(noteId: string): NoteDraft | null {
  try {
    const raw = sessionStorage.getItem(key(noteId));
    if (!raw) return null;
    sessionStorage.removeItem(key(noteId));
    return JSON.parse(raw) as NoteDraft;
  } catch { return null; }
}

/** Ask an open note page to apply the draft. The page claims it at once (then
 *  applies); false means no page for that note is open — the caller stages
 *  it and navigates. */
export function offerDraft(d: NoteDraft, waitMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const timer = setTimeout(() => { if (!answered) resolve(false); }, waitMs);
    window.dispatchEvent(new CustomEvent(DRAFT_EVENT, {
      detail: { draft: d, respond: (ok: boolean) => {
        answered = true; clearTimeout(timer); resolve(ok);
      } },
    }));
  });
}

/** Take the last applied draft back out of an open note. "edited" means the
 *  user changed the note since, and the page kept their work. */
export function undoDraft(noteId: string, waitMs = 1500): Promise<UndoOutcome> {
  return new Promise((resolve) => {
    let answered = false;
    const timer = setTimeout(() => { if (!answered) resolve("gone"); }, waitMs);
    window.dispatchEvent(new CustomEvent(UNDO_EVENT, {
      detail: { noteId, respond: (o: UndoOutcome) => {
        answered = true; clearTimeout(timer); resolve(o);
      } },
    }));
  });
}
