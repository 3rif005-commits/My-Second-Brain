"use client";

// REGISTRY — the tabs under a skill's properties. A new view of a skill (test
// runs, history, usage…) = one entry here: a label, when it shows, and what
// it renders. Tabs that hold their own unsaved work report it through
// `reportDirty`, so switching skills still asks before throwing it away.
import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, GitCompare, Palette, PenLine, type LucideIcon } from "lucide-react";
import { STYLE_FILE, StyleTab } from "./StyleTab";
import { Markdown } from "@/lib/markdown/Markdown";
import { skillsApi, type Skill, type SkillDraft } from "@/lib/skills";
import { diffStat, lineDiff } from "./lineDiff";

export interface TabCtx {
  skill: Skill;
  draft: SkillDraft;
  set: (patch: Partial<SkillDraft>) => void;
  /** A tab with its own unsaved work (a reference file) says so here. */
  reportDirty: (tabId: string, dirty: boolean) => void;
  /** After a tab saved something that changes the skill (e.g. "edited"). */
  onSkillChanged: () => void;
}

export interface SkillTab {
  id: string;
  label: string;
  icon: LucideIcon;
  visible: (ctx: TabCtx) => boolean;
  /** A small count next to the label, when there is one. */
  badge?: (ctx: TabCtx) => string | null;
  render: (ctx: TabCtx) => React.ReactNode;
}

// ── Instructions ────────────────────────────────────────────────────────────

function InstructionsTab({ draft, set }: TabCtx) {
  const [mode, setMode] = useState<"write" | "preview">("write");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(420, el.scrollHeight)}px`;
  }, [draft.body, mode]);
  const words = draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="inline-flex p-0.5 rounded-lg bg-gray-100 dark:bg-white/5">
          {(["write", "preview"] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)}
              className={`px-2.5 h-6 rounded-md text-[12px] capitalize transition-colors ${mode === m
                ? "bg-white dark:bg-white/10 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}>
              {m}
            </button>
          ))}
        </div>
        <span className="text-[11.5px] text-gray-400">{words.toLocaleString()} words</span>
      </div>
      {mode === "write" ? (
        <textarea
          ref={ref}
          value={draft.body}
          aria-label="Instructions"
          spellCheck={false}
          placeholder={"What the AI should do, step by step.\n\n- Be specific about the format of the result.\n- Say what to leave out."}
          onChange={(e) => set({ body: e.target.value })}
          onKeyDown={(e) => {
            // Tab indents inside the instructions instead of leaving the box.
            if (e.key !== "Tab" || e.shiftKey) return;
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: a, selectionEnd: b } = el;
            set({ body: draft.body.slice(0, a) + "  " + draft.body.slice(b) });
            requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
          }}
          className="w-full resize-none rounded-xl px-4 py-3 font-mono text-[12.5px] leading-relaxed
            bg-gray-50/80 dark:bg-white/[0.03] border border-gray-200/80 dark:border-white/10
            text-gray-800 dark:text-gray-100 placeholder:text-gray-400 outline-none
            focus:border-indigo-300 dark:focus:border-indigo-500/50 focus:bg-white dark:focus:bg-white/[0.05]
            transition-colors"
        />
      ) : (
        <div className="min-h-[420px] rounded-xl px-5 py-4 border border-gray-200/80 dark:border-white/10
          prose prose-sm dark:prose-invert max-w-none">
          {draft.body.trim() ? <Markdown>{draft.body}</Markdown>
            : <p className="text-gray-400">Nothing written yet.</p>}
        </div>
      )}
    </div>
  );
}

// ── Files (reference files the skill reads) ─────────────────────────────────

function FilesTab({ skill, reportDirty, onSkillChanged }: TabCtx) {
  const [active, setActive] = useState(skill.files[0] ?? "");
  const [saved, setSaved] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dirty = saved !== null && text !== saved;
  useEffect(() => { reportDirty("files", dirty); }, [dirty, reportDirty]);
  useEffect(() => () => reportDirty("files", false), [reportDirty]);

  const load = useCallback(async (path: string) => {
    setSaved(null); setError("");
    try {
      const r = await skillsApi.readFile(skill.name, path);
      setSaved(r.content); setText(r.content);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open the file"); }
  }, [skill.name]);
  useEffect(() => { if (active) void load(active); }, [active, load]);

  async function save() {
    setBusy(true); setError("");
    try {
      await skillsApi.writeFile(skill.name, active, text);
      setSaved(text);
      onSkillChanged();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex gap-4 min-h-[420px]">
      <ul className="w-52 shrink-0 space-y-0.5">
        {skill.files.map((f) => (
          <li key={f}>
            <button type="button"
              onClick={() => setActive(f)}
              disabled={dirty && f !== active}
              title={dirty && f !== active ? "Save or discard this file's changes first" : undefined}
              className={`disabled:opacity-40 disabled:cursor-not-allowed w-full flex items-center gap-2 px-2 h-8 rounded-md text-left text-[12.5px] truncate ${f === active
                ? "bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-gray-100"
                : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"}`}>
              <FileText size={13} className="shrink-0 text-gray-400" />
              <span className="truncate">{f.split("/").pop()}</span>
            </button>
          </li>
        ))}
        <li className="px-2 pt-2 text-[11px] leading-snug text-gray-400">
          Files the skill reads while it works. Edits are saved as your own version.
        </li>
      </ul>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
          aria-label={`File ${active}`} disabled={saved === null}
          className="flex-1 min-h-[420px] w-full resize-y rounded-xl px-4 py-3 font-mono text-[12.5px] leading-relaxed
            bg-gray-50/80 dark:bg-white/[0.03] border border-gray-200/80 dark:border-white/10 outline-none
            focus:border-indigo-300 text-gray-800 dark:text-gray-100 disabled:opacity-50" />
        <div className="flex items-center justify-end gap-2">
          {error && <span className="text-[12px] text-red-500 mr-auto">{error}</span>}
          {dirty && (
            <button type="button" onClick={() => setText(saved ?? "")}
              className="h-8 px-3 rounded-lg text-[12.5px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10">
              Discard
            </button>
          )}
          <button type="button" onClick={save} disabled={!dirty || busy}
            className="h-8 px-3.5 rounded-lg text-[12.5px] font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-40">
            {busy ? "Saving…" : "Save file"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Original (what changed in an edited built-in) ───────────────────────────

function OriginalTab({ skill, draft }: TabCtx) {
  const [original, setOriginal] = useState<{ description: string; body: string } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    skillsApi.original(skill.name)
      .then((o) => { if (live) setOriginal(o); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : "Could not load the original"); });
    return () => { live = false; };
  }, [skill.name]);
  if (error) return <p className="text-[13px] text-gray-500">{error}</p>;
  if (!original) return <p className="text-[13px] text-gray-400">Loading the original…</p>;
  const diff = lineDiff(original.body, draft.body);
  const { added, removed } = diffStat(diff);
  return (
    <div className="space-y-3">
      <p className="text-[12.5px] text-gray-500 dark:text-gray-400">
        {added || removed
          ? <>Your instructions against the built-in: <span className="text-emerald-600">+{added}</span>{" "}
              <span className="text-red-500">−{removed}</span> lines.</>
          : "The instructions are the same as the built-in."}
        {original.description !== draft.description && " The description differs too."}
      </p>
      <pre className="rounded-xl border border-gray-200/80 dark:border-white/10 overflow-auto max-h-[560px]
        text-[12px] leading-relaxed font-mono py-2">
        {diff.map((l, i) => (
          <div key={i} className={`px-3 whitespace-pre-wrap ${l.kind === "added"
            ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200"
            : l.kind === "removed" ? "bg-red-50 text-red-900 line-through decoration-red-300 dark:bg-red-500/10 dark:text-red-200"
            : "text-gray-600 dark:text-gray-300"}`}>
            <span className="select-none inline-block w-4 text-gray-400">{l.kind === "added" ? "+" : l.kind === "removed" ? "−" : " "}</span>
            {l.text || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}

export const TABS: SkillTab[] = [
  { id: "instructions", label: "Instructions", icon: PenLine, visible: () => true, render: (c) => <InstructionsTab {...c} /> },
  {
    // E12 — every skill: preferences added after its instructions; a job
    // can also learn them from how the user edits its results.
    id: "style", label: "Your style", icon: Palette,
    visible: ({ skill }) => skill.files.includes(STYLE_FILE),
    render: (c) => <StyleTab key={c.skill.name} {...c} />,
  },
  {
    id: "files", label: "Files", icon: FileText,
    visible: ({ skill }) => skill.files.length > 0,
    badge: ({ skill }) => String(skill.files.length),
    render: (c) => <FilesTab key={c.skill.name} {...c} />,
  },
  {
    id: "original", label: "Compare with original", icon: GitCompare,
    visible: ({ skill }) => skill.source === "edited",
    render: (c) => <OriginalTab key={c.skill.name} {...c} />,
  },
];
