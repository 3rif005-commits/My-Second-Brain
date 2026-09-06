"use client";

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useMemo } from "react";
import { useCreateBlockNote, SuggestionMenuController, getDefaultReactSlashMenuItems, useBlockNoteEditor, useExtension } from "@blocknote/react";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { BlockNoteView, darkDefaultTheme } from "@blocknote/mantine";
import { AIExtension, AIMenuController } from "@blocknote/xl-ai";
// @ts-ignore — ClientSideTransport + fetchViaProxy + getAISlashMenuItems exist in runtime bundle but omitted from index.d.ts
import { ClientSideTransport, fetchViaProxy, getAISlashMenuItems } from "@blocknote/xl-ai";
import { createOpenAI } from "@ai-sdk/openai";
// @ts-ignore — @blocknote/core@0.48.0 ships an empty index.d.ts (upstream bug); runtime exports are fine
import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, createInlineContentSpec } from "@blocknote/core";
// @ts-ignore — locales subpath has types but upstream types may not be picked up
import { en as coreEn } from "@blocknote/core/locales";
// @ts-ignore — locales subpath export
import { en as aiEn } from "@blocknote/xl-ai/locales";
import { withMultiColumn, multiColumnDropCursor, getMultiColumnSlashMenuItems, locales as multiColumnLocales } from "@blocknote/xl-multi-column";
import { useTheme } from "@/app/providers";
import { MathBlockSpec, CheckpointBlockSpec, CalloutBlockSpec, InlineMathSpec, insertMathBlock, insertCalloutBlock } from "./customBlocks";
import {
  extractCalloutChildren, attachCalloutChildren, inlineMathInTableCells,
  mergeRedundantToggleHeadings,
} from "./calloutChildren";
import { insertionTarget } from "./insertAtCursor";
import { NoteFormattingToolbar } from "./inlineToolbar";
import { transformNotionHtml } from "./notionPaste";
import { readNotionJson, notionJsonToBlocks } from "./notionBlocks";
import { NoteIdContext } from "./noteIdContext";
import { DatabaseBlockSpec, insertDatabaseBlock } from "../database/DatabaseBlock";
import { ButtonBlockSpec, insertButtonBlock } from "../database/ButtonBlock";

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
const multiColSchema = withMultiColumn(
  (BlockNoteSchema as any).create({
    blockSpecs: {
      ...defaultBlockSpecs,
      // createReactBlockSpec returns a factory — must be invoked to get the BlockSpec
      math: MathBlockSpec(),
      checkpoint: CheckpointBlockSpec(),
      callout: CalloutBlockSpec(),
      database: DatabaseBlockSpec(),
      button: ButtonBlockSpec(),
    },
    inlineContentSpecs: {
      ...defaultInlineContentSpecs,
      mention: MentionSpec,
      // Mid-sentence `$…$` formulas from a Notion paste — see customBlocks.tsx
      inlineMath: InlineMathSpec,
    },
  })
);

const VALID_BLOCK_TYPES = new Set(Object.keys(multiColSchema.blockSpecs));

// Recursively remove blocks with types unknown to the schema so
// useCreateBlockNote never receives unrecognized content.
function sanitizeBlocks(blocks: AnyBlock[]): AnyBlock[] {
  return blocks
    .filter((b) => b != null && VALID_BLOCK_TYPES.has(b?.type))
    .map((b) => ({ ...b, children: Array.isArray(b.children) ? sanitizeBlocks(b.children) : [] }));
}

/** Reorders slash-menu items so every group's items sit in one contiguous
 *  run, keeping first-appearance order of the groups and of the items inside
 *  each. BlockNote's SuggestionMenu (its own SuggestionMenu.tsx) walks the
 *  flat item list and pushes a group LABEL whenever an item's `group` differs
 *  from the previous item's, keyed on the group name itself — so a group that
 *  appears in two non-adjacent runs renders that label twice under one React
 *  key ("Encountered two children with the same key, `Basic blocks`"), and
 *  React then drops the colliding children, leaving a header with no items
 *  beneath it. Live-reproduced here the moment the multi-column items (whose
 *  own locale files put them in "Basic blocks" — the same group BlockNote's
 *  defaults use at the head of the list) were appended at the end. Doing this
 *  generically means no caller has to hand-order its array to stay safe,
 *  which is the same failure mode the "Databases"/"Buttons" group comments
 *  further down describe from the item-title side. */
function withContiguousGroups<T extends { group?: string }>(items: T[]): T[] {
  const byGroup = new Map<string, T[]>();
  for (const item of items) {
    const key = item.group ?? "";
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(item);
    else byGroup.set(key, [item]);
  }
  // Map preserves insertion order, so groups keep first-appearance order.
  return [...byGroup.values()].flat();
}

// Custom dark theme: editor background matches app's gray-900 (#111827)
// so the editor blends seamlessly instead of showing BlockNote's #1F1F1F
const appDarkTheme = {
  ...darkDefaultTheme,
  colors: {
    ...darkDefaultTheme.colors,
    editor: {
      background: "#111827", // Tailwind gray-900 — matches dark:bg-gray-900
      text: "#e5e7eb",       // Tailwind gray-200
    },
    menu: {
      background: "#1f2937", // gray-800 — slightly lighter for dropdowns/menus
      text: "#e5e7eb",
    },
    tooltip: {
      background: "#1f2937",
      text: "#e5e7eb",
    },
    hovered: {
      background: "#374151", // gray-700
      text: "#f9fafb",
    },
    selected: {
      background: "#4b5563", // gray-600
      text: "#f9fafb",
    },
    border: "#374151",       // gray-700
    sideMenu: "#6b7280",     // gray-500
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

// Cmd+K with text selected inside the editor → open inline AI.
// Cmd+K with no selection → falls through to BrainLayoutClient's bubble-phase
// handler which opens the CommandK chat modal.
//
// Runs in capture phase so stopPropagation() prevents BrainLayoutClient from
// seeing the event when we handle it here.
function AIKeyboardHandler() {
  const editor = useBlockNoteEditor();
  // @ts-ignore — useExtension types require generic constraint satisfied by AIExtension
  const aiExt = useExtension(AIExtension);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "k") return;

      const sel = window.getSelection();
      const selectedText = sel?.toString().trim() ?? "";
      const insideEditor =
        !!selectedText &&
        !!editor.domElement &&
        sel != null &&
        editor.domElement.contains(sel.anchorNode);

      if (!insideEditor) return; // let BrainLayoutClient handle it

      e.preventDefault();
      e.stopPropagation();
      const pos = editor.getTextCursorPosition();
      if (pos?.block) {
        aiExt?.openAIMenuAtBlock(pos.block.id);
      }
    }
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [editor, aiExt]);
  return null;
}

export interface BlockEditorHandle {
  exportMarkdown: (title: string) => Promise<void>;
  /** Append blocks at the end of the document. */
  insertBlocksAtEnd: (blocks: AnyBlock[]) => void;
  /** Insert blocks after the block the user last put their cursor in — the
   *  workspace "send to note" target. Falls back to the end of the document
   *  when the editor has never been focused. */
  insertBlocksAtCursor: (blocks: AnyBlock[]) => void;
  /** Scroll a block into view and flash-highlight it (source→note sync). */
  scrollToBlock: (blockId: string) => void;
  /** Parse HTML and append it at the end; returns the blocks that landed.
   *  Used by workspace synthesis in "append" mode (the `ingestHtml` prop is
   *  the replace path and rewrites the whole document). */
  insertHtmlAtEnd: (html: string) => Promise<AnyBlock[]>;
  /** Ids of the top-level blocks currently in the document. Used to prune
   *  anchors whose block the user has since deleted. */
  blockIds: () => string[];
  /** The WHOLE document. `insertHtmlAtEnd` resolves with only the blocks it
   *  appended, so a caller that needs to persist the result must read the full
   *  document from here — saving the returned slice would replace the note with
   *  just the appended part. */
  getDocument: () => AnyBlock[];
}

export interface InteractiveBlock { title: string; html: string }

const DEFAULT_BLOCK_HTML = `<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
  height:100vh;background:#f8fafc;color:#64748b;font-size:14px;text-align:center;padding:24px}
</style>
<div>
  <div style="font-size:32px;margin-bottom:12px">⚡</div>
  <strong style="color:#6366f1">Interactive Block</strong><br/>
  Switch to <strong>AI</strong> to generate content, or <strong>Code</strong> to paste your own HTML.
</div>`;

interface BlockEditorProps {
  noteId: string;
  initialContent: AnyBlock[] | undefined;
  onSave?: (blocks: AnyBlock[], plainText: string) => void;
  /** Raw HTML from the ingest pipeline — parsed to blocks and applied on mount. */
  ingestHtml?: string;
  /** Called once during ingest with any <div data-type="interactive"> blocks found. */
  onInteractiveBlocks?: (blocks: InteractiveBlock[]) => void;
  /** Called when the user inserts a Knowledge Check via the slash menu. */
  onAddInteractiveBlock?: (block: InteractiveBlock) => void;
  /** Called once after ingestHtml has been parsed and applied (workspace anchors). */
  onBlocksApplied?: (blocks: AnyBlock[]) => void;
  /** Fires on every editor change, before the debounced save — lets a consumer
   *  know the document is dirty while autosave is still pending. */
  onDirty?: () => void;
}

function getPlainText(blocks: AnyBlock[]): string {
  return blocks
    .map((block: AnyBlock) => {
      const inline = Array.isArray(block.content)
        ? block.content
            .map((c: { type: string; text?: string }) =>
              c.type === "text" ? (c.text ?? "") : ""
            )
            .join("")
        : "";
      const childText = block.children?.length ? getPlainText(block.children) : "";
      return [inline, childText].filter(Boolean).join("\n");
    })
    .join("\n");
}

export const BlockEditor = forwardRef<BlockEditorHandle, BlockEditorProps>(
  function BlockEditorComponent({ noteId: _noteId, initialContent, onSave, ingestHtml, onInteractiveBlocks, onAddInteractiveBlock, onBlocksApplied, onDirty }, ref) {
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastUserBlockRef = useRef<string | null>(null);
    const { resolvedTheme } = useTheme();
    const onDirtyRef = useRef(onDirty);
    onDirtyRef.current = onDirty;

    const inlineTransport = useMemo(
      () =>
        new ClientSideTransport({
          model: createOpenAI({
            apiKey: "x",
            fetch: fetchViaProxy(
              (_url: string) => `/api/ai/blocknote?noteId=${encodeURIComponent(_noteId)}`
            ),
          })("gpt-4o"),
        }),
      [_noteId]
    );

    const editor = useCreateBlockNote(
      {
        schema: multiColSchema,
        initialContent: (() => {
          if (!initialContent || initialContent.length === 0) return undefined;
          const safe = sanitizeBlocks(initialContent);
          return safe.length > 0 ? safe : undefined;
        })(),
        extensions: [AIExtension({ transport: inlineTransport })],
        dropCursor: multiColumnDropCursor,
        // Merge the xl-ai locale under the `ai` key so getAIDictionary(editor)
        // works, and the multi-column one under `multi_column` — its
        // getMultiColumnSlashMenuItems (wired into the slash menu below)
        // throws a literal "Multi-column dictionary not found" without it.
        dictionary: { ...coreEn, ai: aiEn, multi_column: multiColumnLocales.en },
        // Paste-from-Notion (and, incidentally, from any other rich source):
        // rewrite the clipboard HTML through notionPaste.ts before handing it
        // to BlockNote's own HTML→block parser, then reattach callout
        // children the same way insertHtmlAtEnd already does (BlockNote's
        // parser can't reconstruct a callout's children from nested markup —
        // see calloutChildren.ts — and that gap applies to live clipboard
        // paste too, not just the ingest/synthesis paths). Any failure here
        // falls back to defaultPasteHandler so a bug in this path degrades to
        // today's paste behavior rather than eating the paste entirely.
        pasteHandler: ({ event, editor, defaultPasteHandler }: AnyBlock) => {
          const html = event.clipboardData?.getData("text/html");
          // Notion's own block tree, when the clipboard carries it. It must be
          // read here, synchronously, while the paste event is still being
          // dispatched — clipboardData is not guaranteed valid afterwards.
          const notionJson = readNotionJson(event.clipboardData);
          if (!html && !notionJson) return defaultPasteHandler();
          (async () => {
            try {
              // Preferred path: Notion's JSON says outright whether a block is
              // a toggle or a bullet, whether a heading is toggleable, and what
              // colour and emoji a callout has — none of which survive into the
              // `text/html` the fallback below has to parse. See notionBlocks.ts.
              if (notionJson) {
                const fromJson = notionJsonToBlocks(notionJson);
                if (fromJson && fromJson.length > 0) {
                  const pos = editor.getTextCursorPosition();
                  if (pos?.block) editor.insertBlocks(fromJson, pos.block.id, "after");
                  else editor.replaceBlocks(editor.document, fromJson);
                  return;
                }
              }
              const transformed = await transformNotionHtml(html ?? "", _noteId);
              // Deliberately not editor.pasteHTML() here — live-tested against
              // the real BlockNoteView (not just jsdom) during this feature's
              // build and found to duplicate content for a `<details>` toggle
              // (both a correct toggleListItem AND a separate flattened-text
              // paragraph came out of one paste). tryParseHTMLToBlocks +
              // manual insertion is the same path insertHtmlAtEnd already uses
              // and doesn't have this bug. Runs extractCalloutChildren
              // unconditionally — it's a no-op when there's no callout div.
              const { strippedHtml, calloutChildren } = await extractCalloutChildren(
                transformed,
                async (h: string) => (await editor.tryParseHTMLToBlocks(h)) as AnyBlock[]
              );
              const rawParsed = await editor.tryParseHTMLToBlocks(strippedHtml);
              const parsed = attachCalloutChildren(rawParsed as AnyBlock[], calloutChildren);
              const pos = editor.getTextCursorPosition();
              if (pos?.block) editor.insertBlocks(parsed, pos.block.id, "after");
              else editor.replaceBlocks(editor.document, parsed);
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("[notionPaste] paste handling failed, falling back:", e);
              // Falls back through the same tryParseHTMLToBlocks + manual
              // insertion path (not editor.pasteHTML(html) or
              // defaultPasteHandler()) for two reasons: (1) pasteHTML is the
              // thing just proven unreliable above, and (2)
              // defaultPasteHandler would re-read event.clipboardData from
              // inside this async callback, after the synchronous paste event
              // has already finished dispatching — browsers don't guarantee
              // that stays valid. `html` (the original, untransformed
              // clipboard HTML) was already captured synchronously above.
              if (!html) return;
              try {
                const rawParsed = await editor.tryParseHTMLToBlocks(html);
                const pos = editor.getTextCursorPosition();
                if (pos?.block) editor.insertBlocks(rawParsed, pos.block.id, "after");
                else editor.replaceBlocks(editor.document, rawParsed);
              } catch (e2) {
                // eslint-disable-next-line no-console
                console.warn("[notionPaste] fallback paste also failed:", e2);
              }
            }
          })();
          return true;
        },
      } as Parameters<typeof useCreateBlockNote>[0]
    );

    useImperativeHandle(ref, () => ({
      getDocument() {
        return editor.document as AnyBlock[];
      },
      async exportMarkdown(title: string) {
        const md = await editor.blocksToMarkdownLossy(editor.document);
        const safeName = title.replace(/[^a-z0-9]/gi, "_").toLowerCase() || "note";
        const blob = new Blob([`# ${title}\n\n${md}`], { type: "text/markdown" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeName}.md`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      },
      insertBlocksAtCursor(blocks: AnyBlock[]) {
        const doc = editor.document as AnyBlock[];
        const target = insertionTarget(doc, lastUserBlockRef.current);
        let inserted: AnyBlock[] | undefined;
        if (target) {
          inserted = editor.insertBlocks(blocks, target, "after") as AnyBlock[];
        } else {
          editor.replaceBlocks(editor.document, blocks);
        }
        // Advance the remembered position to what we just inserted, so sending
        // three things in a row stacks them in order instead of piling all
        // three immediately after the same anchor in reverse.
        const landed = inserted?.[inserted.length - 1];
        if (landed?.id) lastUserBlockRef.current = landed.id;
      },
      insertBlocksAtEnd(blocks: AnyBlock[]) {
        const doc = editor.document as AnyBlock[];
        const last = doc[doc.length - 1];
        if (last) {
          editor.insertBlocks(blocks, last.id, "after");
        } else {
          editor.replaceBlocks(editor.document, blocks);
        }
      },
      scrollToBlock(blockId: string) {
        const el = editor.domElement?.querySelector(`[data-id="${blockId}"]`) as HTMLElement | null;
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.style.transition = "background-color 0.4s";
        el.style.backgroundColor = "rgba(99,102,241,0.18)";
        setTimeout(() => { el.style.backgroundColor = ""; }, 1400);
      },
      async insertHtmlAtEnd(html: string) {
        const doc = new window.DOMParser().parseFromString(html, "text/html");
        const { strippedHtml, calloutChildren } = await extractCalloutChildren(
          mergeRedundantToggleHeadings(inlineMathInTableCells(doc.body.innerHTML)),
          async (h: string) => (await editor.tryParseHTMLToBlocks(h)) as AnyBlock[]
        );
        const rawParsed = await editor.tryParseHTMLToBlocks(strippedHtml);
        const parsed = attachCalloutChildren(rawParsed as AnyBlock[], calloutChildren);
        const before = (editor.document as AnyBlock[]).length;
        const last = (editor.document as AnyBlock[])[before - 1];
        if (last) editor.insertBlocks(parsed, last.id, "after");
        else editor.replaceBlocks(editor.document, parsed);
        const now = editor.document as AnyBlock[];
        const added = last ? now.slice(before) : now;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        onSave?.(now, getPlainText(now));
        return added;
      },
      blockIds() {
        return (editor.document as AnyBlock[]).map((b) => b.id);
      },
    }));

    // The block the user last put their cursor in. Tracked rather than read
    // from `getTextCursorPosition()` at insert time for two reasons: on an
    // editor the user has never focused that call reports the FIRST block (so a
    // naive cursor insert would drop content at the top of the note, which is
    // worse than appending), and by the time "send to note" fires the user is
    // clicking in the SOURCE pane, so the editor is no longer focused. The
    // ProseMirror selection survives that blur; this ref records only positions
    // the user actually established.
    useEffect(() => {
      const unsubscribe = editor.onSelectionChange(() => {
        if (!editor.isFocused()) return;
        const block = editor.getTextCursorPosition()?.block;
        if (block) lastUserBlockRef.current = block.id;
      });
      return unsubscribe;
    }, [editor]);

    const save = useCallback(() => {
      if (!onSave) return;
      const blocks = editor.document as AnyBlock[];
      onSave(blocks, getPlainText(blocks));
    }, [editor, onSave]);

    // 2-second debounced auto-save on every content change
    useEffect(() => {
      const unsubscribe = editor.onChange(() => {
        onDirtyRef.current?.();
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(save, 2000);
      });
      return () => {
        unsubscribe();
        if (saveTimer.current) clearTimeout(saveTimer.current);
      };
    }, [editor, save]);

    // Apply ingested HTML (PDF / URL ingest flow) — runs once when ingestHtml is set
    useEffect(() => {
      if (!ingestHtml || !onSave) return;
      (async () => {
        // Extract <div data-type="interactive"> before BlockNote parsing
        const doc = new window.DOMParser().parseFromString(ingestHtml, "text/html");
        const interactiveDivs = [...doc.querySelectorAll('[data-type="interactive"]')];
        const interactiveData = interactiveDivs.map((el) => ({
          title: el.getAttribute("data-title") || "Knowledge Check",
          html: el.innerHTML,
        }));
        interactiveDivs.forEach((el) => el.remove());

        // Extract callout bodies before parsing — BlockNote's HTML→block
        // conversion can't reconstruct a callout's children from nested markup
        // (see insertHtmlAtEnd above for the same pattern), so without this every
        // callout ingested via PDF/URL would land as an empty shell.
        const { strippedHtml, calloutChildren } = await extractCalloutChildren(
          mergeRedundantToggleHeadings(inlineMathInTableCells(doc.body.innerHTML)),
          async (h: string) => (await editor.tryParseHTMLToBlocks(h)) as AnyBlock[]
        );
        const rawBlocks = await editor.tryParseHTMLToBlocks(strippedHtml);
        const blocks = attachCalloutChildren(rawBlocks as AnyBlock[], calloutChildren);
        editor.replaceBlocks(editor.document, blocks);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        onSave(blocks as AnyBlock[], getPlainText(blocks as AnyBlock[]));

        if (interactiveData.length > 0) onInteractiveBlocks?.(interactiveData);
        onBlocksApplied?.(blocks as AnyBlock[]);
      })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ingestHtml]);

    return (
      <div className="prose max-w-none">
        <NoteIdContext.Provider value={_noteId}>
        <BlockNoteView
          editor={editor}
          theme={resolvedTheme === "dark" ? appDarkTheme : "light"}
          // Disable the built-in slash menu — we render our own custom
          // SuggestionMenuController below. Without this, both menus are active
          // and a mouse-click on our menu's item fails to apply the conversion.
          slashMenu={false}
          // Same arrangement for the inline toolbar: ours (inlineToolbar.tsx)
          // adds the inline `code` style and inline math on top of BlockNote's
          // own items, and replaces the built-in one rather than sitting
          // alongside it.
          formattingToolbar={false}
        >
          {/* Intercepts Cmd/Ctrl+J to open the inline AI menu */}
          <AIKeyboardHandler />

          {/* Inline toolbar — BlockNote's items + inline code + inline math */}
          <NoteFormattingToolbar />

          {/* Slash menu — default items + Knowledge Check */}
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => {
              const [defaults, aiItems] = await Promise.all([
                getDefaultReactSlashMenuItems(editor),
                // @ts-ignore — runtime export, not in type definitions
                getAISlashMenuItems(editor),
              ]);
              const custom = onAddInteractiveBlock
                ? [{
                    title: "Knowledge Check",
                    group: "Interactive",
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    icon: <span style={{ fontSize: 18 }}>⚡</span> as any,
                    subtext: "Sandboxed interactive quiz block",
                    aliases: ["quiz", "interactive", "disco"],
                    onItemClick: () => onAddInteractiveBlock({
                      title: "Knowledge Check",
                      html: DEFAULT_BLOCK_HTML,
                    }),
                  }]
                : [];
              // Own "Databases" group (rather than folding into "Interactive",
              // which is really about the Knowledge Check quiz block above) —
              // a database is a distinct kind of thing from an interactive
              // block, and Notion's own slash menu gives databases their own
              // section too. Plural, deliberately distinct from the item's own
              // "Database" title below: BlockNote's SuggestionMenu renders a
              // group-label element keyed by `group` and each item element
              // keyed by `title` in the same flat list (@blocknote/react's
              // SuggestionMenu.tsx) — a group with exactly one item whose
              // title equals the group name collides on that key ("two
              // children with the same key, `Database`"), corrupting the
              // menu's rendering. Live-reproduced during this task's browser
              // check before this fix.
              const databaseItems = [{
                title: "Database",
                group: "Databases",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                icon: <span style={{ fontSize: 18 }}>🗄️</span> as any,
                subtext: "Embed a new database in this note",
                aliases: ["table", "db"],
                onItemClick: () => {
                  const pos = editor.getTextCursorPosition();
                  insertDatabaseBlock(editor, pos?.block?.id);
                },
              }];
              // Milestone 12 (task-42): own "Buttons" group (plural,
              // deliberately distinct from the item's own "Button" title
              // below) — the exact same key-collision bug the "Databases"
              // group above already hit and fixed once (a group with
              // exactly one item whose title equals the group name
              // collides on BlockNote's own flat-list React key, corrupting
              // the slash menu's rendering; see that fix's commit,
              // `8615748`, and the "Databases" comment just above).
              const buttonItems = [{
                title: "Button",
                group: "Buttons",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                icon: <span style={{ fontSize: 18 }}>⚡</span> as any,
                subtext: "Add a clickable button with its own action chain",
                aliases: ["action", "click"],
                onItemClick: () => {
                  const pos = editor.getTextCursorPosition();
                  insertButtonBlock(editor, pos?.block?.id);
                },
              }];
              // Callout and math are two more custom block types with no
              // slash item of their own — reachable only via paste until
              // now. Sharing one "More blocks" group (rather than each
              // getting its own, as Database/Button do above) is fine here
              // because neither item's title equals that group name, so it
              // doesn't hit the title-equals-group-name key collision the
              // comment above describes. Checkpoint, this app's other custom
              // block type, deliberately has NO item here — it anchors to a
              // specific spot in a specific workspace resource (a video
              // timestamp, a PDF page…), so one inserted blank would have
              // nothing to point at and render as a dead pill (see
              // CheckpointBlockSpec's own "old canvas model" comment in
              // customBlocks.tsx); it's only ever created from a workspace
              // viewer's own "add checkpoint" action.
              const moreBlockItems = [
                {
                  title: "Callout",
                  group: "More blocks",
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  icon: <span style={{ fontSize: 18 }}>💡</span> as any,
                  subtext: "Highlighted block for an aside or a note",
                  aliases: ["note", "aside", "box", "tip", "warning"],
                  onItemClick: () => {
                    const pos = editor.getTextCursorPosition();
                    insertCalloutBlock(editor, pos?.block?.id);
                  },
                },
                {
                  title: "Math Formula",
                  group: "More blocks",
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  icon: <span style={{ fontSize: 18 }}>∑</span> as any,
                  subtext: "Block-level LaTeX, rendered with KaTeX",
                  aliases: ["math", "equation", "latex", "formula"],
                  onItemClick: () => {
                    const pos = editor.getTextCursorPosition();
                    insertMathBlock(editor, pos?.block?.id);
                  },
                },
              ];
              // Column blocks are in the schema (withMultiColumn above) but
              // their own slash items ship separately — without these, "Two
              // columns"/"Three columns" are unreachable from the menu even
              // though the block types exist and paste/drag can produce them.
              const columnItems = getMultiColumnSlashMenuItems(editor);
              const all = withContiguousGroups([
                ...defaults, ...aiItems, ...custom,
                ...databaseItems, ...buttonItems, ...moreBlockItems, ...columnItems,
              ]);
              if (!query) return all;
              const q = query.toLowerCase();
              return all.filter((item) =>
                item.title.toLowerCase().includes(q) ||
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (item as any).aliases?.some((a: string) => a.includes(q))
              );
            }}
          />

          {/* AI menu — ⌘J or select text to rewrite/explain */}
          <AIMenuController />

          {/* @ mention menu */}
          <SuggestionMenuController
            triggerCharacter="@"
            getItems={async (query) => {
              // Empty query → show 8 recent notes; otherwise use search
              const url = query.length >= 1
                ? `/api/notes/search?q=${encodeURIComponent(query)}`
                : `/api/notes`;
              const res = await fetch(url);
              if (!res.ok) return [];
              const all: { id: string; title: string; icon: string }[] = await res.json();
              const notes = (query.length >= 1 ? all : all.slice(0, 8))
                .filter((n) => n.id !== _noteId);

              // BlockNote keys menu items by `title` — deduplicate to avoid React warnings
              const seenTitles = new Set<string>();
              return notes.map((note): DefaultReactSuggestionItem => {
                const base = note.title || "Untitled";
                const title = seenTitles.has(base) ? `${base} (${note.id.slice(0, 6)})` : base;
                seenTitles.add(base);
                return {
                  title,
                  icon: <span>{note.icon || "📄"}</span>,
                  onItemClick: () => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (editor as any).insertInlineContent([
                      { type: "mention", props: { noteId: note.id, noteName: note.title || "Untitled" } },
                      " ",
                    ]);
                  },
                };
              });
            }}
          />
        </BlockNoteView>
        </NoteIdContext.Provider>
      </div>
    );
  }
);
