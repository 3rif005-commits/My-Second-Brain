import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { CheckpointLink } from "./customBlocks";

const HREF = "/brain/workspace/n1?source=s1&p=150";

describe("CheckpointLink (📍 p. N pill)", () => {
  afterEach(() => { push.mockReset(); vi.restoreAllMocks(); });

  it("is not an <a>, so the editor's link handler can't open it in a second tab", () => {
    render(<CheckpointLink href={HREF}>p. 150</CheckpointLink>);
    const link = screen.getByRole("link");
    expect(link.tagName).not.toBe("A");
    expect(link.closest("a")).toBeNull();
  });

  it("a click jumps inside the app, in the same tab", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<CheckpointLink href={HREF}>p. 150</CheckpointLink>);
    fireEvent.click(screen.getByRole("link"));
    expect(push).toHaveBeenCalledWith(HREF);
    expect(open).not.toHaveBeenCalled();
  });

  it("Ctrl/⌘-click and middle-click open a new tab; Enter follows it", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<CheckpointLink href={HREF}>p. 150</CheckpointLink>);
    const link = screen.getByRole("link");
    fireEvent.click(link, { ctrlKey: true });
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(push).not.toHaveBeenCalled();
    fireEvent.keyDown(link, { key: "Enter" });
    expect(push).toHaveBeenCalledWith(HREF);
  });
});
