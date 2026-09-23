// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { selectionMenuItems, streamToolsFor, type SelectionSkill } from "./selectionSkills";

const SKILL: SelectionSkill = {
  name: "define-terms", description: "Define every term.",
  output: "insert_below", prompt: "Add a bulleted list…",
};
const DEFAULTS = () => [{ key: "improve_writing", title: "Improve writing",
  onItemClick: () => {} }] as never[];

function editor(selected: boolean, invokeAI = vi.fn()) {
  return {
    getSelection: () => (selected ? { blocks: [{ id: "b1" }] } : undefined),
    getExtension: () => ({ invokeAI }),
  };
}

describe("selection menu skills", () => {
  it("puts skills above the defaults when text is selected", () => {
    const items = selectionMenuItems(editor(true), "user-input", [SKILL], DEFAULTS);
    expect(items.map((i) => i.key)).toEqual(["skill:define-terms", "improve_writing"]);
    expect(items[0].title).toBe("Define terms");
  });

  it("leaves the menu alone with no selection, or once a run is under way", () => {
    for (const [sel, status] of [[false, "user-input"], [true, "user-reviewing"],
                                  [true, "ai-writing"]] as const) {
      const keys = selectionMenuItems(editor(sel), status, [SKILL], DEFAULTS).map((i) => i.key);
      expect(keys).toEqual(["improve_writing"]);
    }
  });

  it("sends the skill's body as the prompt, on the selection", async () => {
    const invokeAI = vi.fn();
    const [item] = selectionMenuItems(editor(true, invokeAI), "user-input", [SKILL], DEFAULTS);
    await item.onItemClick(() => {});
    expect(invokeAI).toHaveBeenCalledOnce();
    const opts = invokeAI.mock.calls[0][0];
    expect(opts.useSelection).toBe(true);
    expect(opts.userPrompt).toBe(SKILL.prompt);
    expect(opts.streamToolsProvider).toBeDefined();
  });

  it("lets the output contract decide what may change — and never delete", () => {
    expect(streamToolsFor("insert_below")).toEqual({ add: true, update: false, delete: false });
    expect(streamToolsFor("rewrite_selection")).toEqual({ add: false, update: true, delete: false });
  });
});
