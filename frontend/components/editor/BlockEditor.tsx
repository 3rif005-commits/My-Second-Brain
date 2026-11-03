"use client";

import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useMemo } from "react";
import { useCreateBlockNote, BlockNoteContext, SuggestionMenuController, getDefaultReactSlashMenuItems, useBlockNoteEditor, useExtension, SideMenuController, SideMenu, TableHandlesController, TableHandle } from "@blocknote/react";
import { NotionBlockMenu, NotionTableHandleMenu } from "./notionMenus";
import type { DefaultReactSuggestionItem } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { AIExtension, AIMenuController } from "@blocknote/xl-ai";
// @ts-ignore — ClientSideTransport + fetchViaProxy + getAISlashMenuItems exist in runtime bundle but omitted from index.d.ts
import { ClientSideTransport, fetchViaProxy, getAISlashMenuItems } from "@blocknote/xl-ai";
import { createOpenAI } from "@ai-sdk/openai";
// @ts-ignore — locales subpath has types but upstream types may not be picked up
import { en as coreEn } from "@blocknote/core/locales";
// @ts-ignore — locales subpath export
import { en as aiEn } from "@blocknote/xl-ai/locales";
import { multiColumnDropCursor, getMultiColumnSlashMenuItems, locales as multiColumnLocales } from "@blocknote/xl-multi-column";
import { useTheme } from "@/app/providers";
import { Sparkles } from "lucide-react";
import { insertMathBlock, insertCalloutBlock } from "./customBlocks";
import { restoreUnknown } from "./unknownBlocks";
import {
  extractCalloutChildren, attachCalloutChildren, inlineMathInTableCells,
  mergeRedundantToggleHeadings,
} from "./calloutChildren";
import { insertionTarget } from "./insertAtCursor";
import { NoteFormattingToolbar } from "./inlineToolbar";
import { SkillAIMenu } from "./selectionSkills";
import { transformNotionHtml } from "./notionPaste";
import { readNotionJson, notionJsonToBlocks } from "./notionBlocks";
import { NoteIdContext } from "./noteIdContext";
import { NotionBlockSelection, selectedBlockIds } from "./blockSelectionExtension";
import { modelFileFrom, modelTitle, uploadModel } from "@/lib/modelDrop";
import { useToast } from "@/app/providers";
import { freshFileUrl } from "@/lib/freshFileUrl";
import { insertDatabaseBlock } from "../database/DatabaseBlock";
import { insertButtonBlock } from "../database/ButtonBlock";
import { insertInteractiveBlock } from "./InteractiveBlock";

// The note schema lives in noteSchema.tsx: the citation hover card renders
// blocks with it too, without pulling this editor's AI bundle into chat.
import { multiColSchema, sanitizeBlocks } from "./noteSchema";

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

// The editor theme points at the Notion tokens (app/tokens.css), so the same object
// is right in light and dark: the CSS variables switch, not the theme. Text and
// highlight colours are Notion's BLOCK palette (blocks.md §3).
const BLOCK_HUES = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
const notionTheme = {
  colors: {
    editor: { background: "var(--c-bg)", text: "var(--c-text)" },
    menu: { background: "var(--c-bg-elevated)", text: "var(--c-text)" },
    tooltip: { background: "var(--c-bg-tooltip)", text: "var(--c-text-on-tooltip)" },
    hovered: { background: "var(--c-bg-hover)", text: "var(--c-text)" },
    selected: { background: "var(--c-bg-selected)", text: "var(--c-text)" },
    disabled: { background: "var(--c-bg-field)", text: "var(--c-text-disabled)" },
    shadow: "var(--c-border)",
    border: "var(--c-border)",
    sideMenu: "var(--c-icon-subtle)",
    highlights: Object.fromEntries(
      BLOCK_HUES.map((h) => [h, { text: `var(--blk-${h}-text)`, background: `var(--blk-${h}-bg)` }]),
    ) as Record<(typeof BLOCK_HUES)[number], { text: string; background: string }>,
  },
  borderRadius: 6,
  fontFamily: "var(--font-ui)",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

// Cmd+K with text selected inside the editor → open inline AI.
// Cmd+K with no selection → falls through to BrainLayoutClient's bubble-phase
// handler, which opens and focuses the app's AI panel.
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

// A block's OWN toggle control — never a descendant's: BlockNote renders a
// block's children in a sibling `.bn-block-group`, so anchoring on the block's
// own `.bn-block-content` (directly, or inside the `.react-renderer` wrapper
// custom React blocks add) cannot reach a nested toggle. Used by scrollToBlock
// to open collapsed toggles around a deep-linked block.
const TOGGLE_WRAPPER_OF_BLOCK =
  ":scope > .bn-block-content .bn-toggle-wrapper, :scope > .react-renderer > .bn-block-content .bn-toggle-wrapper";
const TOGGLE_BUTTON_OF_BLOCK =
  ":scope > .bn-block-content .bn-toggle-button, :scope > .react-renderer > .bn-block-content .bn-toggle-button";

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
  /** Parse Markdown and append it at the end; returns the blocks that landed.
   *  For callers (plugins, agents) that write headings, lists and code fences
   *  without knowing the block schema. */
  insertMarkdownAtEnd: (markdown: string) => Promise<AnyBlock[]>;
  /** Swap the whole document for this HTML and save — a draft going into an
   *  empty note, where appending would leave an empty line above the title. */
  replaceWithHtml: (html: string) => Promise<AnyBlock[]>;
  /** Ids of the top-level blocks currently in the document. Used to prune
   *  anchors whose block the user has since deleted. */
  blockIds: () => string[];
  /** The WHOLE document. `insertHtmlAtEnd` resolves with only the blocks it
   *  appended, so a caller that needs to persist the result must read the full
   *  document from here — saving the returned slice would replace the note with
   *  just the appended part. */
  getDocument: () => AnyBlock[];
  /** Replace the whole document with these blocks — how a draft is undone. */
  replaceDocument: (blocks: AnyBlock[]) => void;
}

export type InteractiveView = "preview" | "code" | "split";
export interface InteractiveBlock {
  title: string;
  html: string;
  /** exported picture, data URL */
  snapshot?: string;
  /** what the block shows: the result, the code, or both (Notion's Mermaid block) */
  view?: InteractiveView;
  wrap?: boolean;
  /** share of the page column, 1 = full width */
  width?: number;
  /** px, for window-filling content only; 0 = default from the width */
  height?: number;
}


interface BlockEditorProps {
  noteId: string;
  initialContent: AnyBlock[] | undefined;
  onSave?: (blocks: AnyBlock[], plainText: string) => void;
  /** Raw HTML from the ingest pipeline — parsed to blocks and applied on mount. */
  ingestHtml?: string;
  /** Called once after ingestHtml has been parsed and applied (workspace anchors). */
  onBlocksApplied?: (blocks: AnyBlock[]) => void;
  /** Fires on every editor change, before the debounced save — lets a consumer
   *  know the document is dirty while autosave is still pending. */
  onDirty?: () => void;
  /** Extra slash-menu entries supplied by whoever is hosting the editor.
   *  Kept generic on purpose: the workspace injects its skills here, and the
   *  editor stays unaware that skills exist. */
  extraSlashItems?: ExtraSlashItem[];
}

export interface ExtraSlashItem {
  title: string;
  group: string;
  subtext?: string;
  aliases?: string[];
  icon?: string;
  onItemClick: () => void;
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
  function BlockEditorComponent({ noteId: _noteId, initialContent, onSave, ingestHtml, onBlocksApplied, onDirty, extraSlashItems }, ref) {
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastUserBlockRef = useRef<string | null>(null);
    const { resolvedTheme } = useTheme();
    const onDirtyRef = useRef(onDirty);
    onDirtyRef.current = onDirty;

    const inlineTransport = useMemo(
      () =>
        new ClientSideTransport({
          // `.chat(...)`, not `(...)`: calling the provider directly selects
          // OpenAI's Responses API (`input: [...]`), and /agent/inline
          // forwards to chat/completions, which answered every editor AI
          // request with 400 "specify prompt or messages" — found live when
          // stock "Improve Writing" wrote nothing. The model id is ignored:
          // the backend runs the user's Fast routing slot (agent_inline.py).
          model: createOpenAI({
            apiKey: "x",
            fetch: fetchViaProxy(
              (_url: string) => `/api/ai/blocknote?noteId=${encodeURIComponent(_noteId)}`
            ),
          }).chat("gpt-4o"),
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
        // NotionBlockSelection: blocks as selectable units (Esc, Ctrl+A twice,
        // ↑/↓, Shift+↑/↓, drag from the margin…) — see blockSelection.ts.
        extensions: [AIExtension({ transport: inlineTransport }), NotionBlockSelection()],
        // Pictures captured into a note used to carry a 24-hour link (ledger B2): swap an old link to our own
        // storage for a fresh one when it is shown. Stored content is untouched.
        resolveFileUrl: freshFileUrl,
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
          // With blocks selected (block mode), the paste goes right after them;
          // otherwise after the block holding the caret.
          const selectedIds = selectedBlockIds(editor);
          const pasteAfter = (): string | undefined =>
            selectedIds[selectedIds.length - 1] ?? editor.getTextCursorPosition()?.block?.id;
          (async () => {
            try {
              // Preferred path: Notion's JSON says outright whether a block is
              // a toggle or a bullet, whether a heading is toggleable, and what
              // colour and emoji a callout has — none of which survive into the
              // `text/html` the fallback below has to parse. See notionBlocks.ts.
              if (notionJson) {
                const fromJson = notionJsonToBlocks(notionJson);
                if (fromJson && fromJson.length > 0) {
                  const after = pasteAfter();
                  if (after) editor.insertBlocks(fromJson, after, "after");
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
              const after = pasteAfter();
              if (after) editor.insertBlocks(parsed, after, "after");
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
                const after = pasteAfter();
                if (after) editor.insertBlocks(rawParsed, after, "after");
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

    // Every save goes through here: placeholders become their original blocks
    // again, so a block this editor can't show is never lost on save.
    const persist = (blocks: AnyBlock[]) => {
      const stored = restoreUnknown(blocks);
      onSave?.(stored, getPlainText(stored));
    };

    // A generated draft → blocks, with the callout bodies BlockNote's own
    // parser would drop (see calloutChildren.ts).
    const parseDraftHtml = async (html: string): Promise<AnyBlock[]> => {
      const doc = new window.DOMParser().parseFromString(html, "text/html");
      const { strippedHtml, calloutChildren } = await extractCalloutChildren(
        mergeRedundantToggleHeadings(inlineMathInTableCells(doc.body.innerHTML)),
        async (h: string) => (await editor.tryParseHTMLToBlocks(h)) as AnyBlock[]
      );
      const rawParsed = await editor.tryParseHTMLToBlocks(strippedHtml);
      return attachCalloutChildren(rawParsed as AnyBlock[], calloutChildren);
    };

    useImperativeHandle(ref, () => ({
      // Callers save what this returns, so it is the stored form.
      getDocument() {
        return restoreUnknown(editor.document as AnyBlock[]);
      },
      replaceDocument(blocks: AnyBlock[]) {
        // An empty note is one empty paragraph: replaceBlocks with nothing
        // would leave BlockNote without a block to put the cursor in.
        const safe = sanitizeBlocks(blocks);
        editor.replaceBlocks(editor.document,
          safe.length ? safe : [{ type: "paragraph" }] as AnyBlock[]);
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
        const found = editor.domElement?.querySelector(`[data-id="${blockId}"]`) as HTMLElement | null;
        if (!found) return;
        const el: HTMLElement = found;

        // A block nested inside a COLLAPSED toggle — a toggle heading or a
        // toggle list item — is in the DOM but under a `display:none` group:
        // BlockNote hides a block's `.bn-block-group` while its toggle wrapper
        // says `data-show-children="false"`. scrollIntoView on it does nothing
        // and the highlight below measures 0x0, so a citation to it "only
        // opened the page". Live-found on a bullet inside a collapsed toggle.
        //
        // Open each collapsed ancestor, outermost first, by clicking BlockNote's
        // own toggle button: the same path as a user's click, which BlockNote
        // keeps as UI state in localStorage and which never rewrites the note
        // (verified live: updated_at unchanged, no save). Not by setting
        // `data-show-children` ourselves — that attribute is on a node view
        // ProseMirror manages, the same trap the highlight below avoids.
        const collapsed: HTMLElement[] = [];
        for (let a: HTMLElement | null = el.parentElement; a && a !== editor.domElement; a = a.parentElement) {
          if (!a.classList.contains("bn-block")) continue;
          const wrapper = a.querySelector(TOGGLE_WRAPPER_OF_BLOCK);
          if (wrapper?.getAttribute("data-show-children") === "false") collapsed.push(a);
        }
        for (const block of collapsed.reverse()) {
          block.querySelector<HTMLElement>(TOGGLE_BUTTON_OF_BLOCK)?.click();
        }

        const revealAndHighlight = () => {
          el.scrollIntoView({ behavior: "smooth", block: "center" });

          // Not a direct style write on `el`: ProseMirror keeps its own
          // MutationObserver on this subtree (to catch spellcheck/IME edits it
          // didn't make itself) and, live-verified, treats ANY externally-applied
          // inline style the same way — discarding it by re-rendering the node
          // from its own state within the same tick, regardless of focus or how
          // long after mount it runs. A fixed-position overlay tracking the
          // block's own rect sits outside ProseMirror's tracked tree entirely, so
          // there is nothing for it to "fix" back.
          const overlay = document.createElement("div");
          overlay.setAttribute("aria-hidden", "true");
          overlay.dataset.blockHighlight = blockId;
          overlay.style.cssText =
            "position:fixed;pointer-events:none;z-index:40;border-radius:4px;" +
            "background-color:rgb(var(--accent-500) / 0.18);transition:background-color 0.4s;";
          document.body.appendChild(overlay);

          function place() {
            const rect = el!.getBoundingClientRect();
            overlay.style.left = `${rect.left}px`;
            overlay.style.top = `${rect.top}px`;
            overlay.style.width = `${rect.width}px`;
            overlay.style.height = `${rect.height}px`;
          }
          place();

          // Tracks the block through the smooth-scroll animation triggered
          // above; stops itself the instant the fade starts, well before the
          // 1400ms mark, so it can never spin longer than the highlight itself.
          let raf = requestAnimationFrame(function track() {
            place();
            raf = requestAnimationFrame(track);
          });

          setTimeout(() => {
            cancelAnimationFrame(raf);
            overlay.style.backgroundColor = "transparent";
            setTimeout(() => overlay.remove(), 400);
          }, 1000);
        };

        if (collapsed.length === 0) {
          revealAndHighlight();
          return;
        }
        // Opening is a React state change, so the children only get a box on a
        // later frame. Poll layout until the block has one — reading only,
        // never writing to the editor, and bounded, so an id that somehow never
        // renders gives up quietly instead of spinning.
        const started = performance.now();
        const waitForBox = () => {
          if (el.getBoundingClientRect().height > 0) return revealAndHighlight();
          if (performance.now() - started < 1500) requestAnimationFrame(waitForBox);
        };
        requestAnimationFrame(waitForBox);
      },
      async replaceWithHtml(html: string) {
        const parsed = await parseDraftHtml(html);
        editor.replaceBlocks(editor.document, parsed);
        const now = editor.document as AnyBlock[];
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
        persist(now);
        return now;
      },
      async insertHtmlAtEnd(html: string) {
        const parsed = await parseDraftHtml(html);
        const before = (editor.document as AnyBlock[]).length;
        const last = (editor.document as AnyBlock[])[before - 1];
        if (last) editor.insertBlocks(parsed, last.id, "after");
        else editor.replaceBlocks(editor.document, parsed);
        const now = editor.document as AnyBlock[];
        const added = last ? now.slice(before) : now;
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
        persist(now);
        return added;
      },
      async insertMarkdownAtEnd(markdown: string) {
        const parsed = (await editor.tryParseMarkdownToBlocks(markdown)) as AnyBlock[];
        if (!parsed.length) return [];
        // Same insert-after-last / replace-empty-doc shape as insertHtmlAtEnd.
        const before = (editor.document as AnyBlock[]).length;
        const last = (editor.document as AnyBlock[])[before - 1];
        if (last) editor.insertBlocks(parsed, last.id, "after");
        else editor.replaceBlocks(editor.document, parsed);
        const now = editor.document as AnyBlock[];
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
        persist(now);
        return last ? now.slice(before) : now;
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
      persist(editor.document as AnyBlock[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor, onSave]);

    // 2-second debounced auto-save on every content change
    useEffect(() => {
      const unsubscribe = editor.onChange(() => {
        onDirtyRef.current?.();
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
        saveTimer.current = setTimeout(() => { saveTimer.current = null; save(); }, 2000);
      });
      return () => {
        unsubscribe();
        // Leaving the note inside the 2 s debounce: save now instead of dropping the edit.
        if (saveTimer.current) {
          clearTimeout(saveTimer.current);
          saveTimer.current = null;
          save();
        }
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
        const blocks = [...attachCalloutChildren(rawBlocks as AnyBlock[], calloutChildren),
          // interactive blocks found in the ingest are real blocks of the note now (ledger B1)
          ...interactiveData.map((d) => ({ type: "interactive", props: { title: d.title, html: d.html } }))] as AnyBlock[];
        editor.replaceBlocks(editor.document, blocks);
        if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
        persist(blocks as AnyBlock[]);

        onBlocksApplied?.(blocks as AnyBlock[]);
      })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ingestHtml]);

    // A .glb/.stl dropped anywhere in the note becomes a 3D live block (lib/modelDrop.ts).
    // ProseMirror already accepts drags over the editor, so only the drop is handled here;
    // every other drop goes through untouched.
    const { showToast } = useToast();
    const onDropModel = (e: React.DragEvent) => {
      const file = modelFileFrom(e.dataTransfer);
      if (!file || !_noteId) return;
      e.preventDefault();
      e.stopPropagation();
      showToast(`Uploading ${file.name}…`, "info");
      uploadModel(_noteId, file).then((url) => {
        const block = { type: "interactive", props: { title: modelTitle(file.name), html: url } };
        const target = insertionTarget(editor.document as AnyBlock[], lastUserBlockRef.current);
        if (target) editor.insertBlocks([block] as AnyBlock[], target, "after");
        else editor.replaceBlocks(editor.document, [block] as AnyBlock[]);
      }).catch((err) => showToast(err instanceof Error ? err.message : "Upload failed"));
    };
    return (
      <div className="notion-editor max-w-none" onDropCapture={onDropModel}>
        <NoteIdContext.Provider value={_noteId}>
        {/* BlockNote adds "dark" or "light" as a CLASS on its container from the OS
            colour scheme, and our tokens key off .dark. Without this the editor
            turns its text light on a light page whenever the OS is dark but the
            app theme is light. The context makes it follow the app theme. */}
        <BlockNoteContext.Provider value={{ colorSchemePreference: resolvedTheme }}>
        <BlockNoteView
          editor={editor}
          theme={notionTheme}
          data-color-scheme={resolvedTheme}
          // Disable the built-in slash menu — we render our own custom
          // SuggestionMenuController below. Without this, both menus are active
          // and a mouse-click on our menu's item fails to apply the conversion.
          slashMenu={false}
          // Same arrangement for the inline toolbar: ours (inlineToolbar.tsx)
          // adds the inline `code` style and inline math on top of BlockNote's
          // own items, and replaces the built-in one rather than sitting
          // alongside it.
          formattingToolbar={false}
          // Notion's block menu (⋮⋮) and table row/column menus replace
          // BlockNote's defaults (notionMenus.tsx).
          sideMenu={false}
          tableHandles={false}
        >
          <SideMenuController
            sideMenu={(props) => (
              <SideMenu {...props} dragHandleMenu={() => <NotionBlockMenu noteId={_noteId} />} />
            )}
          />
          <TableHandlesController
            tableHandle={(props) => <TableHandle {...props} tableHandleMenu={NotionTableHandleMenu as never} />}
          />
          {/* Intercepts Cmd/Ctrl+J to open the inline AI menu */}
          <AIKeyboardHandler />

          {/* Inline toolbar — BlockNote's items + inline code + inline math */}
          <NoteFormattingToolbar />

          {/* Slash menu — default items + Interactive block */}
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) => {
              const [defaults, aiItems] = await Promise.all([
                getDefaultReactSlashMenuItems(editor),
                // @ts-ignore — runtime export, not in type definitions
                getAISlashMenuItems(editor),
              ]);
              const hosted = (extraSlashItems ?? []).map((item) => ({
                title: item.title,
                group: item.group,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                icon: <span style={{ fontSize: 16 }}>{item.icon ?? "✨"}</span> as any,
                subtext: item.subtext,
                aliases: item.aliases,
                onItemClick: item.onItemClick,
              }));
              const custom = [{
                title: "Interactive block",
                group: "Interactive",
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                icon: <Sparkles size={18} /> as any,
                subtext: "Ask AI for a quiz, chart, simulation or diagram",
                aliases: ["quiz", "knowledge check", "interactive", "live", "chart", "diagram", "simulation", "disco"],
                // Starts empty and untitled: the block shows its "Ask AI to build something" row.
                onItemClick: () => insertInteractiveBlock(editor, editor.getTextCursorPosition()?.block?.id, { title: "", html: "" }, { replaceEmpty: true }),
              }];
              // Own "Databases" group (rather than folding into "Interactive",
              // which is really about the interactive block above) —
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
                ...hosted, ...defaults, ...aiItems, ...custom,
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

          {/* AI menu — ⌘J or select text to rewrite/explain. With text
              selected, selection-surface skills sit above the defaults. */}
          <AIMenuController aiMenu={SkillAIMenu} />

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
        </BlockNoteContext.Provider>
        </NoteIdContext.Provider>
      </div>
    );
  }
);
