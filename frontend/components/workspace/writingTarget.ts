// The note captures and "Add to note" go to in a workspace session (the note
// last worked in), so a source viewer's buttons can name it: "Add to Lecture 10".
import { createContext, useContext } from "react";

export const WritingTargetContext = createContext<{ title: string } | null>(null);

/** "Add to Lecture 10 note", or plain "Add to note" outside a session. */
export function useAddLabel(): string {
  const t = useContext(WritingTargetContext);
  if (!t) return "Add to note";
  const title = t.title.length > 22 ? `${t.title.slice(0, 21)}…` : t.title;
  return `Add to ${title}`;
}
