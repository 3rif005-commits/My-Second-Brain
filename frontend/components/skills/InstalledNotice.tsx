"use client";

// On an installed skill's page: where it came from, the pinned version, and
// "Check for update" — which only shows the change as a diff. Nothing changes
// until Update, and Update applies exactly the diff that was shown (backend:
// services/skill_install.py).
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { skillsApi, type Skill, type UpdateCheck } from "@/lib/skills";

function shortPin(pin?: string | null) {
  if (!pin) return "unknown";
  return pin.startsWith("sha256:") ? pin.slice(7, 19) : pin.slice(0, 12);
}

export function InstalledNotice({ skill, onUpdated }: { skill: Skill; onUpdated: (s: Skill) => void }) {
  const [check, setCheck] = useState<UpdateCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return (
    <section aria-label="Installed skill" className="mb-5 rounded-xl border border-rose-200/70 dark:border-rose-500/20
      bg-rose-50/50 dark:bg-rose-500/[0.04] px-3.5 py-2.5 text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-300">
      <p>
        Installed from <span className="break-all font-mono text-[11.5px]">{skill.source_url ?? "an outside link"}</span>,
        version {shortPin(skill.pin)}. It is never used unasked, and a chat that uses it asks before changing anything.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" disabled={busy} onClick={() => run(async () => setCheck(await skillsApi.checkUpdate(skill.name)))}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[12.5px] bg-white/70 dark:bg-white/10
            border border-gray-200 dark:border-white/10 hover:bg-white disabled:opacity-50">
          {busy && !check ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Check for update
        </button>
        {check?.up_to_date && <span role="status">Up to date.</span>}
      </div>
      {error && <p role="alert" className="mt-2 text-rose-600 dark:text-rose-400">{error}</p>}
      {check && !check.up_to_date && (
        <div className="mt-3 space-y-2">
          <p>
            A new version ({shortPin(check.pin)}) changes this skill. Read the change; nothing is applied until you click Update.
          </p>
          {check.warnings.length > 0 && (
            <p role="alert" className="text-amber-700 dark:text-amber-300">The new version {check.warnings.join("; ")}.</p>
          )}
          <pre aria-label="Changes" className="max-h-72 overflow-auto rounded-lg bg-white dark:bg-black/30 p-2.5 font-mono text-[11.5px] leading-relaxed">
            {check.diff.split("\n").map((line, i) => (
              <span key={i} className={`block ${line.startsWith("+") && !line.startsWith("+++") ? "text-emerald-700 dark:text-emerald-400"
                : line.startsWith("-") && !line.startsWith("---") ? "text-rose-700 dark:text-rose-400" : ""}`}>{line || " "}</span>
            ))}
          </pre>
          <div className="flex gap-2">
            <button type="button" disabled={busy}
              onClick={() => run(async () => { onUpdated(await skillsApi.applyUpdate(skill.name, check.content_hash)); setCheck(null); })}
              className="inline-flex items-center gap-1.5 h-7 px-3 rounded-lg text-[12.5px] font-medium bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-50">
              {busy && <Loader2 size={12} className="animate-spin" />} Update
            </button>
            <button type="button" onClick={() => setCheck(null)} className="h-7 px-3 rounded-lg text-[12.5px] hover:bg-white/60 dark:hover:bg-white/5">
              Keep this version
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
