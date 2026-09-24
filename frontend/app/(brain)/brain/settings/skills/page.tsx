"use client";

// Settings → Skills. The editor lives in components/skills/ — start at
// SkillsWorkspace.tsx, whose header maps every piece.
import { Suspense } from "react";
import { SkillsWorkspace } from "@/components/skills/SkillsWorkspace";

export default function SkillsSettingsPage() {
  return (
    <Suspense fallback={<div className="flex-1 p-8 text-[13px] text-gray-400">Loading…</div>}>
      <SkillsWorkspace />
    </Suspense>
  );
}
