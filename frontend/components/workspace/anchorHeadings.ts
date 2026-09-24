import { parseSourceAnchor, type AnchorType, type NoteAnchor } from "@/lib/workspace";

type AnyBlockLike = { id?: string; type: string; props?: { level?: number } };

export function findLevelHeadings<T extends AnyBlockLike>(blocks: T[], level: number): T[] {
  return blocks.filter((b) => b.type === "heading" && (b.props?.level ?? 1) === level);
}

export interface DraftAnchor { sourceIndex: number; type: AnchorType; value: number }

/** A draft's source anchors, read BEFORE BlockNote parsing strips unknown
 *  attributes. One entry per <h3>, null where that heading carried none, so
 *  the zip against the parsed heading blocks stays aligned. */
export function readDraftAnchors(html: string): (DraftAnchor | null)[] {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("h3")).map((h) => {
    const raw = h.getAttribute("data-anchor");
    return raw ? parseSourceAnchor(raw) : null;
  });
}

/** Pin each anchored <h3> of a draft to the heading block it became. Anchors
 *  point at sources by position ([1], [2]…), resolved through `sourceIds`; an
 *  index the model invented pins nothing. */
export function anchorRows(
  blocks: AnyBlockLike[], anchors: (DraftAnchor | null)[], sourceIds: string[],
): NoteAnchor[] {
  const rows: NoteAnchor[] = [];
  findLevelHeadings(blocks, 3).forEach((h, i) => {
    const p = anchors[i];
    const rid = p ? sourceIds[p.sourceIndex - 1] : undefined;
    if (!p || !rid || !h.id) return;
    rows.push({
      block_id: h.id, resource_id: rid, anchor_type: p.type,
      anchor_start: p.value, anchor_end: p.value,
    });
  });
  return rows;
}
