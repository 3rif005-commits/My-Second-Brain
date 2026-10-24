"use client";

// The live (interactive) block, laid out like Notion's media blocks (image block in
// docs/notion-reference/surfaces/blocks.md): the content in a 10px-rounded frame with no
// header, a small pill top-right on hover — Ask AI | Code, save as image, ⋯ — and the title
// as a caption under the frame. Ask AI opens a prompt card under the block; Code swaps the
// frame for a code view coloured like the note's code blocks. Styles: app/liveBlock.css.

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Captions, CodeXml, Copy, Download, Ellipsis, LoaderCircle, Sparkles, Trash2 } from "lucide-react";
import { NoteIdContext } from "./noteIdContext";
import { diagramFromImage, imageFromTransfer, isPlaceholderHtml, liveBlockRequest, stripFences, useFrameHeight } from "@/lib/liveBlock";
import { assetOrigin, buildSrcDoc, detectKind, preflightWarnings } from "@/lib/liveRuntime";
import { exportFrameImage, MAX_SNAPSHOT_CHARS } from "@/lib/liveExport";
import { LiveCodeEditor } from "@/components/interactive/LiveCodeEditor";
import type { InteractiveBlock } from "./BlockEditor";

interface Props {
  block: InteractiveBlock;
  index: number;
  onUpdate: (index: number, block: InteractiveBlock) => void;
  onRemove: (index: number) => void;
}

/** The code view's language: Mermaid source is coloured as Mermaid, a model link is plain. */
export function codeLanguage(code: string): string {
  const kind = detectKind(code);
  return kind === "mermaid" ? "mermaid" : kind === "model" ? "text" : "html";
}

/** Whether the block shows something ⤓ can save (a diagram, chart, canvas or 3D view). */
export function canExportImage(code: string): boolean {
  return detectKind(code) !== "html" || /<canvas|<svg|sbScene/.test(code);
}

export function InteractiveBlockCard({ block, index, onUpdate, onRemove }: Props) {
  const [showCode, setShowCode] = useState(false);
  const [asking, setAsking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [title, setTitle] = useState(block.title);
  const [code, setCode] = useState(block.html);
  const [draft, setDraft] = useState(block.html);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  // Like Notion's caption: only there once there is one, or while you are adding it.
  const [captioning, setCaptioning] = useState(false);
  const captionRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const frameHeight = useFrameHeight(frameRef);
  const srcDoc = useMemo(() => buildSrcDoc(code, { assetOrigin: assetOrigin() }), [code]);
  const warnings = useMemo(() => preflightWarnings(code), [code]);
  const empty = isPlaceholderHtml(code);
  const noteId = useContext(NoteIdContext);

  // The block changed from outside (undo, another device, the AI elsewhere): show that.
  useEffect(() => { setCode(block.html); }, [block.html]);
  useEffect(() => { setTitle(block.title); }, [block.title]);

  useEffect(() => {
    if (asking) promptRef.current?.focus({ preventScroll: true });
  }, [asking]);

  useEffect(() => {
    if (captioning) captionRef.current?.focus({ preventScroll: true });
  }, [captioning]);

  // ⋯ menu: outside click or Escape closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function openCode() {
    setDraft(empty ? "" : code);
    setShowCode(true);
    setAsking(false);
    setError("");
  }

  function applyCode() {
    const next = draft.trim() ? draft : code;
    setCode(next);
    onUpdate(index, { title, html: next });
    setShowCode(false);
  }

  function toggleAsk() {
    setAsking((a) => !a);
    setShowCode(false);
    setError("");
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
      if (img.dataUrl.length <= MAX_SNAPSHOT_CHARS) onUpdate(index, { title, html: code, snapshot: img.dataUrl });
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
      // Show the result straight away and keep it; Code is one click if it needs a tweak.
      setCode(next);
      onUpdate(index, { title, html: next });
      setPrompt("");
      setAsking(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  const exportable = !empty && canExportImage(code);
  const pinned = asking || showCode || menuOpen;

  return (
    <div className="sb-live no-print">
      <div className="sb-live-stage">
        {showCode ? (
          <div className="sb-live-code">
            <LiveCodeEditor
              value={draft}
              onChange={setDraft}
              lang={codeLanguage(draft)}
              placeholder="Paste any self-contained HTML / CSS / JS, Mermaid source, or a link to a .glb / .stl model…"
              onSubmit={applyCode}
              onCancel={() => setShowCode(false)}
              autoFocus
            />
            <div className="sb-live-code-foot">
              <span className="sb-live-hint">Ctrl+Enter to apply · Esc to cancel</span>
              <button type="button" className="sb-btn sb-btn-quiet" onClick={() => setShowCode(false)}>Cancel</button>
              <button type="button" className="sb-btn sb-btn-primary" onClick={applyCode}>Apply</button>
            </div>
          </div>
        ) : empty ? (
          <div className="sb-live-empty">
            <button type="button" className="sb-live-empty-main" onClick={toggleAsk}>
              <Sparkles size={18} aria-hidden="true" />
              <span>Ask AI to build something here: a quiz, chart, simulation or diagram</span>
            </button>
            <button type="button" className="sb-live-empty-side" onClick={openCode}>Paste code</button>
          </div>
        ) : (
          <div className="sb-live-frame">
            <iframe
              ref={frameRef}
              srcDoc={srcDoc}
              sandbox="allow-scripts"
              style={{ height: frameHeight }}
              // aria-label, not title: a title shows as the browser's own tooltip on hover.
              aria-label={title || "Interactive block"}
            />
          </div>
        )}

        {!empty || showCode ? (
          <div className="sb-live-pill" data-pinned={pinned ? "true" : undefined}>
            <button
              type="button"
              className="sb-pill-btn sb-pill-text"
              aria-pressed={asking}
              onClick={toggleAsk}
            >
              <Sparkles size={13} aria-hidden="true" />
              Ask AI
            </button>
            <span className="sb-pill-divider" aria-hidden="true" />
            <button
              type="button"
              className="sb-pill-btn"
              aria-pressed={showCode}
              aria-label={showCode ? "Show the block" : "Edit code"}
              title={showCode ? "Show the block" : "Edit code"}
              onClick={() => (showCode ? setShowCode(false) : openCode())}
            >
              <CodeXml size={16} aria-hidden="true" />
            </button>
            {exportable && !showCode ? (
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
            <div className="sb-live-menu-anchor" ref={menuRef}>
              <button
                type="button"
                className="sb-pill-btn"
                aria-label="More actions"
                title="More actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
              >
                <Ellipsis size={16} aria-hidden="true" />
              </button>
              {menuOpen ? (
                <div className="sb-menu sb-live-menu" role="menu">
                  {!title.trim() ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="sb-menu-row"
                      onClick={() => { setMenuOpen(false); setCaptioning(true); }}
                    >
                      <Captions size={16} aria-hidden="true" /> Add caption
                    </button>
                  ) : null}
                  <button type="button" role="menuitem" className="sb-menu-row" onClick={copyCode}>
                    <Copy size={16} aria-hidden="true" /> Copy code
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
        ) : null}
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

      {warnings.length > 0 || error || copied ? (
        <p className={`sb-live-note${error ? " sb-live-error" : ""}`} role={error ? "alert" : undefined}>
          {copied ? "Code copied." : [...warnings, ...(error ? [error] : [])].join(" ")}
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
            if (title !== block.title) onUpdate(index, { title, html: code });
          }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur(); }}
          placeholder="Write a caption…"
          aria-label="Block title"
        />
      ) : null}
    </div>
  );
}
