"use client";

// "New skill": pick a starting point (templates.ts), then name it. Like
// Notion's template picker — a gallery first, the blank page one click away.
// "Duplicate" opens straight on the naming step with the copy filled in.
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, X } from "lucide-react";
import type { SkillDraft } from "@/lib/skills";
import { GROUPS, groupOf } from "./groups";
import { TEMPLATES, type SkillTemplate } from "./templates";
import { IconPicker } from "./IconPicker";
import { nameProblem, slugify } from "./model";

export interface NewSkillStart { name: string; draft: SkillDraft }

export function NewSkillDialog({ open, taken, start, onCancel, onCreate }: {
  open: boolean;
  /** Names already used — a new one must differ. */
  taken: string[];
  /** Set for "Duplicate": skip the gallery. */
  start?: NewSkillStart | null;
  onCancel: () => void;
  onCreate: (name: string, draft: SkillDraft) => Promise<void>;
}) {
  const [step, setStep] = useState<"pick" | "name">("pick");
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [title, setTitle] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setError(""); setBusy(false);
    if (start) {
      setDraft(start.draft); setName(start.name); setTitle(start.name.replace(/-/g, " "));
      setNameTouched(true); setStep("name");
    } else {
      setDraft(null); setName(""); setTitle(""); setNameTouched(false); setStep("pick");
    }
  }, [open, start]);

  useEffect(() => {
    if (step === "name") requestAnimationFrame(() => titleRef.current?.focus());
  }, [step]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onCancel]);

  const byGroup = useMemo(() => GROUPS.map((g) => ({ g, items: TEMPLATES.filter((t) => t.where === g.where) })), []);
  const problem = nameProblem(name, taken);
  const descriptionMissing = !draft?.description.trim();

  if (!open) return null;

  function pick(t: SkillTemplate) {
    setDraft({ description: t.description, body: t.body, where: t.where,
      output: t.where === "selection" ? (t.output ?? "insert_below") : t.where === "chat" ? "draft_note" : null,
      icon: t.icon });
    const isBlank = t.id.startsWith("blank-");
    setTitle(isBlank ? "" : t.title);
    setName(isBlank ? "" : slugify(t.title));
    setNameTouched(false);
    setStep("name");
  }

  async function create() {
    if (!draft || problem || descriptionMissing) return;
    setBusy(true); setError("");
    try { await onCreate(name, draft); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not create the skill"); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] px-4" role="dialog" aria-modal="true"
      aria-label="New skill">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onCancel} />
      <div className="relative w-full max-w-2xl rounded-2xl bg-white dark:bg-gray-900 shadow-2xl
        border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="flex items-center gap-2 px-5 h-12 border-b border-gray-100 dark:border-gray-800">
          {step === "name" && !start && (
            <button type="button" onClick={() => setStep("pick")} aria-label="Back to templates"
              className="p-1 -ml-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
              <ArrowLeft size={15} />
            </button>
          )}
          <h2 className="text-[14px] font-semibold text-gray-900 dark:text-gray-100">
            {step === "pick" ? "New skill" : start ? "Duplicate skill" : "Name your skill"}
          </h2>
          <button type="button" onClick={onCancel} aria-label="Close"
            className="ml-auto p-1 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
            <X size={15} />
          </button>
        </div>

        {step === "pick" ? (
          <div className="p-5 space-y-5 max-h-[65vh] overflow-y-auto">
            {byGroup.map(({ g, items }) => (
              <section key={g.where}>
                <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
                  <g.icon size={12} /> {g.label}
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {items.map((t) => (
                    <button key={t.id} type="button" onClick={() => pick(t)} data-testid={`template-${t.id}`}
                      className="text-left p-3 rounded-xl border border-gray-200 dark:border-gray-800
                        hover:border-accent-300 dark:hover:border-accent-500/50 hover:bg-accent-50/40
                        dark:hover:bg-accent-500/5 transition-colors">
                      <span className="block text-[22px] leading-none mb-2">{t.icon}</span>
                      <span className="block text-[13px] font-medium text-gray-900 dark:text-gray-100">{t.title}</span>
                      <span className="block text-[11.5px] leading-snug text-gray-500 dark:text-gray-400 mt-0.5">{t.blurb}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : draft && (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <IconPicker size="sm" icon={draft.icon} fallback={groupOf(draft.where).defaultIcon}
                onChange={(icon) => setDraft({ ...draft, icon })} />
              <input ref={titleRef} value={title} aria-label="Skill name"
                placeholder="Exam questions"
                onChange={(e) => { setTitle(e.target.value); if (!nameTouched) setName(slugify(e.target.value)); }}
                onKeyDown={(e) => { if (e.key === "Enter") void create(); }}
                className="flex-1 text-[20px] font-semibold bg-transparent outline-none text-gray-900 dark:text-gray-100
                  placeholder:text-gray-300 dark:placeholder:text-gray-600" />
            </div>
            <div className="flex items-center gap-2 text-[12.5px]">
              <span className="text-gray-500 w-24 shrink-0">{draft.where === "chat" ? "Command" : "Id"}</span>
              <span className="text-gray-400">{draft.where === "chat" ? "/" : ""}</span>
              <input value={name} aria-label="Command"
                onChange={(e) => { setName(e.target.value.toLowerCase()); setNameTouched(true); }}
                className="flex-1 font-mono bg-gray-50 dark:bg-white/5 rounded-md px-2 h-7 outline-none
                  border border-transparent focus:border-accent-300 text-gray-800 dark:text-gray-100" />
            </div>
            <div className="flex items-center gap-2 text-[12.5px]">
              <span className="text-gray-500 w-24 shrink-0">Runs in</span>
              <span className="text-gray-800 dark:text-gray-100">{groupOf(draft.where).label}</span>
            </div>
            <div className="text-[12.5px]">
              <label className="block text-gray-500 mb-1" htmlFor="new-skill-description">
                Description — the AI reads this to decide when the skill fits
              </label>
              <textarea id="new-skill-description" rows={2} value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Write likely exam questions, with model answers, from the note's sources."
                className="w-full rounded-lg px-3 py-2 bg-gray-50 dark:bg-white/5 outline-none resize-none
                  border border-transparent focus:border-accent-300 text-gray-800 dark:text-gray-100" />
            </div>
            {(name && problem) && <p className="text-[12px] text-amber-600">{problem}</p>}
            {error && <p className="text-[12px] text-red-500">{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={onCancel}
                className="h-8 px-3 rounded-lg text-[13px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10">
                Cancel
              </button>
              <button type="button" onClick={create} disabled={busy || !!problem || descriptionMissing}
                className="h-8 px-4 rounded-lg text-[13px] font-medium bg-accent-600 text-white hover:bg-accent-500 disabled:opacity-40">
                {busy ? "Creating…" : "Create skill"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

