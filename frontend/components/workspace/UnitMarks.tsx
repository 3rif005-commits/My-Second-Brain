"use client";

// The marks beside each part of an AI-solved worksheet, and the progress line
// above it (docs/INTERACTIVE_NOTES_DESIGN.md, Check and Fix).
//
// A mark sits at the right end of a unit's heading — not saved in the note —
// and says where that part stands: ○ not written · ● written, not checked ·
// ✓ checked by you · ! something to look at · ↻ a new version waiting for
// Keep or Back. An exercise's mark is the worst of its answers, so a closed
// toggle still shows what is inside. Click it for: the question in the sheet,
// Mark checked, Redo, Redo with a note.
import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, ExternalLink, Loader2, RotateCcw, Sparkles, Undo2 } from "lucide-react";
import { childrenOf, markOf, progress, type MarkKind, type SolveProgress, type Unit } from "@/lib/units";
import type { NoteUnits } from "./useNoteUnits";

const GLYPH: Record<MarkKind, { text: string; cls: string; label: string }> = {
  planned: { text: "○", cls: "text-gray-400", label: "Not written yet" },
  written: { text: "●", cls: "text-blue-500", label: "Written — not checked yet" },
  checked: { text: "✓", cls: "text-emerald-600", label: "Checked by you" },
  flagged: { text: "!", cls: "text-amber-600 font-bold", label: "Something to look at" },
  pending: { text: "↻", cls: "text-accent-600", label: "New version — keep it or go back" },
};

const PRESETS = ["More steps", "Shorter", "Use the course's notation"];

const btn = "inline-flex items-center gap-1 h-7 px-2.5 rounded-md text-[12px] hover:bg-surface-hover disabled:opacity-50";

export function UnitProgressLine({ units, onNext, onSolve, solving }: {
  units: Unit[]; onNext: (u: Unit) => void;
  /** Solve all from the note itself: the AI panel's card is gone after a reload. */
  onSolve?: () => void;
  solving?: SolveProgress;
}) {
  const p = progress(units);
  if (!p.total) return null;
  if (solving?.running) {
    return (
      <div className="mb-2 text-[12px] text-ink-secondary" data-testid="unit-progress">
        <Loader2 size={12} className="mr-1 inline animate-spin" />
        {solving.finishing ? "Writing the revision sheet…" : `Solving… ${solving.done} of ${solving.total || "…"} exercises`}
      </div>
    );
  }
  const parts = [p.written < p.total ? `${p.written} of ${p.total} written` : null,
    `${p.checked} of ${p.total} checked`, p.toLook ? `${p.toLook} to look at` : null].filter(Boolean);
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] text-ink-secondary" data-testid="unit-progress">
      <span>{parts.join(" · ")}</span>
      {p.written < p.total && onSolve && (
        <button type="button" onClick={onSolve}
          className="inline-flex h-6 items-center gap-1 rounded-md bg-accent-600 px-2 text-white hover:bg-accent-500">
          <Sparkles size={11} /> {p.written ? "Solve the rest" : "Solve all"}
        </button>
      )}
      {solving && !solving.running && [...solving.edited.map((e) => `${e}: kept your edits (Redo it for the AI's version)`),
        ...solving.errors].map((e) => (
        <span key={e} className="w-full text-amber-700 dark:text-amber-300">{e}</span>
      ))}
      {p.next && p.written > 0 && (
        <button type="button" className="inline-flex items-center gap-0.5 text-ink hover:underline"
          onClick={() => onNext(p.next!)}>
          Next <ChevronRight size={12} />
        </button>
      )}
    </div>
  );
}

export function UnitMarks({ api, contentRef, sourceTitle, onOpenSource, openKey, setOpenKey }: {
  api: NoteUnits;
  contentRef: React.RefObject<HTMLDivElement | null>;
  sourceTitle: (resourceId: string) => string;
  onOpenSource: (resourceId: string, page: number) => void;
  /** The unit whose menu is open (the progress line's Next opens one too). */
  openKey: string | null;
  setOpenKey: (k: string | null) => void;
}) {
  const { units } = api;
  const shown = useMemo(() => units.filter((u) => u.block_id && u.key !== "" && u.key !== "revision"), [units]);
  const [places, setPlaces] = useState<{ u: Unit; top: number }[]>([]);

  useEffect(() => {
    const box = contentRef.current;
    if (!box) return;
    const place = () => {
      const base = box.getBoundingClientRect().top;
      const next: { u: Unit; top: number }[] = [];
      for (const u of shown) {
        const el = box.querySelector(`[data-id="${CSS.escape(u.block_id!)}"] .bn-inline-content`);
        const r = el?.getBoundingClientRect();
        // Inside a closed toggle a heading has no box: no mark until it opens.
        if (r && r.height > 0) next.push({ u, top: r.top - base });
      }
      setPlaces((prev) => (JSON.stringify(prev.map((d) => [d.u.key, d.top, d.u.state, d.u.pending]))
        === JSON.stringify(next.map((d) => [d.u.key, d.top, d.u.state, d.u.pending])) ? prev : next));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(box);
    const mo = new MutationObserver(place);
    mo.observe(box, { attributes: true, subtree: true, attributeFilter: ["data-show-children", "class"] });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [shown, contentRef]);

  return (
    <>
      {places.map(({ u, top }) => {
        const m = markOf(u, units);
        const g = GLYPH[m.kind];
        const busy = api.busy.has(u.key);
        return (
          <div key={u.key} className="absolute right-0" style={{ top: top + 2 }}>
            <button type="button" onClick={() => setOpenKey(openKey === u.key ? null : u.key)}
              aria-label={`${u.title}: ${g.label}`} title={m.problems.length ? m.problems.join("\n") : g.label}
              className={`flex size-5 items-center justify-center rounded-full text-[12px] hover:bg-surface-hover ${g.cls}`}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : g.text}
            </button>
            {openKey === u.key && (
              <UnitMenu u={u} api={api} problems={m.problems} isLeaf={childrenOf(units, u.key).length === 0}
                sourceTitle={sourceTitle} onOpenSource={onOpenSource} onClose={() => setOpenKey(null)} />
            )}
          </div>
        );
      })}
    </>
  );
}

function UnitMenu({ u, api, problems, isLeaf, sourceTitle, onOpenSource, onClose }: {
  u: Unit; api: NoteUnits; problems: string[]; isLeaf: boolean;
  sourceTitle: (resourceId: string) => string;
  onOpenSource: (resourceId: string, page: number) => void;
  onClose: () => void;
}) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = api.busy.has(u.key);

  async function redo(withNote: string) {
    setError(null);
    try {
      await api.redo(u.key, withNote);
      setAsking(false);
      setNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not write it again.");
    }
  }

  return (
    <div className="absolute right-6 top-0 z-30 w-72 rounded-lg border border-border bg-surface p-2.5 text-[12.5px] shadow-lg"
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} data-testid="unit-menu">
      <p className="mb-1.5 font-medium text-ink">{u.title}</p>
      {problems.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-amber-700 dark:text-amber-300">
          {problems.map((p) => <li key={p}>• {p}</li>)}
        </ul>
      )}
      {u.resource_id && u.page && (
        <button type="button" className={btn} onClick={() => onOpenSource(u.resource_id!, u.page!)}>
          <ExternalLink size={12} /> {sourceTitle(u.resource_id)} · p.{u.page}
        </button>
      )}
      {u.pending && (
        <div className="my-1.5 flex items-center gap-1 rounded-md bg-accent-500/10 px-2 py-1">
          <span className="mr-auto text-accent-600">New version</span>
          <button type="button" className={btn} onClick={() => void api.keep(u.key)}><Check size={12} /> Keep</button>
          <button type="button" className={btn} onClick={() => void api.backToOld(u.key)}><Undo2 size={12} /> Back to old</button>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {isLeaf && u.state !== "planned" && (
          <button type="button" className={btn} onClick={() => void api.setChecked(u.key, u.state !== "checked")}>
            <Check size={12} /> {u.state === "checked" ? "Not checked" : "Mark checked"}
          </button>
        )}
        <button type="button" className={btn} disabled={busy} onClick={() => void redo("")}>
          <RotateCcw size={12} /> {u.state === "planned" ? "Solve" : "Redo"}
        </button>
        {u.state !== "planned" && (
          <button type="button" className={btn} disabled={busy} onClick={() => setAsking((a) => !a)}>
            Redo with a note…
          </button>
        )}
      </div>
      {asking && (
        <div className="mt-1.5 space-y-1.5">
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button key={p} type="button" className={`${btn} ring-1 ring-border`} disabled={busy}
                onClick={() => void redo(p)}>{p}</button>
            ))}
          </div>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} autoFocus
            placeholder="What should change? e.g. use Gauss's law as in the course"
            className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1 text-[12.5px] outline-none" />
          <button type="button" className={`${btn} ring-1 ring-border`} disabled={busy || !note.trim()}
            onClick={() => void redo(note.trim())}>Redo with this note</button>
        </div>
      )}
      {busy && <p className="mt-1.5 text-ink-secondary"><Loader2 size={11} className="mr-1 inline animate-spin" />Writing it again…</p>}
      {error && <p className="mt-1.5 text-red-600">{error}</p>}
    </div>
  );
}
