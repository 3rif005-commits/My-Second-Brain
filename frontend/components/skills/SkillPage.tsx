"use client";

// One skill, as a page: icon and title, the property rows (properties.tsx),
// then tabs (tabs.tsx). Saving is explicit — a stray keystroke in a built-in
// must not quietly become the user's own version — with ⌘S and a bar that
// appears only when there is something to save.
import { useState } from "react";
import { ArrowLeft, ChevronRight, Sparkles } from "lucide-react";
import type { Skill, SkillDraft } from "@/lib/skills";
import { groupOf } from "./groups";
import { IconPicker } from "./IconPicker";
import { PROPERTIES, PropertyRow, type PropertyCtx } from "./properties";
import { TABS, type TabCtx } from "./tabs";
import { SkillMenu, type SkillAction } from "./SkillMenu";
import { SourceMark } from "./SkillSidebar";

export function SkillPage({
  skill, draft, dirty, saving, error, onChange, onSave, onDiscard, onAction, onBack, reportDirty, onSkillChanged,
}: {
  skill: Skill;
  draft: SkillDraft;
  dirty: boolean;
  saving: boolean;
  error: string;
  onChange: (patch: Partial<SkillDraft>) => void;
  onSave: () => void;
  onDiscard: () => void;
  onAction: (a: SkillAction) => void;
  /** Narrow screens: back to the list. */
  onBack: () => void;
  reportDirty: (tabId: string, dirty: boolean) => void;
  onSkillChanged: () => void;
}) {
  const group = groupOf(draft.where);
  const ctx: PropertyCtx & TabCtx = { skill, draft, set: onChange, reportDirty, onSkillChanged };
  const tabs = TABS.filter((t) => t.visible(ctx));
  const [tabId, setTabId] = useState("instructions");
  const tab = tabs.find((t) => t.id === tabId) ?? tabs[0];

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* top bar: where you are, and what you can do */}
      <div className="flex items-center gap-2 px-4 md:px-8 h-12 shrink-0 border-b border-gray-100 dark:border-gray-800">
        <button type="button" onClick={onBack} aria-label="Back to all skills"
          className="md:hidden p-1 -ml-1 rounded-md text-gray-400 hover:text-gray-700">
          <ArrowLeft size={16} />
        </button>
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 min-w-0 text-[13px] text-gray-500">
          <span className="hidden sm:inline">Skills</span>
          <ChevronRight size={12} className="hidden sm:inline text-gray-300" />
          <span className="hidden sm:inline truncate">{group.label}</span>
          <ChevronRight size={12} className="hidden sm:inline text-gray-300" />
          <span className="truncate text-gray-800 dark:text-gray-100">{skill.title}</span>
        </nav>
        <SourceMark source={skill.source} />
        <div className="ml-auto flex items-center gap-1">
          {skill.where === "chat" && (
            <button type="button" onClick={() => onAction("try")}
              title={`Open the AI panel with /${skill.name}`}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[12.5px] text-gray-600
                dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
              <Sparkles size={13} className="text-accent-500" /> Try it
            </button>
          )}
          <SkillMenu skill={skill} onAction={onAction} />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <article className="max-w-3xl mx-auto px-4 md:px-8 pt-8 pb-32">
          {skill.source === "bundled" && (
            <p className="mb-5 text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400 bg-gray-50
              dark:bg-white/[0.03] border border-gray-200/70 dark:border-white/10 rounded-xl px-3.5 py-2.5">
              A built-in skill. Your changes are saved as your own version; the original stays, and
              <span className="font-medium text-gray-700 dark:text-gray-200"> Reset</span> brings it back.
            </p>
          )}

          <IconPicker icon={draft.icon} fallback={group.defaultIcon} onChange={(icon) => onChange({ icon })} />
          <h1 className="mt-2 mb-5 text-[30px] font-bold tracking-tight text-gray-900 dark:text-gray-50">
            {skill.title}
          </h1>

          <div className="space-y-0.5 mb-8">
            {PROPERTIES.filter((p) => !p.visible || p.visible(ctx)).map((p) => (
              <PropertyRow key={p.id} p={p} ctx={ctx} />
            ))}
          </div>

          <div role="tablist" aria-label="Skill views"
            className="flex items-center gap-1 border-b border-gray-100 dark:border-gray-800 mb-4">
            {tabs.map((t) => {
              const badge = t.badge?.(ctx);
              return (
                <button key={t.id} type="button" role="tab" aria-selected={t.id === tab.id}
                  onClick={() => setTabId(t.id)}
                  className={`inline-flex items-center gap-1.5 h-9 px-2.5 -mb-px border-b-2 text-[13px] transition-colors ${
                    t.id === tab.id
                      ? "border-gray-900 dark:border-gray-100 text-gray-900 dark:text-gray-100"
                      : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
                  <t.icon size={13} /> {t.label}
                  {badge && <span className="text-[11px] text-gray-400">{badge}</span>}
                </button>
              );
            })}
          </div>
          <div role="tabpanel">{tab.render(ctx)}</div>
        </article>
      </div>

      {/* save bar — only while there is something to save */}
      {(dirty || error) && (
        <div className="shrink-0 border-t border-gray-100 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 backdrop-blur">
          {/* pr-20: the round AI button sits bottom-right on every page */}
          <div className="max-w-3xl mx-auto pl-4 md:pl-8 pr-20 h-14 flex items-center gap-2">
            <span className={`text-[12.5px] ${error ? "text-red-500" : "text-gray-500"}`}>
              {error || (skill.source === "bundled" ? "Unsaved changes — saving creates your own version" : "Unsaved changes")}
            </span>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={onDiscard} disabled={saving}
                className="h-8 px-3 rounded-lg text-[13px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10">
                Discard
              </button>
              <button type="button" onClick={onSave} disabled={saving || !dirty || !draft.description.trim()}
                title="Save (⌘S)"
                className="h-8 px-4 rounded-lg text-[13px] font-medium bg-accent-600 text-white hover:bg-accent-500 disabled:opacity-40">
                {saving ? "Saving…" : "Save"} <span className="ml-1 text-[11px] opacity-70">⌘S</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
