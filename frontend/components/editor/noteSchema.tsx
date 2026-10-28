"use client";

// The BlockNote schema every note is written with: the default blocks plus
// this app's own, the @mention and inline-math inline specs, and columns.
// Shared by the editor and the citation hover card (BlockPreviewBody.tsx),
// which renders a cited passage with it so it looks like the note. Kept out
// of BlockEditor.tsx so the card does not pull in the editor's AI bundle.

// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug); runtime exports are fine
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, createInlineContentSpec } from "@blocknote/core";
import { withMultiColumn } from "@blocknote/xl-multi-column";
import { MathBlockSpec, CheckpointBlockSpec, CalloutBlockSpec, UnknownBlockSpec, InlineMathSpec } from "./customBlocks";
import { wrapUnknown } from "./unknownBlocks";
import { createNotionCodeBlockSpec } from "./codeBlock";
import { DatabaseBlockSpec } from "../database/DatabaseBlock";
import { ButtonBlockSpec } from "../database/ButtonBlock";
import { InteractiveBlockSpec } from "./InteractiveBlock";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyBlock = any;

// Inline @mention — links to another note in the brain
const MentionSpec = createInlineContentSpec(
  {
    type: "mention" as const,
    propSchema: {
      noteId: { default: "" },
      noteName: { default: "" },
    },
    content: "none",
  },
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: (inlineContent: any) => {
      const el = document.createElement("a");
      el.textContent = `@${inlineContent.props.noteName}`;
      el.className = "mention-link";
      el.style.cursor = "pointer";
      el.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.location.href = `/brain/${inlineContent.props.noteId}`;
      });
      return { dom: el };
    },
  }
);

// Extend the full default schema with column/columnList + @mention
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const multiColSchema = withMultiColumn(
  (BlockNoteSchema as any).create({
    blockSpecs: {
      ...defaultBlockSpecs,
      // Syntax colours + Notion's hover pill (language, Copy, Wrap) — see codeBlock.ts
      codeBlock: createNotionCodeBlockSpec(),
      // createReactBlockSpec returns a factory — must be invoked to get the BlockSpec
      math: MathBlockSpec(),
      checkpoint: CheckpointBlockSpec(),
      callout: CalloutBlockSpec(),
      database: DatabaseBlockSpec(),
      button: ButtonBlockSpec(),
      interactive: InteractiveBlockSpec(),
      unknownBlock: UnknownBlockSpec(),
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      mention: MentionSpec,
      // Mid-sentence `$…$` formulas from a Notion paste — see customBlocks.tsx
      inlineMath: InlineMathSpec,
    },
  })
);

export const VALID_BLOCK_TYPES = new Set(Object.keys(multiColSchema.blockSpecs));

// useCreateBlockNote can't hold a block of an unregistered type, so each one is
// swapped for an `unknownBlock` placeholder that keeps the original; `persist`
// below swaps it back before anything is saved (unknownBlocks.ts).
export function sanitizeBlocks(blocks: AnyBlock[]): AnyBlock[] {
  return wrapUnknown(blocks, VALID_BLOCK_TYPES);
}
