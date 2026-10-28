"use client";

/**
 * A few blocks of a note, rendered read-only — the body of the citation
 * hover card.
 *
 * A throwaway BlockNote instance, built with `multiColSchema` (the schema the
 * app's notes are actually written with, see noteSchema.tsx) so a callout, a
 * math block, an embedded database or an @mention looks the same here as it
 * does in the note. Modeled on PublicNoteView.tsx, which does the same for a
 * whole shared note, with two differences: the schema (that one uses
 * BlockNote's plain default, which cannot render this app's own block types),
 * and `pointer-events: none`, which keeps the card non-interactive — it can
 * neither take focus nor swallow the click meant for the link beneath it.
 *
 * Deliberately a SEPARATE editor instance, never a write into the live note's
 * editor DOM: BlockNote's ProseMirror view discards external mutations to the
 * nodes it manages (see live-block-anchors.spec.ts for the full story).
 */

import { useId } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { useTheme } from "@/app/providers";
import { NoteIdContext } from "./noteIdContext";
import { multiColSchema, sanitizeBlocks, type AnyBlock } from "./noteSchema";

export interface BlockPreviewProps {
  /** The blocks' own note — a `database`/`button` block reads it from
   *  NoteIdContext to resolve what it points at. */
  noteId: string;
  /** The cited block plus its neighbours, in document order. */
  blocks: AnyBlock[];
  /** Which of `blocks` was cited. That one gets marked; the rest are context. */
  targetIndex: number;
}

/** Escapes an id for use inside a CSS attribute selector. `CSS.escape` is in
 *  every browser that runs this app, but not in jsdom, so there's a fallback
 *  for the unit tests that mount this. */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\\]]/g, "\\$&");
}

export function BlockPreviewBody({ noteId, blocks, targetIndex }: BlockPreviewProps) {
  const { resolvedTheme } = useTheme();
  const scope = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  // Same guard BlockEditor applies to loaded content: a block whose type the
  // schema doesn't know crashes useCreateBlockNote rather than rendering.
  // Sanitizing can drop blocks, so the target is identified by id, not by
  // surviving at the same index.
  const targetId = blocks[targetIndex]?.id as string | undefined;
  const content = sanitizeBlocks(blocks);
  const editor = useCreateBlockNote({
    schema: multiColSchema,
    initialContent: content.length > 0 ? content : undefined,
    // BlockNote gives its editor root `tabindex="0"`. In a card that nobody
    // can click into, that would put a stop in the tab order for no reason.
    // Set through BlockNote's own option rather than by writing the attribute
    // afterwards — the editor root is a ProseMirror-managed node.
    domAttributes: { editor: { tabindex: "-1" } },
  } as Parameters<typeof useCreateBlockNote>[0]);

  return (
    <NoteIdContext.Provider value={noteId}>
      {/* The cited block is marked from a STYLESHEET, not by writing a style
          or a class onto the block itself. BlockNote's ProseMirror view
          discards external mutations to the nodes it manages and re-renders
          them from its own state — the bug that cost work item D a session
          (see live-block-anchors.spec.ts). A rule matching BlockNote's own
          `data-id` attribute touches nothing ProseMirror tracks, so there is
          nothing for it to undo. Scoped to this card's instance so two
          previews can never style each other. */}
      {targetId && (
        <style>{`
          [data-preview-scope="${scope}"] .bn-editor > .bn-block-group > .bn-block-outer[data-id="${cssEscape(targetId)}"] {
            background: rgb(var(--accent-500) / 0.08);
            box-shadow: inset 2px 0 0 rgb(var(--accent-500));
            /* Square on the accent side. An inset bar on a fully rounded band
               follows the corner radius and bends into a bracket at top and
               bottom; a straight rule reads as a deliberate mark. */
            border-radius: 0 6px 6px 0;
            padding-block: 3px;
            /* Bleed into the card's own padding so the mark reads as a band
               across the passage. Padding it inwards instead would indent the
               cited line relative to its neighbours, which makes it look like
               a different kind of block rather than the same prose, marked. */
            margin-inline: -8px;
            padding-inline: 8px;
          }
          .dark [data-preview-scope="${scope}"] .bn-editor > .bn-block-group > .bn-block-outer[data-id="${cssEscape(targetId)}"] {
            background: rgb(var(--accent-400) / 0.16);
            box-shadow: inset 2px 0 0 rgb(var(--accent-400));
          }
          [data-preview-scope="${scope}"] .bn-editor > .bn-block-group > .bn-block-outer:not([data-id="${cssEscape(targetId)}"]) {
            opacity: 0.6;
          }
        `}</style>
      )}
      <div
        data-preview-scope={scope}
        data-target-block={targetId}
        className="bn-block-preview pointer-events-none select-text"
      >
        <BlockNoteView
          editor={editor}
          editable={false}
          slashMenu={false}
          formattingToolbar={false}
          sideMenu={false}
          filePanel={false}
          tableHandles={false}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
        />
      </div>
    </NoteIdContext.Provider>
  );
}
