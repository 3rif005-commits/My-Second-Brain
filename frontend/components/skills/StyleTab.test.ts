import { describe, expect, it } from "vitest";
import { withPreference } from "./StyleTab";

describe("withPreference (E12)", () => {
  it("adds a line after what is there", () => {
    expect(withPreference("<!-- c -->\nNo analogy boxes.\n", "Short definitions."))
      .toBe("<!-- c -->\nNo analogy boxes.\nShort definitions.\n");
  });
  it("never adds the same line twice", () => {
    const t = "No analogy boxes.\n";
    expect(withPreference(t, " No analogy boxes. ")).toBe(t);
  });
});
