import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const showToast = vi.fn();
vi.mock("@/app/providers", () => ({
  useToast: () => ({ showToast }),
}));

import { useDatabaseView } from "./useDatabaseView";
import type { DatabaseDetailResponse, DatabaseRow } from "./types";

const DETAIL: DatabaseDetailResponse = {
  database: {
    id: "db-1",
    user_id: "user-1",
    title: "My Database",
    description: [],
    icon: null,
    cover_url: null,
    is_inline: false,
    parent_note_id: null,
    is_locked: false,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    deleted_at: null,
  },
  data_source: {
    id: "ds-1",
    database_id: "db-1",
    user_id: "user-1",
    name: "Default",
    system_kind: null,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    is_virtual: false,
  },
  properties: [
    { id: "p1", data_source_id: "ds-1", user_id: "user-1", key: "titleKey", name: "Title", type: "title", config: {}, description: null, storage: "jsonb", column_name: null, result_type: null, is_volatile: false, position: 0, created_at: "2026-01-01T00:00:00Z" },
  ],
  views: [
    { id: "v1", data_source_id: "ds-1", user_id: "user-1", name: "Default view", icon: null, type: "table", config: {}, filter: null, sorts: [], is_locked: false, position: 0 },
  ],
};

const ROWS: { rows: DatabaseRow[] } = {
  rows: [
    { id: "row-1", properties: { titleKey: { type: "title", title: "First" } } },
    { id: "row-2", properties: { titleKey: { type: "title", title: "Second" } } },
  ],
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  showToast.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDatabaseView", () => {
  it("loads database detail and rows on mount", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === "/api/db/databases/db-1") return Promise.resolve(jsonResponse(DETAIL));
      if (url === "/api/db/data-sources/ds-1/rows") return Promise.resolve(jsonResponse(ROWS));
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDatabaseView("db-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.database?.title).toBe("My Database");
    expect(result.current.dataSource?.id).toBe("ds-1");
    expect(result.current.properties).toHaveLength(1);
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("sets an error when the initial load fails", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(jsonResponse({ detail: "database not found" }, 404))
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDatabaseView("missing"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("database not found");
  });

  it("updateCell: applies optimistically, then reconciles with the server response", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/db/databases/db-1") return Promise.resolve(jsonResponse(DETAIL));
      if (url === "/api/db/data-sources/ds-1/rows") return Promise.resolve(jsonResponse(ROWS));
      if (url === "/api/db/data-sources/ds-1/rows/row-1" && init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({ id: "row-1", properties: { titleKey: { type: "title", title: "Edited" } } })
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDatabaseView("db-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCell("row-1", "titleKey", { type: "title", title: "Edited" });
    });

    const row1 = result.current.rows.find((r) => r.id === "row-1");
    expect(row1?.properties.titleKey).toEqual({ type: "title", title: "Edited" });
    expect(showToast).not.toHaveBeenCalled();

    const patchCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
    expect(patchCall).toBeTruthy();
    expect(JSON.parse((patchCall![1] as RequestInit).body as string)).toEqual({
      property_key: "titleKey",
      value: { type: "title", title: "Edited" },
    });
  });

  it("updateCell: rolls back and toasts on a 500", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/db/databases/db-1") return Promise.resolve(jsonResponse(DETAIL));
      if (url === "/api/db/data-sources/ds-1/rows") return Promise.resolve(jsonResponse(ROWS));
      if (url === "/api/db/data-sources/ds-1/rows/row-1" && init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({ detail: "internal error" }, 500));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDatabaseView("db-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCell("row-1", "titleKey", { type: "title", title: "Edited" });
    });

    const row1 = result.current.rows.find((r) => r.id === "row-1");
    // Rolled back to the original value, not left at the optimistic one.
    expect(row1?.properties.titleKey).toEqual({ type: "title", title: "First" });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("internal error", "error");
  });

  it("updateCell: rolls back and toasts on a 501 (All Notes write-not-implemented)", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/db/databases/db-1") return Promise.resolve(jsonResponse(DETAIL));
      if (url === "/api/db/data-sources/ds-1/rows") return Promise.resolve(jsonResponse(ROWS));
      if (url === "/api/db/data-sources/ds-1/rows/row-1" && init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({ detail: "row writes on the All Notes virtual source are not yet implemented" }, 501)
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDatabaseView("db-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateCell("row-1", "titleKey", { type: "title", title: "Edited" });
    });

    const row1 = result.current.rows.find((r) => r.id === "row-1");
    expect(row1?.properties.titleKey).toEqual({ type: "title", title: "First" });
    expect(showToast).toHaveBeenCalledWith(
      "row writes on the All Notes virtual source are not yet implemented",
      "error"
    );
  });
});
