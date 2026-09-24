import { describe, it, expect } from "vitest";
import { matchJobs, parseCommand, resultSummary, type ChatJob } from "./chatJobs";

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

  it("summarises a result", () => {
    const html = '<h2>A</h2><h2>B</h2><div data-type="callout"></div><table></table><details></details>';
    expect(resultSummary(html)).toBe("2 chapters · 1 box · 1 table · 1 toggle");
  });
});
