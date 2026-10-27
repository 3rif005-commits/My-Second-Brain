// Skills — the types and the API, shared by Settings → Skills and anything
// else that lists or edits skills. The backend is routers/skills_api.py.

/** Where a skill runs — one plain choice (see routers/skills_api.py). */
export type Where = "chat" | "selection" | "assistant";

/** What a selection skill does with its result. Jobs always draft a note;
 *  assistant rules only shape replies, so they have no choice to make. */
export type SelectionOutput = "insert_below" | "rewrite_selection";

export type SkillSource = "bundled" | "edited" | "user";

/** Where a skill came from (backend: Skill.origin). Drafted and installed
 * skills are treated as untrusted text: never picked unasked, and a chat that
 * uses one asks before it changes anything. */
export type SkillOrigin = "builtin" | "user" | "assistant" | "installed";

/** How the study guide writes from several sources (E9). */
export type MultiSource = "auto" | "single" | "chapters";

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
  origin?: SkillOrigin;
  /** Installed skills: the link it came from and the exact version (pinned). */
  source_url?: string | null;
  pin?: string | null;
  can_reset: boolean;
  can_delete: boolean;
  /** The study guide only; null for every other skill. */
  multi_source?: MultiSource | null;
}

/** What the editor changes; the rest of a Skill is read-only. */
export interface SkillDraft {
  description: string;
  body: string;
  where: Where;
  output: string | null;
  icon: string | null;
  multi_source?: MultiSource | null;
}

/** One preference "Learn from my edits" suggests (E12). */
export interface StyleSuggestion { preference: string; evidence: string }

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

/** A drafted skill the curator set aside after 30 days unused (never deleted). */
export interface ArchivedSkill {
  name: string;
  description: string;
  origin: SkillOrigin;
  archived_at: string;
}

/** What the chat proposes with skill.propose: nothing is saved until Save. */
export interface SkillDraftProposal {
  name: string;
  description: string;
  body: string;
  where: "assistant" | "chat";
  /** Plain-language warnings (instruction-like text found). Advisory. */
  warnings: string[];
  /** Hidden characters were removed from what the model wrote. */
  hidden_removed?: boolean;
}

/** Everything to read before installing (backend: services/skill_install.py). */
export interface InstallPreview {
  name: string;
  description: string;
  body: string;
  /** Files that will be stored: SKILL.md and reference texts. */
  files: string[];
  /** Everything else in the folder — scripts included — never stored or run. */
  skipped: string[];
  warnings: string[];
  source: string;
  pin: string;
  content_hash: string;
}

export type UpdateCheck =
  | { up_to_date: true; pin?: string | null }
  | (InstallPreview & { up_to_date: false; diff: string; current_pin?: string | null });

export const skillsApi = {
  list: () => fetch("/api/skills").then((r) => json<{ skills: Skill[] }>(r)).then((d) => d.skills ?? []),
  /** The skills and the archived ones, for Settings → Skills. */
  overview: () => fetch("/api/skills")
    .then((r) => json<{ skills: Skill[]; archived?: ArchivedSkill[] }>(r))
    .then((d) => ({ skills: d.skills ?? [], archived: d.archived ?? [] })),
  restore: (name: string) =>
    fetch(`/api/skills/${enc(name)}/restore`, { method: "POST", headers: JSON_HEADERS, body: "{}" })
      .then((r) => json<Skill>(r)),
  installPreview: (url: string) =>
    fetch("/api/skills/install-preview", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url }) })
      .then((r) => json<InstallPreview>(r)),
  /** Installs exactly the previewed content (same hash), or fails. */
  install: (url: string, content_hash: string) =>
    fetch("/api/skills/install", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ url, content_hash }) })
      .then((r) => json<Skill>(r)),
  checkUpdate: (name: string) =>
    fetch(`/api/skills/${enc(name)}/check-update`, { method: "POST", headers: JSON_HEADERS, body: "{}" })
      .then((r) => json<UpdateCheck>(r)),
  applyUpdate: (name: string, content_hash: string) =>
    fetch(`/api/skills/${enc(name)}/update`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ content_hash }) })
      .then((r) => json<Skill>(r)),
  /** Save a drafted skill exactly as the card shows it (after any edits). */
  saveDraft: (d: Pick<SkillDraftProposal, "name" | "description" | "body" | "where">) =>
    fetch("/api/skills/drafts", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(d) })
      .then((r) => json<Skill>(r)),
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
  /** Suggestions only — the user adds what they want to Your style. */
  learnStyle: (name: string) =>
    fetch(`/api/skills/${enc(name)}/learn-style`, { method: "POST", headers: JSON_HEADERS, body: "{}" })
      .then((r) => json<{ pairs: number; suggestions: StyleSuggestion[]; reason: string | null }>(r)),
  readFile: (name: string, path: string) =>
    fetch(`/api/skills/${enc(name)}/files/${path}`).then((r) => json<{ content: string }>(r)),
  writeFile: (name: string, path: string, content: string) =>
    fetch(`/api/skills/${enc(name)}/files/${path}`, {
      method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ content }),
    }).then((r) => json<{ content: string }>(r)),
};
