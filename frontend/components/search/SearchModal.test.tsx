import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { registerCommands } from "@/lib/commands";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/brain" }));
vi.mock("@/context/NotionContext", () => ({ useNotion: () => ({ open: vi.fn() }) }));
vi.mock("@/lib/hooks/useNotes", () => ({ useNotes: () => ({ notes: [] }) }));

import { SearchModal } from "./SearchModal";

describe("SearchModal commands", () => {
  it("lists a registered command for a matching query and runs it on Enter", () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ json: () => Promise.resolve([]) })));
    const run = vi.fn();
    const onClose = vi.fn();
    const off = registerCommands([{ id: "note.export.latex", label: "Export as LaTeX", keywords: ["tex"], run }]);
    try {
      render(<SearchModal open onClose={onClose} />);
      const input = screen.getByRole("textbox");
      fireEvent.change(input, { target: { value: "latex" } });
      expect(screen.getByText("Export as LaTeX")).toBeTruthy();
      fireEvent.keyDown(input, { key: "Enter" });
      expect(run).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalled();
    } finally {
      off();
      vi.unstubAllGlobals();
    }
  });
});
