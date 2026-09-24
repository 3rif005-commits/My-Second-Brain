"use client";

// Synthesis lifecycle for one note: poll, decide replace-vs-append, apply,
// and derive the "Re-synthesize (N sources)" state from what the current draft
// was actually built from.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wsApi, type NoteSource, type Synthesis, type SynthesisEstimate } from "@/lib/workspace";
import type { NoteApplyApi } from "./NotePane";

interface Options {
  noteId: string | null;
  sources: NoteSource[];
  applyRef: React.MutableRefObject<NoteApplyApi | null>;
}

export interface SynthesisController {
  synthesis: Synthesis | null;
  /** A draft is queued or being written right now. */
  running: boolean;
  /** The current draft was built from a different source set than what's ready. */
  stale: boolean;
  readyCount: number;
  /** The ready source ids, joined — what both the estimate and the skill bar
   * re-price on. */
  readyKey: string;
  /** No draft has ever been written for this note — the first run is a decision,
   * not a refresh, so the UI offers it with a price instead of firing it. */
  neverGenerated: boolean;
  /** What that first run would cost. Null while unknown or with no sources. */
  estimate: SynthesisEstimate | null;
  /** The replace-vs-append dialog should be open. */
  askMode: boolean;
  requestSynthesis: () => void;
  /** Call once the applied draft has been saved into the note. */
  markApplied: () => void;
  /** A run was queued by something other than the Generate button (a skill):
   * flip to the running state so the poll starts immediately instead of after
   * the next interval. */
  refreshAfterStart: () => void;
  chooseMode: (mode: "replace" | "append") => void;
  cancelMode: () => void;
  dismissError: () => void;
  /** A draft landed in the note during this visit and can still be undone. */
  justApplied: boolean;
  /** Put the note back as it was before that draft. False when it cannot be
   *  undone any more (the user has typed since). */
  undoApply: () => boolean;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export function useSynthesis({ noteId, sources, applyRef }: Options): SynthesisController {
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [estimate, setEstimate] = useState<SynthesisEstimate | null>(null);
  const [askMode, setAskMode] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const appliedRef = useRef<string | null>(null);   // html we already applied
  const modeRef = useRef<"replace" | "append" | null>(null);

  const readyIds = useMemo(
    () => sources.filter((s) => s.status === "ready").map((s) => s.id), [sources]);
  const pending = sources.some((s) => s.status === "queued" || s.status === "processing");
  // A synthesis that has been in flight this long lost its worker (a backend
  // restart mid-LLM leaves the row behind); treat it as finished so the user can
  // retry instead of staring at a spinner forever. Well above the free-tier
  // OpenRouter model's documented 3-5 minute cold start, because re-firing beside
  // a live worker would let the client apply the same draft twice.
  const STALE_RUN_MS = 15 * 60 * 1000;
  const inFlight = synthesis?.status === "queued" || synthesis?.status === "running";
  const staleRun = !!inFlight && !!synthesis?.updated_at
    && Date.now() - Date.parse(synthesis.updated_at) > STALE_RUN_MS;
  const running = !!inFlight && !staleRun;
  // A ready draft that nobody has applied yet. `applyRef.current` may still be
  // null on first render (the shell shows "Loading session…" until the note
  // arrives), and mutating a ref cannot re-run the apply effect — so keep
  // polling until the draft actually lands, instead of stranding it.
  const unapplied = synthesis?.status === "ready"
    && !synthesis.applied_at
    && appliedRef.current !== synthesis.html;

  const refresh = useCallback(() => {
    if (!noteId) return;
    wsApi.getSynthesis(noteId).then(setSynthesis).catch(() => {});
  }, [noteId]);

  useEffect(() => {
    appliedRef.current = null;
    modeRef.current = null;
    setSynthesis(null);
    refresh();
  }, [noteId, refresh]);

  const readyKey = readyIds.join(",");
  // No pre-run estimate fetch any more: the Generate button it priced is gone
  // (jobs are priced in the AI panel), and the request averaged 5 s — the
  // slowest thing the workspace page asked for.

  // Poll only while a draft is being written or waiting to be applied. Polling
  // through source processing existed for auto-generation, which no longer
  // happens (the drop policy is "suggest").
  useEffect(() => {
    if (!noteId || (!running && !unapplied)) return;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [noteId, running, unapplied, refresh]);

  // Apply a ready, unapplied draft.
  useEffect(() => {
    const html = synthesis?.html;
    if (!noteId || !html || synthesis?.status !== "ready") return;
    if (synthesis.applied_at || appliedRef.current === html) return;
    const api = applyRef.current;
    if (!api) return;   // NotePane not mounted yet; the unapplied poll re-runs this

    // Never silently overwrite the user's own work: without an explicit choice,
    // an edited note gets the draft appended, not slammed on top.
    const mode = modeRef.current
      ?? (api.hasUserEdits() ? "append" : "replace");
    appliedRef.current = html;
    modeRef.current = null;
    // NotePane calls back through `markApplied` once the note has actually been
    // PATCHed. Marking here instead would record `applied_at` while the content
    // was still in the autosave debounce, and a navigation in that window
    // stranded the draft permanently.
    api.apply(html, synthesis.source_ids ?? [], mode);
  }, [noteId, synthesis, applyRef]);

  /** The draft is now durably in the note — record it server-side. */
  const [justApplied, setJustApplied] = useState(false);
  useEffect(() => { setJustApplied(false); }, [noteId]);

  const markApplied = useCallback(() => {
    if (!noteId) return;
    setJustApplied(true);
    wsApi.markSynthesisApplied(noteId).then(refresh).catch(() => {});
  }, [noteId, refresh]);

  const queue = useCallback((mode: "replace" | "append") => {
    if (!noteId) return;
    setJustApplied(false);
    modeRef.current = mode;
    setErrorDismissed(false);
    setSynthesis((s) => ({
      status: "queued", source_ids: s?.source_ids ?? [], html: null,
    }));
    wsApi.synthesize(noteId, mode).then(refresh).catch(() => refresh());
  }, [noteId, refresh]);

  const requestSynthesis = useCallback(() => {
    if (!noteId || running) return;
    if (applyRef.current?.hasUserEdits()) setAskMode(true);
    else queue("replace");
  }, [noteId, running, applyRef, queue]);

  const undoApply = useCallback(() => {
    const ok = applyRef.current?.undoApply() ?? false;
    setJustApplied(false);
    return ok;
  }, [applyRef]);

  const refreshAfterStart = useCallback(() => {
    setJustApplied(false);
    setErrorDismissed(false);
    modeRef.current = null;
    setSynthesis((s) => ({ status: "queued", source_ids: s?.source_ids ?? [],
                           html: null }));
    refresh();
  }, [refresh]);

  const chooseMode = useCallback((mode: "replace" | "append") => {
    setAskMode(false);
    queue(mode);
  }, [queue]);

  return {
    synthesis: synthesis && synthesis.status === "failed" && errorDismissed
      ? { ...synthesis, error: null } : synthesis,
    running,
    stale: synthesis?.status === "ready"
      && !sameSet(synthesis.source_ids ?? [], readyIds),
    readyCount: readyIds.length,
    readyKey,
    neverGenerated: !synthesis || synthesis.status === "none",
    estimate,
    askMode,
    requestSynthesis,
    markApplied,
    refreshAfterStart,
    chooseMode,
    cancelMode: () => setAskMode(false),
    dismissError: () => setErrorDismissed(true),
    justApplied,
    undoApply,
  };
}
