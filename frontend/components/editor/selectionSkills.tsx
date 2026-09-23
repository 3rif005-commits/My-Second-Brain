"use client";

// Skills in the editor's selection menu.
//
// Select text, open the AI menu, and the skills that declared
// `surfaces: [selection]` sit above BlockNote's own "Improve writing" family.
// A click sends the skill's body as the prompt through xl-ai's own invokeAI —
// the same transport, passthrough, run log and budget every other editor AI
// request uses — and the result lands in xl-ai's accept/reject review, so a
// skill cannot change the user's text without them seeing the diff first.
//
// The output contract decides what the model may touch: `insert_below` may
// only ADD blocks, `rewrite_selection` may only UPDATE the selected ones.
// Neither may delete.

import { useEffect, useState } from "react";
import {
  AIExtension, AIMenu, getDefaultAIMenuItems, type AIMenuSuggestionItem,
} from "@blocknote/xl-ai";
// @ts-ignore — xl-ai@0.48.0 exports aiDocumentFormats at runtime but its
// index.d.ts leaves the api module out (same upstream gap as @blocknote/core)
import { aiDocumentFormats } from "@blocknote/xl-ai";

export type SelectionSkill = {
  name: string;
  description: string;
  output: "insert_below" | "rewrite_selection";
  prompt: string;
};

type Status = Parameters<typeof getDefaultAIMenuItems>[1];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEditor = any;

/** Which edits a skill's output contract allows. */
export function streamToolsFor(output: SelectionSkill["output"]) {
  return output === "rewrite_selection"
    ? { add: false, delete: false, update: true }
    : { add: true, delete: false, update: false };
}

function title(name: string) {
  return name.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** The AI menu's items: skills first when text is selected, then BlockNote's
 *  own. With no selection, or once a run is under way, the menu is exactly
 *  what it was — a skill never appears where it has nothing to act on. */
export function selectionMenuItems(
  editor: AnyEditor,
  status: Status,
  skills: SelectionSkill[],
  defaults: (e: AnyEditor, s: Status) => AIMenuSuggestionItem[] = getDefaultAIMenuItems,
): AIMenuSuggestionItem[] {
  const base = defaults(editor, status);
  if (status !== "user-input" || !editor.getSelection?.() || skills.length === 0) {
    return base;
  }
  const items: AIMenuSuggestionItem[] = skills.map((s) => ({
    key: `skill:${s.name}`,
    title: title(s.name),
    subtext: s.description,
    aliases: [s.name],
    group: "Skills",
    size: "small",
    onItemClick: async () => {
      await editor.getExtension(AIExtension)?.invokeAI({
        useSelection: true,
        userPrompt: s.prompt,
        streamToolsProvider: aiDocumentFormats.html.getStreamToolsProvider({
          defaultStreamTools: streamToolsFor(s.output),
        }),
      });
    },
  }));
  return [...items, ...base];
}

let cached: Promise<SelectionSkill[]> | null = null;

/** Fetched once per page load: the list is bundled files, not user data. */
export function useSelectionSkills(): SelectionSkill[] {
  const [skills, setSkills] = useState<SelectionSkill[]>([]);
  useEffect(() => {
    let live = true;
    cached ??= fetch("/api/skills/surface/selection")
      .then((r) => (r.ok ? r.json() : { skills: [] }))
      .then((d) => d.skills ?? [])
      .catch(() => { cached = null; return []; });
    cached.then((s) => { if (live) setSkills(s); });
    return () => { live = false; };
  }, []);
  return skills;
}

/** Drop-in for AIMenuController's `aiMenu` prop. */
export function SkillAIMenu(props: React.ComponentProps<typeof AIMenu>) {
  const skills = useSelectionSkills();
  return (
    <AIMenu
      {...props}
      items={(editor, status) => selectionMenuItems(editor, status, skills)}
    />
  );
}
