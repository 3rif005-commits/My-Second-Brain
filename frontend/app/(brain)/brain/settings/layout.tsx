"use client";

// Notion's Settings modal (docs/notion-reference/surfaces/settings.md): a card at
// 90vw (max 1512px) × calc(100% − 100px) over a dimmed backdrop, a 240px left nav
// with "Search settings" and grouped sections, and the page in an 800px column.
// Every section keeps its own URL (/brain/settings/<id>), so links and the
// sidebar's Settings row open the modal on the right page; closing returns to
// where you were.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from "@/components/settings/sections";
import { cx } from "@/components/ui/cx";

import { SETTINGS_RETURN_KEY as RETURN_KEY } from "@/lib/settingsReturn";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [query, setQuery] = useState("");
  const active = SETTINGS_SECTIONS.find((s) => pathname.startsWith(s.href));

  const close = () => {
    let back = "/brain";
    try {
      back = sessionStorage.getItem(RETURN_KEY) || "/brain";
    } catch {
      // storage unavailable: go home
    }
    router.push(back);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc closes Settings unless something inside (a menu, a dialog) handles it first.
      if (e.key === "Escape" && !e.defaultPrevented && !document.querySelector("[role=dialog][aria-modal=true]:not([data-settings-modal])")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return SETTINGS_SECTIONS.filter((s) => `${s.label} ${s.group} ${s.keywords ?? ""}`.toLowerCase().includes(q));
  }, [query]);

  const navItem = (s: (typeof SETTINGS_SECTIONS)[number]) => {
    const isActive = s === active;
    return (
      <Link
        key={s.id}
        href={s.href}
        role="tab"
        aria-selected={isActive}
        aria-current={isActive ? "page" : undefined}
        onClick={() => setQuery("")}
        className={cx(
          "flex h-7 items-center gap-1.5 rounded-md px-1.5 text-sm font-medium transition-colors duration-fast",
          isActive ? "bg-surface-active text-ink" : "text-ink-sidebar hover:bg-surface-active",
        )}
      >
        <s.icon size={18} strokeWidth={1.75} className="shrink-0 text-ink-icon" />
        <span className="truncate">{s.label}</span>
      </Link>
    );
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-surface-backdrop px-3 py-[50px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-settings-modal
        className="relative flex h-full w-[90vw] max-w-[1512px] overflow-hidden rounded-modal bg-surface shadow-modal"
      >
        <nav aria-label="Settings sections" className="hidden w-60 shrink-0 flex-col bg-surface-sidebar md:flex">
          <div className="p-2">
            <label className="relative block">
              <Search size={14} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-icon" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search settings"
                aria-label="Search settings"
                className="h-7 w-full rounded-md bg-surface-field pl-7 pr-1.5 text-sm text-ink shadow-[inset_0_0_0_1px_var(--c-border-strong)] outline-none placeholder:text-ink-placeholder focus:shadow-input"
              />
            </label>
          </div>
          <div role="tablist" aria-orientation="vertical" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
            {results ? (
              results.length ? (
                results.map((s) => (
                  <div key={s.id}>
                    <div className="px-1.5 pt-1.5 text-xs text-ink-tertiary">{s.group}</div>
                    {navItem(s)}
                  </div>
                ))
              ) : (
                <p className="px-1.5 py-2 text-sm text-ink-tertiary">No results</p>
              )
            ) : (
              SETTINGS_GROUPS.map((g) => (
                <div key={g} className="flex flex-col gap-0.5 pt-1.5 first:pt-0">
                  <div className="px-2 py-1.5 text-xs font-medium leading-4 text-ink-tertiary">{g}</div>
                  {SETTINGS_SECTIONS.filter((s) => s.group === g).map(navItem)}
                </div>
              ))
            )}
          </div>
        </nav>

        <div className="relative flex min-w-0 flex-1 flex-col">
          {/* Small screens: the sections as a scrollable pill row instead of the nav. */}
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2 md:hidden">
            {SETTINGS_SECTIONS.map((s) => (
              <Link
                key={s.id}
                href={s.href}
                className={cx(
                  "h-7 shrink-0 rounded-full px-2.5 text-sm leading-7",
                  s === active ? "bg-surface-active text-ink" : "text-ink-tertiary",
                )}
              >
                {s.label}
              </Link>
            ))}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close settings"
            className="absolute right-3 top-3 z-10 flex size-[22px] items-center justify-center rounded-full bg-surface-chip text-ink-icon hover:brightness-95"
          >
            <X size={14} />
          </button>
          <div
            className={cx(
              "settings-content min-h-0 flex-1 overflow-y-auto",
              active?.wide ? "flex" : "px-6 pb-11 pt-9 sm:px-[60px]",
            )}
          >
            {active?.wide ? children : <div className="mx-auto w-full max-w-[800px]">{children}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
