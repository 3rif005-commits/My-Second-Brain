"use client";

// REGISTRY — the property rows under a skill's title, Notion-style: an icon
// and a label on the left, the value on the right. A new setting = one entry
// here (plus the field in lib/skills.ts SkillDraft and the backend payload).
// Only settings the runtime honours belong here: a property that changes
// nothing would mislead the user.
import { useEffect, useRef, useState } from "react";
import {
  Check, ChevronDown, Command, Eye, FileOutput, Info, Layers, Lock, MapPin, type LucideIcon,
} from "lucide-react";
import type { Skill, SkillDraft, Where } from "@/lib/skills";
import { GROUPS, groupOf } from "./groups";
import { canChangeWhere, titleOf } from "./model";

export interface PropertyCtx {
  skill: Skill;
  draft: SkillDraft;
  set: (patch: Partial<SkillDraft>) => void;
}

export interface SkillProperty {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Shown on hover of the label: what the setting does. */
  help: string;
  visible?: (ctx: PropertyCtx) => boolean;
  render: (ctx: PropertyCtx) => React.ReactNode;
}

// ── small building blocks ───────────────────────────────────────────────────

export interface Option<T extends string> { value: T; label: string; hint?: string }

/** A Notion-like select: the value as a quiet button, options in a popover. */
export function SelectValue<T extends string>({ value, options, onChange, locked, lockedHint, testId }: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  locked?: boolean;
  lockedHint?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const current = options.find((o) => o.value === value);
  if (locked) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-gray-700 dark:text-gray-200" title={lockedHint}>
        {current?.label ?? value}
        <Lock size={11} className="text-gray-300 dark:text-gray-600" />
      </span>
    );
  }
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} data-testid={testId}
        className="inline-flex items-center gap-1 -mx-1.5 px-1.5 h-7 rounded-md text-[13px] text-gray-800
          dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
        {current?.label ?? value}
        <ChevronDown size={12} className="text-gray-400" />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 top-full mt-1 z-30 w-72 py-1 rounded-xl bg-white dark:bg-gray-800
          border border-gray-200 dark:border-gray-700 shadow-xl">
          {options.map((o) => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === value}
              onClick={() => { onChange(o.value); setOpen(false); }}
              className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/5">
              <span className="w-4 pt-0.5 shrink-0">{o.value === value && <Check size={13} className="text-indigo-500" />}</span>
              <span>
                <span className="block text-[13px] text-gray-800 dark:text-gray-100">{o.label}</span>
                {o.hint && <span className="block text-[11.5px] text-gray-500 dark:text-gray-400">{o.hint}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A textarea that grows with its text — for one- or two-line values. */
export function GrowingText({ value, onChange, placeholder, label }: {
  value: string; onChange: (v: string) => void; placeholder?: string; label: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea ref={ref} rows={1} value={value} aria-label={label} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full -mx-1.5 px-1.5 py-1 rounded-md resize-none overflow-hidden bg-transparent text-[13px]
        leading-relaxed text-gray-800 dark:text-gray-100 placeholder:text-gray-400 outline-none
        hover:bg-gray-100/70 dark:hover:bg-white/5 focus:bg-white dark:focus:bg-white/5
        focus:ring-1 focus:ring-indigo-300 dark:focus:ring-indigo-500/40 transition-colors" />
  );
}

// ── the properties ──────────────────────────────────────────────────────────

const WHERE_OPTIONS: Option<Where>[] = GROUPS.map((g) => ({ value: g.where, label: g.label, hint: g.hint }));

const RESULT_OPTIONS: Option<"insert_below" | "rewrite_selection">[] = [
  { value: "insert_below", label: "Add below the selection", hint: "Your text stays; the result goes under it." },
  { value: "rewrite_selection", label: "Replace the selection", hint: "The result takes the selected text's place." },
];

export const PROPERTIES: SkillProperty[] = [
  {
    id: "where",
    label: "Runs in",
    icon: Layers,
    help: "Where the skill is offered. A built-in skill keeps its place — the app calls it there.",
    render: ({ skill, draft, set }) => (
      <SelectValue
        testId="prop-where"
        value={draft.where}
        options={WHERE_OPTIONS}
        locked={!canChangeWhere(skill)}
        lockedHint="A built-in skill keeps its place."
        onChange={(where) => set({
          where,
          output: where === "selection" ? "insert_below" : where === "chat" ? "draft_note" : null,
        })}
      />
    ),
  },
  {
    id: "command",
    label: "Command",
    icon: Command,
    help: "What to type in the AI panel to run it.",
    visible: ({ draft }) => draft.where === "chat",
    render: ({ skill }) => (
      <code className="px-1.5 py-0.5 rounded-md text-[12.5px] bg-gray-100 dark:bg-white/10 text-gray-800 dark:text-gray-100">
        /{skill.name}
      </code>
    ),
  },
  {
    id: "result",
    label: "Result",
    icon: FileOutput,
    help: "What happens to the selected text when the action runs.",
    visible: ({ draft }) => draft.where === "selection",
    render: ({ draft, set }) => (
      <SelectValue
        testId="prop-result"
        value={(draft.output === "rewrite_selection" ? "rewrite_selection" : "insert_below")}
        options={RESULT_OPTIONS}
        onChange={(output) => set({ output })}
      />
    ),
  },
  {
    id: "shows-up",
    label: "Shows up",
    icon: MapPin,
    help: "Where you will find it.",
    render: ({ skill, draft }) => (
      <span className="text-[13px] text-gray-600 dark:text-gray-300">
        {groupOf(draft.where).showsUp(skill.name, titleOf(skill.name))}
      </span>
    ),
  },
  {
    id: "description",
    label: "Description",
    icon: Info,
    help: "The AI reads this to decide when the skill fits. One or two plain sentences.",
    render: ({ draft, set }) => (
      <GrowingText value={draft.description} label="Description"
        placeholder="When should the AI use this? One or two sentences."
        onChange={(description) => set({ description })} />
    ),
  },
  {
    id: "version",
    label: "Version",
    icon: Eye,
    help: "Built-in skills can be edited; your version is used, and Reset brings the original back.",
    render: ({ skill }) => (
      <span className="text-[13px] text-gray-600 dark:text-gray-300">
        {skill.source === "bundled" && "Built-in — editing saves your own version"}
        {skill.source === "edited" && "Your version of a built-in — Reset brings the original back"}
        {skill.source === "user" && "Yours"}
      </span>
    ),
  },
];

/** One row: icon + label on the left, value on the right. */
export function PropertyRow({ p, ctx }: { p: SkillProperty; ctx: PropertyCtx }) {
  const Icon = p.icon;
  return (
    <div className="group flex items-start gap-2 min-h-[34px] py-1" data-testid={`property-${p.id}`}>
      <div className="w-36 shrink-0 flex items-center gap-2 h-7 text-[13px] text-gray-500 dark:text-gray-400" title={p.help}>
        <Icon size={14} className="shrink-0" />
        <span className="truncate">{p.label}</span>
      </div>
      <div className="flex-1 min-w-0 flex items-center min-h-[28px]">{p.render(ctx)}</div>
    </div>
  );
}
