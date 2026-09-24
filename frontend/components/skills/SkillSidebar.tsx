"use client";

// The list of skills, Notion-sidebar style: search, "New", and the skills
// grouped by where they run (groups.ts), each with its icon and a quiet mark
// for edited built-ins and the user's own.
import { Plus, Search } from "lucide-react";
import type { Skill } from "@/lib/skills";
import { GROUPS } from "./groups";
import { matches } from "./model";
import { SkillMenu, type SkillAction } from "./SkillMenu";

export function SourceMark({ source }: { source: Skill["source"] }) {
  if (source === "bundled") return null;
  return (
    <span className={`shrink-0 text-[10.5px] px-1.5 py-px rounded-full ${source === "edited"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
      : "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"}`}>
      {source === "edited" ? "Edited" : "Yours"}
    </span>
  );
}

export function SkillSidebar({ skills, selected, query, onQuery, onSelect, onNew, onAction, loading }: {
  skills: Skill[];
  selected: string | null;
  query: string;
  onQuery: (q: string) => void;
  onSelect: (name: string) => void;
  onNew: () => void;
  onAction: (s: Skill, a: SkillAction) => void;
  loading: boolean;
}) {
  const shown = skills.filter((s) => matches(s, query));
  return (
    <aside className="flex flex-col min-h-0 h-full" aria-label="Skills">
      <div className="px-3 pt-4 pb-2 space-y-2 shrink-0">
        <div className="flex items-center justify-between px-1">
          <h1 className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">Skills</h1>
          <button type="button" onClick={onNew}
            className="inline-flex items-center gap-1 h-7 px-2.5 rounded-lg text-[12.5px] font-medium
              bg-indigo-600 text-white hover:bg-indigo-500 transition-colors">
            <Plus size={13} strokeWidth={2.5} /> New
          </button>
        </div>
        <label className="flex items-center gap-2 h-8 px-2.5 rounded-lg bg-gray-100/80 dark:bg-white/5
          focus-within:ring-1 focus-within:ring-indigo-300">
          <Search size={13} className="text-gray-400 shrink-0" />
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search skills"
            aria-label="Search skills"
            className="flex-1 min-w-0 bg-transparent outline-none text-[13px] text-gray-800 dark:text-gray-100 placeholder:text-gray-400" />
        </label>
      </div>

      <nav className="flex-1 min-h-0 overflow-y-auto px-2 pb-4">
        {loading && <p className="px-2 py-2 text-[12.5px] text-gray-400">Loading…</p>}
        {!loading && shown.length === 0 && (
          <p className="px-2 py-2 text-[12.5px] text-gray-400">
            {query ? "No skill matches." : "No skills yet."}
          </p>
        )}
        {GROUPS.map((g) => {
          const group = shown.filter((s) => s.where === g.where);
          if (!group.length) return null;
          return (
            <section key={g.where} className="mt-3 first:mt-1">
              <h2 className="flex items-center gap-1.5 px-2 h-6 text-[11px] font-semibold uppercase tracking-wide text-gray-400"
                title={g.hint}>
                <g.icon size={11} /> {g.label}
                <span className="ml-auto font-normal normal-case tracking-normal">{group.length}</span>
              </h2>
              <ul className="space-y-px">
                {group.map((s) => (
                  <li key={s.name} className="group relative">
                    <button type="button" aria-current={s.name === selected ? "page" : undefined}
                      onClick={() => onSelect(s.name)}
                      className={`w-full flex items-center gap-2 pl-2 pr-9 h-8 rounded-md text-left select-none outline-none
                        focus-visible:ring-1 focus-visible:ring-indigo-300 ${s.name === selected
                        ? "bg-gray-200/70 dark:bg-white/10 text-gray-900 dark:text-gray-100"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"}`}>
                      <span className="w-5 text-center text-[15px] leading-none shrink-0" aria-hidden>{s.icon ?? g.defaultIcon}</span>
                      <span className="flex-1 min-w-0 truncate text-[13px]">{s.title}</span>
                      <SourceMark source={s.source} />
                    </button>
                    {/* beside the row, not inside it: a button in a button is not one */}
                    <div className="absolute right-1 top-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                      <SkillMenu skill={s} onAction={(a) => onAction(s, a)} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </nav>
    </aside>
  );
}
