"use client";

// The live (interactive) block, built like Notion's Mermaid code block (measured live in
// Notion, 2026-10-24): ONE box in the code-block fill — no frame, no header — showing the
// result ("Preview"), the code ("Code") or both ("Split"), chosen per block. The code is
// edited in place and the preview follows. A pill top-right on hover, in Notion's order:
// Ask AI | view | Expand | Download | Copy | Wrap | ⋯ (Caption, Copy code, Wrap code, Save as
// image, Delete). Caption under the box. The content takes the note's light/dark colours.
// Styles: app/liveBlock.css.

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowUp, Captions, Check, CodeXml, Copy, CornerDownLeft, Download, Ellipsis, Eye,
  LoaderCircle, Rows2, Sparkles, Trash2, ZoomIn,
} from "lucide-react";
import { NoteIdContext } from "./noteIdContext";
import { diagramFromImage, imageFromTransfer, isPlaceholderHtml, liveBlockRequest, stripFences, useFrameHeight } from "@/lib/liveBlock";
import { assetOrigin, buildSrcDoc, detectKind, preflightWarnings, type LiveTheme } from "@/lib/liveRuntime";
import { exportFrameImage, MAX_SNAPSHOT_CHARS } from "@/lib/liveExport";
import { LiveCodeEditor } from "@/components/interactive/LiveCodeEditor";
import { useTheme } from "@/app/providers";
import type { InteractiveBlock, InteractiveView } from "./BlockEditor";

interface Props {
  block: InteractiveBlock;
  index: number;
  onUpdate: (index: number, block: InteractiveBlock) => void;
  onRemove: (index: number) => void;
}

/** How long typing pauses before the code is saved and the preview redrawn. */
export const COMMIT_DELAY_MS = 600;

/** The code view's language: Mermaid source is coloured as Mermaid, a model link is plain. */
export function codeLanguage(code: string): string {
  const kind = detectKind(code);
  return kind === "mermaid" ? "mermaid" : kind === "model" ? "text" : "html";
}

/** Whether the block shows something ⤓ can save (a diagram, chart, canvas or 3D view). */
export function canExportImage(code: string): boolean {
  return detectKind(code) !== "html" || /<canvas|<svg|sbScene/.test(code);
}

// Notion's labels (aria-labels read off its code block).
const VIEWS: { id: InteractiveView; label: string; Icon: typeof Eye }[] = [
  { id: "code", label: "Show only code and hide preview", Icon: CodeXml },
  { id: "preview", label: "Show only preview and hide code", Icon: Eye },
  { id: "split", label: "Show code and preview", Icon: Rows2 },
];

function useOutsideClose(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, ref, close]);
}

export function InteractiveBlockCard({ block, index, onUpdate, onRemove }: Props) {
  const { resolvedTheme } = useTheme();
  const theme: LiveTheme = resolvedTheme === "dark" ? "dark" : "light";
  const [view, setView] = useState<InteractiveView>(block.view ?? "preview");
  const [wrap, setWrap] = useState(!!block.wrap);
  const [title, setTitle] = useState(block.title);
  const [code, setCode] = useState(block.html);
  const [asking, setAsking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [captioning, setCaptioning] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const captionRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sent = useRef(block.html);
  const noteId = useContext(NoteIdContext);

  // The preview shows the SAVED code: it redraws when typing pauses, not on every key.
  const saved = block.html;
  const frameHeight = useFrameHeight(frameRef);
  const srcDoc = useMemo(() => buildSrcDoc(saved, { assetOrigin: assetOrigin(), theme }), [saved, theme]);
  const bigDoc = useMemo(
    () => (expanded ? buildSrcDoc(saved, { assetOrigin: assetOrigin(), theme, fit: true }) : ""),
    [expanded, saved, theme],
  );
  const warnings = useMemo(() => preflightWarnings(saved), [saved]);
  const empty = isPlaceholderHtml(code);
  const showCode = view === "code" || view === "split";
  const showPreview = view === "preview" || view === "split";

  // The block changed from outside (undo, another device, the AI): show it — unless it is
  // just our own save coming back while we type on.
  useEffect(() => {
    if (block.html !== sent.current) { setCode(block.html); sent.current = block.html; }
  }, [block.html]);
  useEffect(() => { setTitle(block.title); }, [block.title]);
  useEffect(() => { if (block.view) setView(block.view); }, [block.view]);
  useEffect(() => { setWrap(!!block.wrap); }, [block.wrap]);

  useEffect(() => { if (asking) promptRef.current?.focus({ preventScroll: true }); }, [asking]);
  useEffect(() => { if (captioning) captionRef.current?.focus({ preventScroll: true }); }, [captioning]);
  useEffect(() => () => { if (commitTimer.current) clearTimeout(commitTimer.current); }, []);

  useOutsideClose(menuOpen, menuRef, () => setMenuOpen(false));
  useOutsideClose(viewMenuOpen, viewMenuRef, () => setViewMenuOpen(false));
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded]);

  function save(patch: Partial<InteractiveBlock>) {
    const next = { title, html: code, view, wrap, ...patch };
    sent.current = next.html;
    onUpdate(index, next);
  }

  function edit(next: string) {
    setCode(next);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => {
      commitTimer.current = null;
      save({ html: next });
    }, COMMIT_DELAY_MS);
  }

  function flush() {
    if (!commitTimer.current) return;
    clearTimeout(commitTimer.current);
    commitTimer.current = null;
    save({ html: code });
  }

  function chooseView(v: InteractiveView) {
    setViewMenuOpen(false);
    setView(v);
    setAsking(false);
    save({ view: v });
  }

  function toggleWrap() {
    const next = !wrap;
    setWrap(next);
    save({ wrap: next });
  }

  function writeCode() {
    if (isPlaceholderHtml(code)) setCode("");
    chooseView(view === "preview" ? "split" : view);
  }

  async function exportImage() {
    if (!frameRef.current) return;
    setMenuOpen(false);
    setExporting(true);
    setError("");
    try {
      const img = await exportFrameImage(frameRef.current);
      if (!img) { setError("This block has no picture to save (no diagram, chart or 3D view)."); return; }
      const a = document.createElement("a");
      a.href = img.dataUrl;
      a.download = `${(title || "block").replace(/[^\w-]+/g, "_")}.${img.kind}`;
      a.click();
      // Keep the picture with the block: it is what prints and what shows where scripts can't run.
      if (img.dataUrl.length <= MAX_SNAPSHOT_CHARS) save({ snapshot: img.dataUrl });
    } finally {
      setExporting(false);
    }
  }

  function copyCode() {
    setMenuOpen(false);
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  }

  // A photo pasted or dropped into the AI box: the vision model writes it as a diagram.
  async function fromPhoto(image: File) {
    if (!noteId) { setError("Open this block inside a note to use a photo."); return; }
    setGenerating(true);
    setError("");
    try {
      const next = await diagramFromImage(noteId, image);
      setCode(next);
      sent.current = next;
      onUpdate(index, { title, html: next });
      setAsking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the photo");
    } finally {
      setGenerating(false);
    }
  }

  function onPhotoTransfer(e: React.ClipboardEvent | React.DragEvent, dt: DataTransfer | null) {
    const img = imageFromTransfer(dt);
    if (!img) return;
    // Taken here: the workspace page around the note would otherwise add the photo as a source.
    e.preventDefault();
    e.stopPropagation();
    void fromPhoto(img);
  }

  async function generate() {
    if (!prompt.trim() || generating) return;
    flush();
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: liveBlockRequest(title, prompt, empty ? null : code) }],
          query: prompt.trim(),
          surface: "interactive",
          mode: "api",
        }),
      });
      if (!res.ok || !res.body) {
        throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let html = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const ev = JSON.parse(raw);
            if (ev.type === "text") html += ev.content;
          } catch { /* skip */ }
        }
      }

      const next = stripFences(html);
      if (!next) throw new Error("The model returned nothing");
      // Show the result straight away and keep it.
      setCode(next);
      sent.current = next;
      onUpdate(index, { title, html: next, view: view === "code" ? "split" : view, wrap });
      if (view === "code") setView("split");
      setPrompt("");
      setAsking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  const savedEmpty = isPlaceholderHtml(saved);
  const exportable = !savedEmpty && canExportImage(saved);
  const pinned = asking || menuOpen || viewMenuOpen;
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[1];
  const emptyRow = empty && !showCode;

  return (
    <div className="sb-live no-print" data-view={view}>
      <div className={`sb-live-box${emptyRow ? " sb-live-box-empty" : ""}`}>
        {emptyRow ? (
          <div className="sb-live-empty">
            <button type="button" className="sb-live-empty-main" onClick={() => setAsking(true)}>
              <Sparkles size={18} aria-hidden="true" />
              <span>Ask AI to build something here: a quiz, chart, simulation or diagram</span>
            </button>
            <button type="button" className="sb-live-empty-side" onClick={writeCode}>Write code</button>
          </div>
        ) : (
          <>
            {showCode ? (
              <div className="sb-live-code">
                <LiveCodeEditor
                  value={empty ? "" : code}
                  onChange={edit}
                  onBlur={flush}
                  lang={codeLanguage(code)}
                  wrap={wrap}
                  placeholder="HTML / CSS / JS, Mermaid source, or a link to a .glb / .stl model"
                  autoFocus={empty}
                />
              </div>
            ) : null}
            {showPreview && !savedEmpty ? (
              <div className="sb-live-preview">
                <iframe
                  ref={frameRef}
                  srcDoc={srcDoc}
                  sandbox="allow-scripts"
                  // colorScheme matches the page inside, or Chrome paints an opaque backdrop.
                  style={{ height: frameHeight, colorScheme: theme }}
                  // aria-label, not title: a title shows as the browser's own tooltip on hover.
                  aria-label={title || "Interactive block"}
                />
              </div>
            ) : null}
          </>
        )}

        <div className="sb-live-pill" data-pinned={pinned ? "true" : undefined}>
          <button type="button" className="sb-pill-btn sb-pill-text" aria-pressed={asking} onClick={() => setAsking((a) => !a)}>
            <Sparkles size={13} aria-hidden="true" />
            Ask AI
          </button>
          {!emptyRow ? (
            <>
              <span className="sb-pill-divider" aria-hidden="true" />
              <div className="sb-pill-anchor" ref={viewMenuRef}>
                <button
                  type="button"
                  className="sb-pill-btn"
                  aria-label="Open preview format menu"
                  title={current.label}
                  aria-haspopup="menu"
                  aria-expanded={viewMenuOpen}
                  onClick={() => setViewMenuOpen((o) => !o)}
                >
                  <current.Icon size={15} aria-hidden="true" />
                </button>
                {viewMenuOpen ? (
                  <div className="sb-view-menu" role="menu">
                    {VIEWS.map(({ id, label, Icon }) => (
                      <button
                        key={id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={view === id}
                        aria-label={label}
                        title={label}
                        className="sb-pill-btn"
                        onClick={() => chooseView(id)}
                      >
                        <Icon size={15} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              {showPreview && !savedEmpty ? (
                <button type="button" className="sb-pill-btn" aria-label="Expand" title="Expand" onClick={() => setExpanded(true)}>
                  <ZoomIn size={15} aria-hidden="true" />
                </button>
              ) : null}
              {exportable && showPreview ? (
                <button
                  type="button"
                  className="sb-pill-btn"
                  aria-label="Save as image"
                  title="Save as image"
                  disabled={exporting}
                  onClick={exportImage}
                >
                  <Download size={15} aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                className="sb-pill-btn"
                aria-label="Copy code to clipboard"
                title={copied ? "Copied" : "Copy code"}
                onClick={copyCode}
              >
                {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
              </button>
              {showCode ? (
                <button
                  type="button"
                  className="sb-pill-btn"
                  aria-label="Wrap code"
                  title="Wrap code"
                  aria-pressed={wrap}
                  onClick={toggleWrap}
                >
                  <CornerDownLeft size={15} aria-hidden="true" />
                </button>
              ) : null}
            </>
          ) : null}
          <div className="sb-pill-anchor" ref={menuRef}>
            <button
              type="button"
              className="sb-pill-btn"
              aria-label="Open block actions menu"
              title="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <Ellipsis size={16} aria-hidden="true" />
            </button>
            {menuOpen ? (
              <div className="sb-menu" role="menu">
                <div className="sb-menu-header">Interactive block</div>
                <button
                  type="button"
                  role="menuitem"
                  className="sb-menu-row"
                  onClick={() => { setMenuOpen(false); setCaptioning(true); }}
                >
                  <Captions size={16} aria-hidden="true" /> Caption
                </button>
                <button type="button" role="menuitem" className="sb-menu-row" onClick={copyCode} disabled={empty}>
                  <Copy size={16} aria-hidden="true" /> Copy code
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={wrap}
                  className="sb-menu-row"
                  onClick={toggleWrap}
                >
                  <CornerDownLeft size={16} aria-hidden="true" /> Wrap code
                  <span className="sb-switch" data-on={wrap ? "true" : undefined} aria-hidden="true" />
                </button>
                {exportable ? (
                  <button type="button" role="menuitem" className="sb-menu-row" onClick={exportImage}>
                    <Download size={16} aria-hidden="true" /> Save as image
                  </button>
                ) : null}
                <div className="sb-menu-divider" />
                <button
                  type="button"
                  role="menuitem"
                  className="sb-menu-row sb-menu-danger"
                  onClick={() => { setMenuOpen(false); onRemove(index); }}
                >
                  <Trash2 size={16} aria-hidden="true" /> Delete
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {asking ? (
        <div className="sb-live-ask">
          <div className="sb-live-ask-row">
            <Sparkles size={16} className="sb-live-ask-icon" aria-hidden="true" />
            <textarea
              ref={promptRef}
              value={prompt}
              rows={1}
              disabled={generating}
              onChange={(e) => {
                setPrompt(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void generate(); }
                else if (e.key === "Escape") { e.preventDefault(); setAsking(false); }
              }}
              onPaste={(e) => onPhotoTransfer(e, e.clipboardData)}
              onDrop={(e) => onPhotoTransfer(e, e.dataTransfer)}
              aria-label="Ask AI"
              placeholder={empty
                ? "e.g. a bar chart comparing sorting algorithms, or a pendulum simulator with sliders"
                : "Describe a change, e.g. make the labels bigger"}
            />
            <button
              type="button"
              className="sb-live-send"
              aria-label="Send"
              disabled={generating || !prompt.trim()}
              onClick={() => void generate()}
            >
              {generating ? <LoaderCircle size={16} className="sb-spin" aria-hidden="true" /> : <ArrowUp size={16} aria-hidden="true" />}
            </button>
          </div>
          <p className="sb-live-hint sb-live-ask-hint">
            {generating
              ? "Writing the block…"
              : empty
                ? "Enter to send · paste a photo of a diagram to turn it into one · Esc to close"
                : "The AI edits this block rather than starting over · paste a photo for a diagram · Esc to close"}
          </p>
        </div>
      ) : null}

      {(warnings.length > 0 || error) && !emptyRow ? (
        <p className={`sb-live-note${error ? " sb-live-error" : ""}`} role={error ? "alert" : undefined}>
          {[...warnings, ...(error ? [error] : [])].join(" ")}
        </p>
      ) : null}

      {title.trim() || captioning ? (
        <input
          ref={captionRef}
          className="sb-live-caption"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => {
            setCaptioning(false);
            if (title !== block.title) save({ title });
          }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
          placeholder="Write a caption…"
          aria-label="Block title"
        />
      ) : null}

      {expanded && typeof document !== "undefined"
        ? createPortal(
            <div className="sb-lightbox" role="dialog" aria-modal="true" aria-label={title || "Interactive block"} onMouseDown={() => setExpanded(false)}>
              <div className="sb-lightbox-panel" onMouseDown={(e) => e.stopPropagation()}>
                <iframe srcDoc={bigDoc} sandbox="allow-scripts" style={{ colorScheme: theme }} aria-label={title || "Interactive block"} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
