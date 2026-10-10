"use client";

// The interactive ("Disco") block as a real block of the note (ledger B1). It used to live only in this
// browser's localStorage, so another browser, the tablet, a backup and the Notion mirror never saw it.
// Stored as props {title, html}: the note carries it everywhere the note goes.
import { createReactBlockSpec } from "@blocknote/react";
import { InteractiveBlockCard } from "./InteractiveBlockCard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

export const DEFAULT_INTERACTIVE_HTML = `<div style="font-family:sans-serif;padding:16px">
  <strong style="color:#6366f1">Interactive Block</strong><br/>
  <p>Edit the code, or ask the AI to build something here.</p>
</div>`;

export const InteractiveBlockSpec = createReactBlockSpec(
  {
    type: "interactive",
    propSchema: {
      title: { default: "Knowledge Check" },
      html: { default: DEFAULT_INTERACTIVE_HTML },
    },
    content: "none",
  },
  {
    render: ({ block, editor }: { block: AnyBlock; editor: AnyBlock }) => (
      <div contentEditable={false} className="w-full">
        <InteractiveBlockCard
          index={0}
          block={{ title: block.props.title, html: block.props.html }}
          onUpdate={(_i, updated) => editor.updateBlock(block, { props: { title: updated.title, html: updated.html } })}
          onRemove={() => editor.removeBlocks([block])}
        />
      </div>
    ),
  }
);

/** Insert a new interactive block after `afterBlockId`, or at the end of the document. */
export function insertInteractiveBlock(editor: AnyBlock, afterBlockId: string | undefined, props?: { title: string; html: string }) {
  const nb = { type: "interactive", props: props ?? { title: "Knowledge Check", html: DEFAULT_INTERACTIVE_HTML } };
  const doc = editor.document as AnyBlock[];
  const target = afterBlockId ?? doc[doc.length - 1]?.id;
  if (target) editor.insertBlocks([nb], target, "after");
  else editor.replaceBlocks(editor.document, [nb]);
}

/** What the old localStorage list held. Anything that is not {title, html} text is ignored. */
export function legacyInteractive(raw: string | null): { title: string; html: string }[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    return Array.isArray(list)
      ? list.filter((b) => b && typeof b.html === "string").map((b) => ({ title: typeof b.title === "string" ? b.title : "Knowledge Check", html: b.html }))
      : [];
  } catch { return []; }
}
