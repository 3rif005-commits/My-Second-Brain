"use client";

import { Sparkles } from "lucide-react";
import { formatSkillCost, type NoteSkill } from "@/lib/workspace";

interface Props {
  skills: NoteSkill[];
  /** The skill being started, if any. */
  starting: string | null;
  /** A run is already in flight; the bar goes quiet rather than queueing. */
  busy: boolean;
  onRun: (skill: NoteSkill) => void;
}

/** The workspace's other jobs.
 *
 * Every chip carries its price before the click, and a skill that cannot run
 * yet says why — "comparing needs at least two sources" is worth more than a
 * greyed-out button. Nothing here fires on its own: that is the rule the
 * workspace broke before, and the reason it stopped generating unasked.
 */
export function SkillBar({ skills, starting, busy, onRun }: Props) {
  if (!skills.length) return null;

  return (
    <div className="ws-scroll-x flex items-center gap-1.5 px-2 pb-2 shrink-0 overflow-x-auto">
      <span className="shrink-0 text-[11px] text-gray-400 dark:text-gray-500 pl-1 pr-0.5">
        Also
      </span>
      {skills.map((skill) => {
        const blocked = skill.runnable !== null;
        const label = skill.skill.replace(/-/g, " ");
        return (
          <button
            key={skill.skill}
            onClick={() => onRun(skill)}
            disabled={blocked || busy || starting !== null}
            title={blocked ? skill.runnable! : `${skill.description} · ${formatSkillCost(skill)}`}
            className={`shrink-0 inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px]
              border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400
              disabled:cursor-not-allowed ${
              blocked
                ? "border-dashed border-gray-200 dark:border-white/10 text-gray-400 dark:text-gray-600"
                : "border-gray-200/80 dark:border-white/10 text-gray-600 dark:text-gray-300 " +
                  "hover:bg-white dark:hover:bg-white/5 hover:text-gray-900 dark:hover:text-gray-100"
            }`}
          >
            <Sparkles size={11} className={blocked ? "opacity-40" : "text-indigo-500"} />
            <span className="capitalize">{label}</span>
            <span className="text-gray-400 dark:text-gray-500">
              {blocked ? skill.runnable : formatSkillCost(skill)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
