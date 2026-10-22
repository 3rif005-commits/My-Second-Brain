// The clickable transcript under a video (ArtCraft study item 9, after filmcraft's transcript
// panel): lines carry their start time; the creator's chapters sit between them as headings.

export type TranscriptLine = [number, string];
/** A creator's YouTube chapter or an uploaded file's own chapter mark (which has a picture). */
export interface Chapter { start: number; title: string; thumb_url?: string }
export type TranscriptRow =
  | { kind: "chapter"; start: number; title: string; thumb?: string }
  | { kind: "line"; start: number; text: string; index: number };

/** Index of the line being spoken at `t` (the last line starting at or before it), or -1. */
export function activeLine(lines: TranscriptLine[], t: number): number {
  let lo = 0, hi = lines.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid][0] <= t + 0.25) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** Lines with each chapter heading placed before the first line at or after its start;
 *  chapters after the last line (or with no transcript at all) come at the end. */
export function transcriptRows(lines: TranscriptLine[], chapters: Chapter[] = []): TranscriptRow[] {
  const ch = [...chapters].sort((a, b) => a.start - b.start);
  const rows: TranscriptRow[] = [];
  let c = 0;
  const chapterRow = (x: Chapter): TranscriptRow => ({ kind: "chapter", start: x.start, title: x.title, thumb: x.thumb_url });
  lines.forEach(([start, text], index) => {
    while (c < ch.length && ch[c].start <= start + 1) rows.push(chapterRow(ch[c++]));
    rows.push({ kind: "line", start, text, index });
  });
  while (c < ch.length) rows.push(chapterRow(ch[c++]));
  return rows;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

/** Transcript lines from a source's meta, or [] when it has none or they're malformed. */
export function readTranscript(meta: Record<string, unknown> | undefined): { lines: TranscriptLine[]; chapters: Chapter[] } {
  const raw = Array.isArray(meta?.transcript) ? (meta!.transcript as unknown[]) : [];
  const lines = raw.filter((l): l is TranscriptLine =>
    Array.isArray(l) && typeof l[0] === "number" && typeof l[1] === "string");
  const rawCh = Array.isArray(meta?.chapters) ? (meta!.chapters as unknown[]) : [];
  const chapters = rawCh
    .filter((c): c is Chapter =>
      !!c && typeof (c as Chapter).start === "number" && typeof (c as Chapter).title === "string")
    .map(({ start, title, thumb_url }) =>
      (typeof thumb_url === "string" && /^https?:\/\//.test(thumb_url) ? { start, title, thumb_url } : { start, title }));
  return { lines, chapters };
}
