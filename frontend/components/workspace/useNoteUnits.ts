"use client";

// The units of one note (lib/units.ts): which heading block each one is, what
// state it is in, and the four things that change them — the skeleton landing,
// an exercise being written into its heading, Mark checked, and Redo.
import { useCallback, useEffect, useRef, useState } from "react";
import type { BlockEditorHandle } from "@/components/editor/BlockEditor";
import { compactBlockHtml } from "@/components/editor/editorAI";
import {
  bindUnits, isUntouchedSkeleton, readDraftUnits, unitsApi,
  type FillOutcome, type Unit,
} from "@/lib/units";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

export interface NoteUnits {
  units: Unit[];
  refresh: () => Promise<void>;
  /** Remember the keys of a draft about to be applied (before BlockNote parses it). */
  collect: (html: string) => void;
  /** Pair the remembered keys with the blocks that landed, and store them. */
  bindApplied: (blocks: AnyBlock[]) => void;
  /** Put a written exercise, "overview" or "revision" into the note. */
  fill: (key: string, html: string) => Promise<FillOutcome>;
  setChecked: (key: string, checked: boolean) => Promise<void>;
  /** Write one unit again; it replaces the unit and waits for Keep / Back. */
  redo: (key: string, note: string) => Promise<void>;
  keep: (key: string) => Promise<void>;
  backToOld: (key: string) => Promise<void>;
  /** The keys being written again right now. */
  busy: Set<string>;
}

export function useNoteUnits(noteId: string,
                             editorRef: React.RefObject<BlockEditorHandle | null>): NoteUnits {
  const [units, setUnits] = useState<Unit[]>([]);
  const unitsRef = useRef<Unit[]>([]);
  const pendingKeys = useRef<(string | null)[] | null>(null);
  /** The version a Redo replaced, and where its keys pointed, for Back to old. */
  const oldVersions = useRef<Map<string, { block: AnyBlock; bindings: { key: string; block_id: string }[] }>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());

  const put = (next: Unit[]) => { unitsRef.current = next; setUnits(next); };

  const refresh = useCallback(async () => {
    try { put(await unitsApi.list(noteId)); } catch { /* no table yet, or offline */ }
  }, [noteId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const bindBlocks = useCallback(async (blocks: AnyBlock[], keys: (string | null)[]) => {
    const pairs = bindUnits(blocks, keys);
    if (!pairs.length) return;
    // Show them at once; the stored rows follow.
    put(unitsRef.current.map((u) => {
      const p = pairs.find((x) => x.key === u.key);
      return p ? { ...u, block_id: p.block_id } : u;
    }));
    await unitsApi.bind(noteId, pairs).catch(() => {});
  }, [noteId]);

  const collect = useCallback((html: string) => {
    const keys = readDraftUnits(html);
    pendingKeys.current = keys.some((k) => k != null) ? keys : null;
  }, []);

  const bindApplied = useCallback((blocks: AnyBlock[]) => {
    const keys = pendingKeys.current;
    pendingKeys.current = null;
    if (!keys) return;
    // The plan was stored when the map ran: read it, then pin each key.
    void (async () => { await refresh(); await bindBlocks(blocks, keys); })();
  }, [refresh, bindBlocks]);

  const blockOf = (key: string) => {
    const u = unitsRef.current.find((x) => x.key === key);
    return u?.block_id ? editorRef.current?.getBlock(u.block_id) : undefined;
  };

  const fill = useCallback(async (key: string, html: string): Promise<FillOutcome> => {
    const ed = editorRef.current;
    if (!ed) return "missing";
    if (!unitsRef.current.length) await refresh();
    let landed: AnyBlock[] = [];
    if (key === "overview") {
      const root = blockOf("");
      if (!root) return "missing";
      const doc = ed.getDocument();
      const next = doc[doc.findIndex((b: AnyBlock) => b.id === root.id) + 1];
      landed = next?.type === "callout" && next.props?.calloutType === "OVERVIEW"
        ? await ed.replaceBlockWithHtml(next.id, html)
        : await ed.insertHtmlAfter(root.id, html);
      return landed.length ? "filled" : "missing";
    }
    const block = blockOf(key);
    if (!block) return "missing";
    if (key !== "revision" && !isUntouchedSkeleton(block)) return "edited";
    landed = key === "revision"
      ? await ed.replaceSectionWithHtml(block.id, html)
      : await ed.replaceBlockWithHtml(block.id, html);
    if (!landed.length) return "missing";
    await bindBlocks(landed, readDraftUnits(html));
    await refresh();
    return "filled";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorRef, refresh, bindBlocks]);

  const setChecked = useCallback(async (key: string, checked: boolean) => {
    put(unitsRef.current.map((u) => u.key === key
      ? { ...u, state: checked ? "checked" : "written", problems: checked ? [] : u.problems } : u));
    await unitsApi.patch(noteId, key, { state: checked ? "checked" : "written" }).catch(() => {});
  }, [noteId]);

  const redo = useCallback(async (key: string, note: string) => {
    const ed = editorRef.current;
    const block = blockOf(key);
    if (!ed || !block) throw new Error("That part is no longer in the note.");
    setBusy((s) => new Set(s).add(key));
    try {
      const current = compactBlockHtml(await ed.blockHtml(block.id));
      const res = await unitsApi.redo(noteId, key, current, note);
      const now = blockOf(key);
      if (!now) throw new Error("That part was deleted while it was being written.");
      const bindings = unitsRef.current
        .filter((u) => (u.key === key || u.key.startsWith(key + ".")) && u.block_id)
        .map((u) => ({ key: u.key, block_id: u.block_id! }));
      oldVersions.current.set(key, { block: structuredClone(now), bindings });
      const landed = await ed.replaceBlockWithHtml(now.id, res.html);
      await bindBlocks(landed, readDraftUnits(res.html));
      await refresh();
      // Show what changed: scrolling to its first line opens the toggle.
      const first = landed[0]?.children?.[0]?.id ?? landed[0]?.id;
      if (first) ed.scrollToBlock(first);
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, editorRef, refresh, bindBlocks]);

  const keep = useCallback(async (key: string) => {
    oldVersions.current.delete(key);
    put(unitsRef.current.map((u) => u.key === key ? { ...u, pending: false } : u));
    await unitsApi.patch(noteId, key, { pending: false }).catch(() => {});
  }, [noteId]);

  const backToOld = useCallback(async (key: string) => {
    const ed = editorRef.current;
    const old = oldVersions.current.get(key);
    const now = blockOf(key);
    if (ed && old && now) {
      ed.replaceBlockWithBlocks(now.id, [old.block]);
      // The old blocks come back with their own ids: the keys point at them again.
      put(unitsRef.current.map((u) => {
        const b = old.bindings.find((x) => x.key === u.key);
        return b ? { ...u, block_id: b.block_id } : u;
      }));
      await unitsApi.bind(noteId, old.bindings).catch(() => {});
    } else if (ed && now) {
      // After a reload the old blocks are gone from memory: the server kept
      // the HTML each Redo replaced (live 2026-11-24: Back did nothing).
      const unit = unitsRef.current.find((u) => u.key === key);
      const last = (unit?.versions ?? []).at(-1) as { html?: string } | undefined;
      if (!last?.html) throw new Error("The old version isn't stored — use Ctrl+Z in the note.");
      const landed = await ed.replaceBlockWithHtml(now.id, last.html);
      // That HTML came from the editor and carries no data-unit: the part and
      // its sub-parts are its headings, in page order.
      const keys = unitsRef.current
        .filter((u) => u.key === key || u.key.startsWith(key + "."))
        .sort((a, b) => a.position - b.position).map((u) => u.key);
      await bindBlocks(landed, keys);
    }
    oldVersions.current.delete(key);
    put(unitsRef.current.map((u) => u.key === key ? { ...u, pending: false } : u));
    await unitsApi.patch(noteId, key, { pending: false, state: "written" }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, editorRef, bindBlocks]);

  return { units, refresh, collect, bindApplied, fill, setChecked, redo, keep, backToOld, busy };
}
