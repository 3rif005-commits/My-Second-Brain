"use client";

// Custom BlockNote blocks used by workspace notes (and available everywhere):
//   math       — KaTeX-rendered LaTeX, click to edit the source
//   checkpoint — deep link to an exact spot in a workspace resource
//                (timestamp for video, page for documents, section for websites)
import { useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug); runtime exports are fine
import { createInlineContentSpec } from "@blocknote/core";
import katex from "katex";
import "katex/dist/katex.min.css";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

function MathRenderer({ latex }: { latex: string }) {
  let html = "";
  let error = false;
  try {
    html = katex.renderToString(latex || "\\text{empty formula}", {
      displayMode: true,
      throwOnError: false,
    });
  } catch {
    error = true;
  }
  if (error) return <code className="text-red-500 text-sm">{latex}</code>;
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MathBlockView({ block, editor }: { block: any; editor: any }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(block.props.latex ?? "");

  if (editing) {
    return (
      <div className="w-full my-1 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/20 p-2">
        <textarea
          autoFocus
          className="w-full bg-transparent font-mono text-sm outline-none resize-y min-h-[48px] text-gray-800 dark:text-gray-200"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              editor.updateBlock(block, { props: { latex: draft } });
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="LaTeX, e.g. \int_0^1 x^2\,dx"
        />
        <div className="flex items-center justify-between mt-1">
          <div className="text-gray-700 dark:text-gray-300 overflow-x-auto">
            <MathRenderer latex={draft} />
          </div>
          <button
            className="text-xs px-2 py-1 rounded bg-indigo-500 text-white hover:bg-indigo-600 shrink-0"
            onClick={() => {
              editor.updateBlock(block, { props: { latex: draft } });
              setEditing(false);
            }}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="w-full my-1 py-1 px-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60 overflow-x-auto text-gray-800 dark:text-gray-200"
      title="Click to edit LaTeX"
      onClick={() => {
        setDraft(block.props.latex ?? "");
        setEditing(true);
      }}
    >
      <MathRenderer latex={block.props.latex ?? ""} />
    </div>
  );
}

export const MathBlockSpec = createReactBlockSpec(
  {
    type: "math",
    propSchema: {
      latex: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => <MathBlockView block={props.block} editor={props.editor} />,
    parse: (element: HTMLElement) => {
      if (element.getAttribute("data-type") !== "math") return undefined;
      // Same defensive pattern as CalloutBlockSpec below: BlockNote auto-maps
      // `data-<kebab-prop>` attributes matching the propSchema onto the block's
      // props AFTER parse() runs, which would silently override whatever parse()
      // returns for any prop whose kebab name is present as a data attribute.
      // `latex` here comes from textContent, not a `data-latex` attribute, so
      // there's no live collision today — but removing `data-type` keeps this
      // element's markup consistent and safe against a future propSchema change.
      element.removeAttribute("data-type");
      return { latex: element.textContent?.trim() || "" };
    },
  }
);

/** Inserts a blank math block right after `afterBlockId` — same
 *  insert-after-cursor, else append-at-the-document's-end pattern as
 *  `insertDatabaseBlock`/`insertButtonBlock` (DatabaseBlock.tsx /
 *  ButtonBlock.tsx). Used by the "/" slash menu, so a formula can be added
 *  the same way any other block is, not just via paste. */
export function insertMathBlock(editor: AnyBlock, afterBlockId: string | undefined) {
  const newBlock = { type: "math", props: { latex: "" } };
  const target = afterBlockId ?? (editor.document as AnyBlock[]).at(-1)?.id;
  if (target) editor.insertBlocks([newBlock], target, "after");
  else editor.replaceBlocks(editor.document, [newBlock]);
}

/** Inline (mid-sentence) math — the counterpart to the block-level `math`
 *  spec above. A Notion paste carries formulas as literal `$…$` text inside a
 *  paragraph's prose, so they can't become their own block without tearing the
 *  sentence in half; they need a genuine INLINE content type. Same
 *  `createInlineContentSpec` pattern as BlockEditor's `mention` spec.
 *
 *  `content: "none"` makes it an atom: the LaTeX lives in the `latex` prop,
 *  not as editable child text, so the rendered formula behaves as one unit.
 *  BlockNote registers a parse rule for `[data-inline-content-type="inlineMath"]`
 *  automatically and maps `data-latex` onto the prop, which is exactly the
 *  markup notionPaste.ts emits — no custom parse function needed. */
export const InlineMathSpec = createInlineContentSpec(
  {
    type: "inlineMath" as const,
    propSchema: {
      latex: { default: "" },
    },
    content: "none",
  },
  {
    // BlockNote calls this as `render(inlineContent, updateInlineContent,
    // editor)`. The second argument replaces THIS node with whatever inline
    // content it's given — used below to write an edited formula back, still
    // as a formula.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render: (inlineContent: any, updateInlineContent?: (content: AnyBlock) => void) => {
      const latex = (inlineContent.props?.latex as string) ?? "";
      const el = document.createElement("span");
      el.className = "inline-math";

      /** Draws the rendered formula. Also the "cancel" path out of editing. */
      const showFormula = () => {
        el.textContent = "";
        try {
          // displayMode false — must sit on the text baseline, not break the line.
          el.innerHTML = katex.renderToString(latex, {
            displayMode: false,
            throwOnError: false,
          });
        } catch {
          // Unparseable LaTeX shows its source rather than vanishing.
          el.textContent = `$${latex}$`;
        }
      };

      // A formula is an atom (`content: "none"`), so it needs its own way in
      // to fix a typo. Clicking opens a small input holding the LaTeX SOURCE,
      // committed with Enter or blur and abandoned with Escape — the block
      // level MathBlockView's click-to-edit, sized for one line of prose.
      //
      // Deliberately NOT "turn the node back into `$…$` text": that looked
      // like editing but was really destruction. One stray click left raw
      // `$x^2$` sitting in the note with nothing marking it as a formula any
      // more, and re-applying the toolbar's ∑ button to it folded the `$`
      // delimiters into the LaTeX itself. The node stays an inlineMath node
      // the whole way through here.
      const openEditor = () => {
        if (!updateInlineContent) return;
        let settled = false;
        el.textContent = "";

        const input = document.createElement("input");
        input.className = "inline-math-input";
        input.value = latex;
        input.setAttribute("aria-label", "LaTeX source");
        // Roughly track the content's width so the line doesn't jump.
        input.size = Math.max(latex.length, 4);
        input.style.font = "inherit";
        input.style.fontFamily = "monospace";
        input.style.color = "inherit";
        input.style.background = "transparent";
        input.style.border = "1px solid currentColor";
        input.style.borderRadius = "3px";
        input.style.padding = "0 2px";

        const commit = () => {
          if (settled) return;
          settled = true;
          const next = input.value.trim();
          // An empty formula would render as nothing and so could never be
          // clicked again — treat clearing the box as "leave it alone".
          if (!next || next === latex) return showFormula();
          updateInlineContent({ type: "inlineMath", props: { latex: next } });
        };

        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            settled = true;
            showFormula();
          }
        });
        input.addEventListener("blur", commit);

        el.appendChild(input);
        input.focus();
        input.select();
      };

      if (updateInlineContent) {
        el.setAttribute("title", "Click to edit LaTeX");
        el.style.cursor = "pointer";
        // The input is a real focusable control inside an atom — keep
        // ProseMirror from treating typing in it as editing the document.
        el.contentEditable = "false";
        el.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!el.querySelector("input")) openEditor();
        });
      } else {
        el.setAttribute("title", latex);
      }

      showFormula();
      return { dom: el };
    },
  }
);

function checkpointHref(p: {
  noteId: string; resourceId: string; anchorType: string; value: string;
}): string {
  const key = p.anchorType === "time" ? "t" : p.anchorType === "page" ? "p" : "s";
  return `/brain/workspace/${p.noteId}?source=${p.resourceId}&${key}=${p.value}`;
}

function fmtAnchor(anchorType: string, value: string): string {
  if (anchorType === "time") {
    const s = Math.floor(Number(value) || 0);
    const mm = Math.floor(s / 60);
    return `${mm}:${String(s % 60).padStart(2, "0")}`;
  }
  if (anchorType === "page") return `p. ${value}`;
  return `§${value}`;
}

export const CheckpointBlockSpec = createReactBlockSpec(
  {
    type: "checkpoint",
    propSchema: {
      noteId: { default: "" },
      // Deprecated: kept in the schema so checkpoint blocks written before the
      // workspaces redesign still parse instead of breaking their note. Such a
      // block has no noteId and renders as a dead pill below.
      workspaceId: { default: "" },
      resourceId: { default: "" },
      anchorType: { default: "time" }, // time | page | section
      value: { default: "0" },
      label: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const p = block.props;
      const body = (
        <>
          <span>{p.anchorType === "time" ? "⏱" : "📍"}</span>
          <span>{p.label || "Checkpoint"}</span>
          <span className="opacity-70">{fmtAnchor(p.anchorType, p.value)}</span>
        </>
      );
      // A checkpoint left behind by the old canvas model has nowhere to link to.
      if (!p.noteId || !p.resourceId) {
        return (
          <span
            title="This checkpoint's source is no longer available"
            className="inline-flex items-center gap-1.5 my-0.5 px-2.5 py-1 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-400 text-xs font-medium"
            contentEditable={false}
          >
            {body}
          </span>
        );
      }
      return (
        <a
          href={checkpointHref(p)}
          className="inline-flex items-center gap-1.5 my-0.5 px-2.5 py-1 rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 text-xs font-medium no-underline hover:bg-amber-100 dark:hover:bg-amber-900/50 transition-colors cursor-pointer"
          contentEditable={false}
        >
          {body}
        </a>
      );
    },
  }
);

export type CalloutType =
  | "OVERVIEW" | "NOTE" | "TIP" | "IMPORTANT" | "WARNING"
  | "CAUTION" | "FORMULA" | "ANALOGY" | "EXAM";

export const CALLOUT_PALETTE: Record<CalloutType, { color: string; icon: string; label: string }> = {
  OVERVIEW:  { color: "blue",   icon: "📋", label: "Overview" },
  NOTE:      { color: "gray",   icon: "ℹ️", label: "Note" },
  TIP:       { color: "green",  icon: "💡", label: "Tip" },
  IMPORTANT: { color: "yellow", icon: "❗", label: "Important" },
  WARNING:   { color: "orange", icon: "⚠️", label: "Warning" },
  CAUTION:   { color: "red",    icon: "🛑", label: "Caution" },
  FORMULA:   { color: "purple", icon: "📐", label: "Formula" },
  ANALOGY:   { color: "brown",  icon: "💭", label: "Analogy" },
  EXAM:      { color: "pink",   icon: "🎯", label: "Exam" },
};

function CalloutBlockView({ block }: { block: any }) {
  const rawType = block.props.calloutType as string;
  const type: CalloutType = rawType in CALLOUT_PALETTE ? (rawType as CalloutType) : "NOTE";
  const { icon, label } = CALLOUT_PALETTE[type];
  // A callout pasted from Notion can carry ANY emoji, not just this app's
  // nine, so the source emoji wins when there is one (see notionPaste.ts).
  const sourceIcon = (block.props.calloutIcon as string) || "";
  // Notion's callout is ONE coloured box with the emoji beside the text and no
  // caption, so that's what this renders: just the icon. The box itself, its
  // colour, and putting the body alongside the icon rather than underneath all
  // live in CSS (app/globals.css), because BlockNote renders a block's children
  // into a SIBLING `.bn-block-group` div that React has no access to from here
  // — the two are joined into one card by a grid on their shared `.bn-block`.
  // `label` stays as the accessible name; it is deliberately not drawn.
  return (
    <span className="callout-icon" contentEditable={false} title={label} aria-label={label}>
      {sourceIcon || icon}
    </span>
  );
}

export const CalloutBlockSpec = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      calloutType: { default: "NOTE" as CalloutType },
      // The source emoji, when a pasted callout used one this app's palette
      // doesn't have. Empty for callouts created in-app — see CalloutBlockView.
      calloutIcon: { default: "" },
    },
    content: "none",
  },
  {
    render: (props) => <CalloutBlockView block={props.block} />,
    parse: (element: HTMLElement) => {
      if (element.getAttribute("data-type") !== "callout") return undefined;
      const raw = element.getAttribute("data-callout-type");
      const rawIcon = element.getAttribute("data-callout-icon") || "";
      // BlockNote auto-maps `data-<kebab-prop>` attributes matching the
      // propSchema (here, `data-callout-type` -> `calloutType`) onto the
      // block's props AFTER this parse() function runs. If left in place,
      // that auto-mapping would silently override whatever we return below
      // with the raw, unvalidated `data-callout-type` value — defeating the
      // unknown-calloutType-falls-back-to-NOTE behavior a few lines down.
      // Removing it here makes our validated return value the final answer.
      element.removeAttribute("data-callout-type");
      element.removeAttribute("data-callout-icon");
      element.removeAttribute("data-type");
      if (!raw || !(raw in CALLOUT_PALETTE)) {
        return { calloutType: "NOTE", calloutIcon: rawIcon };
      }
      return { calloutType: raw as CalloutType, calloutIcon: rawIcon };
    },
  }
);

/** Inserts a blank NOTE-type callout, with one empty paragraph child, right
 *  after `afterBlockId` — same pattern as `insertMathBlock` above. The child
 *  paragraph isn't optional: the callout's own `content` is "none" (see
 *  CalloutBlockView's comment — its box and body live in its children, not
 *  its own content), so without one there'd be nowhere for the user to type
 *  a first line. */
export function insertCalloutBlock(editor: AnyBlock, afterBlockId: string | undefined) {
  const newBlock = {
    type: "callout",
    props: { calloutType: "NOTE", calloutIcon: "" },
    children: [{ type: "paragraph", content: [] }],
  };
  const target = afterBlockId ?? (editor.document as AnyBlock[]).at(-1)?.id;
  const [inserted] = target
    ? editor.insertBlocks([newBlock], target, "after")
    : editor.replaceBlocks(editor.document, [newBlock]).insertedBlocks ?? [];
  // Land the caret in the callout's body so it can be typed into straight
  // away, rather than leaving it behind in the block the "/" was typed in.
  // Same insert-then-position pattern BlockNote's own keyboard shortcuts use
  // (its `let [a] = editor.insertBlocks(…); editor.setTextCursorPosition(a)`).
  // Guarded: the callout's own content is "none", so the caret belongs on its
  // first child, and none of this is worth throwing over if it isn't there.
  const body = inserted?.children?.[0];
  if (body) editor.setTextCursorPosition(body, "start");
}
