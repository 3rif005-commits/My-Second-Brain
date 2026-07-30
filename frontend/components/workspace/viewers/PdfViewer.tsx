"use client";

// PDF viewer with element-level selection.
//
// react-pdf renders each page (canvas + selectable text layer); on top we
// absolutely position overlays for the elements PyMuPDF extracted server-side
// (text blocks, headings, images, tables, formulas) scaled from PDF points to
// rendered pixels. Clicking an element opens a one-click action bar.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { wsApi, type SendAction, type WsElement, type NoteSource } from "@/lib/workspace";
import { useToast } from "@/app/providers";
import { ActionBar, ActionButton } from "./ActionBar";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url
).toString();

const PAGE_WIDTH = 680;

interface PdfViewerProps {
  resource: NoteSource;
  onPosition: (page: number) => void;
  onAction: (action: SendAction) => void;
  /** Parent stores a seek function here: seekRef.current = (page) => …  */
  seekRef: React.MutableRefObject<((value: number) => void) | null>;
}

const ELEMENT_COLORS: Record<string, string> = {
  image: "border-emerald-400/70 hover:bg-emerald-400/10",
  table: "border-sky-400/70 hover:bg-sky-400/10",
  formula: "border-purple-400/70 hover:bg-purple-400/10",
  heading: "border-amber-400/50 hover:bg-amber-400/10",
  text: "border-transparent hover:border-indigo-300/60 hover:bg-indigo-300/5",
};

export function PdfViewer({ resource, onPosition, onAction, seekRef }: PdfViewerProps) {
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [active, setActive] = useState<{ el: WsElement; x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const currentPage = useRef(1);

  useEffect(() => {
    wsApi.sourceFileUrl(resource.id).then((r) => setFileUrl(r.url)).catch(() => {});
  }, [resource.id]);

  const pageSizes = useMemo(
    () => (resource.meta?.page_sizes as [number, number][]) || [],
    [resource.meta]);

  const elementsByPage = useMemo(() => {
    const map: Record<number, WsElement[]> = {};
    for (const el of resource.elements ?? []) {
      if (!el.bbox) continue;
      (map[el.page] ??= []).push(el);
    }
    return map;
  }, [resource.elements]);

  // scroll → current page tracking
  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const top = container.scrollTop + 100;
    let page = 1;
    for (const [num, el] of Object.entries(pageRefs.current)) {
      if (el && el.offsetTop <= top) page = Math.max(page, Number(num));
    }
    if (page !== currentPage.current) {
      currentPage.current = page;
      onPosition(page);
    }
  }, [onPosition]);

  // parent-commanded jump (sync, citations, checkpoints)
  useEffect(() => {
    seekRef.current = (page: number) => {
      const el = pageRefs.current[Math.max(1, Math.round(page))];
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    return () => { seekRef.current = null; };
  }, [seekRef]);

  // text-layer selection → floating send button
  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || !containerRef.current || !sel?.rangeCount) {
      setSelection(null);
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const crect = containerRef.current.getBoundingClientRect();
    setSelection({
      text,
      x: rect.left + rect.width / 2 - crect.left,
      y: rect.top - crect.top + containerRef.current.scrollTop,
    });
  }, []);

  function elementClick(e: React.MouseEvent, el: WsElement) {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const crect = container.getBoundingClientRect();
    setActive({
      el,
      x: rect.left + rect.width / 2 - crect.left,
      y: rect.top - crect.top + container.scrollTop,
    });
    setSelection(null);
  }

  async function sendElement(el: WsElement) {
    setActive(null);
    if (el.element_type === "image") {
      if (el.image_url) onAction({ type: "image", url: el.image_url });
      return;
    }
    if (el.element_type === "table") {
      onAction({ type: "table", markdown: el.content || "" });
      return;
    }
    if (el.element_type === "formula") {
      setBusy(true);
      try {
        const { latex } = await wsApi.formulaLatex(resource.id, el.id);
        onAction({ type: "latex", latex });
      } catch (err) {
        // graceful degrade: no vision provider → send the crop as an image
        if (el.image_url) onAction({ type: "image", url: el.image_url });
        else showToast(err instanceof Error ? err.message : "Formula OCR failed");
      } finally {
        setBusy(false);
      }
      return;
    }
    onAction({ type: "text", text: el.content || "" });
  }

  function copyElement(el: WsElement) {
    setActive(null);
    navigator.clipboard.writeText(el.content || el.image_url || "").catch(() => {});
  }

  if (!fileUrl) {
    return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Loading PDF…</div>;
  }

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-y-auto bg-gray-100 dark:bg-gray-950"
      onScroll={() => { handleScroll(); setActive(null); }}
      onMouseUp={handleMouseUp}
    >
      <div className="flex flex-col items-center gap-4 py-4">
        <Document
          file={fileUrl}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          loading={<div className="text-sm text-gray-400 py-8">Rendering…</div>}
          error={<div className="text-sm text-red-400 py-8">Could not render PDF.</div>}
        >
          {Array.from({ length: numPages }, (_, i) => {
            const pno = i + 1;
            const size = pageSizes[i];
            const scale = size ? PAGE_WIDTH / size[0] : 1;
            return (
              <div
                key={pno}
                ref={(el) => { pageRefs.current[pno] = el; }}
                className="relative shadow-md mb-4 bg-white"
                style={{ width: PAGE_WIDTH }}
              >
                <Page pageNumber={pno} width={PAGE_WIDTH}
                  renderAnnotationLayer={false} />
                {/* element overlays — text/heading stay pointer-events-none so
                    react-pdf's text layer (which sits above the canvas for
                    native selection) still receives clicks/drags for the
                    mouseup-based "select text" flow; image/table/formula have
                    no competing text layer, so they get raised z-index +
                    pointer events to be reliably clickable. */}
                {size && (elementsByPage[pno] ?? []).map((el) => {
                  const [x0, y0, x1, y1] = el.bbox!;
                  const clickable = el.element_type !== "text" && el.element_type !== "heading";
                  return (
                    <div
                      key={el.id}
                      className={`absolute border rounded-sm transition-colors ${ELEMENT_COLORS[el.element_type]} ${
                        clickable ? "z-10 cursor-pointer" : "pointer-events-none"
                      }`}
                      style={{
                        left: x0 * scale, top: y0 * scale,
                        width: (x1 - x0) * scale, height: (y1 - y0) * scale,
                      }}
                      title={el.element_type}
                      onClick={clickable ? (e) => elementClick(e, el) : undefined}
                    />
                  );
                })}
                <div className="absolute bottom-1 right-2 text-[10px] text-gray-300 select-none">
                  {pno}
                </div>
              </div>
            );
          })}
        </Document>
      </div>

      {active && (
        <ActionBar x={active.x} y={active.y}>
          <span className="px-1.5 text-gray-400 capitalize">{active.el.element_type}</span>
          <ActionButton onClick={() => sendElement(active.el)} title="Send to note">
            {busy ? "…" : "→ Note"}
          </ActionButton>
          {active.el.element_type === "formula" && (
            <ActionButton onClick={() => sendElement(active.el)} title="Transcribe to LaTeX and insert">
              LaTeX
            </ActionButton>
          )}
          <ActionButton onClick={() => copyElement(active.el)}>Copy</ActionButton>
          <ActionButton onClick={() => setActive(null)}>✕</ActionButton>
        </ActionBar>
      )}

      {selection && (
        <ActionBar x={selection.x} y={selection.y}>
          <ActionButton onClick={() => {
            onAction({ type: "text", text: selection.text });
            setSelection(null);
            window.getSelection()?.removeAllRanges();
          }}>
            → Note
          </ActionButton>
          <ActionButton onClick={() => {
            onAction({
              type: "checkpoint", anchorType: "page",
              value: currentPage.current,
              label: selection.text.slice(0, 40),
            });
            setSelection(null);
          }}>
            📍 Checkpoint
          </ActionButton>
        </ActionBar>
      )}

      {/* persistent checkpoint button */}
      <button
        className="absolute bottom-4 right-4 z-20 px-2.5 py-1.5 rounded-lg bg-gray-900/80 text-white text-xs shadow-lg hover:bg-gray-900"
        onClick={() => onAction({
          type: "checkpoint", anchorType: "page", value: currentPage.current,
        })}
        title="Insert a checkpoint for the current page"
      >
        📍 p.{currentPage.current}
      </button>
    </div>
  );
}
