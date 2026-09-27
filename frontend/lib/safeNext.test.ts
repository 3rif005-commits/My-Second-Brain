import { describe, expect, it } from "vitest";
import { safeNext } from "./safeNext";

describe("safeNext — login returns only to this app", () => {
  it("keeps a path on this app", () => expect(safeNext("/mcp-connect?request=abc")).toBe("/mcp-connect?request=abc"));
  it("refuses other sites", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "evil", null]) {
      expect(safeNext(bad)).toBe("/brain");
    }
  });
});
