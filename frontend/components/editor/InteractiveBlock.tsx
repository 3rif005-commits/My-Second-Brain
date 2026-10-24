"use client";

// The interactive ("Disco") block as a real block of the note (ledger B1). It used to live only in this
// browser's localStorage, so another browser, the tablet, a backup and the Notion mirror never saw it.
// Stored as props {title, html}: the note carries it everywhere the note goes.
import { createReactBlockSpec } from "@blocknote/react";
import { InteractiveBlockCard } from "./InteractiveBlockCard";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

import { DEFAULT_INTERACTIVE_HTML } from "@/lib/liveBlock";
import { detectKind } from "@/lib/liveRuntime";
export { DEFAULT_INTERACTIVE_HTML };

export const InteractiveBlockSpec = createReactBlockSpec(
  {
    type: "interactive",
    propSchema: {
      title: { default: "Knowledge Check" },
      html: { default: DEFAULT_INTERACTIVE_HTML },
      snapshot: { default: "" },
      // Like Notion's Mermaid code block: "preview" (the result), "code", or "split" (both).
      view: { default: "preview" },
      wrap: { default: false },
    },
    content: "none",
  },
  {
    render: ({ block, editor }: { block: AnyBlock; editor: AnyBlock }) => (
      <div contentEditable={false} className="w-full">
        <InteractiveBlockCard
          index={0}
          block={{
            title: block.props.title, html: block.props.html, snapshot: block.props.snapshot,
            view: block.props.view, wrap: block.props.wrap,
          }}
          onUpdate={(_i, updated) => editor.updateBlock(block, { props: {
            title: updated.title, html: updated.html,
            // A changed block's old picture is stale; a new export replaces it.
            snapshot: updated.snapshot ?? (updated.html === block.props.html ? block.props.snapshot : ""),
            view: updated.view ?? block.props.view,
            wrap: updated.wrap ?? block.props.wrap,
          } })}
          onRemove={() => editor.removeBlocks([block])}
        />
        {block.props.snapshot && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.props.snapshot} alt={block.props.title} className="print-only max-w-full mt-6" />
        )}
      </div>
    ),
    // What leaves the editor (Export as Markdown, copy): the block's content, not its toolbar.
    // Mermaid stays Mermaid, a 3D model is a link, anything else is named like the LaTeX export.
    toExternalHTML: ({ block }: { block: AnyBlock }) => {
      const { title, html } = block.props as { title: string; html: string };
      const kind = detectKind(html ?? "");
      if (kind === "mermaid") return <pre><code className="language-mermaid">{html.trim()}</code></pre>;
      if (kind === "model") return <p><a href={html.trim()}>{title || "3D model"}</a></p>;
      return <p><em>[Interactive block: {title}]</em></p>;
    },
  }
);

/** Insert a new interactive block after `afterBlockId`, or at the end of the document. With
 *  `replaceEmpty`, an empty paragraph there BECOMES the block (the slash menu: Notion turns
 *  the "/…" line itself into the block instead of leaving it empty above). */
export function insertInteractiveBlock(
  editor: AnyBlock,
  afterBlockId: string | undefined,
  props?: { title: string; html: string },
  { replaceEmpty = false }: { replaceEmpty?: boolean } = {},
) {
  const nb = { type: "interactive", props: props ?? { title: "Knowledge Check", html: DEFAULT_INTERACTIVE_HTML } };
  const doc = editor.document as AnyBlock[];
  const target = afterBlockId ?? doc[doc.length - 1]?.id;
  const block = replaceEmpty && target ? editor.getBlock(target) : undefined;
  const isEmptyParagraph = block?.type === "paragraph" && !(block.content?.length) && !(block.children?.length);
  if (replaceEmpty && isEmptyParagraph) editor.replaceBlocks([block], [nb]);
  else if (target) editor.insertBlocks([nb], target, "after");
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

export type LegacyPlan = { action: "keep" | "clear" | "insert"; fresh: { title: string; html: string }[] };

/** What to do with the browser's old copy. Unreadable data is KEPT (never deleted unseen); an empty or missing
 *  list is cleared; blocks whose html the note already has are not inserted twice. */
export function planLegacyMigration(raw: string | null, doc: AnyBlock[]): LegacyPlan {
  if (raw === null) return { action: "clear", fresh: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return { action: "keep", fresh: [] }; }
  if (!Array.isArray(parsed)) return { action: "keep", fresh: [] };
  const legacy = legacyInteractive(raw);
  if (!legacy.length) return { action: parsed.length ? "keep" : "clear", fresh: [] };
  const have = new Set(doc.filter((b) => b?.type === "interactive").map((b) => b.props?.html));
  const fresh = legacy.filter((b) => !have.has(b.html));
  return { action: fresh.length ? "insert" : "clear", fresh };
}

/** True once EVERY migrated block is in the saved document (an unrelated autosave must not release the old copy). */
export function migrationSaved(pendingHtml: string[], savedBlocks: AnyBlock[]): boolean {
  const saved = new Set(savedBlocks.filter((b) => b?.type === "interactive").map((b) => b.props?.html));
  return pendingHtml.every((h) => saved.has(h));
}
