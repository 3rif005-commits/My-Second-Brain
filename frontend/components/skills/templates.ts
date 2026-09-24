// REGISTRY — what "New skill" can start from. A new template = one entry.
// A blank one per kind, then examples that show what a good skill reads like.
import type { SelectionOutput, Where } from "@/lib/skills";

export interface SkillTemplate {
  id: string;
  title: string;
  icon: string;
  where: Where;
  /** Selection skills only. */
  output?: SelectionOutput;
  /** One line on the card. */
  blurb: string;
  description: string;
  body: string;
}

export const TEMPLATES: SkillTemplate[] = [
  {
    id: "blank-job", title: "Blank job", icon: "✨", where: "chat",
    blurb: "Runs on a note's sources from the AI panel.",
    description: "",
    body: "",
  },
  {
    id: "blank-selection", title: "Blank action", icon: "✏️", where: "selection", output: "insert_below",
    blurb: "Works on the text you select.",
    description: "",
    body: "",
  },
  {
    id: "blank-assistant", title: "Blank rule", icon: "📘", where: "assistant",
    blurb: "Shapes how the AI answers.",
    description: "",
    body: "",
  },
  {
    id: "exam-questions", title: "Exam questions", icon: "📝", where: "chat",
    blurb: "Likely exam questions with model answers.",
    description: "Write likely exam questions, with model answers, from the note's sources.",
    body: [
      "Write 8–12 exam questions from the attached sources.",
      "",
      "- Mix: definitions, short explanations, one worked problem, one compare/contrast.",
      "- After each question, a model answer a student could memorise.",
      "- Mark which source and page each question comes from.",
      "- Hardest questions last.",
    ].join("\n"),
  },
  {
    id: "explain-simply", title: "Explain simply", icon: "🧒", where: "selection", output: "insert_below",
    blurb: "A plain-language explanation under the selection.",
    description: "Explain the selected text in plain language, for someone new to the subject.",
    body: [
      "Explain the selected text as if to a first-year student.",
      "",
      "- Short sentences. No jargon unless you define it.",
      "- One everyday analogy.",
      "- End with one line: why it matters.",
    ].join("\n"),
  },
  {
    id: "tighten", title: "Tighten", icon: "✂️", where: "selection", output: "rewrite_selection",
    blurb: "Rewrites the selection shorter, same meaning.",
    description: "Rewrite the selected text shorter and clearer, keeping its meaning.",
    body: [
      "Rewrite the selected text to be about half as long.",
      "",
      "- Keep every fact, number and name.",
      "- Keep the author's voice and the formatting (lists stay lists).",
    ].join("\n"),
  },
  {
    id: "answer-style", title: "My answer style", icon: "🎯", where: "assistant",
    blurb: "How you like answers written.",
    description: "How the user wants answers written — apply to every answer.",
    body: [
      "When you answer:",
      "",
      "- Lead with the answer in one sentence, then the detail.",
      "- Use short lists over long paragraphs.",
      "- Cite the note or source you used.",
    ].join("\n"),
  },
];
