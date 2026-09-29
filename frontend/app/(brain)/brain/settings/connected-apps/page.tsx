"use client";

// Settings → Connected apps (5.4): the apps you allowed to use your Second
// Brain (claude.ai, ChatGPT… through the remote MCP server), and the edits or
// deletes they asked for. Nothing changes in a note until you approve it; a
// delete moves the note to the Trash.
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppWindow, Check, PencilLine, Trash2, X } from "lucide-react";

interface App { client_id: string; name: string; connected_at: string }
interface Change {
  id: string; app: string; action: "update" | "delete"; note_id: string; reason: string;
  note_title: string; current_text: string; new_title: string | null; new_text: string; created_at: string;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export default function ConnectedAppsPage() {
  const [apps, setApps] = useState<App[]>([]);
  const [pending, setPending] = useState<Change[]>([]);
  const [setup, setSetup] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // A connected app's MCP Apps card links here with ?change=<id> (5.4) — the
  // sandboxed view has no session of its own, so "Review in Second Brain"
  // just brings the user to the exact waiting change, on the same real page.
  const highlightId = useSearchParams().get("change");
  const highlighted = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const r = await fetch("/api/ws/connected-apps");
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { setError(data.detail ?? data.error ?? "Could not load connected apps"); return; }
    setApps(data.apps ?? []); setPending(data.pending ?? []); setSetup(data.setup ?? "");
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!highlightId || highlighted.current.has(highlightId)) return;
    const el = document.getElementById(`change-${highlightId}`);
    if (!el) return;                                    // not loaded yet, or already decided
    highlighted.current.add(highlightId);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId, pending]);

  async function decide(id: string, approve: boolean) {
    setBusy(id); setError("");
    const r = await fetch(`/api/ws/connected-apps/changes/${id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approve }) });
    if (!r.ok) setError((await r.json().catch(() => ({}))).detail ?? "Could not save your decision");
    setBusy(null); void load();
  }

  async function disconnect(clientId: string) {
    setBusy(clientId); setError("");
    await fetch(`/api/ws/connected-apps/${encodeURIComponent(clientId)}/disconnect`, { method: "POST" });
    setBusy(null); void load();
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 space-y-8" data-testid="connected-apps">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-50">Connected apps</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Apps you allowed to use your Second Brain. They can search, read and create notes;
          editing or deleting a note waits here for your approval.
        </p>
        {setup && <p className="mt-2 text-sm text-amber-700">{setup}</p>}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      <section>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-gray-400 mb-2">
          Waiting for your approval {pending.length > 0 && `(${pending.length})`}
        </h2>
        {pending.length === 0 && <p className="text-sm text-gray-500">Nothing is waiting.</p>}
        <div className="space-y-3">
          {pending.map((c) => (
            <div key={c.id} id={`change-${c.id}`} data-testid="pending-change"
              className={`rounded-xl ring-1 p-4 transition-shadow ${
                c.id === highlightId
                  ? "ring-2 ring-indigo-400 shadow-[0_0_0_4px_rgba(99,102,241,0.15)]"
                  : "ring-gray-200 dark:ring-white/10"}`}>
              <div className="flex items-center gap-2 text-sm">
                {c.action === "delete" ? <Trash2 size={15} className="text-red-500" /> : <PencilLine size={15} className="text-indigo-500" />}
                <span className="font-medium text-gray-900 dark:text-gray-100">
                  {c.app} wants to {c.action === "delete" ? "move to the Trash" : "change"} “{c.note_title}”
                </span>
                <span className="ml-auto text-[11.5px] text-gray-400">{when(c.created_at)}</span>
              </div>
              {c.reason && <p className="mt-1 text-[12.5px] text-gray-500">Reason given: {c.reason}</p>}
              {c.action === "update" && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[11px] uppercase text-gray-400 mb-1">Now</p>
                    <pre className="whitespace-pre-wrap text-[12px] leading-relaxed max-h-56 overflow-auto rounded-lg bg-gray-50 dark:bg-white/5 p-2 text-gray-700 dark:text-gray-300">{c.current_text || "(empty)"}</pre>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase text-gray-400 mb-1">
                      After{c.new_title ? ` — title “${c.new_title}”` : ""}
                    </p>
                    <pre className="whitespace-pre-wrap text-[12px] leading-relaxed max-h-56 overflow-auto rounded-lg bg-indigo-50/60 dark:bg-indigo-500/10 p-2 text-gray-800 dark:text-gray-200">{c.new_text || "(empty)"}</pre>
                  </div>
                </div>
              )}
              {c.action === "delete" && (
                <p className="mt-2 text-[12.5px] text-gray-500">The note goes to the Trash; you can restore it from there.</p>
              )}
              <div className="mt-3 flex gap-2">
                <button onClick={() => decide(c.id, true)} disabled={busy === c.id}
                  className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full bg-indigo-600 text-white text-[12.5px] font-medium hover:bg-indigo-500 disabled:opacity-50">
                  <Check size={13} /> Approve
                </button>
                <button onClick={() => decide(c.id, false)} disabled={busy === c.id}
                  className="inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full ring-1 ring-gray-200 dark:ring-white/10 text-[12.5px] text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5 disabled:opacity-50">
                  <X size={13} /> Reject
                </button>
                <a href={`/brain/${c.note_id}`} className="ml-auto self-center text-[12px] text-indigo-600 hover:underline">Open the note</a>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-gray-400 mb-2">Apps</h2>
        {apps.length === 0 && <p className="text-sm text-gray-500">No app is connected.</p>}
        <ul className="divide-y divide-gray-100 dark:divide-white/5">
          {apps.map((a) => (
            <li key={a.client_id} className="flex items-center gap-3 py-2.5">
              <AppWindow size={16} className="text-gray-400" />
              <div className="min-w-0">
                <p className="text-sm text-gray-800 dark:text-gray-100">{a.name}</p>
                <p className="text-[11.5px] text-gray-400">Connected {when(a.connected_at)}</p>
              </div>
              <button onClick={() => disconnect(a.client_id)} disabled={busy === a.client_id}
                className="ml-auto h-8 px-3 rounded-lg text-[12.5px] text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10 disabled:opacity-50">
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
