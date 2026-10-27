"use client";

// Settings → Skills: the list on the left, the selected skill as a page on
// the right (user, 2026-09-24: "inspired by Notion"). This file owns the state
// — which skill, its draft, saving, the dialogs — and the pieces render it:
//
//   SkillSidebar   list, search, New            groups.ts     kinds of skill
//   SkillPage      icon, title, properties,     properties.tsx the property rows
//                  tabs, save bar               tabs.tsx      the tabs
//   NewSkillDialog template gallery → name      templates.ts  starting points
//   SkillMenu      ⋯ actions                    model.ts      pure logic (tested)
//
// The selected skill is in the address (?skill=name), so a link can open one.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/app/providers";
import { useAIPanel } from "@/context/AIPanelContext";
import { InstallSkillDialog } from "./InstallSkillDialog";
import { skillsApi, type ArchivedSkill, type Skill, type SkillDraft } from "@/lib/skills";
import { draftOf, duplicateOf, isDirty } from "./model";
import { SkillSidebar } from "./SkillSidebar";
import { SkillPage } from "./SkillPage";
import { NewSkillDialog, type NewSkillStart } from "./NewSkillDialog";
import type { SkillAction } from "./SkillMenu";

type Pending =
  | { kind: "switch"; to: string | null }
  | { kind: "new"; start: NewSkillStart | null }
  | { kind: "reset" | "delete"; skill: Skill };

export function SkillsWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { showToast } = useToast();
  const ai = useAIPanel();

  const [skills, setSkills] = useState<Skill[]>([]);
  const [archived, setArchived] = useState<ArchivedSkill[]>([]);
  const [installing, setInstalling] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tabDirty, setTabDirty] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [newDialog, setNewDialog] = useState<{ start: NewSkillStart | null } | null>(null);

  const selectedName = params.get("skill");
  const selected = skills.find((s) => s.name === selectedName) ?? null;
  const dirty = isDirty(selected, draft) || Object.values(tabDirty).some(Boolean);

  const load = useCallback(async () => {
    try {
      const { skills: list, archived: set_aside } = await skillsApi.overview();
      setSkills(list);
      setArchived(set_aside);
      return list;
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not load the skills", "error");
      return [];
    } finally {
      setLoading(false);
    }
  }, [showToast]);
  useEffect(() => { void load(); }, [load]);

  // The first skill is open by default on a wide screen, so the page is never
  // an empty frame; on a phone the list comes first.
  useEffect(() => {
    if (loading || selectedName || !skills.length) return;
    if (typeof window !== "undefined" && window.innerWidth >= 768) go(skills[0].name, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, skills, selectedName]);

  // A fresh draft when another skill is opened — only then: a reload of the
  // list (after saving a reference file, say) must not throw away edits to
  // the instructions that are not saved yet.
  // An installed skill's approved update changes its pin: that is a new
  // version, so the editor starts again from it.
  const openName = selected ? `${selected.name}:${selected.pin ?? ""}` : null;
  useEffect(() => {
    setDraft(selected ? draftOf(selected) : null);
    setError("");
    setTabDirty({});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openName]);

  function go(name: string | null, replace = false) {
    const q = new URLSearchParams(params.toString());
    if (name) q.set("skill", name); else q.delete("skill");
    const url = `${pathname}${q.toString() ? `?${q}` : ""}`;
    if (replace) router.replace(url, { scroll: false }); else router.push(url, { scroll: false });
  }

  /** Move to another skill — asking first if this one has unsaved work. */
  function select(name: string | null) {
    if (name === selectedName) return;
    if (dirty) setPending({ kind: "switch", to: name });
    else go(name);
  }

  const save = useCallback(async () => {
    if (!selected || !draft || !dirty || saving) return;
    if (!draft.description.trim()) { setError("A description is needed — the AI uses it to pick the skill."); return; }
    setSaving(true); setError("");
    try {
      const updated = await skillsApi.save(selected.name, draft);
      setSkills((prev) => prev.map((s) => (s.name === updated.name ? updated : s)));
      showToast(selected.source === "bundled" ? "Saved as your version" : "Saved", "info");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }, [selected, draft, dirty, saving, showToast]);

  // ⌘S saves; leaving the page with unsaved work asks the browser to confirm.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void saveRef.current(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const reportDirty = useCallback((tabId: string, d: boolean) => {
    setTabDirty((prev) => (prev[tabId] === d ? prev : { ...prev, [tabId]: d }));
  }, []);

  const taken = useMemo(() => skills.map((s) => s.name), [skills]);

  function onAction(s: Skill, a: SkillAction) {
    if (a === "try") { ai.ask(`/${s.name} `); return; }
    if (a === "duplicate") {
      const start = duplicateOf(s.name === selected?.name && draft ? { ...s, ...draft } : s, taken);
      if (dirty) setPending({ kind: "new", start }); else setNewDialog({ start });
      return;
    }
    setPending({ kind: a, skill: s });
  }

  async function confirmPending() {
    const p = pending;
    setPending(null);
    if (!p) return;
    if (p.kind === "switch") { setTabDirty({}); go(p.to); return; }
    if (p.kind === "new") { setTabDirty({}); if (selected) setDraft(draftOf(selected)); setNewDialog({ start: p.start }); return; }
    try {
      await skillsApi.remove(p.skill.name);
      const list = await load();
      const back = list.find((s) => s.name === p.skill.name);
      if (back && back.name === selectedName) { setDraft(draftOf(back)); setTabDirty({}); }
      if (p.kind === "delete") {
        showToast(`Deleted /${p.skill.name}`, "info");
        if (p.skill.name === selectedName) go(list[0]?.name ?? null, true);
      } else {
        showToast("Back to the original", "info");
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not do that", "error");
    }
  }

  async function create(name: string, d: SkillDraft) {
    const created = await skillsApi.create({ name, ...d });
    await load();
    setNewDialog(null);
    go(created.name);
    showToast("Skill created — write its instructions", "info");
  }

  const pendingText = !pending ? null
    : pending.kind === "switch" || pending.kind === "new"
      ? { title: "Discard unsaved changes?", description: "Your edits to this skill have not been saved.", confirm: "Discard", danger: true }
    : pending.kind === "reset"
      ? { title: `Reset "${pending.skill.title}"?`, description: "Your version is removed and the built-in one is used again — its instructions and its files.", confirm: "Reset", danger: false }
      : { title: `Delete "${pending.skill.title}"?`, description: "The skill is removed. This cannot be undone.", confirm: "Delete", danger: true };

  return (
    <div className="flex-1 min-h-0 flex">
      <div className={`${selected ? "hidden md:flex" : "flex"} w-full md:w-72 shrink-0 flex-col min-h-0
        border-r border-gray-100 dark:border-gray-800 bg-gray-50/60 dark:bg-white/[0.015]`}>
        <SkillSidebar
          skills={skills}
          archived={archived}
          onInstall={() => setInstalling(true)}
          onRestore={async (name) => {
            try {
              await skillsApi.restore(name);
              await load();
              showToast(`${name} is back`, "info");
            } catch (e) {
              showToast(e instanceof Error ? e.message : "Could not restore it", "error");
            }
          }}
          selected={selectedName}
          query={query}
          onQuery={setQuery}
          onSelect={select}
          onNew={() => (dirty ? setPending({ kind: "new", start: null }) : setNewDialog({ start: null }))}
          onAction={onAction}
          loading={loading}
        />
      </div>

      <main className={`${selected ? "flex" : "hidden md:flex"} flex-1 min-w-0 min-h-0 flex-col`}>
        {selected && draft ? (
          <SkillPage
            key={selected.name}
            skill={selected}
            draft={draft}
            dirty={dirty}
            saving={saving}
            error={error}
            onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
            onSave={() => void save()}
            onDiscard={() => { setDraft(draftOf(selected)); setError(""); }}
            onAction={(a) => onAction(selected, a)}
            onBack={() => select(null)}
            reportDirty={reportDirty}
            onSkillChanged={() => void load()}
            onInstalledUpdated={(s) => {
              setSkills((prev) => prev.map((x) => (x.name === s.name ? s : x)));
              showToast(`${s.title} updated`, "info");
            }}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-[13px] text-gray-400">
            {loading ? "Loading…" : "Pick a skill, or make a new one."}
          </div>
        )}
      </main>

      <NewSkillDialog
        open={!!newDialog}
        start={newDialog?.start ?? null}
        taken={taken}
        onCancel={() => setNewDialog(null)}
        onCreate={create}
      />
      <ConfirmDialog
        open={!!pending}
        title={pendingText?.title ?? ""}
        description={pendingText?.description}
        confirmLabel={pendingText?.confirm}
        danger={pendingText?.danger}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
      <InstallSkillDialog
        open={installing}
        onClose={() => setInstalling(false)}
        onInstalled={async (skill) => {
          await load();
          go(skill.name);
          showToast(`${skill.title} installed`, "info");
        }}
      />
    </div>
  );
}
