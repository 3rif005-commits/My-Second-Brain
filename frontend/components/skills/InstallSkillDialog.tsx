"use client";

// Install a skill from a GitHub folder or a SKILL.md link — read it before it
// is yours. OpenClaw's skill store taught why: skills that ran code, installs
// nobody read, updates that arrived by themselves. Here Preview shows the
// whole skill (instructions, files, what was skipped, warnings) and saves
// nothing; Install stores exactly that content or nothing, pinned to that
// version. Backend: services/skill_install.py.
import { useState } from "react";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { Modal } from "@/components/ui";
import { skillsApi, type InstallPreview, type Skill } from "@/lib/skills";

export function InstallSkillDialog({ open, onClose, onInstalled }: {
  open: boolean;
  onClose: () => void;
  onInstalled: (skill: Skill) => void;
}) {
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<InstallPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close() {
    setUrl(""); setPreview(null); setError(""); setBusy(false);
    onClose();
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  const previewIt = () => run(async () => setPreview(await skillsApi.installPreview(url.trim())));
  const install = () => run(async () => {
    if (!preview) return;
    const skill = await skillsApi.install(preview.source, preview.content_hash);
    close();
    onInstalled(skill);
  });

  return (
    <Modal open={open} onClose={close} label="Install a skill"
      className="w-[min(640px,calc(100vw-32px))] max-h-[85vh] overflow-y-auto p-5">
      <h2 className="mb-1 text-[16px] font-semibold text-gray-900 dark:text-gray-100">Install a skill</h2>
      <p className="mb-3 text-[12.5px] leading-relaxed text-gray-500 dark:text-gray-400">
        A GitHub folder link (https://github.com/owner/repo/tree/main/skill) or a link to a SKILL.md.
        Only text is installed; scripts are never stored or run. You read it before it is yours, and it
        never changes unless you approve an update.
      </p>
      <div className="flex gap-2">
        <input aria-label="Skill link" value={url} onChange={(e) => { setUrl(e.target.value); setPreview(null); }}
          placeholder="https://github.com/…" disabled={busy}
          onKeyDown={(e) => { if (e.key === "Enter" && url.trim() && !busy) void previewIt(); }}
          className="flex-1 min-w-0 h-8 rounded-lg border border-gray-200 dark:border-white/10 bg-transparent px-2.5 text-[13px]
            text-gray-800 dark:text-gray-100 outline-none focus:ring-1 focus:ring-accent-300" />
        <button type="button" onClick={previewIt} disabled={busy || !url.trim()}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium bg-gray-100
            dark:bg-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-200 disabled:opacity-50">
          {busy && !preview && <Loader2 size={12} className="animate-spin" />} Preview
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-[12.5px] text-rose-600 dark:text-rose-400">{error}</p>}

      {preview && (
        <section aria-label="Skill preview" className="mt-4 space-y-3 text-[13px]">
          <div>
            <p className="font-mono text-[13px] text-gray-900 dark:text-gray-100">{preview.name}</p>
            <p className="text-gray-600 dark:text-gray-300">{preview.description}</p>
            <p className="mt-0.5 text-[11.5px] text-gray-400">
              Version {preview.pin.startsWith("sha256:") ? preview.pin.slice(7, 19) : preview.pin.slice(0, 12)} · pinned
            </p>
          </div>
          {preview.warnings.length > 0 && (
            <div role="alert" className="flex gap-1.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-2.5 text-[12.5px] text-amber-800 dark:text-amber-200">
              <AlertTriangle size={14} className="mt-px shrink-0" />
              <span>This skill {preview.warnings.join("; ")}. Install it only if you trust where it came from.</span>
            </div>
          )}
          <div>
            <p className="mb-1 text-[11.5px] font-medium uppercase tracking-wide text-gray-400">Instructions</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 dark:bg-white/[0.03] p-2.5
              font-mono text-[12px] leading-relaxed text-gray-700 dark:text-gray-200">{preview.body}</pre>
          </div>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            Files: {preview.files.join(", ")}
            {preview.skipped.length > 0 && <> · <span className="text-gray-700 dark:text-gray-300">Not installed: {preview.skipped.join(", ")}</span></>}
          </p>
          <p className="text-[12px] text-gray-500 dark:text-gray-400">
            Installed skills are never used unasked, and a chat that uses one asks you before it changes anything.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={close} className="h-8 px-3 rounded-lg text-[12.5px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5">
              Cancel
            </button>
            <button type="button" onClick={install} disabled={busy}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-medium bg-accent-600 text-white hover:bg-accent-700 disabled:opacity-50">
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Install
            </button>
          </div>
        </section>
      )}
    </Modal>
  );
}
