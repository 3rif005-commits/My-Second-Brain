// A worksheet solved unit by unit (docs/INTERACTIVE_NOTES_DESIGN.md).
//
// The backend (services/workspace/units.py) plans the page, and the note gets
// a skeleton: every exercise and question as the toggle heading it will have,
// tagged data-unit="KEY". BlockNote drops unknown attributes when it parses
// HTML, so the keys are read from the HTML first and paired with the heading
// blocks in document order — the way anchorHeadings.ts pins page links.
import type { Passage } from "@/components/workspace/viewers/passageMarks";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

export type UnitState = "planned" | "written" | "checked" | "flagged";

export interface Unit {
  key: string;
  parent_key: string | null;
  depth: number;
  label: string;
  title: string;
  question: string;
  quote: string;
  page: number | null;
  kind: string;
  rules: unknown[];
  /** What the answer must show ("K-map F1", "circuit"); the note's "Needs:" line. */
  needs?: string[];
  importance: string;
  state: UnitState;
  problems: string[];
  block_id: string | null;
  pending: boolean;
  resource_id: string | null;
  position: number;
  /** Earlier AI versions (HTML), newest last — what Back to old restores. */
  versions?: unknown[];
}

/** A part of the page to put into the note: an exercise, "overview" or "revision". */
export interface UnitFill { noteId: string; key: string; html: string }
export type FillOutcome = "filled" | "edited" | "missing";
export const UNIT_EVENT = "note-unit";

/** What the panel asks a note to do with a written unit. The note answers
 *  with how it went; false when no page for that note is open. */
export function offerUnit(f: UnitFill, waitMs = 30_000): Promise<FillOutcome | false> {
  return new Promise((resolve) => {
    let answered = false;
    const timer = setTimeout(() => { if (!answered) resolve(false); }, waitMs);
    window.dispatchEvent(new CustomEvent(UNIT_EVENT, {
      detail: { fill: f, respond: (o: FillOutcome) => { answered = true; clearTimeout(timer); resolve(o); } },
    }));
  });
}

// ---- keys ↔ blocks ------------------------------------------------------------

/** The data-unit key of every heading of `html`, in document order; null for a
 *  heading with none. One entry per heading, so it zips with the heading
 *  blocks BlockNote makes of the same HTML. */
export function readDraftUnits(html: string): (string | null)[] {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll("h1, h2, h3, h4, h5, h6"))
    .map((h) => h.getAttribute("data-unit"));
}

/** Heading blocks, depth first, in document order. */
export function headingBlocks(blocks: AnyBlock[]): AnyBlock[] {
  const out: AnyBlock[] = [];
  const walk = (list: AnyBlock[]) => {
    for (const b of list ?? []) {
      if (b?.type === "heading") out.push(b);
      if (Array.isArray(b?.children) && b.children.length) walk(b.children);
    }
  };
  walk(blocks);
  return out;
}

/** [{key, block_id}] for the tagged headings that landed. When the counts
 *  differ the pairing is still by order (and says so): a key on the wrong
 *  heading is visible and fixable, a key on nothing is lost. */
export function bindUnits(blocks: AnyBlock[], keys: (string | null)[]): { key: string; block_id: string }[] {
  const heads = headingBlocks(blocks);
  if (heads.length !== keys.length) {
    console.warn(`[units] ${keys.length} headings in the HTML vs ${heads.length} heading blocks`);
  }
  const out: { key: string; block_id: string }[] = [];
  heads.forEach((h, i) => {
    const key = keys[i];
    if (key != null && h?.id) out.push({ key, block_id: h.id });
  });
  return out;
}

// ---- what a unit looks like now ------------------------------------------------

export const NOT_SOLVED = "Not solved yet.";

const inlineText = (b: AnyBlock): string =>
  Array.isArray(b?.content)
    ? b.content.map((c: AnyBlock) => (c?.type === "text" ? c.text ?? "" : c?.type === "link" ? inlineText(c) : "")).join("")
    : typeof b?.content === "string" ? b.content : "";

/** Is this unit still the skeleton (headings, grey question lines and
 *  "Not solved yet.")? Only then may a written answer replace it: anything
 *  else is the user's work. */
export function isUntouchedSkeleton(block: AnyBlock): boolean {
  const ok = (b: AnyBlock): boolean => {
    if (b?.type === "heading") return (b.children ?? []).every(ok);
    if (b?.type !== "paragraph") return false;
    const text = inlineText(b).trim();
    const grey = Array.isArray(b.content) && b.content.length > 0 && b.content.every((c: AnyBlock) =>
      c?.type !== "text" || c.styles?.textColor === "gray" || !c.text?.trim());
    // The "Needs:" line is meant to be edited before solving.
    const needsLine = text.startsWith(NEEDS_LABEL);
    return (text === NOT_SOLVED || text === "" || grey || needsLine) && (b.children ?? []).length === 0;
  };
  return ok(block);
}

// ---- marks, progress, passages --------------------------------------------------

const isPart = (u: Unit) => u.key !== "" && u.key !== "revision" && u.key !== "overview";

export function childrenOf(units: Unit[], key: string): Unit[] {
  return units.filter((u) => u.parent_key === key);
}

/** The units an answer belongs to: no sub-units. */
export function leafUnits(units: Unit[]): Unit[] {
  return units.filter((u) => isPart(u) && childrenOf(units, u.key).length === 0);
}

export interface Progress { total: number; checked: number; toLook: number; written: number; next: Unit | null }

/** "6 of 11 checked · 1 to look at" — over the answers, in page order. The
 *  next one to look at is a flagged or Redo-pending answer first, then the
 *  first written one not yet checked. */
export function progress(units: Unit[]): Progress {
  const leaves = leafUnits(units).sort((a, b) => a.position - b.position);
  const look = (u: Unit) => u.state === "flagged" || u.pending;
  return {
    total: leaves.length,
    checked: leaves.filter((u) => u.state === "checked").length,
    toLook: leaves.filter(look).length,
    written: leaves.filter((u) => u.state !== "planned").length,
    next: leaves.find(look) ?? leaves.find((u) => u.state === "written") ?? null,
  };
}

export type MarkKind = "planned" | "written" | "checked" | "flagged" | "pending";

/** One mark for a heading: its own state for an answer; for an exercise the
 *  worst of its answers, so a closed toggle still shows what is inside. */
export function markOf(unit: Unit, units: Unit[]): { kind: MarkKind; problems: string[] } {
  const own = (u: Unit): MarkKind => u.pending ? "pending" : u.state;
  const kids = units.filter((u) => u.key.startsWith(unit.key + ".") && childrenOf(units, u.key).length === 0);
  const all = [unit, ...kids];
  const problems = all.flatMap((u) => u.problems ?? []);
  const kinds = all.map(own);
  const rank: MarkKind[] = ["flagged", "pending", "planned", "written", "checked"];
  const kind = kids.length
    ? rank.find((k) => kinds.includes(k)) ?? own(unit)
    : own(unit);
  return { kind, problems };
}

/** Each question's own words, tinted in the sheet (PdfViewer via passageMarks). */
export function unitPassages(units: Unit[]): Passage[] {
  return units
    .filter((u) => isPart(u) && u.quote && u.resource_id && u.page)
    .map((u) => ({ resourceId: u.resource_id!, page: u.page!, text: u.quote.replace(/\s+/g, " ").trim() }));
}

// ---- talking to the backend ----------------------------------------------------

const base = (noteId: string) => `/api/ws/notes/${noteId}/units`;

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.detail?.error ?? body?.error ?? `Server ${res.status}`;
    throw new Error(String(err));
  }
  return body as T;
}

/** One answer's AI check: a blind second solve compared with the note. */
export interface CheckResult {
  key: string;
  verdict: "agree" | "differ" | "unsure";
  /** The second solve's answer ("computed on every input" for a Boolean function). */
  blind: string;
  /** The note's answer, as the check read it. */
  note: string;
  why: string;
}

/** "" checks every answer of the worksheet; the URL names it "_root". */
const keyPath = (key: string) => encodeURIComponent(key === "" ? "_root" : key);

/** The answers under a part (every answer for ""): leaves only, page order. */
export function answersUnder(units: Unit[], key: string): Unit[] {
  return units
    .filter((u) => u.key && u.key !== "revision" && (key === "" || u.key === key || u.key.startsWith(key + ".")))
    .filter((u) => !units.some((c) => c.parent_key === u.key))
    .sort((a, b) => a.position - b.position);
}

/** "6 agree · 1 differs · 1 not sure" */
export function checkSummary(results: CheckResult[]): string {
  const n = (v: CheckResult["verdict"]) => results.filter((r) => r.verdict === v).length;
  return [n("agree") ? `${n("agree")} agree${n("agree") === 1 ? "s" : ""}` : null,
    n("differ") ? `${n("differ")} differ${n("differ") === 1 ? "s" : ""}` : null,
    n("unsure") ? `${n("unsure")} not sure` : null].filter(Boolean).join(" · ");
}

export const unitsApi = {
  list: async (noteId: string): Promise<Unit[]> =>
    (await json<{ units: Unit[] }>(await fetch(base(noteId)))).units,
  bind: async (noteId: string, pairs: { key: string; block_id: string }[]) =>
    json(await fetch(`${base(noteId)}/bind`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pairs),
    })),
  patch: async (noteId: string, key: string, body: { state?: "checked" | "written"; pending?: boolean }) =>
    json(await fetch(`${base(noteId)}/${encodeURIComponent(key === "" ? "_root" : key)}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })),
  check: async (noteId: string, key: string, answers: Record<string, string>) =>
    json<{ key: string; results: CheckResult[]; usd: number | null }>(
      await fetch(`${base(noteId)}/${keyPath(key)}/check`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers }),
      })),
  redo: async (noteId: string, key: string, currentHtml: string, note: string) =>
    json<{ key: string; html: string; problems: Record<string, string[]>; usd: number | null }>(
      await fetch(`${base(noteId)}/${encodeURIComponent(key)}/redo`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_html: currentHtml, note }),
      })),
};

export type SolveEvent =
  | { type: "start"; keys: string[] }
  | { type: "unit"; key: string; html: string; problems: Record<string, string[]> }
  | { type: "unit_error"; key: string; content: string }
  | { type: "finishing" }
  | { type: "finish"; overview: string; revision: string }
  | { type: "done"; usd: number | null }
  | { type: "error"; content: string };

/** Ask the note to Solve all (the AI panel's card sends it): detail {noteId}. */
export const SOLVE_EVENT = "note-units-solve";

export interface SolveProgress {
  running: boolean;
  /** The card handed the run to the note, which shows the progress. */
  handedOff?: boolean;
  total: number;
  done: number;
  finishing?: boolean;
  /** Parts that could not be written, and parts left alone because you edited them. */
  errors: string[];
  edited: string[];
  usd?: number | null;
}

/** Solve all: each exercise goes into its heading as it lands (offerUnit →
 *  the note), then the Overview and the revision sheet. `step` updates the
 *  caller's progress; the AI panel's card and the note's own line both use it. */
export async function solveAll(noteId: string,
                               step: (fn: (s: SolveProgress) => SolveProgress) => void,
                               needs?: Record<string, string[]>): Promise<void> {
  const titles = new Map<string, string>();
  try {
    for (const u of await unitsApi.list(noteId)) titles.set(u.key, u.title);
  } catch { /* titles are only for messages */ }
  const name = (k: string) => titles.get(k) ?? (k === "revision" ? "Revision sheet" : `Part ${k}`);
  try {
    await streamSolve(noteId, needs, async (ev) => {
      if (ev.type === "start") {
        step((s) => ({ ...s, total: ev.keys.length }));
      } else if (ev.type === "unit") {
        const out = await offerUnit({ noteId, key: ev.key, html: ev.html });
        step((s) => ({
          ...s, done: s.done + 1,
          edited: out === "edited" ? [...s.edited, name(ev.key)] : s.edited,
          errors: out === "missing" || out === false
            ? [...s.errors, `${name(ev.key)}: its heading is no longer in the note.`]
            : s.errors,
        }));
      } else if (ev.type === "unit_error") {
        step((s) => ({ ...s, errors: [...s.errors, `${name(ev.key)} could not be written: ${ev.content}`] }));
      } else if (ev.type === "finishing") {
        step((s) => ({ ...s, finishing: true }));
      } else if (ev.type === "finish") {
        if (ev.overview) await offerUnit({ noteId, key: "overview", html: ev.overview });
        if (ev.revision) await offerUnit({ noteId, key: "revision", html: ev.revision });
      } else if (ev.type === "done") {
        step((s) => ({ ...s, usd: ev.usd }));
      } else if (ev.type === "error") {
        step((s) => ({ ...s, errors: [...s.errors, ev.content] }));
      }
    });
  } catch (e) {
    step((s) => ({ ...s, errors: [...s.errors, e instanceof Error ? e.message : "Solving stopped."] }));
  } finally {
    step((s) => ({ ...s, running: false, finishing: false }));
  }
}

/** Solve all, as a stream of events (POST /notes/{id}/units/solve). */
export async function streamSolve(noteId: string, needs: Record<string, string[]> | undefined,
                                  onEvent: (e: SolveEvent) => void | Promise<void>,
                                  signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${base(noteId)}/solve`, {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ needs: needs ?? {} }),
  });
  if (!res.ok || !res.body) {
    await json(res);
    throw new Error(`Server ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      let ev: SolveEvent;
      try { ev = JSON.parse(line.slice(6)); } catch { continue; }
      await onEvent(ev);
    }
  }
}

export const NEEDS_LABEL = "Needs:";

/** The "Needs:" line right under a part's heading, as the student left it:
 *  null when the part has none. */
export function needsOf(block: AnyBlock): string[] | null {
  for (const b of block?.children ?? []) {
    if (b?.type !== "paragraph") continue;
    const text = inlineText(b).trim();
    if (!text.startsWith(NEEDS_LABEL)) continue;
    return text.slice(NEEDS_LABEL.length).split(/[·,;]/).map((x) => x.trim()).filter(Boolean);
  }
  return null;
}
