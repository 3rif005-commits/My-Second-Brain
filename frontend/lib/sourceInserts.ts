// What the AI's source tools hand the panel (backend services/agent/source_tools.py):
// one record per inserted thing, keyed by the token the model put in its reply.
// Insert turns each record into the same blocks the source viewer's buttons make.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

export type SourceInsertKind = "quote" | "figure" | "table" | "formula" | "frame" | "clip" | "audio";

export interface SourceInsert {
  token: string;
  kind: SourceInsertKind;
  source_id: string;
  /** The note the source belongs to — where its pill jumps to. */
  note_id: string;
  title: string;
  anchor_type?: "page" | "time" | "section";
  value?: number;
  label?: string;
  url?: string;
  caption?: string;
  latex?: string;
  markdown?: string;
  text?: string;
}

export const TOKEN_RE = /\[\[src:[0-9a-f]{6}\]\]/g;

/** A markdown table → the editor's table block (the viewer's "Send table" too). */
export function markdownTableToBlock(md: string): AnyBlock | null {
  const rows = md.trim().split("\n")
    .map((r) => r.trim())
    .filter((r) => r.startsWith("|"))
    .filter((r) => !/^\|[\s:|-]+\|$/.test(r)) // drop separator row
    .map((r) => r.slice(1, r.endsWith("|") ? -1 : undefined).split("|").map((c) => c.trim()));
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((r) => r.length));
  return {
    type: "table",
    content: {
      type: "tableContent",
      rows: rows.map((cells) => ({
        cells: Array.from({ length: width }, (_, i) => [
          { type: "text", text: cells[i] ?? "", styles: {} },
        ]),
      })),
    },
  };
}

/** The jump-back pill for a place in a source. */
export function pillBlock(p: {
  noteId: string; resourceId: string; anchorType: string; value: number | string; label?: string;
}): AnyBlock {
  return {
    type: "checkpoint",
    props: { noteId: p.noteId, resourceId: p.resourceId, anchorType: p.anchorType,
             value: String(p.value), label: p.label ?? "" },
  };
}

/** The blocks one record becomes. `fallbackNoteId`: for a record without its note. */
export function insertBlocks(r: SourceInsert, fallbackNoteId = ""): AnyBlock[] {
  const noteId = r.note_id || fallbackNoteId;
  const pill = () => (r.anchor_type && r.value !== undefined && noteId && r.source_id
    ? [pillBlock({ noteId, resourceId: r.source_id, anchorType: r.anchor_type, value: r.value,
                   label: r.label })]
    : []);
  switch (r.kind) {
    case "quote": {
      const paras = (r.text ?? "").split("\n\n").map((p) => p.trim()).filter(Boolean);
      return [...paras.map((p) => ({ type: "quote", content: p })), ...pill()];
    }
    case "figure":
    case "frame":
      return r.url ? [{ type: "image", props: { url: r.url, caption: r.caption ?? "" } }, ...pill()] : [];
    case "table": {
      const t = markdownTableToBlock(r.markdown ?? "");
      return t ? [t, ...pill()] : [];
    }
    case "formula":
      return r.latex ? [{ type: "math", props: { latex: r.latex } }] : [];
    case "clip":
      return r.url ? [{ type: "video", props: { url: r.url, caption: r.caption ?? "" } }, ...pill()] : [];
    case "audio":
      return r.url ? [{ type: "audio", props: { url: r.url, caption: r.caption ?? "" } }, ...pill()] : [];
    default:
      return [];
  }
}

/** For the chat bubble: each token shown as what it will become, not as `[[src:…]]`. */
export function previewInserts(md: string, inserts: SourceInsert[] = []): string {
  if (!md.includes("[[src:")) return md;
  const byToken = new Map(inserts.map((r) => [r.token, r]));
  return md.replace(TOKEN_RE, (tok) => {
    const r = byToken.get(tok);
    if (!r) return "";
    const where = r.label ? ` · ${r.label}` : "";
    switch (r.kind) {
      case "figure":
      case "frame":
        return r.url ? `![${(r.caption || r.title).replace(/[[\]]/g, "")}](${r.url})` : "";
      case "quote":
        return `\n\n> ${(r.text ?? "").replace(/\n+/g, " ")}\n>\n> — *${r.title}${where}*\n\n`;
      case "formula":
        return r.latex ? `\n\n$$\n${r.latex}\n$$\n\n` : "";
      case "table":
        return `\n\n${r.markdown ?? ""}\n\n`;
      case "clip":
        return `*▶ Clip from ${r.title}${r.caption ? ` (${r.caption})` : where}*`;
      case "audio":
        return `*♪ Audio from ${r.title}${r.caption ? ` (${r.caption})` : where}*`;
      default:
        return "";
    }
  });
}
