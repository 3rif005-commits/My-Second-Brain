import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SourceMark } from "./SkillSidebar";

describe("SourceMark", () => {
  it("names drafted and installed skills, whatever their source", () => {
    const { rerender } = render(<SourceMark source="user" origin="installed" />);
    expect(screen.getByText("Installed").getAttribute("title")).toMatch(/Never used unasked/);
    rerender(<SourceMark source="user" origin="assistant" />);
    expect(screen.getByText("Drafted by AI")).toBeTruthy();
  });

  it("keeps the old marks for built-ins and your own", () => {
    const { container, rerender } = render(<SourceMark source="bundled" origin="builtin" />);
    expect(container.textContent).toBe("");
    rerender(<SourceMark source="edited" origin="user" />);
    expect(screen.getByText("Edited")).toBeTruthy();
    rerender(<SourceMark source="user" />);
    expect(screen.getByText("Yours")).toBeTruthy();
  });
});
