"use client";

// The frame of every Settings page: a slim top bar with the sections
// (components/settings/sections.ts) and the page below, full height — the
// skills editor needs its width for the list and the page side by side.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Settings } from "lucide-react";
import { SETTINGS_SECTIONS } from "@/components/settings/sections";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="shrink-0 flex items-center gap-4 px-4 h-11 border-b border-gray-100 dark:border-gray-800
        group-data-[sidebar=collapsed]/shell:pl-14">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-900 dark:text-gray-100">
          <Settings size={14} className="text-gray-400" /> Settings
        </span>
        <nav aria-label="Settings sections" className="flex items-center gap-0.5 min-w-0 overflow-x-auto">
          {SETTINGS_SECTIONS.map((s) => {
            const active = pathname.startsWith(s.href);
            return (
              <Link key={s.id} href={s.href} aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] whitespace-nowrap transition-colors ${
                  active
                    ? "bg-gray-100 dark:bg-white/10 text-gray-900 dark:text-gray-100 font-medium"
                    : "text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-white/5"}`}>
                <s.icon size={13} /> {s.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <div className="flex-1 min-h-0 flex">{children}</div>
    </div>
  );
}
