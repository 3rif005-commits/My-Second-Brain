"use client";

// Mirror status + what "everything" contains (decision D5) + Send all changes.
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNotion } from "@/context/NotionContext";
import { announceNotionChange, notionApi, type Include, type MirrorMap } from "@/lib/notion";

const SWITCHES: { key: keyof Include; label: string; help: string }[] = [
  { key: "collections", label: "Folders", help: "Each folder becomes a page with its notes in a table." },
  { key: "notes", label: "Notes", help: "Every note, as its own page under its folder." },
  { key: "databases", label: "Databases", help: "Tables with their rows, relations, formulas and views." },
  { key: "embedded_files", label: "Files inside notes", help: "Images and attachments, uploaded to Notion." },
  { key: "source_files", label: "Workspace source files", help: "PDFs and videos attached to a note (can be large). Off by default." },
  { key: "threads", label: "Chat threads", help: "Your AI chats, each as a page. Off by default." },
  { key: "skills", label: "Skills", help: "Your skills as pages. Off by default." },
];

function count(m: MirrorMap | null) {
  const c = { synced: 0, changed: 0, failed: 0, needs_you: 0, private: 0 };
  if (m) for (const v of Object.values(m.notes)) if (v in c) c[v as keyof typeof c] += 1;
  return c;
}

export function MirrorSection() {
  const notion = useNotion();
  const [inc, setInc] = useState<Include | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { notionApi.include().then((r) => setInc(r.include)).catch((e) => setError(e.message)); }, []);
  const c = count(notion.mirror);

  const flip = useCallback(async (key: keyof Include) => {
    if (!inc) return;
    const next = { ...inc, [key]: !inc[key] };
    setInc(next);
    try { setInc((await notionApi.setInclude({ [key]: next[key] })).include); announceNotionChange(); }
    catch (e) { setInc(inc); setError((e as Error).message); }
  }, [inc]);

  return (
    <section id="mirror" aria-label="Mirror status" className="space-y-4">
      <h2 className="font-semibold">Mirror status</h2>
      <ul className="flex flex-wrap gap-2 text-[13px]" data-testid="mirror-counts">
        <li className="rounded-full border px-3 py-1 border-gray-200 dark:border-white/10">{c.synced} in sync</li>
        <li className="rounded-full border px-3 py-1 border-amber-300 dark:border-amber-500/40">{c.changed} changed</li>
        <li className="rounded-full border px-3 py-1 border-rose-300 dark:border-rose-500/40">{c.failed} failing</li>
        <li className="rounded-full border px-3 py-1 border-violet-300 dark:border-violet-500/40">{c.needs_you} need you</li>
        <li className="rounded-full border px-3 py-1 border-gray-200 dark:border-white/10">{c.private} private (not sent)</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => notion.open({ all: true }, "whole brain")}>Send all changes…</Button>
        <span className="text-[12px] text-gray-500 self-center">You see what would be sent before anything is.</span>
      </div>
      <div className="space-y-2">
        <h3 className="text-[13px] font-medium">What “the whole brain” includes</h3>
        {error && <p role="alert" className="text-[13px] text-rose-600">{error}</p>}
        <ul className="rounded-lg border border-gray-200 dark:border-white/10 divide-y divide-gray-100 dark:divide-white/10">
          {SWITCHES.map((s) => (
            <li key={s.key} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium">{s.label}</div>
                <div className="text-[12px] text-gray-500">{s.help}</div>
              </div>
              <button role="switch" aria-checked={!!inc?.[s.key]} aria-label={s.label} disabled={!inc} onClick={() => flip(s.key)}
                className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 ${inc?.[s.key] ? "bg-indigo-500" : "bg-gray-300 dark:bg-gray-600"}`}>
                <span className={`inline-block h-4 w-4 translate-y-0.5 rounded-full bg-white shadow transition-transform ${inc?.[s.key] ? "translate-x-[18px]" : "translate-x-0.5"}`} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
