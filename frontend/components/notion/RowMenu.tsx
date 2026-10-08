"use client";

// Right-click on a note, folder or database in the sidebar: "Send to Notion…" (and "Open in Notion").
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, RefreshCw, Send } from "lucide-react";
import { useNotion } from "@/context/NotionContext";
import { notionApi, scopeOf, type ItemKind, type Rule } from "@/lib/notion";

export interface RowMenuTarget { kind: ItemKind; id: string; title: string; x: number; y: number }

export function RowMenu({ target, onClose }: { target: RowMenuTarget; onClose: () => void }) {
  const notion = useNotion();
  const ref = useRef<HTMLDivElement>(null);
  const [rule, setRule] = useState<Rule | null | undefined>(undefined);
  const ruleKind = target.kind === "note" || target.kind === "collection" || target.kind === "database" ? target.kind : null;

  useEffect(() => {
    if (!ruleKind || !notion.connected) return;
    notionApi.rules().then((r) => setRule(r.rules.find((x) => x.scope_kind === ruleKind && x.scope_id === target.id) ?? null)).catch(() => setRule(undefined));
  }, [ruleKind, target.id, notion.connected]);

  async function toggleRule() {
    onClose();
    try {
      if (rule) await notionApi.deleteRule(rule.id);
      else if (ruleKind) await notionApi.addRule({ scope_kind: ruleKind, scope_id: target.id, mode: "on_change" });
    } catch { /* the Settings page shows rules; nothing more to do here */ }
  }

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [onClose]);

  async function openInNotion() {
    onClose();
    try {
      const n = await notionApi.note(target.id);
      if (n.notion_url) window.open(n.notion_url, "_blank", "noopener");
    } catch { /* nothing to open */ }
  }

  const state = target.kind === "note" ? notion.stateOf("note", target.id) : null;
  const left = Math.min(target.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 230);
  return createPortal(
    <div ref={ref} role="menu" aria-label={`Notion actions for ${target.title}`}
      style={{ left, top: target.y }}
      className="fixed z-[9990] w-56 rounded-[var(--menu-radius)] py-1 bg-[var(--menu-bg)] text-[color:var(--menu-fg)] shadow-[var(--menu-shadow)]">
      <button role="menuitem" className="w-full flex items-center gap-2 px-3 h-[var(--menu-row-height)] text-[13px] hover:bg-[var(--menu-row-hover-bg)] text-left"
        onClick={() => { onClose(); notion.open(scopeOf(target.kind, target.id), target.title); }}>
        <Send size={13} /> Send to Notion…
      </button>
      {state && state !== "private" && target.kind === "note" && (
        <button role="menuitem" className="w-full flex items-center gap-2 px-3 h-[var(--menu-row-height)] text-[13px] hover:bg-[var(--menu-row-hover-bg)] text-left"
          onClick={openInNotion}>
          <ExternalLink size={13} /> Open in Notion
        </button>
      )}
      {ruleKind && notion.connected && rule !== undefined && (
        <button role="menuitem" className="w-full flex items-center gap-2 px-3 h-[var(--menu-row-height)] text-[13px] hover:bg-[var(--menu-row-hover-bg)] text-left"
          onClick={toggleRule}>
          <RefreshCw size={13} /> {rule ? "Stop keeping in sync" : "Keep in sync"}
        </button>
      )}
    </div>, document.body);
}
