"use client";

// A note's privacy level (routing spec §5.4). It decides which models may
// read the note: the backend's privacy gate enforces it, this only sets it.
import { useEffect, useRef, useState } from "react";
import { Check, Globe, Lock, User } from "lucide-react";
import type { Sensitivity } from "@/lib/types/database";

const LEVELS: { value: Sensitivity; label: string; desc: string; icon: typeof Lock }[] = [
  { value: "open", label: "Open", desc: "Any model may read it", icon: Globe },
  { value: "personal", label: "Personal", desc: "Cloud models you trust may read it", icon: User },
  { value: "private", label: "Private", desc: "Never leaves this device", icon: Lock },
];

const STYLE: Record<Sensitivity, string> = {
  open: "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300",
  personal: "bg-accent-50 dark:bg-accent-950/30 border-accent-200 dark:border-accent-800 text-accent-700 dark:text-accent-200",
  private: "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200",
};

interface Props {
  noteId: string;
  sensitivity?: Sensitivity;
  /** Before migration 029 only local_only exists. */
  localOnly?: boolean;
}

export function PrivacyLevel({ noteId, sensitivity, localOnly }: Props) {
  const [value, setValue] = useState<Sensitivity>(sensitivity ?? (localOnly ? "private" : "personal"));
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  async function choose(next: Sensitivity) {
    setOpen(false);
    if (next === value) return;
    const prev = value;
    setValue(next);
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sensitivity: next }),
      });
      if (!res.ok) { setValue(prev); setError("Not saved"); }
    } catch {
      setValue(prev);
      setError("Not saved");
    } finally {
      setPending(false);
    }
  }

  const current = LEVELS.find((l) => l.value === value)!;
  const Icon = current.icon;
  return (
    <div ref={ref} className="relative inline-flex items-center gap-2">
      <button type="button" onClick={() => setOpen((v) => !v)} disabled={pending}
        aria-haspopup="menu" aria-expanded={open}
        aria-label={`Privacy: ${current.label}. ${current.desc}. Change`}
        title={current.desc}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${STYLE[value]}`}>
        <Icon size={11} /> {current.label}
      </button>
      {error && <span className="text-[11px] text-red-500">{error}</span>}
      {open && (
        <div role="menu" className="absolute left-0 top-full z-30 mt-1 w-64 overflow-hidden rounded-xl border
          border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
          {LEVELS.map((l) => {
            const LIcon = l.icon;
            return (
              <button key={l.value} type="button" role="menuitemradio" aria-checked={value === l.value}
                onClick={() => void choose(l.value)}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-white/5">
                <LIcon size={13} className="mt-0.5 shrink-0 text-gray-400" />
                <span className="flex-1">
                  <span className="block text-[13px] font-medium text-gray-800 dark:text-gray-100">{l.label}</span>
                  <span className="block text-[11.5px] text-gray-500 dark:text-gray-400">{l.desc}</span>
                </span>
                {value === l.value && <Check size={13} className="mt-0.5 text-accent-500" />}
              </button>
            );
          })}
          <a href="/brain/settings/routing?tab=privacy"
            className="block border-t border-gray-100 px-3 py-1.5 text-[11.5px] text-accent-600 hover:underline
              dark:border-gray-700 dark:text-accent-400">
            Which providers are trusted?
          </a>
        </div>
      )}
    </div>
  );
}
