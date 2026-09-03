"use client";

// The inline ("formatting") toolbar — the menu that appears over selected text.
//
// BlockNote's own default toolbar (its `getFormattingToolbarItems`) covers
// bold / italic / underline / strike, alignment, colour, nesting and links,
// but stops there. Two inline capabilities this app's schema genuinely has
// were unreachable from it:
//
//   code       — a BlockNote default STYLE (its `defaultStyleSpecs` define it,
//                its English dictionary has `formatting_toolbar.code`, and its
//                icon map has an entry) that is simply left out of the default
//                item list. Nothing to build: the stock BasicTextStyleButton
//                renders it once asked for.
//   inlineMath — this app's own inline content spec (customBlocks.tsx). It had
//                no entry point at all outside a Notion paste, so a formula
//                could be pasted but never written.
//
// Everything else the schema supports already has an entry: text and
// background colour share the colour button, links have their own, and
// `mention` is reached by typing "@" rather than from a selection.

import {
  FormattingToolbar,
  FormattingToolbarController,
  getFormattingToolbarItems,
  BasicTextStyleButton,
  useBlockNoteEditor,
  useComponentsContext,
} from "@blocknote/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = any;

/** Replaces the selected text with an inline formula whose LaTeX IS that text
 *  — select `x^2`, click the button, get a rendered formula. Returns false
 *  (changing nothing) when the selection is empty, because an inline formula
 *  is an atom: an empty one would render as nothing and be impossible to
 *  click, so there'd be no way back out of it.
 *
 *  Exported for its own test, and to keep the click handler below a one-liner
 *  — the same reason insertMathBlock/insertCalloutBlock are exported from
 *  customBlocks.tsx. */
export function insertInlineMath(editor: AnyEditor): boolean {
  const latex = stripMathDelimiters((editor.getSelectedText?.() ?? "").trim());
  if (!latex) return false;
  editor.insertInlineContent([{ type: "inlineMath", props: { latex } }]);
  return true;
}

/** Drops the `$…$` (or `$$…$$`) wrapper a selection may carry, so the LaTeX
 *  stored on the node is the formula itself and not the delimiters around it.
 *  Selecting `$x^2$` — the way LaTeX is written in prose, and the exact form
 *  a Notion paste leaves behind when it can't resolve a formula — otherwise
 *  produces a node whose latex is literally `$x^2$`, which KaTeX renders with
 *  stray dollar signs in it. */
function stripMathDelimiters(text: string): string {
  const match = /^\$\$?([\s\S]+?)\$\$?$/.exec(text);
  return (match ? match[1] : text).trim();
}

function InlineMathButton() {
  const editor = useBlockNoteEditor();
  const Components = useComponentsContext()!;

  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      data-test="inlineMath"
      label="Inline math"
      mainTooltip="Inline math"
      secondaryTooltip="Select the LaTeX first, e.g. x^2"
      onClick={() => {
        insertInlineMath(editor);
        editor.focus();
      }}
      icon={<span style={{ fontFamily: "serif", fontStyle: "italic", fontSize: 16 }}>∑</span>}
    />
  );
}

/** This app's formatting toolbar: BlockNote's own items, plus the two above.
 *  Rendered by BlockEditor, which passes `formattingToolbar={false}` to
 *  BlockNoteView so this replaces the built-in one rather than duplicating it
 *  (the same arrangement `slashMenu={false}` already uses there). */
export function NoteFormattingToolbar() {
  return (
    <FormattingToolbarController
      formattingToolbar={() => (
        <FormattingToolbar>
          {getFormattingToolbarItems()}
          <BasicTextStyleButton basicTextStyle="code" />
          <InlineMathButton />
        </FormattingToolbar>
      )}
    />
  );
}
