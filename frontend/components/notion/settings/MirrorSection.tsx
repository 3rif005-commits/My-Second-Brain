"use client";

// Mirror status + what "everything" contains (decision D5) + Send all changes.
import { useCallback, useEffect, useState } from "react";
import { Button, SettingsRow, SettingsSection, Toggle } from "@/components/ui";
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
    <SettingsSection id="mirror" title="What to send">
      <div className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-2 text-[13px] text-ink" data-testid="mirror-counts">
          <li className="rounded-full border border-line px-3 py-1">{c.synced} in sync</li>
          <li className="rounded-full border border-amber-500/40 px-3 py-1">{c.changed} changed</li>
          <li className="rounded-full border border-rose-500/40 px-3 py-1">{c.failed} failing</li>
          <li className="rounded-full border border-accent-500/40 px-3 py-1">{c.needs_you} need you</li>
          <li className="rounded-full border border-line px-3 py-1">{c.private} private (not sent)</li>
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => notion.open({ all: true }, "whole brain")}>Send all changes…</Button>
          <span className="text-[12px] text-ink-tertiary">You see what would be sent before anything is.</span>
        </div>
      </div>
      {error && <p role="alert" className="text-[13px] text-ink-danger">{error}</p>}
      <p className="-mb-2 text-[13px] font-medium text-ink">What “the whole brain” includes</p>
      {SWITCHES.map((sw) => (
        <SettingsRow key={sw.key} label={sw.label} help={sw.help}>
          <Toggle checked={!!inc?.[sw.key]} disabled={!inc} label={sw.label} onChange={() => flip(sw.key)} />
        </SettingsRow>
      ))}
    </SettingsSection>
  );
}
