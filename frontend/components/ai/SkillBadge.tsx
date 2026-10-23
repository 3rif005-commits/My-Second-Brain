"use client";

interface Props { names: string[] }

export function SkillBadge({ names }: Props) {
  return (
    <div className="my-2 inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-accent-50 dark:bg-accent-950/40 text-accent-700 dark:text-accent-300">
      <span aria-hidden>🧩</span>
      <span>
        {names.length === 1 ? "Loaded skill: " : "Loaded skills: "}
        <span className="font-semibold">{names.join(", ")}</span>
      </span>
    </div>
  );
}
