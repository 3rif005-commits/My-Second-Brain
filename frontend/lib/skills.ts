// Skills — the types and the API, shared by Settings → Skills and anything
// else that lists or edits skills. The backend is routers/skills_api.py.

/** Where a skill runs — one plain choice (see routers/skills_api.py). */
export type Where = "chat" | "selection" | "assistant";

/** What a selection skill does with its result. Jobs always draft a note;
 *  assistant rules only shape replies, so they have no choice to make. */
export type SelectionOutput = "insert_below" | "rewrite_selection";

export type SkillSource = "bundled" | "edited" | "user";

export interface Skill {
  name: string;
  title: string;
  description: string;
  body: string;
  where: Where;
  output: string | null;
  icon: string | null;
  /** Reference files, as paths inside the skill ("reference/x.md"). */
  files: string[];
  source: SkillSource;
  can_reset: boolean;
  can_delete: boolean;
}

/** What the editor changes; the rest of a Skill is read-only. */
export interface SkillDraft {
  description: string;
  body: string;
  where: Where;
  output: string | null;
  icon: string | null;
}

export interface NewSkill extends SkillDraft {
  name: string;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const detail = typeof data.detail === "string" ? data.detail : data.error;
    throw new Error(detail || `Error ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const enc = encodeURIComponent;
const JSON_HEADERS = { "Content-Type": "application/json" };

export const skillsApi = {
  list: () => fetch("/api/skills").then((r) => json<{ skills: Skill[] }>(r)).then((d) => d.skills ?? []),
  get: (name: string) => fetch(`/api/skills/${enc(name)}`).then((r) => json<Skill>(r)),
  save: (name: string, d: SkillDraft) =>
    fetch(`/api/skills/${enc(name)}`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify(d) })
      .then((r) => json<Skill>(r)),
  create: (s: NewSkill) =>
    fetch("/api/skills", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(s) })
      .then((r) => json<Skill>(r)),
  /** Reset an edited built-in, or delete a skill the user made. */
  remove: async (name: string) => {
    const r = await fetch(`/api/skills/${enc(name)}`, { method: "DELETE" });
    if (!r.ok && r.status !== 204) await json(r);
  },
  original: (name: string) =>
    fetch(`/api/skills/${enc(name)}/original`)
      .then((r) => json<{ description: string; body: string; output: string | null }>(r)),
  readFile: (name: string, path: string) =>
    fetch(`/api/skills/${enc(name)}/files/${path}`).then((r) => json<{ content: string }>(r)),
  writeFile: (name: string, path: string, content: string) =>
    fetch(`/api/skills/${enc(name)}/files/${path}`, {
      method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ content }),
    }).then((r) => json<{ content: string }>(r)),
};
