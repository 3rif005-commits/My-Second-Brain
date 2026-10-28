import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/brain" }));

import { MessageList } from "./MessageList";

const NOTE = "09dc0273-e973-4eef-9307-c5703ab54222";

describe("an answer's sources", () => {
  it("lists the notes the answer read, as links to the matched block", () => {
    render(<MessageList items={[{ kind: "assistant", id: "a1", content: "Review backprop first.",
      sources: [{ title: "Midterm plan", href: `/brain/${NOTE}#n3b2` }] }]} />);
    expect(screen.getByText("Read from your notes:")).toBeInTheDocument();
    expect(screen.getByText("Midterm plan").closest("a")).toHaveAttribute("href", `/brain/${NOTE}#n3b2`);
  });

  it("shows nothing while the answer is still streaming", () => {
    render(<MessageList items={[{ kind: "assistant", id: "a1", content: "Rev", streaming: true,
      sources: [{ title: "Midterm plan", href: `/brain/${NOTE}` }] }]} />);
    expect(screen.queryByText("Read from your notes:")).not.toBeInTheDocument();
  });
});
