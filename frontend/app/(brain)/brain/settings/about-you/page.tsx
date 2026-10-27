"use client";

// About you: short facts and preferences every chat sees, so you don't repeat
// "I study electrical engineering" in each conversation. You see and control
// all of it here. The chat can propose an entry ("Saved by the AI"), and has to
// ask first whenever it has read your sources or private notes. Backend:
// services/memory.py.
import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { Button, EmptyState, IconButton, Input, SettingsPage, SettingsRow, SettingsSection } from "@/components/ui";

interface Entry {
  id: string;
  content: string;
  source: "user" | "assistant";
  created_at: string;
}

interface Limits {
  entry: number;
  total: number;
  entries: number;
}

const DEFAULT_LIMITS: Limits = { entry: 300, total: 2000, entries: 30 };

export default function AboutYouPage() {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [limits, setLimits] = useState<Limits>(DEFAULT_LIMITS);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/memory");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setLoadError(data.detail ?? `Error ${res.status}`);
        setEntries([]);
        return;
      }
      setEntries(data.entries ?? []);
      if (data.limits) setLimits(data.limits);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      setEntries([]);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const used = (entries ?? []).reduce((n, e) => n + e.content.length, 0);
  const text = draft.trim();
  const full = (entries?.length ?? 0) >= limits.entries || used + text.length > limits.total;

  async function add() {
    if (!text) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.detail ?? `Error ${res.status}`);
        return;
      }
      setDraft("");
      setEntries((list) => [...(list ?? []), data as Entry]);
    } finally {
      setSaving(false);
    }
  }

  async function remove(entry: Entry) {
    setEntries((list) => list?.filter((e) => e.id !== entry.id) ?? list);
    const res = await fetch(`/api/memory/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) load();
  }

  return (
    <SettingsPage
      title="About you"
      description="Short facts and preferences the AI keeps in mind in every chat, like what you study or how you like answers. Only you can see and change this list."
    >
      <SettingsSection title="Add" description="One fact per line. Don't put passwords or anything secret here.">
        <SettingsRow stacked label="Something the AI should remember" htmlFor="about-you-new"
          help={`${text.length}/${limits.entry} characters · ${used.toLocaleString()}/${limits.total.toLocaleString()} used`}>
          <div className="flex max-w-[560px] gap-2">
            <Input
              id="about-you-new"
              inputSize="lg"
              className="flex-1"
              maxLength={limits.entry}
              placeholder="I study electrical engineering, 3rd year"
              value={draft}
              onChange={(e) => { setDraft(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter" && !saving && text && !full) add(); }}
            />
            <Button icon={saving ? <Loader2 className="animate-spin" /> : <Plus />} onClick={add}
              disabled={saving || !text || full}>
              Add
            </Button>
          </div>
        </SettingsRow>
        {full && <p className="text-sm text-ink-secondary">The list is full. Remove something to add more.</p>}
        {error && <p role="alert" className="text-sm text-ink-danger">{error}</p>}
      </SettingsSection>

      <SettingsSection title="What the AI knows about you">
        {entries === null && <p className="text-sm text-ink-tertiary">Loading…</p>}
        {loadError && <p role="alert" className="text-sm text-ink-danger">{loadError}</p>}
        {entries?.length === 0 && !loadError && (
          <EmptyState
            title="Nothing yet"
            description="Add a fact above, or tell the chat something about yourself and let it save it."
          />
        )}
        {entries?.map((e) => (
          <SettingsRow
            key={e.id}
            label={<span className="[overflow-wrap:anywhere]">{e.content}</span>}
            help={e.source === "assistant"
              ? <span className="inline-flex items-center gap-1"><Sparkles size={11} /> Saved by the AI</span>
              : undefined}
          >
            <IconButton label={`Remove "${e.content}"`} onClick={() => remove(e)}>
              <Trash2 />
            </IconButton>
          </SettingsRow>
        ))}
      </SettingsSection>
    </SettingsPage>
  );
}
