"use client";

// The marks beside each part of an AI-solved worksheet, and the progress line
// above it (docs/INTERACTIVE_NOTES_DESIGN.md, Check and Fix).
//
// A mark sits at the right end of a unit's heading — not saved in the note —
// and says where that part stands: ○ not written · ● written, not checked ·
// ✓ checked by you · ! something to look at · ↻ a new version waiting for
// Keep or Back. An exercise's mark is the worst of its answers, so a closed
// toggle still shows what is inside. Click it for: the question in the sheet,
// Mark checked, Check with AI, Redo, Redo with a note.
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, ExternalLink, Loader2, RotateCcw, ShieldCheck, Sparkles, Undo2 } from "lucide-react";
import {
  answersUnder, checkSummary, childrenOf, markOf, progress,
  type CheckResult, type MarkKind, type SolveProgress, type Unit,
} from "@/lib/units";
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

export function UnitProgressLine({ units, onNext, onSolve, solving, onCheckAll, checkingAll, checkNote }: {
  units: Unit[]; onNext: (u: Unit) => void;
  /** Solve all from the note itself: the AI panel's card is gone after a reload. */
  onSolve?: () => void;
  solving?: SolveProgress;
  /** Check every written answer with AI, in one call. */
  onCheckAll?: () => void;
  checkingAll?: boolean;
  /** What the last Check all found, or why it failed. */
  checkNote?: string | null;
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
      {p.written > 0 && onCheckAll && (
        <button type="button" onClick={onCheckAll} disabled={checkingAll}
          title="A second, blind solve of every answer, compared with the note. It only flags."
          className="inline-flex h-6 items-center gap-1 rounded-md px-2 ring-1 ring-border hover:bg-surface-hover disabled:opacity-60">
          {checkingAll ? <Loader2 size={11} className="animate-spin" /> : <ShieldCheck size={11} />}
          {checkingAll ? "Checking…" : "Check all with AI"}
        </button>
      )}
      {checkNote && !checkingAll && <span>{checkNote}</span>}
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
            <button type="button" data-unit-mark onClick={() => setOpenKey(openKey === u.key ? null : u.key)}
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
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Close on Escape anywhere and on a click outside (the mark itself toggles).
  // Then bring the menu into view: opened by Next, it can sit off-screen
  // while the toggles above it are still opening (live 2026-11-24).
  useEffect(() => {
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (box.current?.contains(t) || t.closest?.("[data-unit-mark]")) return;
      closeRef.current();
    };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    const t = setTimeout(() => box.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 700);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
      clearTimeout(t);
    };
  }, []);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = api.busy.has(u.key);
  const checking = api.checking.has(u.key) || api.checking.has("");
  const answers = answersUnder(api.units, u.key);
  const verdicts = answers.map((a) => ({ a, r: api.checks.get(a.key) })).filter((x) => x.r) as
    { a: Unit; r: CheckResult }[];

  async function check() {
    setError(null);
    try {
      await api.check(u.key);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check it.");
    }
  }

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
    <div ref={box} className="absolute right-6 top-0 z-30 w-72 rounded-lg border border-border bg-surface p-2.5 text-[12.5px] shadow-lg"
      data-testid="unit-menu">
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
          <button type="button" className={btn} onClick={() => { api.backToOld(u.key).catch((e) => setError(e instanceof Error ? e.message : "Could not go back.")); }}><Undo2 size={12} /> Back to old</button>
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
        {u.state !== "planned" && (
          <button type="button" className={btn} disabled={busy || checking} onClick={() => void check()}
            title="A second, blind solve compared with the answer in the note. It only flags.">
            <ShieldCheck size={12} /> Check with AI
          </button>
        )}
      </div>
      {checking && <p className="mt-1.5 text-ink-secondary"><Loader2 size={11} className="mr-1 inline animate-spin" />Solving it again, blind…</p>}
      {!checking && verdicts.length > 0 && (
        <div className="mt-2 space-y-1 border-t border-border pt-1.5" data-testid="unit-checks">
          <p className="text-ink-secondary">AI check: {checkSummary(verdicts.map((v) => v.r))}</p>
          {verdicts.map(({ a, r }) => (
            <div key={a.key} className="leading-snug">
              <span className={r.verdict === "agree" ? "text-emerald-600" : r.verdict === "differ" ? "font-bold text-amber-600" : "text-ink-secondary"}>
                {r.verdict === "agree" ? "✓" : r.verdict === "differ" ? "≠" : "?"}
              </span>{" "}
              {answers.length > 1 && <span className="font-medium">{a.label || a.title} </span>}
              {r.verdict === "agree" && <span className="text-ink-secondary">agrees{r.blind ? `: ${r.blind}` : ""}</span>}
              {r.verdict === "differ" && (
                <span>second solve: <em>{r.blind}</em>{r.why ? <span className="text-ink-secondary"> — {r.why}</span> : null}</span>
              )}
              {r.verdict === "unsure" && <span className="text-ink-secondary">{r.why || "could not compare"}</span>}
            </div>
          ))}
        </div>
      )}
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
