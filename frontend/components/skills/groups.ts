// REGISTRY — the kinds of skill, one entry per place a skill can run. The
// sidebar groups by these, the "Runs in" property offers them, the template
// gallery sorts by them. A new place a skill can run = one entry here (and
// the backend's WHERE in routers/skills_api.py).
import { BookOpen, TextSelect, Sparkles, type LucideIcon } from "lucide-react";
import type { Where } from "@/lib/skills";

export interface SkillGroup {
  where: Where;
  /** The group's name in the sidebar and the "Runs in" menu. */
  label: string;
  icon: LucideIcon;
  /** One line: what a skill of this kind is. */
  hint: string;
  /** Where it shows up, in the user's words — the "Shows up" property. */
  showsUp: (name: string, title: string) => string;
  /** The icon a skill of this kind gets until it has its own. */
  defaultIcon: string;
}

export const GROUPS: SkillGroup[] = [
  {
    where: "chat",
    label: "AI panel jobs",
    icon: Sparkles,
    hint: "Runs on a note's sources and writes a result you can put in the note.",
    showsUp: (name) => `Type /${name} in the AI panel, or pick it from the editor's / menu`,
    defaultIcon: "✨",
  },
  {
    where: "selection",
    label: "Actions on selected text",
    icon: TextSelect,
    hint: "Works on the text you select in a note.",
    showsUp: (_, title) => `Select text in a note → AI menu → ${title}`,
    defaultIcon: "✏️",
  },
  {
    where: "assistant",
    label: "Assistant rules",
    icon: BookOpen,
    hint: "Instructions the AI follows when a request matches the description.",
    showsUp: () => "Read by the AI whenever a request matches its description",
    defaultIcon: "📘",
  },
];

export function groupOf(where: Where): SkillGroup {
  return GROUPS.find((g) => g.where === where) ?? GROUPS[GROUPS.length - 1];
}
