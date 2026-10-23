import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MessageList, type StreamItem } from "./MessageList";

describe("MessageList skill chips", () => {
  it("shows one chip for skills loaded together", () => {
    const items: StreamItem[] = [
      { kind: "user", id: "u", content: "q" },
      { kind: "skill", id: "s1", name: "note-author" },
      { kind: "skill", id: "s2", name: "citations" },
      { kind: "skill", id: "s3", name: "citations" },
    ];
    render(<MessageList items={items} />);
    expect(screen.getAllByText(/Loaded skill/)).toHaveLength(1);
    expect(screen.getByText("note-author, citations")).toBeInTheDocument();
  });

  it("keeps the singular for one skill", () => {
    render(<MessageList items={[{ kind: "skill", id: "s1", name: "tutor" }]} />);
    expect(screen.getByText(/Loaded skill:/)).toBeInTheDocument();
  });
});
