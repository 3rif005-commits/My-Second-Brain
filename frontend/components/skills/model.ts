// The pure part of the skills editor: drafts, dirtiness, names, search.
// No React here, so all of it is unit-tested (model.test.ts).
import type { Skill, SkillDraft, Where } from "@/lib/skills";

export function draftOf(s: Skill): SkillDraft {
  return { description: s.description, body: s.body, where: s.where, output: s.output, icon: s.icon,
    multi_source: s.multi_source ?? null };
}

/** Has the draft moved away from what is saved? Compares what the editor
 *  can change — nothing else. */
export function isDirty(saved: Skill | null, draft: SkillDraft | null): boolean {
  if (!saved || !draft) return false;
  const a = draftOf(saved);
  return a.description !== draft.description || a.body !== draft.body || a.where !== draft.where
    || (a.output ?? null) !== (draft.output ?? null) || (a.icon ?? null) !== (draft.icon ?? null)
    || (a.multi_source ?? null) !== (draft.multi_source ?? null);
}

/** What `where` a skill can be moved to — a built-in keeps its kind (the app
 *  calls it in a specific place); a skill of the user's own can move. */
export function canChangeWhere(s: Skill): boolean {
  return s.source === "user";
}

/** "Exam questions!" → "exam-questions": the command a new skill gets. */
export function slugify(title: string): string {
  return title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63);
}

/** Why a name cannot be used, or null. Mirrors the backend's rule. */
export function nameProblem(name: string, taken: string[]): string | null {
  if (!name) return "Give it a name.";
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(name)) return "Lowercase letters, digits and dashes — at least 2.";
  if (taken.includes(name)) return `/${name} already exists.`;
  return null;
}

/** "study-guide" → "Study guide". */
export function titleOf(name: string): string {
  return name.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
}

/** Search over name, title and description, case-insensitive. */
export function matches(s: Skill, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [s.name, s.title, s.description].some((f) => f.toLowerCase().includes(t));
}

/** A copy to start a new skill from ("Duplicate"). */
export function duplicateOf(s: Skill, taken: string[]): { name: string; draft: SkillDraft } {
  let name = `${s.name}-copy`.slice(0, 63);
  for (let i = 2; taken.includes(name); i++) name = `${s.name}-copy-${i}`.slice(0, 63);
  return { name, draft: { ...draftOf(s), where: s.where as Where } };
}
