"use client";

// Synthesis lifecycle for one note: poll, decide replace-vs-append, apply,
// and derive the "Re-synthesize (N sources)" state from what the current draft
// was actually built from.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { wsApi, type NoteSource, type Synthesis } from "@/lib/workspace";
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
  /** The replace-vs-append dialog should be open. */
  askMode: boolean;
  requestSynthesis: () => void;
  chooseMode: (mode: "replace" | "append") => void;
  cancelMode: () => void;
  dismissError: () => void;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

export function useSynthesis({ noteId, sources, applyRef }: Options): SynthesisController {
  const [synthesis, setSynthesis] = useState<Synthesis | null>(null);
  const [askMode, setAskMode] = useState(false);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const appliedRef = useRef<string | null>(null);   // html we already applied
  const modeRef = useRef<"replace" | "append" | null>(null);

  const readyIds = useMemo(
    () => sources.filter((s) => s.status === "ready").map((s) => s.id), [sources]);
  const pending = sources.some((s) => s.status === "queued" || s.status === "processing");
  const running = synthesis?.status === "queued" || synthesis?.status === "running";

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

  // Poll while a source is still processing (the settle guard fires on the last
  // one) or while a draft is being written.
  useEffect(() => {
    if (!noteId || (!pending && !running)) return;
    const timer = setInterval(refresh, 2500);
    return () => clearInterval(timer);
  }, [noteId, pending, running, refresh]);

  // Apply a ready, unapplied draft.
  useEffect(() => {
    const html = synthesis?.html;
    if (!noteId || !html || synthesis?.status !== "ready") return;
    if (synthesis.applied_at || appliedRef.current === html) return;
    const api = applyRef.current;
    if (!api) return;   // NotePane not mounted yet; the effect re-runs when it is

    // Never silently overwrite the user's own work: without an explicit choice,
    // an edited note gets the draft appended, not slammed on top.
    const mode = modeRef.current
      ?? (api.hasUserEdits() ? "append" : "replace");
    appliedRef.current = html;
    modeRef.current = null;
    api.apply(html, synthesis.source_ids ?? [], mode);
    wsApi.markSynthesisApplied(noteId).then(refresh).catch(() => {});
  }, [noteId, synthesis, applyRef, refresh]);

  const queue = useCallback((mode: "replace" | "append") => {
    if (!noteId) return;
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
    askMode,
    requestSynthesis,
    chooseMode,
    cancelMode: () => setAskMode(false),
    dismissError: () => setErrorDismissed(true),
  };
}
