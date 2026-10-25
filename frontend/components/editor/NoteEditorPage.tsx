"use client";

import React, { Component, useState, useCallback, useEffect, useMemo, useRef } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Link, Layers, Send, Star, FileDown, FileCode, Printer, Trash2, Globe, Presentation } from "lucide-react";
import { PresentMode } from "./PresentMode";
import { blocksToLatex } from "@/lib/latexExport";
import { registerCommands } from "@/lib/commands";
import type { Note } from "@/lib/types/database";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { TopBar, TopBarButton } from "@/components/shell/TopBar";
import { PageMenu } from "@/components/shell/PageMenu";
import { usePageStyle } from "@/lib/pageStyle";
import { useToast } from "@/app/providers";
import { cx } from "@/components/ui/cx";
import { wsApi } from "@/lib/workspace";
import { getPlainText } from "@/lib/blockText";
import {
  DRAFT_EVENT, UNDO_EVENT, takeStagedDraft, type NoteDraft, type UndoOutcome,
} from "@/lib/noteDraft";
import { anchorRows, readDraftAnchors } from "@/components/workspace/anchorHeadings";
import { hasContent } from "@/components/workspace/sendBlocks";
import { NoteProperties } from "./NoteProperties";
import { DatabaseRowProperties } from "../database/DatabaseRowProperties";
import { BacklinksPanel } from "./BacklinksPanel";
import { useLegacyInteractiveMigration } from "./useLegacyInteractiveMigration";
import { useNotion } from "@/context/NotionContext";
import { NotionChip } from "../notion/NotionChip";
import type { BlockEditorHandle } from "./BlockEditor";
import { createNoteSaver, dropCopy, planRestore, readCopy, type SaveStatus } from "@/lib/unsavedCopy";
import { usePublishNote } from "@/lib/plugins/usePublish";

const EMOJIS = [
  "📄","📝","📋","📌","📍","📎","🔗","📚","📖","📕","📗","📘","📙","🗒️","🗓️",
  "📅","📆","🗃️","🗂️","📁","📂","📊","📈","📉","💡","🎯","⭐","✨","🔥","💎",
  "🏆","🥇","🎖️","🧠","🔬","🔭","🧪","⚗️","⚙️","🛠️","🔑","🔒","🚀","🎨","🎭",
  "🎬","🎵","🎸","🎹","❤️","🧡","💛","💚","💙","💜","🌍","🌱","🌸","🌊","⚡","☀️",
];

// Cast to support forwardRef after dynamic import
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const BlockEditor = dynamic(
  () => import("./BlockEditor").then((m) => m.BlockEditor),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-md bg-surface-field" /> }
) as React.ForwardRefExoticComponent<
  React.ComponentProps<typeof import("./BlockEditor").BlockEditor> &
    React.RefAttributes<BlockEditorHandle>
>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

interface EditorErrorBoundaryProps {
  onClear: () => void;
  children: React.ReactNode;
}
interface EditorErrorBoundaryState { error: Error | null }

class EditorErrorBoundary extends Component<EditorErrorBoundaryProps, EditorErrorBoundaryState> {
  state: EditorErrorBoundaryState = { error: null };
  static getDerivedStateFromError(e: Error) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-gray-500 dark:text-gray-400">
          <p className="text-sm">Note content couldn't be loaded (corrupted block data).</p>
          <button
            onClick={this.props.onClear}
            className="text-xs px-3 py-1.5 rounded-md bg-red-50 text-red-600 hover:bg-red-100 dark:bg-red-900/20 dark:text-red-400 dark:hover:bg-red-900/40 transition-colors"
          >
            Clear content and start fresh
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface NoteEditorPageProps {
  note: Note;
  collectionName?: string;
}

export function NoteEditorPage({ note, collectionName }: NoteEditorPageProps) {
  const router = useRouter();
  const editorRef = useRef<BlockEditorHandle>(null);
  const [title, setTitle] = useState(note.title);
  const [icon, setIcon] = useState(note.icon || "📄");
  const [isPublic, setIsPublic] = useState(note.is_public ?? false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  // Edits this browser never got to the server (lib/unsavedCopy.ts). Decided once, on the
  // client: the server render has no localStorage and reads nothing.
  const [restorePlan] = useState(() => planRestore(readCopy(note.id), note.content));
  const saverRef = useRef<ReturnType<typeof createNoteSaver> | null>(null);
  const dirtyRef = useRef(false);
  const [ingestHtml, setIngestHtml] = useState<string | undefined>();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [favorited, setFavorited] = useState(note.is_favorited ?? false);
  const { style: pageStyle, update: updatePageStyle } = usePageStyle(note.id);
  const { showToast } = useToast();
  const lastPlainRef = useRef<string>(note.content_text ?? "");
  const notion = useNotion();
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [sourceCount, setSourceCount] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reindexDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A note with sources attached can be reopened in the workspace shell — the
  // other half of "how do I get back to a session?" (the first half is the
  // recents strip in the empty shell).
  useEffect(() => {
    wsApi.listSources(note.id)
      .then((rows) => setSourceCount(rows.length))
      .catch(() => setSourceCount(0));
  }, [note.id]);

  useEffect(() => {
    const key = `ingest-pending-${note.id}`;
    const html = sessionStorage.getItem(key);
    if (html) {
      sessionStorage.removeItem(key);
      setIngestHtml(html);
    }
  }, [note.id]);

  // ── drafts from the AI side panel (lib/noteDraft.ts) ─────────────────────
  // A link to one block (/brain/<note>#<block id> — search results, citations,
  // apps connected through MCP) scrolls to it and highlights it. The editor
  // and its blocks render a moment after the page: wait for the block.
  useEffect(() => {
    let cancelled = false;
    async function toHashBlock() {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (!id) return;
      for (let i = 0; i < 60 && !cancelled; i++) {
        if (editorRef.current && document.querySelector(`[data-id="${CSS.escape(id)}"]`)) {
          editorRef.current.scrollToBlock(id);
          return;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    void toHashBlock();
    window.addEventListener("hashchange", toHashBlock);
    return () => { cancelled = true; window.removeEventListener("hashchange", toHashBlock); };
  }, [note.id]);

  // The last applied draft, so Undo can take it back — but only while the
  // document is still exactly what the draft left.
  const lastDraftRef = useRef<{ before: AnyBlock[]; after: string } | null>(null);

  const applyDraft = useCallback(async (d: NoteDraft): Promise<boolean> => {
    // The editor is loaded lazily: a draft staged before navigation waits for it.
    for (let i = 0; i < 100 && !editorRef.current; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const ed = editorRef.current;
    if (!ed) return false;
    const before = ed.getDocument();
    // "replace" is only for an empty note. Checked again here: the note may
    // have been typed into since the panel looked.
    const empty = !hasContent(before);
    const blocks = d.mode === "replace" && empty
      ? await ed.replaceWithHtml(d.html)
      : await ed.insertHtmlAtEnd(d.html);
    lastDraftRef.current = { before, after: JSON.stringify(ed.getDocument()) };
    const rows = anchorRows(blocks, readDraftAnchors(d.html), d.sourceIds);
    if (rows.length) {
      const live = new Set(ed.blockIds());
      const kept = (await wsApi.getAnchors(note.id).catch(() => []))
        .filter((a) => live.has(a.block_id));
      wsApi.putAnchors(note.id, [...kept, ...rows]).catch(() => {});
    }
    wsApi.listSources(note.id).then((r) => setSourceCount(r.length)).catch(() => {});
    return true;
  }, [note.id]);

  useEffect(() => {
    const staged = takeStagedDraft(note.id);
    if (staged) void applyDraft(staged);

    function onDraft(e: Event) {
      const { draft, respond } = (e as CustomEvent<{ draft: NoteDraft; respond: (ok: boolean) => void }>).detail;
      if (draft.noteId !== note.id) return;
      // Claim it at once: the editor may still be loading, and a late answer
      // would make the panel stage it too — applying it twice.
      respond(true);
      void applyDraft(draft);
    }
    function onUndo(e: Event) {
      const { noteId, respond } = (e as CustomEvent<{ noteId: string; respond: (o: UndoOutcome) => void }>).detail;
      if (noteId !== note.id) return;
      const ed = editorRef.current;
      const last = lastDraftRef.current;
      if (!ed || !last) return respond("gone");
      if (JSON.stringify(ed.getDocument()) !== last.after) return respond("edited");
      ed.replaceDocument(last.before);
      lastDraftRef.current = null;
      const doc = ed.getDocument();
      void handleSaveContent(doc, getPlainText(doc));
      respond("undone");
    }
    window.addEventListener(DRAFT_EVENT, onDraft);
    window.addEventListener(UNDO_EVENT, onUndo);
    return () => {
      window.removeEventListener(DRAFT_EVENT, onDraft);
      window.removeEventListener(UNDO_EVENT, onUndo);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, applyDraft]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showMenu]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmojiPicker(false);
      }
    }
    if (showEmojiPicker) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showEmojiPicker]);

  async function persistTitle(val: string) {
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: val }),
    });
    window.dispatchEvent(new Event("notes-changed"));
  }

  async function selectEmoji(emoji: string) {
    setIcon(emoji);
    setShowEmojiPicker(false);
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icon: emoji }),
    });
    window.dispatchEvent(new Event("notes-changed"));
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setTitle(val);
    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
    titleDebounceRef.current = setTimeout(() => persistTitle(val), 600);
  }

  function handleTitleBlur() {
    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
    persistTitle(title);
  }

  // Ledger B1: interactive blocks used to live only in this browser's localStorage. Move any that are here INTO
  // the note (as real blocks); the browser's copy is deleted only after the note, with them, has been saved.
  const afterSave = useLegacyInteractiveMigration(editorRef, note.id);

  // One save loop per note: copy first, send, keep the copy until the server confirms,
  // retry with backoff, never two requests in flight.
  useEffect(() => {
    const saver = createNoteSaver({
      noteId: note.id,
      serverContent: note.content,
      send: async (blocks, plainText) => {
        const res = await fetch(`/api/notes/${note.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: blocks, content_text: plainText }),
        });
        return res.ok;
      },
      onStatus: setSaveStatus,
      onSaved: (blocks, ok) => {
        if (ok) setLastSaved(new Date());
        afterSave(ok, blocks);
      },
    });
    saverRef.current = saver;
    const retry = () => { void saver.retryNow(); };
    // Closing the tab inside the autosave debounce: keep what is on screen.
    const keep = () => {
      const doc = dirtyRef.current ? editorRef.current?.getDocument() : null;
      if (doc) saver.keepNow(doc, getPlainText(doc));
    };
    window.addEventListener("online", retry);
    window.addEventListener("pagehide", keep);
    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("pagehide", keep);
      saver.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // What the browser kept from a session whose save never landed.
  useEffect(() => {
    const at = (c: { at: number }) =>
      new Date(c.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (restorePlan.action === "restore") {
      showToast(`Restored edits from ${at(restorePlan.copy)} that hadn't been saved`, "info");
      void saverRef.current?.save(restorePlan.copy.blocks, restorePlan.copy.plainText);
    } else if (restorePlan.action === "conflict") {
      // Changed on another device since: overwrite nothing, delete nothing unseen.
      showToast(`This note changed elsewhere. Your unsaved edits from ${at(restorePlan.copy)} are kept in this browser.`, "info");
    } else if (readCopy(note.id)) {
      dropCopy(note.id); // it was saved after all
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  const handleSaveContent = useCallback(
    async (blocks: AnyBlock[], plainText: string) => {
      lastPlainRef.current = plainText;
      dirtyRef.current = false;
      await saverRef.current?.save(blocks, plainText);

      // Debounce re-index: fire 30s after last block change
      if (reindexDebounceRef.current) clearTimeout(reindexDebounceRef.current);
      reindexDebounceRef.current = setTimeout(() => {
        fetch("/api/internal/reindex-note", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note_id: note.id }),
        }).catch(() => {
          // silent — reindex is best-effort
        });
      }, 30_000);
    },
    [note.id]
  );

  // Plugins (Settings → Plugins) see this note while it is open. Reads go
  // through the editor handle, so they include edits not yet autosaved. A
  // plugin changing mastery remounts NoteProperties so its chip shows it.
  const [mastery, setMastery] = useState(note.mastery_status);
  const [topics, setTopics] = useState<string[]>(note.topics ?? []);
  const [masteryNonce, setMasteryNonce] = useState(0);
  const pluginNoteState = useMemo(
    () => ({ id: note.id, title, mastery, topics }),
    [note.id, title, mastery, topics],
  );
  usePublishNote(pluginNoteState, {
    getBlocks: () => editorRef.current?.getDocument() ?? null,
    appendMarkdown: async (markdown) => {
      await editorRef.current?.insertMarkdownAtEnd(markdown);
    },
    setMastery: async (status) => {
      const r = await fetch(`/api/notes/${note.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mastery_status: status }),
      });
      if (!r.ok) throw new Error(`Could not save mastery (${r.status})`);
      setMastery(status as Note["mastery_status"]);
      setMasteryNonce((n) => n + 1);
      window.dispatchEvent(new Event("notes-changed"));
    },
  });

  async function confirmDelete() {
    setShowDeleteModal(false);
    await fetch(`/api/notes/${note.id}`, { method: "DELETE" });
    window.dispatchEvent(new Event("notes-changed"));
    router.push("/brain");
    router.refresh();
  }

  async function togglePublic() {
    const next = !isPublic;
    setIsPublic(next);
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_public: next }),
    });
  }

  async function copyShareLink() {
    const url = `${window.location.origin}/share/${note.id}`;
    await navigator.clipboard.writeText(url);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
  }

  async function toggleFavorite() {
    const next = !favorited;
    setFavorited(next);
    await fetch(`/api/notes/${note.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_favorited: next }),
    });
    window.dispatchEvent(new Event("notes-changed"));
  }

  async function copyPageLink() {
    await navigator.clipboard.writeText(`${window.location.origin}/brain/${note.id}`);
    showToast("Copied page link to clipboard", "info");
  }

  function handleExportMarkdown() {
    setShowMenu(false);
    editorRef.current?.exportMarkdown(title || "note");
  }

  function handleExportLatex() {
    setShowMenu(false);
    const doc = editorRef.current?.getDocument();
    if (!doc) return;
    const blob = new Blob([blocksToLatex(title, doc)], { type: "application/x-tex" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${(title || "note").replace(/[^a-z0-9]+/gi, "_").toLowerCase() || "note"}.tex`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function handleExportPdf() {
    setShowMenu(false);
    window.print();
  }

  // The page menu's actions as commands (lib/commands.ts): quick find (⌘P) lists them and
  // anything can run one by id. Through a ref, so the handlers stay current.
  const actionsRef = useRef({ present: () => setPresenting(true), markdown: handleExportMarkdown,
    pdf: handleExportPdf, latex: handleExportLatex });
  actionsRef.current = { present: () => setPresenting(true), markdown: handleExportMarkdown,
    pdf: handleExportPdf, latex: handleExportLatex };
  useEffect(() => registerCommands([
    { id: "note.present", label: "Present this page", keywords: ["slides", "slideshow"], run: () => actionsRef.current.present() },
    { id: "note.export.markdown", label: "Export as Markdown", keywords: ["md", "download"], run: () => actionsRef.current.markdown() },
    { id: "note.export.pdf", label: "Export as PDF", keywords: ["print", "download"], run: () => actionsRef.current.pdf() },
    { id: "note.export.latex", label: "Export as LaTeX", keywords: ["tex", "download"], run: () => actionsRef.current.latex() },
  ]), [note.id]);

  const words = (lastPlainRef.current || "").trim().split(/\s+/).filter(Boolean).length;

  return (
    <>
      <div className="print-scroll flex h-full flex-col bg-surface">
        <TopBar
          crumbs={[
            ...(collectionName ? [{ label: collectionName }] : []),
            { label: title || "Untitled", icon: icon },
          ]}
          meta={saveStatus === "saving" ? "Saving…" : saveStatus === "failed" ? "Not saved — retrying" : ingestHtml && !lastSaved ? "Applying…" : undefined}
        >
          <NotionChip noteId={note.id} />
          {/* Any note can be a study session, sources or not (2026-10-25). */}
          <TopBarButton
            text
            label={sourceCount > 0
              ? `Open this note beside its ${sourceCount} source${sourceCount === 1 ? "" : "s"}`
              : "Study this note in the workspace: add sources, open other notes beside it"}
            onClick={() => router.push(`/brain/workspace/${note.id}`)}
          >
            <Layers size={16} className="text-ink-icon" /> Open in workspace
          </TopBarButton>
          <TopBarButton text label="Share" onClick={() => { void togglePublic().then(() => showToast(isPublic ? "Public link turned off" : "Anyone with the link can view this page", "info")); }}>
            {isPublic ? <Globe size={14} className="text-accent" /> : null}
            Share
          </TopBarButton>
          <TopBarButton label="Copy link" onClick={copyPageLink}>
            <Link />
          </TopBarButton>
          <TopBarButton label={favorited ? "Remove from Favorites" : "Add to Favorites"} onClick={toggleFavorite} active={favorited}>
            <Star fill={favorited ? "currentColor" : "none"} />
          </TopBarButton>
          <PageMenu
            label="Note options"
            style={pageStyle}
            onStyleChange={updatePageStyle}
            sections={[
              [
                { label: "Copy link", icon: <Link />, hint: "Ctrl+Alt+L", onSelect: copyPageLink },
                ...(isPublic ? [{ label: linkCopied ? "Copied!" : "Copy public link", icon: <Globe />, onSelect: copyShareLink }] : []),
                { label: isPublic ? "Stop sharing publicly" : "Share publicly", icon: <Globe />, onSelect: togglePublic },
                { label: "Move to Trash", icon: <Trash2 />, danger: true, onSelect: () => setShowDeleteModal(true) },
              ],
              [
                { label: "Present", icon: <Presentation />, onSelect: () => setPresenting(true) },
                { label: "Export as Markdown", icon: <FileDown />, onSelect: handleExportMarkdown },
                { label: "Export as PDF", icon: <Printer />, onSelect: handleExportPdf },
                { label: "Export as LaTeX", icon: <FileCode />, onSelect: handleExportLatex },
                { label: "Send to Notion…", icon: <Send />, onSelect: () => notion.open({ note_ids: [note.id] }) },
              ],
            ]}
            meta={[
              `${words} word${words === 1 ? "" : "s"}`,
              lastSaved ? `Last saved ${lastSaved.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : `Last edited ${new Date(note.updated_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}`,
            ]}
          />
        </TopBar>

        {/* Scrollable content. The page column is Notion's 720px (or full width with a
            96px gutter); font, Small text and Full width come from the page ⋯ menu. */}
        <div className="print-scroll min-h-0 flex-1 overflow-y-auto bg-surface">
          <div
            data-page-font={pageStyle.font}
            data-small-text={pageStyle.smallText}
            className={cx(
              "notion-page print-content mx-auto w-full pb-[30vh] pt-20",
              pageStyle.fullWidth ? "px-[96px]" : "max-w-[calc(720px+2*96px)] px-6 sm:px-[96px]",
            )}
          >
            {/* Page icon: 78px, Notion's emoji size */}
            <div ref={emojiRef} className="relative mb-1 inline-block">
              <button
                onClick={() => setShowEmojiPicker((v) => !v)}
                title="Change icon"
                className="flex size-[78px] items-center justify-center rounded-md text-[70px] leading-none transition-colors duration-instant hover:bg-surface-hover"
              >
                {icon}
              </button>

              {showEmojiPicker && (
                <div className="no-print absolute left-0 top-full z-40 mt-1 w-[408px] max-w-[90vw] rounded-menu bg-menu-bg p-2 shadow-menu">
                  <div className="grid max-h-60 grid-cols-11 overflow-y-auto">
                    {EMOJIS.map((e) => (
                      <button
                        key={e}
                        onClick={() => selectEmoji(e)}
                        className={cx(
                          "flex size-8 items-center justify-center rounded text-2xl leading-none transition-colors duration-instant hover:bg-surface-hover",
                          e === icon && "bg-surface-active",
                        )}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Editable title: 40px/700 (checklist #80) */}
            <label htmlFor="note-title" className="sr-only">
              Note title
            </label>
            <input
              id="note-title"
              className="notion-page-title mb-2 w-full border-none bg-transparent px-0.5 text-[40px] font-bold leading-[48px] text-ink caret-current outline-none placeholder:text-ink-placeholder"
              value={title}
              onChange={handleTitleChange}
              onBlur={handleTitleBlur}
              placeholder="New page"
            />

            {/* Properties panel */}
            <NoteProperties
              key={masteryNonce}
              note={{ ...note, mastery_status: mastery, topics }}
              onChange={(u) => {
                if (u.mastery_status) setMastery(u.mastery_status);
                if (u.topics) setTopics(u.topics);
              }}
            />

            {/* Database row properties — RowPeek's deferred phase 2, renders
             * nothing for an ordinary note (see DatabaseRowProperties.tsx). */}
            <DatabaseRowProperties noteId={note.id} />

            {/* Block editor */}
            <EditorErrorBoundary
              onClear={() => handleSaveContent([], "").then(() => window.location.reload())}
            >
              <BlockEditor
                ref={editorRef}
                noteId={note.id}
                initialContent={
                  restorePlan.action === "restore"
                    ? restorePlan.copy.blocks
                    : Array.isArray(note.content) && note.content.length > 0
                      ? (note.content as AnyBlock[])
                      : undefined
                }
                onSave={handleSaveContent}
                onDirty={() => { dirtyRef.current = true; }}
                ingestHtml={ingestHtml}
              />
            </EditorErrorBoundary>

            {/* Backlinks — notes that @mention this one */}
            <BacklinksPanel noteId={note.id} />
          </div>
        </div>
      </div>

      {presenting && <PresentMode title={title} onClose={() => setPresenting(false)} />}

      <ConfirmDialog
        open={showDeleteModal}
        title="Move this page to Trash?"
        description="You can restore it from Trash in the sidebar."
        confirmLabel="Move to Trash"
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteModal(false)}
      />
    </>
  );
}
