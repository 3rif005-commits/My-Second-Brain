"use client";

// Settings → Skills: every skill the app runs, readable and editable
// (user decision, 2026-09-24). A built-in skill is edited as the user's own
// copy, which wins; Reset brings the original back. A new skill can be a job
// in the AI panel, an action on selected text, or instructions the assistant
// follows.
import { useEffect, useState } from "react";
import { Plus, Edit2, Trash2, RotateCcw, Save, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

type Where = "chat" | "selection" | "assistant";

interface Skill {
  name: string;
  title: string;
  description: string;
  body: string;
  where: Where;
  source: "bundled" | "edited" | "user";
  can_reset: boolean;
  can_delete: boolean;
}

const WHERE: { value: Where; label: string; hint: string }[] = [
  { value: "chat", label: "Job in the AI panel",
    hint: "Runs on all of the note's sources: type /name in the AI panel or the editor's / menu." },
  { value: "selection", label: "Action on selected text",
    hint: "Appears in the AI menu when you select text in a note." },
  { value: "assistant", label: "Assistant instructions",
    hint: "The chat assistant follows these when a request matches the description." },
];

const SOURCE_BADGE: Record<Skill["source"], { label: string; cls: string }> = {
  bundled: { label: "Built-in", cls: "bg-gray-100 text-gray-500 dark:bg-white/5 dark:text-gray-400" },
  edited: { label: "Edited", cls: "bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300" },
  user: { label: "Yours", cls: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300" },
};

type Draft = { name: string; description: string; body: string; where: Where };

export default function SkillsSettingsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Skill | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: "", description: "", body: "", where: "chat" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<{ skill: Skill; action: "reset" | "delete" } | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/skills").catch(() => null);
    if (res?.ok) setSkills((await res.json()).skills ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  function openEdit(skill: Skill) {
    setEditing(skill);
    setDraft({ name: skill.name, description: skill.description, body: skill.body, where: skill.where });
    setError("");
  }
  function openNew() {
    setEditing("new");
    setDraft({ name: "", description: "", body: "", where: "chat" });
    setError("");
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const isNew = editing === "new";
      const res = await fetch(isNew ? "/api/skills" : `/api/skills/${(editing as Skill).name}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isNew ? draft : { description: draft.description, body: draft.body, where: draft.where }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.detail === "string" ? data.detail : `Error ${res.status}`);
        return;
      }
      await load();
      setEditing(null);
    } finally {
      setSaving(false);
    }
  }

  async function runConfirmed() {
    if (!confirm) return;
    await fetch(`/api/skills/${confirm.skill.name}`, { method: "DELETE" });
    setConfirm(null);
    await load();
  }

  if (editing) {
    const isNew = editing === "new";
    const skill = isNew ? null : editing;
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="flex items-center gap-3 mb-6">
            <button onClick={() => setEditing(null)} title="Back"
              className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
              <X size={18} />
            </button>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
              {isNew ? "New skill" : `Edit: ${skill!.title}`}
            </h1>
            {skill?.source === "bundled" && (
              <span className="text-xs text-gray-400">Saving keeps the original — Reset brings it back.</span>
            )}
          </div>

          <div className="space-y-5">
            {isNew && (
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Name (lowercase, dashes)</label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-lg
                    bg-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  placeholder="exam-questions"
                />
              </div>
            )}

            <fieldset>
              <legend className="block text-xs font-medium text-gray-500 mb-2">Where it runs</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {WHERE.map((w) => (
                  <label key={w.value}
                    className={`flex flex-col gap-1 p-3 rounded-xl border cursor-pointer transition-colors ${
                      draft.where === w.value
                        ? "border-indigo-400 bg-indigo-50/60 dark:bg-indigo-500/10"
                        : "border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                    <span className="flex items-center gap-2 text-sm font-medium text-gray-800 dark:text-gray-100">
                      <input type="radio" name="where" value={w.value} checked={draft.where === w.value}
                        onChange={() => setDraft((d) => ({ ...d, where: w.value }))} />
                      {w.label}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">{w.hint}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Description — one line; the AI uses it to know when this skill fits
              </label>
              <input
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-white/10 rounded-lg
                  bg-white dark:bg-white/5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Write five exam questions from the attached sources."
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Instructions</label>
              <textarea
                value={draft.body}
                onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                rows={22}
                spellCheck={false}
                className="w-full px-3 py-2 text-[12.5px] leading-relaxed font-mono border border-gray-200
                  dark:border-white/10 rounded-lg bg-white dark:bg-white/5 focus:outline-none
                  focus:ring-2 focus:ring-indigo-400 resize-y"
                placeholder="What the AI should do, step by step…"
              />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || !draft.description.trim() || !draft.body.trim() || (isNew && !draft.name.trim())}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg
                  hover:bg-indigo-700 disabled:opacity-50 transition-colors">
                <Save size={14} />
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-50">Skills</h1>
            <p className="text-xs text-gray-400 mt-0.5">
              What the AI knows how to do. Edit any of them — built-ins keep their original.
            </p>
          </div>
          <button onClick={openNew}
            className="flex items-center gap-1.5 px-3 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors">
            <Plus size={14} />
            New skill
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <div className="space-y-6">
            {WHERE.map((w) => {
              const group = skills.filter((s) => s.where === w.value);
              if (!group.length) return null;
              return (
                <section key={w.value}>
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{w.label}</h2>
                  <ul className="divide-y divide-gray-100 dark:divide-white/5 border border-gray-100
                    dark:border-white/10 rounded-xl overflow-hidden">
                    {group.map((skill) => (
                      <li key={skill.name}
                        className="flex items-start gap-3 px-4 py-3 bg-white dark:bg-white/[0.02] hover:bg-gray-50 dark:hover:bg-white/5">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {w.value === "chat" ? `/${skill.name}` : skill.title}
                            </span>
                            <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${SOURCE_BADGE[skill.source].cls}`}>
                              {SOURCE_BADGE[skill.source].label}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">{skill.description}</p>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => openEdit(skill)} title="Edit"
                            className="p-1.5 text-gray-400 hover:text-indigo-600 rounded">
                            <Edit2 size={14} />
                          </button>
                          {skill.can_reset && (
                            <button onClick={() => setConfirm({ skill, action: "reset" })} title="Reset to the original"
                              className="p-1.5 text-gray-400 hover:text-amber-600 rounded">
                              <RotateCcw size={14} />
                            </button>
                          )}
                          {skill.can_delete && (
                            <button onClick={() => setConfirm({ skill, action: "delete" })} title="Delete"
                              className="p-1.5 text-gray-400 hover:text-red-500 rounded">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.action === "reset" ? `Reset "${confirm?.skill.title}"?` : `Delete "${confirm?.skill.title}"?`}
        description={confirm?.action === "reset"
          ? "Your edits are discarded and the built-in version is used again."
          : "This skill is removed. This cannot be undone."}
        confirmLabel={confirm?.action === "reset" ? "Reset" : "Delete"}
        danger={confirm?.action === "delete"}
        onConfirm={runConfirmed}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
