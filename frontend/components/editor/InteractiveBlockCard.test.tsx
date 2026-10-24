// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/liveBlock", async (orig) => ({
  ...(await orig<typeof import("@/lib/liveBlock")>()),
  diagramFromImage: vi.fn(async () => "flowchart LR\n  A --> B"),
}));

import { COMMIT_DELAY_MS, InteractiveBlockCard, MIN_WIDTH, canExportImage, clampWidth, codeLanguage } from "./InteractiveBlockCard";
import { NoteIdContext } from "./noteIdContext";
import { DEFAULT_INTERACTIVE_HTML, LEGACY_SLASH_PLACEHOLDER_HTML } from "@/lib/liveBlock";
import type { InteractiveBlock } from "./BlockEditor";

function card(block: Partial<InteractiveBlock> & { html: string }, onUpdate = vi.fn(), onRemove = vi.fn()) {
  const full: InteractiveBlock = { title: "T", ...block };
  const utils = render(
    <NoteIdContext.Provider value="n1">
      <InteractiveBlockCard block={full} index={0} onUpdate={onUpdate} onRemove={onRemove} />
    </NoteIdContext.Provider>,
  );
  return { ...utils, onUpdate, onRemove };
}

const btn = (name: string | RegExp) => screen.getByRole("button", { name });
const noBtn = (name: string | RegExp) => screen.queryByRole("button", { name });

afterEach(() => vi.useRealTimers());

describe("InteractiveBlockCard — Notion's Mermaid code block model", () => {
  it("preview (the default): one box with the result, Notion's pill; no frame, header or ⚡", () => {
    const { container } = card({ html: "<p>hello</p>", title: "Entropy quiz" });
    expect(container.querySelector(".sb-live-box .sb-live-preview iframe")).toBeTruthy();
    expect(container.querySelector(".sb-live-code-editor")).toBeNull();
    for (const name of [/Ask AI/, "Open preview format menu", "Expand", "Copy code to clipboard", "Open block actions menu"]) {
      expect(btn(name)).toBeTruthy();
    }
    expect(noBtn("Wrap code")).toBeNull();
    expect((screen.getByLabelText("Block title") as HTMLInputElement).value).toBe("Entropy quiz");
    expect(container.textContent).not.toContain("⚡");
  });

  it("the view menu offers Notion's three views; each is saved on the block", () => {
    const { container, onUpdate } = card({ html: "<p>x</p>" });
    fireEvent.click(btn("Open preview format menu"));
    const items = screen.getAllByRole("menuitemradio").map((b) => b.getAttribute("aria-label"));
    expect(items).toEqual(["Show only code and hide preview", "Show only preview and hide code", "Show code and preview"]);
    expect(screen.getByRole("menuitemradio", { name: "Show only preview and hide code" }).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("menuitemradio", { name: "Show only code and hide preview" }));
    expect(container.querySelector(".sb-live-code-editor")).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ view: "code" }));

    fireEvent.click(btn("Open preview format menu"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Show code and preview" }));
    expect(container.querySelector(".sb-live-code-editor")).toBeTruthy();
    expect(container.querySelector("iframe")).toBeTruthy();
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ view: "split" }));
  });

  it("code is edited in place: saved when typing pauses (no Apply), or at once on blur", () => {
    vi.useFakeTimers();
    const { onUpdate } = card({ html: "<p>old</p>", view: "split" });
    const area = screen.getByLabelText("Block code");
    fireEvent.change(area, { target: { value: "<p>new</p>" } });
    expect(onUpdate).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(COMMIT_DELAY_MS); });
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ html: "<p>new</p>", view: "split" }));

    fireEvent.change(area, { target: { value: "<p>newer</p>" } });
    fireEvent.blur(area);
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ html: "<p>newer</p>" }));
    expect(screen.queryByText("Apply")).toBeNull();
  });

  it("our own save coming back doesn't reset the text being typed; an outside change does", () => {
    const onUpdate = vi.fn();
    const { rerender } = render(<InteractiveBlockCard block={{ title: "T", html: "<p>a</p>", view: "code" }} index={0} onUpdate={onUpdate} onRemove={() => {}} />);
    const area = screen.getByLabelText("Block code") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "<p>ab</p>" } });
    fireEvent.blur(area);
    fireEvent.change(area, { target: { value: "<p>abc</p>" } });
    rerender(<InteractiveBlockCard block={{ title: "T", html: "<p>ab</p>", view: "code" }} index={0} onUpdate={onUpdate} onRemove={() => {}} />);
    expect(area.value).toBe("<p>abc</p>");
    rerender(<InteractiveBlockCard block={{ title: "T", html: "<p>from elsewhere</p>", view: "code" }} index={0} onUpdate={onUpdate} onRemove={() => {}} />);
    expect(area.value).toBe("<p>from elsewhere</p>");
  });

  it("Wrap code: in the pill while code shows, and as a toggle in ⋯; saved on the block", () => {
    const { container, onUpdate } = card({ html: "<p>x</p>", view: "code" });
    fireEvent.click(btn("Wrap code"));
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ wrap: true }));
    expect(container.querySelector(".sb-live-code-editor")!.getAttribute("data-wrap")).toBe("true");
    fireEvent.click(btn("Open block actions menu"));
    const toggle = screen.getByRole("menuitemcheckbox", { name: /Wrap code/ });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ wrap: false }));
  });

  it("⋯ → Caption shows the caption field; ⋯ → Delete removes the block", () => {
    const { onUpdate, onRemove } = card({ html: "<p>x</p>", title: "" });
    expect(screen.queryByLabelText("Block title")).toBeNull();
    fireEvent.click(btn("Open block actions menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Caption/ }));
    const input = screen.getByLabelText("Block title");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "Galaxy" } });
    fireEvent.blur(input);
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ title: "Galaxy" }));
    fireEvent.click(btn("Open block actions menu"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("Expand opens the result large over the page; Escape closes it", () => {
    card({ html: "<p>x</p>", title: "Big" });
    fireEvent.click(btn("Expand"));
    const dialog = screen.getByRole("dialog", { name: "Big" });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelector("iframe")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("no browser tooltip on the result; it follows the note's theme", () => {
    const { container } = card({ html: "<p>x</p>", title: "" });
    const frame = container.querySelector("iframe")!;
    expect(frame.getAttribute("title")).toBeNull();
    expect(frame.getAttribute("aria-label")).toBe("Interactive block");
    expect(frame.getAttribute("srcdoc")).toContain("color-scheme:light");
  });

  it("an empty block (no code, or either old placeholder page) shows the Ask AI row", () => {
    for (const html of ["", DEFAULT_INTERACTIVE_HTML, LEGACY_SLASH_PLACEHOLDER_HTML]) {
      const { container, unmount } = card({ html, title: "" });
      expect(container.querySelector("iframe")).toBeNull();
      expect(screen.getByText(/Ask AI to build something here/)).toBeTruthy();
      expect(screen.queryByLabelText("Block title")).toBeNull();
      unmount();
    }
  });

  it("empty: the row opens the AI prompt; Write code opens an empty code + preview view", () => {
    const { onUpdate } = card({ html: "" });
    fireEvent.click(screen.getByText(/Ask AI to build something here/));
    expect(screen.getByLabelText("Ask AI")).toBeTruthy();
    fireEvent.click(screen.getByText("Write code"));
    expect((screen.getByLabelText("Block code") as HTMLTextAreaElement).value).toBe("");
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ view: "split" }));
  });

  it("an AI reply in words (not code) is shown as a message and never replaces the block", async () => {
    const reply = "I notice the knowledge context is about **Q-Learning**, not photosynthesis.";
    const body = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "text", content: reply })}\n\ndata: [DONE]\n\n`));
        c.close();
      },
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status: 200 }));
    const { onUpdate } = card({ html: "<p>old</p>" });
    fireEvent.click(btn(/Ask AI/));
    fireEvent.change(screen.getByLabelText("Ask AI"), { target: { value: "a quiz on photosynthesis" } });
    fireEvent.keyDown(screen.getByLabelText("Ask AI"), { key: "Enter" });
    await vi.waitFor(() => expect(screen.getByRole("alert").textContent).toContain("knowledge context is about Q-Learning"));
    expect(onUpdate).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });

  it("an empty block's pill holds only ⋯ (the row itself offers Ask AI)", () => {
    card({ html: "" });
    expect(noBtn(/^Ask AI$/)).toBeNull();
    expect(btn("Open block actions menu")).toBeTruthy();
  });

  it("resize bars (Notion): drag narrows/widens the block around its centre and saves its width", () => {
    const { container, onUpdate } = card({ html: "<p>x</p>" });
    const live = container.querySelector(".sb-live") as HTMLElement;
    // column 600px wide (612 minus the 6px margins), centred at x = 306
    live.getBoundingClientRect = () => ({ left: 0, width: 612, top: 0, height: 300, right: 612, bottom: 300 }) as DOMRect;
    const bars = container.querySelectorAll(".sb-resize-bar");
    expect(bars).toHaveLength(2);
    const right = bars[1] as HTMLElement;
    fireEvent.pointerDown(right, { pointerId: 1, clientX: 606 });
    expect(container.querySelector(".sb-live-col")!.getAttribute("data-resizing")).toBe("true");
    act(() => { right.dispatchEvent(new MouseEvent("pointermove", { clientX: 456 })); }); // 150 from the centre → 300 of 600
    act(() => { right.dispatchEvent(new MouseEvent("pointerup")); });
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ width: 0.5 }));
    const col = container.querySelector(".sb-live-col") as HTMLElement;
    expect(col.style.width.replace(/\s/g, "")).toMatch(/0\.5\*\(100%-12px\)|\(100%-12px\)\*0\.5/);
    expect(col.getAttribute("data-resizing")).toBeNull();
  });

  it("a block opens at its saved width; the width stays between 25 % and full", () => {
    const { container } = card({ html: "<p>x</p>", width: 0.6 });
    expect((container.querySelector(".sb-live-col") as HTMLElement).style.width.replace(/\s/g, "")).toMatch(/0\.6\*\(100%-12px\)|\(100%-12px\)\*0\.6/);
    expect(clampWidth(0.1)).toBe(MIN_WIDTH);
    expect(clampWidth(1.4)).toBe(1);
    expect(clampWidth(0.66666)).toBe(0.667);
  });

  it("window-filling code (3D app, full-screen canvas): big default size, edge to edge, bottom bar", () => {
    const galaxy = "<canvas id=c></canvas><script>c.width=innerWidth;c.height=window.innerHeight</script>";
    const { container, onUpdate } = card({ html: galaxy });
    const preview = container.querySelector(".sb-live-preview")!;
    expect(preview.classList.contains("sb-live-preview-fill")).toBe(true);
    expect((preview.querySelector("iframe") as HTMLIFrameElement).style.height).toBe("420px");
    const bar = container.querySelector(".sb-resize-bottom") as HTMLElement;
    fireEvent.pointerDown(bar, { pointerId: 1, clientY: 500 });
    act(() => { bar.dispatchEvent(new MouseEvent("pointermove", { clientY: 700 })); });
    act(() => { bar.dispatchEvent(new MouseEvent("pointerup")); });
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ height: 620 }));
    expect((preview.querySelector("iframe") as HTMLIFrameElement).style.height).toBe("620px");
    fireEvent.doubleClick(bar);
    expect(onUpdate).toHaveBeenLastCalledWith(0, expect.objectContaining({ height: 0 }));
  });

  it("a saved height is used; content with its own height just fits it (no bottom bar)", () => {
    const { container, unmount } = card({ html: "<style>body{height:100vh}</style><div>x</div>", height: 700 });
    expect((container.querySelector("iframe") as HTMLIFrameElement).style.height).toBe("700px");
    unmount();
    const quiz = card({ html: "<div class=q>quiz</div>" });
    expect(quiz.container.querySelector(".sb-resize-bottom")).toBeNull();
    expect(quiz.container.querySelector(".sb-live-preview-fill")).toBeNull();
  });

  it("an empty block has no resize bars", () => {
    const { container } = card({ html: "" });
    expect(container.querySelector(".sb-resize-bar")).toBeNull();
  });

  it("Save as image is offered only for pictures (diagram, canvas, svg, 3D)", () => {
    expect(canExportImage("flowchart LR\n A-->B")).toBe(true);
    expect(canExportImage("<canvas></canvas>")).toBe(true);
    expect(canExportImage("<p>text</p>")).toBe(false);
    const { unmount } = card({ html: "<p>text</p>" });
    expect(noBtn("Save as image")).toBeNull();
    unmount();
    card({ html: "<svg></svg>" });
    expect(btn("Save as image")).toBeTruthy();
  });

  it("the code is coloured as Mermaid or HTML", () => {
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
