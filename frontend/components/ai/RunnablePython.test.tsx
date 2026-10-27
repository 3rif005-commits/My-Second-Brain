import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sandbox/python", () => ({
  runPython: vi.fn(async (code: string, opts: { onPhase?: (p: string) => void }) => {
    opts.onPhase?.("loading");
    return { ok: true, stdout: `ran ${code.length} chars`, stderr: "", result: "42", images: ["iVBORw0KGgo="] };
  }),
}));

import { Markdown } from "@/lib/markdown/Markdown";
import { runPython } from "@/lib/sandbox/python";
import { RunnablePre } from "./RunnablePython";

describe("Python blocks in an answer", () => {
  it("run only on click, with the block's exact code", async () => {
    render(<Markdown components={{ pre: RunnablePre }}>{"```python\nx = 6 * 7\nx\n```"}</Markdown>);
    expect(runPython).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText("ran 11 chars")).toBeTruthy();
    expect(vi.mocked(runPython).mock.calls[0][0]).toBe("x = 6 * 7\nx");
    expect(screen.getByAltText("Chart 1").getAttribute("src")).toBe("data:image/png;base64,iVBORw0KGgo=");
  });

  it("leave other code blocks alone", () => {
    render(<Markdown components={{ pre: RunnablePre }}>{"```js\nalert(1)\n```"}</Markdown>);
    expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  });
});
