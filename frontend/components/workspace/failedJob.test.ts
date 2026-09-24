import { describe, it, expect } from "vitest";
import { failedJob, jobTitle, type NoteSkill } from "@/lib/workspace";

const skill = (name: string) => ({ skill: name } as unknown as NoteSkill);
const SKILLS = [skill("compare-sources"), skill("flashcards")];

describe("which job a failed run belongs to", () => {
  it("retries the skill this page started, not the study guide", () => {
    const f = failedJob("compare-sources: ConnectionTerminated", SKILLS, "compare-sources");
    expect(f.skill?.skill).toBe("compare-sources");
    expect(f.message).toBe("ConnectionTerminated");
  });

  it("after a reload, reads the job from the server's error prefix", () => {
    const f = failedJob("flashcards: The model returned nothing.", SKILLS, null);
    expect(f.skill?.skill).toBe("flashcards");
    expect(f.message).toBe("The model returned nothing.");
  });

  it("a study-guide failure retries the study guide", () => {
    expect(failedJob("AI provider error (529)", SKILLS, "study-guide").skill).toBeNull();
    expect(failedJob("AI provider error (529)", SKILLS, null).skill).toBeNull();
  });

  it("titles a job for people", () => {
    expect(jobTitle("compare-sources")).toBe("Compare sources");
  });
});

import { formatElapsed } from "@/lib/workspace";

describe("how long a run has been going", () => {
  it("reads as minutes and seconds", () => {
    expect(formatElapsed(42_000)).toBe("0:42");
    expect(formatElapsed(185_400)).toBe("3:05");
  });
  it("says nothing rather than something wrong", () => {
    expect(formatElapsed(null)).toBeNull();
    expect(formatElapsed(-5)).toBeNull();
    expect(formatElapsed(Number.NaN)).toBeNull();
  });
});
