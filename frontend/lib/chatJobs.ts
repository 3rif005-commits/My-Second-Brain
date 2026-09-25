// The workspace chat's jobs (skills) — the pure parts, so they can be tested
// without a browser. User decision (2026-09-24): jobs run from the chat as
// /name commands, or the model picks one; a job's result is previewed in the
// chat and reaches the note only when the user clicks Insert or Replace.

export interface ChatJob {
  skill: string;
  title: string;
  description: string;
  usd: number | null;
  input_tokens: number;
  output_tokens: number;
  /** Why it cannot run on this note right now; null when it can. */
  runnable: string | null;
}

export interface JobResult {
  skill: string;
  title: string;
  html: string;
  source_ids: string[];
  truncated: boolean;
  input_tokens: number;
  output_tokens: number;
  usd: number | null;
  /** The study guide only (E9): how it was written, and the check on it. */
  method?: "single" | "chapters" | null;
  check?: GuideCheck | null;
}

/** services/workspace/guide_check.py — counts, no model. */
export interface GuideCheck {
  sources: { title: string; pages: number; sections: number; concepts: number;
    depth: number | null; thin: boolean }[];
  /** Sources that came out thin — the card offers to write it chapter by chapter. */
  thin: string[];
  problems: string[];
}

// A command can sit anywhere in the message, as long as it starts a word:
// "make it short /study-guide" runs the study guide with "make it short" as
// its focus (user, 2026-09-24). A "/" inside a word or a link is not one.
const COMMAND = /(^|\s)\/([a-z0-9-]+)(?=\s|$)/g;

/** "/flashcards on Q-learning" or "on Q-learning /flashcards" →
 *  { skill: "flashcards", focus: "on Q-learning" }. The first offered job
 *  wins; anything else is a question. */
export function parseCommand(input: string, jobs: ChatJob[]): { skill: string; focus: string } | null {
  for (const m of input.matchAll(COMMAND)) {
    if (!jobs.some((j) => j.skill === m[2])) continue;
    const start = m.index! + m[1].length;
    const focus = (input.slice(0, start) + input.slice(start + m[2].length + 1))
      .replace(/\s+/g, " ").trim();
    return { skill: m[2], focus };
  }
  return null;
}

/** The "/word" being typed at the caret, if any: where it starts and ends in
 *  the input, and what follows the "/". */
export function slashAt(input: string, caret = input.length): { start: number; end: number; query: string } | null {
  const m = /(^|\s)\/([a-z0-9-]*)$/.exec(input.slice(0, caret));
  if (!m) return null;
  return { start: caret - m[2].length - 1, end: caret, query: m[2] };
}

/** The jobs that match the "/word" being typed at the caret, best first. */
export function matchJobs(input: string, jobs: ChatJob[], caret = input.length): ChatJob[] {
  const at = slashAt(input, caret);
  if (!at) return [];
  const q = at.query;
  return jobs.filter((j) => j.skill.startsWith(q) || j.title.toLowerCase().includes(q));
}

/** Put the chosen job where its "/word" was being typed; the caret goes after it. */
export function completeCommand(input: string, caret: number, skill: string): { text: string; caret: number } {
  const at = slashAt(input, caret) ?? { start: caret, end: caret, query: "" };
  const rest = input.slice(at.end).replace(/^\s+/, "");
  const head = input.slice(0, at.start) + `/${skill} `;
  return { text: head + rest, caret: head.length };
}

/** "3 chapters · 24 boxes · 6 tables" — what a result holds, at a glance. */
export function resultSummary(html: string): string {
  const count = (re: RegExp) => (html.match(re) ?? []).length;
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => {
    if (n) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  add(count(/<h2[\s>]/g), "chapter", "chapters");
  add(count(/data-type="callout"/g), "box", "boxes");
  add(count(/<table[\s>]/g), "table", "tables");
  add(count(/<details[\s>]/g), "toggle", "toggles");
  return parts.join(" · ");
}

/** Styles for the sandboxed preview, so a result looks like a note, not raw HTML. */
export const PREVIEW_CSS = `
body{font:13px/1.55 system-ui,sans-serif;color:#1f2937;margin:12px;}
h1{font-size:18px;margin:0 0 8px}h2{font-size:15px;margin:14px 0 6px}
h3{font-size:13.5px;margin:12px 0 4px}h4,h5,h6{font-size:13px;margin:8px 0 4px}
table{border-collapse:collapse;margin:8px 0;font-size:12px}td,th{border:1px solid #e5e7eb;padding:3px 6px}
blockquote{margin:6px 0;padding:4px 10px;border-left:3px solid #c7d2fe;background:#f8fafc}
[data-type="callout"]{margin:8px 0;padding:6px 10px;border-radius:8px;background:#eef2ff;border:1px solid #c7d2fe}
[data-callout-type="EXAM"]{background:#fef3c7;border-color:#fcd34d}
[data-callout-type="CAUTION"],[data-callout-type="WARNING"]{background:#fee2e2;border-color:#fca5a5}
[data-callout-type="TIP"]{background:#dcfce7;border-color:#86efac}
[data-callout-type="FORMULA"]{background:#f3e8ff;border-color:#d8b4fe}
[data-type="math"]{font-family:ui-monospace,monospace;background:#f9fafb;padding:4px 8px;border-radius:6px}
details{margin:4px 0}summary{cursor:pointer}summary>*{display:inline}
`;

/** A job asked for from outside the AI panel (the editor's "/" menu). */
export interface JobRequest { skill: string; focus?: string; nonce: number }
