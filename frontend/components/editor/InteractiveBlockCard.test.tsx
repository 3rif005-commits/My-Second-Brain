// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/liveBlock", async (orig) => ({
  ...(await orig<typeof import("@/lib/liveBlock")>()),
  diagramFromImage: vi.fn(async () => "flowchart LR\n  A --> B"),
}));

import { InteractiveBlockCard, canExportImage, codeLanguage } from "./InteractiveBlockCard";
import { NoteIdContext } from "./noteIdContext";
import { DEFAULT_INTERACTIVE_HTML, LEGACY_SLASH_PLACEHOLDER_HTML } from "@/lib/liveBlock";

function card(html: string, title = "T", onUpdate = vi.fn(), onRemove = vi.fn()) {
  const utils = render(
    <NoteIdContext.Provider value="n1">
      <InteractiveBlockCard block={{ title, html }} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    </NoteIdContext.Provider>,
  );
  return { ...utils, onUpdate, onRemove };
}

describe("InteractiveBlockCard layout", () => {
  it("a filled block: the frame, the pill (Ask AI, code, more) and the title as a caption — no header bar", () => {
    const { container } = card("<p>hello</p>", "Entropy quiz");
    expect(container.querySelector(".sb-live-frame iframe")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ask AI/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit code" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
    expect((screen.getByLabelText("Block title") as HTMLInputElement).value).toBe("Entropy quiz");
    expect(container.textContent).not.toContain("⚡");
  });

  it("an empty block (no code, or either old placeholder page) shows the Ask AI row, not a frame", () => {
    for (const html of ["", DEFAULT_INTERACTIVE_HTML, LEGACY_SLASH_PLACEHOLDER_HTML]) {
      const { container, unmount } = card(html, "");
      expect(container.querySelector("iframe")).toBeNull();
      expect(screen.getByText(/Ask AI to build something here/)).toBeTruthy();
      // No caption until there is one (Notion).
      expect(screen.queryByLabelText("Block title")).toBeNull();
      unmount();
    }
  });

  it("the empty row opens the AI prompt; Paste code opens an empty code view", () => {
    card("");
    fireEvent.click(screen.getByText(/Ask AI to build something here/));
    expect(screen.getByLabelText("Ask AI")).toBeTruthy();
    fireEvent.click(screen.getByText("Paste code"));
    expect((screen.getByLabelText("Block code") as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByLabelText("Ask AI")).toBeNull();
  });

  it("Code → edit → Apply saves the code and shows the block again; Cancel keeps the old code", () => {
    const { onUpdate } = card("<p>old</p>");
    fireEvent.click(screen.getByRole("button", { name: "Edit code" }));
    const area = screen.getByLabelText("Block code") as HTMLTextAreaElement;
    expect(area.value).toBe("<p>old</p>");
    fireEvent.change(area, { target: { value: "<p>new</p>" } });
    fireEvent.click(screen.getByText("Cancel"));
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Edit code" }));
    fireEvent.change(screen.getByLabelText("Block code"), { target: { value: "<p>new</p>" } });
    fireEvent.keyDown(screen.getByLabelText("Block code"), { key: "Enter", ctrlKey: true });
    expect(onUpdate).toHaveBeenCalledWith(0, { title: "T", html: "<p>new</p>" });
    expect(screen.queryByLabelText("Block code")).toBeNull();
  });

  it("⋯ → Delete removes the block", () => {
    const { onRemove } = card("<p>x</p>");
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("no tooltip on the frame; an untitled block gets its caption from ⋯ → Add caption", () => {
    const { container, onUpdate } = card("<p>x</p>", "");
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("title")).toBeNull();
    expect(frame.getAttribute("aria-label")).toBe("Interactive block");
    expect(screen.queryByLabelText("Block title")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Add caption/ }));
    const input = screen.getByLabelText("Block title");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Galaxy" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledWith(0, { title: "Galaxy", html: "<p>x</p>" });
  });

  it("the caption saves the title on blur, only when it changed", () => {
    const { onUpdate } = card("<p>x</p>", "Old");
    const input = screen.getByLabelText("Block title");
    fireEvent.blur(input);
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "New" } });
    fireEvent.blur(input);
    expect(onUpdate).toHaveBeenCalledWith(0, { title: "New", html: "<p>x</p>" });
  });

  it("Save as image is offered only for pictures (diagram, canvas, svg, 3D)", () => {
    expect(canExportImage("flowchart LR\n A-->B")).toBe(true);
    expect(canExportImage("<canvas></canvas>")).toBe(true);
    expect(canExportImage("<p>text</p>")).toBe(false);
    const { unmount } = card("<p>text</p>");
    expect(screen.queryByRole("button", { name: "Save as image" })).toBeNull();
    unmount();
    card("<svg></svg>");
    expect(screen.getByRole("button", { name: "Save as image" })).toBeTruthy();
  });

  it("the code view colours Mermaid as Mermaid and HTML as HTML", () => {
    expect(codeLanguage("flowchart LR\n A-->B")).toBe("mermaid");
    expect(codeLanguage("<p>x</p>")).toBe("html");
    expect(codeLanguage("https://x.org/a.glb")).toBe("text");
  });
});

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
    fireEvent.click(screen.getByText(/Ask AI to build something here/));
    const photo = new File(["x"], "d.png", { type: "image/png" });
    fireEvent.drop(screen.getByLabelText("Ask AI"), { dataTransfer: { files: [photo], items: [] } });
    expect(pageDrop).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith(0, { title: "T", html: "flowchart LR\n  A --> B" }));
  });
});
