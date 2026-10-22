"use client";

import { useContext, useMemo, useRef, useState } from "react";
import { NoteIdContext } from "./noteIdContext";
import { diagramFromImage, imageFromTransfer, isPlaceholderHtml, liveBlockRequest, stripFences, useFrameHeight } from "@/lib/liveBlock";
import { assetOrigin, buildSrcDoc, detectKind, preflightWarnings } from "@/lib/liveRuntime";
import { exportFrameImage, MAX_SNAPSHOT_CHARS } from "@/lib/liveExport";
import type { InteractiveBlock } from "./BlockEditor";

interface Props {
  block: InteractiveBlock;
  index: number;
  onUpdate: (index: number, block: InteractiveBlock) => void;
  onRemove: (index: number) => void;
}

type Mode = "preview" | "edit" | "ai";

export function InteractiveBlockCard({ block, index, onUpdate, onRemove }: Props) {
  const [mode, setMode] = useState<Mode>("preview");
  const [title, setTitle] = useState(block.title);
  const [code, setCode] = useState(block.html);
  const [prompt, setPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameHeight = useFrameHeight(frameRef);
  const srcDoc = useMemo(() => buildSrcDoc(code, { assetOrigin: assetOrigin() }), [code]);
  const warnings = useMemo(() => preflightWarnings(code), [code]);
  const [exporting, setExporting] = useState(false);

  async function exportImage() {
    if (!frameRef.current) return;
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

  function save() {
    onUpdate(index, { title, html: code });
    setMode("preview");
  }

  const noteId = useContext(NoteIdContext);

  // A photo pasted or dropped into the AI box: the vision model writes it as a diagram.
  async function fromPhoto(image: File) {
    if (!noteId) { setError("Open this block inside a note to use a photo."); return; }
    setGenerating(true);
    setError("");
    try {
      const next = await diagramFromImage(noteId, image);
      setCode(next);
      onUpdate(index, { title, html: next });
      setMode("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the photo");
    } finally {
      setGenerating(false);
    }
  }

  function onPhotoTransfer(e: React.ClipboardEvent | React.DragEvent, dt: DataTransfer | null) {
    const img = imageFromTransfer(dt);
    if (!img) return;
    e.preventDefault();
    void fromPhoto(img);
  }

  async function generate() {
    if (!prompt.trim()) return;
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: liveBlockRequest(title, prompt, isPlaceholderHtml(code) ? null : code) }],
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
      setMode("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mt-6 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 no-print">
      {/* Title bar */}
      <div className="flex items-center gap-2 px-3 py-2 bg-accent-600 text-white">
        <span className="text-base">⚡</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => onUpdate(index, { title, html: code })}
          className="flex-1 bg-transparent text-sm font-semibold outline-none placeholder-accent-300 min-w-0"
          placeholder="Block title"
        />
        {/* Mode tabs */}
        <div className="flex gap-1 ml-auto shrink-0">
          {(["preview", "edit", "ai"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); }}
              className={`text-xs px-2 py-0.5 rounded-md font-medium transition-colors ${
                mode === m
                  ? "bg-white text-accent-700"
                  : "text-accent-200 hover:text-white hover:bg-accent-500"
              }`}
            >
              {m === "preview" ? "Preview" : m === "edit" ? "Code" : "AI"}
            </button>
          ))}
          {mode === "preview" && (detectKind(code) !== "html" || /<canvas|<svg|sbScene/.test(code)) ? (
            <button
              onClick={exportImage}
              disabled={exporting}
              className="ml-1 text-accent-200 hover:text-white text-xs px-1 disabled:opacity-50"
              title="Save as image"
            >
              ⤓
            </button>
          ) : null}
          <button
            onClick={() => onRemove(index)}
            className="ml-1 text-accent-300 hover:text-white text-xs px-1"
            title="Remove block"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Preview */}
      {mode === "preview" && (
        <iframe
          ref={frameRef}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          className="w-full border-none block bg-gray-50 dark:bg-gray-900"
          style={{ height: frameHeight }}
          title={title}
        />
      )}
      {mode === "preview" && (warnings.length > 0 || error) && (
        <div className="px-3 py-1.5 text-[11px] text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-300 border-t border-amber-100 dark:border-amber-900/40">
          {[...warnings, ...(error ? [error] : [])].join(" ")}
        </div>
      )}

      {/* Code editor */}
      {mode === "edit" && (
        <div className="flex flex-col bg-gray-950">
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full font-mono text-xs text-green-300 bg-gray-950 p-4 resize-none outline-none"
            style={{ height: 260 }}
            placeholder="Paste any self-contained HTML / CSS / JS here…"
            spellCheck={false}
          />
          <div className="flex justify-end gap-2 px-3 py-2 border-t border-gray-800">
            <button
              onClick={() => setMode("preview")}
              className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={save}
              className="text-xs px-3 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 text-white font-medium transition-colors"
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {/* AI generation */}
      {mode === "ai" && (
        <div className="p-4 bg-white dark:bg-gray-900 flex flex-col gap-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {isPlaceholderHtml(code)
              ? "Describe what this block should do — simulation, quiz, chart, timeline, calculator…"
              : "Describe a change — the AI edits this block rather than starting over."}
            {" "}Or paste a photo of a diagram.
          </p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            onPaste={(e) => onPhotoTransfer(e, e.clipboardData)}
            onDrop={(e) => onPhotoTransfer(e, e.dataTransfer)}
            className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg p-3 outline-none focus:ring-2 focus:ring-accent-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 resize-none"
            placeholder="e.g. A bar chart comparing bubble sort vs merge sort complexity, or a Newton's law simulator with sliders…"
          />
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setMode("preview")}
              className="text-xs px-3 py-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={generate}
              disabled={generating || !prompt.trim()}
              className="text-xs px-4 py-1.5 rounded-lg bg-accent-600 hover:bg-accent-500 disabled:opacity-50 text-white font-medium transition-colors flex items-center gap-1.5"
            >
              {generating ? "Working…" : "Generate"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
