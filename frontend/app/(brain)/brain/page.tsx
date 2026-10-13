"use client";

// Home, in the manner of Notion's: a greeting, then "Recently visited" as a row of
// small page cards, then the quiet actions. No hero illustration.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Clock, FileText, Plus, Upload } from "lucide-react";
import { useNotes } from "@/lib/hooks/useNotes";
import { ImportFileButton } from "@/components/workspace/ImportFileButton";
import { TopBar } from "@/components/shell/TopBar";
import { Skeleton } from "@/components/ui/EmptyState";

function greeting(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function relative(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function BrainIndexPage() {
  const { notes, loading } = useNotes();
  const [hello, setHello] = useState("Welcome back");
  useEffect(() => setHello(greeting(new Date().getHours())), []);

  const recent = notes
    .filter((n) => n.last_viewed_at)
    .sort((a, b) => new Date(b.last_viewed_at!).getTime() - new Date(a.last_viewed_at!).getTime())
    .slice(0, 8);
  const shown = recent.length ? recent : notes.slice(0, 8);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <TopBar crumbs={[{ label: "Home" }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[900px] px-6 pb-24 pt-16 sm:px-[96px]">
          <h1 className="mb-10 text-center text-[30px] font-semibold leading-[39px] text-ink">{hello}</h1>

          <section aria-labelledby="recent-heading">
            <h2 id="recent-heading" className="mb-3 flex items-center gap-1.5 px-0.5 text-xs font-medium text-ink-secondary">
              <Clock size={14} /> Recently visited
            </h2>
            {loading ? (
              <Skeleton rows={3} />
            ) : shown.length ? (
              <div className="-mx-1 flex gap-4 overflow-x-auto px-1 pb-2">
                {shown.map((n) => (
                  <Link
                    key={n.id}
                    href={`/brain/${n.id}`}
                    className="flex h-[150px] w-[144px] shrink-0 flex-col overflow-hidden rounded-card bg-surface-elevated shadow-card transition-colors duration-instant hover:bg-surface-hover"
                  >
                    <div className="relative h-11 bg-surface-field">
                      <span className="absolute -bottom-3 left-4 flex size-8 items-center justify-center text-[26px] leading-none text-ink-icon">
                        {n.icon || <FileText size={26} strokeWidth={1.5} />}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col justify-between px-4 pb-3 pt-5">
                      <span className="line-clamp-2 text-sm font-medium leading-5 text-ink">{n.title || "Untitled"}</span>
                      <span className="text-xs text-ink-tertiary">{n.last_viewed_at ? relative(n.last_viewed_at) : relative(n.updated_at)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="px-0.5 text-sm text-ink-tertiary">Pages you open will show up here.</p>
            )}
          </section>

          <section className="mt-10 flex flex-wrap gap-2">
            <Link
              href="/brain/new"
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-sm font-medium text-ink-on-accent transition-colors duration-instant hover:bg-accent-hover"
            >
              <Plus size={16} /> New Note
            </Link>
            <ImportFileButton className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong px-3 text-sm font-medium text-ink transition-colors duration-instant hover:bg-surface-hover">
              <Upload size={16} /> Import
            </ImportFileButton>
          </section>
        </div>
      </div>
    </div>
  );
}
