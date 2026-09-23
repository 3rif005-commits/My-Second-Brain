"use client";

// The jobs this note can run, and the one call that starts one. Shared by the
// action bar and the editor's slash menu so both offer exactly the same set —
// two lists that could drift is two lists that will.
import { useCallback, useEffect, useState } from "react";
import { wsApi, type NoteSkill } from "@/lib/workspace";

export interface NoteSkillsController {
  skills: NoteSkill[];
  /** The skill currently being started, if any. */
  starting: string | null;
  run: (skill: NoteSkill) => Promise<void>;
}

export function useNoteSkills(
  noteId: string | null,
  readyKey: string,
  busy: boolean,
  onStarted: () => void,
): NoteSkillsController {
  const [skills, setSkills] = useState<NoteSkill[]>([]);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    if (!noteId || readyKey === "") { setSkills([]); return; }
    let live = true;
    wsApi.listSkills(noteId)
      .then((s) => { if (live) setSkills(s); })
      .catch(() => { if (live) setSkills([]); });
    return () => { live = false; };
  }, [noteId, readyKey]);

  const run = useCallback(async (skill: NoteSkill) => {
    // A skill that cannot run is refused here as well as in the UI: the slash
    // menu has no room for a reason, so the guard cannot live only in a chip.
    if (!noteId || busy || skill.runnable) return;
    setStarting(skill.skill);
    try {
      await wsApi.runSkill(noteId, skill.skill);
      onStarted();
    } finally {
      setStarting(null);
    }
  }, [noteId, busy, onStarted]);

  return { skills, starting, run };
}
