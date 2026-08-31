// The load-bearing assertion here is NON-MODALITY.
//
// Notion's own copy for side peek reads "Open pages on the side. Keeps the view
// behind interactive." Our existing RowPeek renders a bg-black/30 backdrop over
// the whole viewport and traps interaction. If someone later makes SidePeek
// modal "for consistency", the first test below fails — which is the point.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidePeek } from "./SidePeek";

describe("SidePeek", () => {
  it("side mode is non-modal: no backdrop, and the page behind stays reachable", async () => {
    const user = userEvent.setup();
    const behind = vi.fn();
    render(
      <div>
        <button type="button" onClick={behind}>
          behind
        </button>
        <SidePeek open onOpenChange={vi.fn()} title="Row one">
          <div>peek body</div>
        </SidePeek>
      </div>
    );

    expect(screen.getByText("peek body")).toBeInTheDocument();

    // Radix renders its overlay only when we ask for one; side mode must not.
    expect(document.querySelector(".bg-black\\/30")).toBeNull();

    // And the content behind is genuinely clickable, not just visible.
    await user.click(screen.getByText("behind"));
    expect(behind).toHaveBeenCalledTimes(1);
  });

  it("centre mode does render a backdrop", () => {
    render(
      <SidePeek open onOpenChange={vi.fn()} title="Row one" mode="center">
        <div>peek body</div>
      </SidePeek>
    );
    expect(document.querySelector(".bg-black\\/30")).not.toBeNull();
    expect(screen.getByTestId("side-peek")).toHaveAttribute("data-mode", "center");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <SidePeek open onOpenChange={onOpenChange} title="Row one">
        <div>peek body</div>
      </SidePeek>
    );

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers a resize affordance in side mode only", () => {
    const { rerender } = render(
      <SidePeek open onOpenChange={vi.fn()} title="Row one">
        <div>b</div>
      </SidePeek>
    );
    expect(screen.getByTestId("side-peek-resize")).toBeInTheDocument();

    rerender(
      <SidePeek open onOpenChange={vi.fn()} title="Row one" mode="center">
        <div>b</div>
      </SidePeek>
    );
    expect(screen.queryByTestId("side-peek-resize")).not.toBeInTheDocument();
  });
});
