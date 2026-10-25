"use client";

// The session's small pieces of chrome: the ⋯ menu in the header, and the first
// steps an empty note offers. Kept apart from WorkspaceShell, which is long enough.
import { useState } from "react";
import { BookOpen, Check, ExternalLink, Layers, Link2, MoreHorizontal, PenLine, Sparkles } from "lucide-react";
import { usdText } from "@/lib/backgroundJobs";
import type { ChatJob } from "@/lib/chatJobs";
import { Popover } from "@/components/ui/primitives/Popover";
import { SourceTrigger } from "./SourceTrigger";

const rowClass = "flex w-full items-center gap-2.5 rounded-md px-2 h-8 text-left text-sm text-ink hover:bg-surface-hover [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-ink-icon";

/** ⋯ in the header: the things a session needs now and then, not all the time. */
export function SessionMenu({ noteId, follow, onFollowChange }: {
  noteId: string;
  /** The note scrolls along with the source being read or played. */
  follow: boolean;
  onFollowChange: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      width={300}
      label="Session menu"
      trigger={
        <button
          type="button"
          aria-label="Session menu"
          aria-haspopup="menu"
          className="flex size-8 items-center justify-center rounded-md text-ink-icon hover:bg-surface-hover data-[state=open]:bg-surface-active"
        >
          <MoreHorizontal size={18} />
        </button>
      }
    >
      <div className="flex flex-col p-1">
        <button type="button" className={rowClass} role="menuitemcheckbox" aria-checked={follow}
          onClick={() => onFollowChange(!follow)}>
          <Link2 /> <span className="flex-1">Note follows the source</span>
          {follow && <Check className="!text-accent" />}
        </button>
        <a href={`/brain/${noteId}`} className={rowClass} onClick={() => setOpen(false)}>
          <ExternalLink /> Open the note as a page
        </a>
        <div className="my-1 h-px bg-line" />
        <SourceTrigger noteId={noteId} />
      </div>
    </Popover>
  );
}

const STARTERS: { skill: string; label: string; icon: React.ReactNode }[] = [
  { skill: "study-guide", label: "Write a study guide", icon: <BookOpen size={18} /> },
  { skill: "flashcards", label: "Make flashcards", icon: <Layers size={18} /> },
];

/** What an empty note offers: a job from the sources, or just writing.
 *  Nothing runs until one is picked. */
export function NoteStarters({ jobs, sourceCount, onJob, onWrite }: {
  jobs: ChatJob[];
  sourceCount: number;
  onJob: (skill: string) => void;
  onWrite: () => void;
}) {
  const offered = STARTERS
    .map((s) => ({ ...s, job: jobs.find((j) => j.skill === s.skill) }))
    .filter((s) => s.job && !s.job.runnable);
  const from = sourceCount === 1 ? "your source" : `all ${sourceCount} sources`;

  return (
    <div className="mt-6 flex max-w-md flex-col gap-2" contentEditable={false}>
      <p className="mb-1 text-sm text-ink-secondary">
        {sourceCount === 0
          ? "Add a PDF, a video or a link with the + above the source, or just start typing."
          : "Start from your sources, or just type. Nothing runs until you pick."}
      </p>
      {offered.map((s, i) => (
        <button
          key={s.skill}
          type="button"
          onClick={() => onJob(s.skill)}
          className={`flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-left transition-colors duration-instant ${
            i === 0 ? "bg-accent text-ink-on-accent hover:bg-accent-hover" : "border border-line-strong text-ink hover:bg-surface-hover"}`}
        >
          {s.icon}
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{s.label}</span>
            <span className={`block text-xs ${i === 0 ? "opacity-90" : "text-ink-secondary"}`}>
              From {from} · ≈{usdText(s.job!.usd)}
            </span>
          </span>
        </button>
      ))}
      <button
        type="button"
        onClick={onWrite}
        className="flex items-center gap-3 rounded-lg border border-line-strong px-3.5 py-2.5 text-left text-ink transition-colors duration-instant hover:bg-surface-hover"
      >
        <PenLine size={18} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">Start writing</span>
          <span className="block text-xs text-ink-secondary">Select text in a source to add it here</span>
        </span>
      </button>
      {offered.length === 0 && sourceCount > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-ink-tertiary">
          <Sparkles size={12} /> The AI jobs appear here once your sources are read.
        </p>
      )}
    </div>
  );
}
