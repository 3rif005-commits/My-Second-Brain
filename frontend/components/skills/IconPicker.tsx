"use client";

// A skill's icon, Notion-style: click the emoji, pick another, or remove it.
import { useEffect, useRef, useState } from "react";

const ICONS = [
  "✨", "🎓", "📚", "📘", "📝", "🧠", "💡", "🔍", "🧪", "📊",
  "🗂️", "📌", "✏️", "✂️", "🧒", "🎯", "⚖️", "🔁", "🧩", "🗣️",
  "📖", "🧮", "🔬", "🌍", "🕰️", "⚡", "🛠️", "🎨", "📐", "❓",
  "✅", "🏷️", "🔗", "🧭", "🪄", "📎", "🗒️", "🎧", "🎬", "🤖",
];

export function IconPicker({ icon, fallback, onChange, size = "lg" }: {
  icon: string | null;
  /** Shown while the skill has no icon of its own. */
  fallback: string;
  onChange: (icon: string | null) => void;
  size?: "lg" | "sm";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Change icon" title="Change icon"
        className={`${size === "lg" ? "w-14 h-14 text-[40px]" : "w-9 h-9 text-[22px]"} leading-none flex items-center justify-center
          rounded-xl hover:bg-gray-100 dark:hover:bg-white/10 transition-colors`}>
        {icon ?? fallback}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-40 w-72 p-2 rounded-xl bg-white dark:bg-gray-800
          border border-gray-200 dark:border-gray-700 shadow-xl">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Icon</span>
            {icon && (
              <button type="button" onClick={() => { onChange(null); setOpen(false); }}
                className="text-[11.5px] text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
                Remove
              </button>
            )}
          </div>
          <div className="grid grid-cols-10 gap-0.5">
            {ICONS.map((e) => (
              <button key={e} type="button" onClick={() => { onChange(e); setOpen(false); }}
                className={`text-xl p-1 rounded-md leading-none hover:bg-gray-100 dark:hover:bg-white/10 ${e === icon
                  ? "bg-accent-50 dark:bg-accent-500/20 ring-1 ring-accent-300" : ""}`}>
                {e}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
