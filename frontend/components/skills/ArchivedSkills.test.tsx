import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SkillSidebar } from "./SkillSidebar";

describe("Archived skills in the sidebar", () => {
  it("lists them with Restore, kept apart from the skills in use", () => {
    const onRestore = vi.fn();
    render(<SkillSidebar skills={[]} archived={[{ name: "old-draft", description: "d", origin: "assistant",
      archived_at: "2026-10-01T00:00:00Z" }]} onRestore={onRestore} selected={null} query=""
      onQuery={() => {}} onSelect={() => {}} onNew={() => {}} onAction={() => {}} loading={false} />);
    const section = screen.getByRole("region", { name: "Archived skills" });
    expect(section.textContent).toContain("old-draft");
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(onRestore).toHaveBeenCalledWith("old-draft");
  });
});
