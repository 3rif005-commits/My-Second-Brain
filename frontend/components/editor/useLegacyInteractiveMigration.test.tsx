// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLegacyInteractiveMigration } from "./useLegacyInteractiveMigration";

const KEY = "interactive-n1";
const legacy = [{ title: "Quiz", html: "<p>q</p>" }];

function fakeEditor(doc: unknown[] = []) {
  return { getDocument: () => doc, insertBlocksAtEnd: vi.fn() };
}

beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => vi.useRealTimers());

describe("legacy interactive migration", () => {
  it("inserts the old blocks, and deletes the browser copy only after a save containing all of them", () => {
    localStorage.setItem(KEY, JSON.stringify(legacy));
    const ed = fakeEditor();
    const ref = { current: ed } as never;
    const { result } = renderHook(() => useLegacyInteractiveMigration(ref, "n1"));
    act(() => { vi.advanceTimersByTime(300); });
    expect(ed.insertBlocksAtEnd).toHaveBeenCalledWith([{ type: "interactive", props: { title: "Quiz", html: "<p>q</p>" } }]);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    result.current(false, [{ type: "interactive", props: { html: "<p>q</p>" } }]);   // failed PATCH
    result.current(true, [{ type: "paragraph" }]);                                    // unrelated autosave
    result.current(true, [{ type: "interactive", props: { html: "<p>other</p>" } }]); // another block, not ours
    expect(localStorage.getItem(KEY)).not.toBeNull();
    result.current(true, [{ type: "interactive", props: { html: "<p>q</p>" } }]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("waits for the editor ref to appear", () => {
    localStorage.setItem(KEY, JSON.stringify(legacy));
    const ref = { current: null } as { current: ReturnType<typeof fakeEditor> | null };
    renderHook(() => useLegacyInteractiveMigration(ref as never, "n1"));
    act(() => { vi.advanceTimersByTime(1000); });
    const ed = fakeEditor();
    ref.current = ed;
    act(() => { vi.advanceTimersByTime(300); });
    expect(ed.insertBlocksAtEnd).toHaveBeenCalledTimes(1);
  });

  it("does not insert twice, clears when the note already has them, keeps unreadable data", () => {
    localStorage.setItem(KEY, JSON.stringify(legacy));
    const ed = fakeEditor([{ type: "interactive", props: { html: "<p>q</p>" } }]);
    renderHook(() => useLegacyInteractiveMigration({ current: ed } as never, "n1"));
    act(() => { vi.advanceTimersByTime(300); });
    expect(ed.insertBlocksAtEnd).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();

    localStorage.setItem(KEY, "{broken");
    const ed2 = fakeEditor();
    renderHook(() => useLegacyInteractiveMigration({ current: ed2 } as never, "n1"));
    act(() => { vi.advanceTimersByTime(300); });
    expect(ed2.insertBlocksAtEnd).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe("{broken");
  });
});
