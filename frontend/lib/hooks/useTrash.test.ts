// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useTrash } from "./useTrash";

const ITEMS = [
  { id: "n1", title: "Note", deleted_at: "2026-10-23T10:00:00Z", kind: "note" },
  { id: "r1", title: "Row", deleted_at: "2026-10-23T09:00:00Z", kind: "row", database: "Tasks" },
  { id: "d1", title: "Tasks", deleted_at: "2026-10-23T08:00:00Z", kind: "database" },
];

afterEach(() => vi.restoreAllMocks());

function mockFetch() {
  const calls: string[] = [];
  const gone = new Set<string>();
  global.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(url)}`);
    const restored = String(url).match(/\/(\w+)(?:\/restore)?$/)?.[1];
    if (init?.method === "POST" && restored) gone.add(restored);
    const left = ITEMS.filter((i) => !gone.has(i.id));
    return { ok: true, json: async () => (String(url) === "/api/notes/trash" ? left : {}) } as Response;
  }) as unknown as typeof fetch;
  return calls;
}

describe("useTrash", () => {
  it("restores a database through its own route and a row like a note", async () => {
    const calls = mockFetch();
    const { result } = renderHook(() => useTrash());
    await waitFor(() => expect(result.current.trashedNotes).toHaveLength(3));
    await act(() => result.current.restoreNote("d1"));
    await act(() => result.current.restoreNote("r1"));
    expect(calls).toContain("POST /api/notes/trash/databases/d1");
    expect(calls).toContain("POST /api/notes/r1/restore");
    expect(result.current.trashedNotes.map((n) => n.id)).toEqual(["n1"]);
  });

  it("never deletes a whole database forever", async () => {
    const calls = mockFetch();
    const { result } = renderHook(() => useTrash());
    await waitFor(() => expect(result.current.trashedNotes).toHaveLength(3));
    await act(() => result.current.permanentDelete("d1"));
    expect(calls.some((c) => c.startsWith("DELETE"))).toBe(false);
  });
});
