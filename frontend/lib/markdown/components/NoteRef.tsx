"use client";

import Link from "next/link";

interface Props {
  id: string;
  title?: string;
  icon?: string;
}

export function NoteRef({ id, title = "Untitled", icon = "📄" }: Props) {
  return (
    <Link
      href={`/brain/${id}`}
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-300 text-sm hover:bg-accent-100 dark:hover:bg-accent-900 transition-colors"
    >
      <span aria-hidden>{icon}</span>
      <span className="font-medium">{title}</span>
    </Link>
  );
}
