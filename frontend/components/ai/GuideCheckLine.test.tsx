// E9: the study guide's check on the result card. Quiet when every source is
// covered; names a thin source and offers — never forces — a chapter-by-chapter
// retry.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GuideCheckLine } from "./PanelCards";
import type { JobResult } from "@/lib/chatJobs";

const base: JobResult = {
  skill: "study-guide", title: "Study guide", html: "<h1>T</h1>", source_ids: [],
  truncated: false, input_tokens: 0, output_tokens: 0, usd: null,
};
const src = (title: string, thin: boolean) =>
  ({ title, pages: 20, sections: 5, concepts: 12, depth: thin ? 0.9 : 1.5, thin });

describe("GuideCheckLine", () => {
  it("is quiet when all is well", () => {
    render(<GuideCheckLine busy={false} result={{ ...base, method: "chapters",
      check: { sources: [src("L8", false)], thin: [], problems: [] } }} />);
    expect(screen.getByTestId("guide-check").textContent).toContain("Written chapter by chapter");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names a thin source and offers the chapter-by-chapter retry", () => {
    const retry = vi.fn();
    render(<GuideCheckLine busy={false} onRetryDeep={retry} result={{ ...base, method: "single",
      check: { sources: [src("L8", false), src("L9", true)], thin: ["L9"], problems: [] } }} />);
    expect(screen.getByText(/“L9” got less depth/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again chapter by chapter/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("does not offer chapters again when it already was", () => {
    render(<GuideCheckLine busy={false} onRetryDeep={() => {}} result={{ ...base, method: "chapters",
      check: { sources: [src("L9", true)], thin: ["L9"], problems: [] } }} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lists form problems", () => {
    render(<GuideCheckLine busy={false} result={{ ...base,
      check: { sources: [], thin: [], problems: ["cut off at the length limit"] } }} />);
    expect(screen.getByText("Check: cut off at the length limit.")).toBeTruthy();
  });

  it("shows nothing for other jobs", () => {
    const { container } = render(<GuideCheckLine busy={false} result={base} />);
    expect(container.textContent).toBe("");
  });
});
