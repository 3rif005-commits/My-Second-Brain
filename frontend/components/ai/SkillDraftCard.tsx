"use client";

// A skill the chat proposed (skill.propose). Nothing is saved until Save: the
// model can only put a draft in front of you, never store one. What Save sends
// is exactly what this card shows, after your edits. The saved skill is marked
// "Drafted by AI", and a chat that uses it asks before changing anything
// (backend: services/skill_drafts.py, Skill.trusted).
import { useState } from "react";
import { AlertTriangle, Check, Loader2, Sparkles } from "lucide-react";
import { skillsApi, type SkillDraftProposal } from "@/lib/skills";

type State = { kind: "editing" } | { kind: "saving" } | { kind: "saved"; name: string }
  | { kind: "dismissed" } | { kind: "error"; message: string };

export function SkillDraftCard({ draft }: { draft: SkillDraftProposal }) {
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [body, setBody] = useState(draft.body);
  const [state, setState] = useState<State>({ kind: "editing" });

  if (state.kind === "dismissed") {
    return <p className="px-1 text-[12.5px] text-ink-tertiary">Skill draft dismissed. Nothing was saved.</p>;
  }
  if (state.kind === "saved") {
    return (
      <p role="status" className="flex items-center gap-1.5 px-1 text-[12.5px] text-ink-secondary">
        <Check size={13} className="text-emerald-600" /> Saved as the skill <b className="font-medium">{state.name}</b>.
        Find it in Settings → Skills.
      </p>
    );
  }

  async function save() {
    setState({ kind: "saving" });
    try {
      const saved = await skillsApi.saveDraft({ name: name.trim(), description: description.trim(), body, where: draft.where });
      setState({ kind: "saved", name: saved.name });
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  const busy = state.kind === "saving";
  return (
    <section aria-label="Skill draft" className="rounded-lg border border-line bg-surface p-3 text-[13px]">
      <header className="mb-2 flex items-center gap-1.5 font-medium text-ink">
        <Sparkles size={13} className="text-accent" /> Save this as a skill?
      </header>
      <p className="mb-2 text-[12px] text-ink-tertiary">
        The AI drafted it; nothing is saved until you click Save. Read it first: a skill is
        instructions the AI will follow later.
      </p>
      {(draft.warnings.length > 0 || draft.hidden_removed) && (
        <div role="alert" className="mb-2 flex gap-1.5 rounded-md bg-amber-50 p-2 text-[12px] text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
          <AlertTriangle size={13} className="mt-px shrink-0" />
          <span>
            {draft.warnings.length > 0 && <>This draft {draft.warnings.join("; ")}. Remove that before saving. </>}
            {draft.hidden_removed && <>Hidden characters were removed from it.</>}
          </span>
        </div>
      )}
      <label className="mb-1 block text-[11.5px] text-ink-tertiary" htmlFor={`draft-name-${draft.name}`}>Name</label>
      <input id={`draft-name-${draft.name}`} value={name} onChange={(e) => setName(e.target.value)} disabled={busy}
        className="mb-2 w-full rounded-md border border-line bg-transparent px-2 py-1 font-mono text-[12.5px] text-ink outline-none focus:ring-1 focus:ring-accent-300" />
      <label className="mb-1 block text-[11.5px] text-ink-tertiary" htmlFor={`draft-desc-${draft.name}`}>What it is for</label>
      <input id={`draft-desc-${draft.name}`} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy}
        className="mb-2 w-full rounded-md border border-line bg-transparent px-2 py-1 text-ink outline-none focus:ring-1 focus:ring-accent-300" />
      <label className="mb-1 block text-[11.5px] text-ink-tertiary" htmlFor={`draft-body-${draft.name}`}>Instructions</label>
      <textarea id={`draft-body-${draft.name}`} value={body} onChange={(e) => setBody(e.target.value)} disabled={busy} rows={6}
        className="mb-2 w-full resize-y rounded-md border border-line bg-transparent px-2 py-1 font-mono text-[12px] leading-relaxed text-ink outline-none focus:ring-1 focus:ring-accent-300" />
      {state.kind === "error" && <p role="alert" className="mb-2 text-[12px] text-ink-danger">{state.message}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={busy || !name.trim() || !description.trim() || !body.trim()}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-accent-600 px-3 text-[12.5px] font-medium text-white hover:bg-accent-700 disabled:opacity-50">
          {busy && <Loader2 size={12} className="animate-spin" />} Save skill
        </button>
        <button type="button" onClick={() => setState({ kind: "dismissed" })} disabled={busy}
          className="h-7 rounded-md px-3 text-[12.5px] text-ink-secondary hover:bg-surface-hover">
          Dismiss
        </button>
      </div>
    </section>
  );
}
