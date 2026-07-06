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
import { withMultiColumn, multiColumnDropCursor } from "@blocknote/xl-multi-column";
import { useTheme } from "@/app/providers";

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
    blockSpecs: defaultBlockSpecs,
    inlineContentSpecs: { ...defaultInlineContentSpecs, mention: MentionSpec },
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
  function BlockEditorComponent({ noteId: _noteId, initialContent, onSave, ingestHtml, onInteractiveBlocks, onAddInteractiveBlock }, ref) {
    const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { resolvedTheme } = useTheme();

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
        // Merge the xl-ai locale under the `ai` key so getAIDictionary(editor) works
        dictionary: { ...coreEn, ai: aiEn },
      } as Parameters<typeof useCreateBlockNote>[0]
    );

    useImperativeHandle(ref, () => ({
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
    }));

    const save = useCallback(() => {
      if (!onSave) return;
      const blocks = editor.document as AnyBlock[];
      onSave(blocks, getPlainText(blocks));
    }, [editor, onSave]);

    // 2-second debounced auto-save on every content change
    useEffect(() => {
      const unsubscribe = editor.onChange(() => {
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

        const blocks = await editor.tryParseHTMLToBlocks(doc.body.innerHTML);
        editor.replaceBlocks(editor.document, blocks);
        if (saveTimer.current) clearTimeout(saveTimer.current);
        onSave(blocks as AnyBlock[], getPlainText(blocks as AnyBlock[]));

        if (interactiveData.length > 0) onInteractiveBlocks?.(interactiveData);
      })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ingestHtml]);

    return (
      <div className="prose max-w-none">
        <BlockNoteView
          editor={editor}
          theme={resolvedTheme === "dark" ? appDarkTheme : "light"}
          // Disable the built-in slash menu — we render our own custom
          // SuggestionMenuController below. Without this, both menus are active
          // and a mouse-click on our menu's item fails to apply the conversion.
          slashMenu={false}
        >
          {/* Intercepts Cmd/Ctrl+J to open the inline AI menu */}
          <AIKeyboardHandler />

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
              const all = [...defaults, ...aiItems, ...custom];
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
      </div>
    );
  }
);
