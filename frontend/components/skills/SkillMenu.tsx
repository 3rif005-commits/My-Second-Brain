"use client";

// The "⋯" menu of a skill — in the list (on hover) and on its page. One place
// for what can be done to a skill, so both stay the same. A new action = one
// entry in `actions` below.
import { useEffect, useRef, useState } from "react";
import { Copy, MoreHorizontal, RotateCcw, Sparkles, Trash2, type LucideIcon } from "lucide-react";
import type { Skill } from "@/lib/skills";

export type SkillAction = "try" | "duplicate" | "reset" | "delete";

interface ActionDef {
  id: SkillAction;
  label: string;
  icon: LucideIcon;
  danger?: boolean;
  visible: (s: Skill) => boolean;
}

const actions: ActionDef[] = [
  { id: "try", label: "Try in the AI panel", icon: Sparkles, visible: (s) => s.where === "chat" },
  { id: "duplicate", label: "Duplicate", icon: Copy, visible: () => true },
  { id: "reset", label: "Reset to original", icon: RotateCcw, visible: (s) => s.can_reset },
  { id: "delete", label: "Delete", icon: Trash2, danger: true, visible: (s) => s.can_delete },
];

export function SkillMenu({ skill, onAction, className = "" }: {
  skill: Skill;
  onAction: (a: SkillAction) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const shown = actions.filter((a) => a.visible(skill));
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button type="button" aria-label={`More actions for ${skill.title}`} aria-haspopup="menu"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-7 h-7 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700
          dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-white/10 transition-colors">
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-1 z-40 w-52 py-1 rounded-xl bg-white dark:bg-gray-800
          border border-gray-200 dark:border-gray-700 shadow-xl">
          {shown.map((a) => (
            <button key={a.id} type="button" role="menuitem"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onAction(a.id); }}
              className={`w-full flex items-center gap-2.5 px-3 h-8 text-left text-[13px] hover:bg-gray-50 dark:hover:bg-white/5 ${
                a.danger ? "text-red-600 dark:text-red-400" : "text-gray-700 dark:text-gray-200"}`}>
              <a.icon size={14} className={a.danger ? "" : "text-gray-400"} /> {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
