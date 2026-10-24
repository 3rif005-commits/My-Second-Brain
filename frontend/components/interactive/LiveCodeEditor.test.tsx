// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LiveCodeEditor } from "./LiveCodeEditor";

function Harness({ initial, lang }: { initial: string; lang: string }) {
  const [v, setV] = useState(initial);
  return <LiveCodeEditor value={v} onChange={setV} lang={lang} />;
}

describe("LiveCodeEditor", () => {
  it("colours HTML behind the textarea, always exactly the text being edited", async () => {
    const { container } = render(<Harness initial={'<p class="x">Hi</p>'} lang="html" />);
    const area = screen.getByLabelText("Block code") as HTMLTextAreaElement;
    const back = container.querySelector(".sb-live-code-back")!;
    await waitFor(() => expect(area.dataset.coloured).toBe("true"));
    expect(back.textContent).toBe('<p class="x">Hi</p>\n');
    expect([...back.querySelectorAll("span[style]")].some((s) => (s as HTMLElement).style.color === "var(--code-tag)")).toBe(true);
    fireEvent.change(area, { target: { value: '<p class="y">Bye</p>' } });
    expect(back.textContent).toBe('<p class="y">Bye</p>\n');
    expect(area.dataset.coloured).toBe("true");
  });

  it("plain text (a model link) stays plain: the textarea shows its own text", () => {
    const { container } = render(<Harness initial="https://x.org/a.glb" lang="text" />);
    expect((screen.getByLabelText("Block code") as HTMLTextAreaElement).dataset.coloured).toBe("false");
    expect(container.querySelector(".sb-live-code-back")!.textContent).toBe("");
  });
});
