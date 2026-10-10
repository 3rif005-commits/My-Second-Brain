"use client";

// Ledger B1: interactive blocks used to live only in this browser's localStorage. Move any that are here INTO the
// note (as real blocks); the browser's copy is deleted only after a save that contains every one of them succeeded.
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { migrationSaved, planLegacyMigration } from "./InteractiveBlock";
import type { BlockEditorHandle } from "./BlockEditor";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

export function useLegacyInteractiveMigration(editorRef: RefObject<BlockEditorHandle | null>, noteId: string) {
  const key = `interactive-${noteId}`;
  const pending = useRef<string[] | null>(null);

  useEffect(() => {
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      const ed = editorRef.current;
      if (!ed && tries < 40) return;
      clearInterval(t);
      if (!ed) return;
      try {
        const plan = planLegacyMigration(localStorage.getItem(key), ed.getDocument() as AnyBlock[]);
        if (plan.action === "clear") localStorage.removeItem(key);
        else if (plan.action === "insert") {
          pending.current = plan.fresh.map((b) => b.html);
          ed.insertBlocksAtEnd(plan.fresh.map((b) => ({ type: "interactive", props: { title: b.title, html: b.html } })));
        }
      } catch { /* the browser copy stays; the next visit tries again */ }
    }, 250);
    return () => clearInterval(t);
  }, [key, editorRef]);

  /** Call after every save attempt with its outcome and the blocks that were sent. */
  return useCallback((ok: boolean, blocks: AnyBlock[]) => {
    if (!ok || !pending.current || !migrationSaved(pending.current, blocks)) return;
    pending.current = null;
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  }, [key]);
}
