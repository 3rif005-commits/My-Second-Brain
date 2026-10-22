// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/liveBlock", async (orig) => ({
  ...(await orig<typeof import("@/lib/liveBlock")>()),
  diagramFromImage: vi.fn(async () => "flowchart LR\n  A --> B"),
}));

import { InteractiveBlockCard } from "./InteractiveBlockCard";
import { NoteIdContext } from "./noteIdContext";

describe("InteractiveBlockCard photo drop", () => {
  it("keeps a photo dropped into the AI box from reaching the page around the note", async () => {
    const pageDrop = vi.fn();
    const onUpdate = vi.fn();
    render(
      <div onDrop={pageDrop}>
        <NoteIdContext.Provider value="n1">
          <InteractiveBlockCard block={{ title: "T", html: "" }} index={0} onUpdate={onUpdate} onRemove={() => {}} />
        </NoteIdContext.Provider>
      </div>,
    );
    fireEvent.click(screen.getByText("AI"));
    const photo = new File(["x"], "d.png", { type: "image/png" });
    fireEvent.drop(screen.getByPlaceholderText(/bar chart/), { dataTransfer: { files: [photo], items: [] } });
    expect(pageDrop).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(0, { title: "T", html: "flowchart LR\n  A --> B" }));
  });
});
