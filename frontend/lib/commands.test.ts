import { afterEach, describe, expect, it, vi } from "vitest";
import { findCommands, registerCommands, runCommand } from "./commands";

let cleanup: (() => void)[] = [];
afterEach(() => { cleanup.forEach((f) => f()); cleanup = []; });

describe("commands", () => {
  it("runs a registered command by id, and not after its screen unregisters it", () => {
    const run = vi.fn();
    const off = registerCommands([{ id: "note.present", label: "Present", run }]);
    expect(runCommand("note.present")).toBe(true);
    off();
    expect(runCommand("note.present")).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("a newer screen's command isn't removed by an older one unmounting", () => {
    const older = registerCommands([{ id: "x", label: "X", run: () => {} }]);
    const newer = vi.fn();
    cleanup.push(registerCommands([{ id: "x", label: "X", run: newer }]));
    older();
    expect(runCommand("x")).toBe(true);
    expect(newer).toHaveBeenCalled();
  });
  it("quick find matches word starts in the label or keywords", () => {
    cleanup.push(registerCommands([
      { id: "note.export.latex", label: "Export as LaTeX", keywords: ["tex"], run: () => {} },
      { id: "note.present", label: "Present", keywords: ["slides"], run: () => {} },
    ]));
    expect(findCommands("exp lat").map((c) => c.id)).toEqual(["note.export.latex"]);
    expect(findCommands("tex").map((c) => c.id)).toEqual(["note.export.latex"]);
    expect(findCommands("slid").map((c) => c.id)).toEqual(["note.present"]);
    expect(findCommands("atex")).toEqual([]);      // inside a word is not a match
    expect(findCommands("")).toEqual([]);
    expect(findCommands(">")).toHaveLength(2);
  });
});
