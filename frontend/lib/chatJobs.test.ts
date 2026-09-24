import { describe, it, expect } from "vitest";
import { completeCommand, matchJobs, parseCommand, resultSummary, type ChatJob } from "./chatJobs";

const J = (skill: string, title: string): ChatJob =>
  ({ skill, title, description: "", usd: 0.05, input_tokens: 1, output_tokens: 1, runnable: null });
const JOBS = [J("study-guide", "Study guide"), J("flashcards", "Flashcards"), J("compare-sources", "Compare sources")];

describe("chat jobs", () => {
  it("reads a /command with an optional focus, only for offered jobs", () => {
    expect(parseCommand("/flashcards on Q-learning", JOBS)).toEqual({ skill: "flashcards", focus: "on Q-learning" });
    expect(parseCommand("/study-guide", JOBS)).toEqual({ skill: "study-guide", focus: "" });
    expect(parseCommand("/delete-everything", JOBS)).toBeNull();
    expect(parseCommand("what is Q-learning?", JOBS)).toBeNull();
  });

  it("suggests jobs while '/' is being typed", () => {
    expect(matchJobs("/", JOBS).length).toBe(3);
    expect(matchJobs("/fl", JOBS).map((j) => j.skill)).toEqual(["flashcards"]);
    expect(matchJobs("/flashcards now", JOBS)).toEqual([]);   // past the name: no menu
    expect(matchJobs("hello", JOBS)).toEqual([]);
  });

  it("finds a /command anywhere a word starts; the rest of the text is its focus", () => {
    expect(parseCommand("make it short /study-guide", JOBS))
      .toEqual({ skill: "study-guide", focus: "make it short" });
    expect(parseCommand("only chapter 2 /flashcards about Q-learning", JOBS))
      .toEqual({ skill: "flashcards", focus: "only chapter 2 about Q-learning" });
    // a slash inside a link or a word is not a command
    expect(parseCommand("see https://x.org/flashcards", JOBS)).toBeNull();
    expect(parseCommand("and/flashcards", JOBS)).toBeNull();
  });

  it("suggests jobs for the /word at the caret, not only at the start", () => {
    expect(matchJobs("make it short /stu", JOBS).map((j) => j.skill)).toEqual(["study-guide"]);
    const text = "make it short /stu then stop";
    const caret = "make it short /stu".length;
    expect(matchJobs(text, JOBS, caret).map((j) => j.skill)).toEqual(["study-guide"]);
    expect(completeCommand(text, caret, "study-guide"))
      .toEqual({ text: "make it short /study-guide then stop", caret: "make it short /study-guide ".length });
    expect(matchJobs("a/b", JOBS)).toEqual([]);
  });

  it("summarises a result", () => {
    const html = '<h2>A</h2><h2>B</h2><div data-type="callout"></div><table></table><details></details>';
    expect(resultSummary(html)).toBe("2 chapters · 1 box · 1 table · 1 toggle");
  });
});
