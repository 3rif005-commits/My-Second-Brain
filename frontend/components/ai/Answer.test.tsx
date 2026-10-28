import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Answer } from "./Answer";
import type { Citation } from "@/lib/workspace";

const CITE: Citation = {
  n: 1, resource_id: "src-1", title: "Lecture 8.pdf", anchor_type: "page",
  anchor_start: 3, anchor_end: 3, snippet: "Each token builds a query and compares it with every key.",
};

afterEach(() => vi.useRealTimers());

describe("Answer source chips", () => {
  it("shows the source, the page and the quote on hover, and still jumps on click", async () => {
    vi.useFakeTimers();
    const onCitation = vi.fn();
    render(<Answer content="Attention compares tokens [1]." citations={[CITE]}
      colorIndex={new Map([["src-1", 0]])} onCitation={onCitation} />);
    const chip = screen.getByRole("button", { name: /Source 1: Lecture 8.pdf, p. 3/ });

    fireEvent.mouseEnter(chip);
    await act(async () => { vi.advanceTimersByTime(250); });
    const card = screen.getByRole("tooltip");
    expect(card).toHaveTextContent("Lecture 8.pdf");
    expect(card).toHaveTextContent("p. 3");
    expect(card).toHaveTextContent("Each token builds a query");

    fireEvent.mouseLeave(chip);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    fireEvent.click(chip);
    expect(onCitation).toHaveBeenCalledWith(CITE);
  });
});
