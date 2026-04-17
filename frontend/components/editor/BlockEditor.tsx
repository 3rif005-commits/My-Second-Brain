"use client";

import { useEffect, useRef, useCallback } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { AIExtension } from "@blocknote/xl-ai";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

interface BlockEditorProps {
  noteId: string;
  initialContent: AnyBlock[] | undefined;
  onSave?: (blocks: AnyBlock[], plainText: string) => void;
  /** Raw HTML from the ingest pipeline — parsed to blocks and applied on mount. */
  ingestHtml?: string;
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

export function BlockEditor({
  noteId: _noteId,
  initialContent,
  onSave,
  ingestHtml,
}: BlockEditorProps) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useCreateBlockNote(
    {
      initialContent:
        initialContent && initialContent.length > 0 ? initialContent : undefined,
      // AIExtension adds the AI slash-menu and toolbar button.
      // Transport is wired in Phase 3 (context-protocol). The extension is safe
      // to include now — it fails gracefully if the user triggers AI without a
      // transport configured.
      extensions: [AIExtension()],
    } as Parameters<typeof useCreateBlockNote>[0]
  );

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
      const blocks = await editor.tryParseHTMLToBlocks(ingestHtml);
      editor.replaceBlocks(editor.document, blocks);
      // Clear any pending debounced save to avoid a double-write
      if (saveTimer.current) clearTimeout(saveTimer.current);
      onSave(blocks as AnyBlock[], getPlainText(blocks as AnyBlock[]));
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ingestHtml]);

  return (
    <div className="prose max-w-none">
      <BlockNoteView editor={editor} theme="light" />
    </div>
  );
}
