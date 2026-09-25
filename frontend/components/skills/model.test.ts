import { describe, it, expect } from "vitest";
import type { Skill } from "@/lib/skills";
import {
  canChangeWhere, draftOf, duplicateOf, isDirty, matches, nameProblem, slugify, titleOf,
} from "./model";
import { diffStat, lineDiff } from "./lineDiff";

const S = (over: Partial<Skill> = {}): Skill => ({
  name: "study-guide", title: "Study guide", description: "Write a guide.", body: "Rules.",
  where: "chat", output: "draft_note", icon: null, files: [], source: "bundled",
  can_reset: false, can_delete: false, ...over,
});

describe("skills editor model", () => {
  it("a draft is dirty only when something the editor changes differs", () => {
    const s = S();
    expect(isDirty(s, draftOf(s))).toBe(false);
    expect(isDirty(s, { ...draftOf(s), body: "Rules!" })).toBe(true);
    expect(isDirty(s, { ...draftOf(s), icon: "🎓" })).toBe(true);
    expect(isDirty(s, { ...draftOf(s), multi_source: "chapters" })).toBe(true);   // E9
    expect(isDirty(null, null)).toBe(false);
  });

  it("only a skill of the user's own can move to another place", () => {
    expect(canChangeWhere(S())).toBe(false);
    expect(canChangeWhere(S({ source: "edited" }))).toBe(false);
    expect(canChangeWhere(S({ source: "user" }))).toBe(true);
  });

  it("turns a title into a command and checks it", () => {
    expect(slugify("Exam questions!")).toBe("exam-questions");
    expect(slugify("  Résumé — court  ")).toBe("resume-court");
    expect(nameProblem("exam-questions", ["study-guide"])).toBeNull();
    expect(nameProblem("study-guide", ["study-guide"])).toMatch(/already exists/);
    expect(nameProblem("X", [])).toMatch(/Lowercase/);
    expect(nameProblem("", [])).toMatch(/name/);
    expect(titleOf("compare-sources")).toBe("Compare sources");
  });

  it("searches name, title and description", () => {
    expect(matches(S(), "GUIDE")).toBe(true);
    expect(matches(S(), "write a")).toBe(true);
    expect(matches(S(), "flashcards")).toBe(false);
    expect(matches(S(), "  ")).toBe(true);
  });

  it("a duplicate gets a free name and the same content", () => {
    const d = duplicateOf(S(), ["study-guide", "study-guide-copy"]);
    expect(d.name).toBe("study-guide-copy-2");
    expect(d.draft.body).toBe("Rules.");
  });
});

describe("line diff", () => {
  it("marks what was added and removed, keeps the rest", () => {
    const d = lineDiff("a\nb\nc", "a\nB\nc\nd");
    expect(d).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
    expect(diffStat(d)).toEqual({ added: 2, removed: 1 });
    expect(diffStat(lineDiff("same", "same"))).toEqual({ added: 0, removed: 0 });
  });
});
