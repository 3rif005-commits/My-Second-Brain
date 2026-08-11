import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const showToast = vi.fn();
vi.mock("@/app/providers", () => ({
  useToast: () => ({ showToast }),
}));

import { useDatabaseView } from "./useDatabaseView";
import type { DatabaseDetailResponse, DatabaseRow, Group, ViewResponse } from "./types";

const TABLE_VIEW: ViewResponse = {
  id: "v1",
  data_source_id: "ds-1",
  user_id: "user-1",
  name: "Default view",
  icon: null,
  type: "table",
  config: {},
  filter: null,
  sorts: [],
  is_locked: false,
  position: 0,
};

const BOARD_VIEW: ViewResponse = {
  id: "v2",
  data_source_id: "ds-1",
  user_id: "user-1",
  name: "Board",
  icon: null,
  type: "board",
  config: { group_by: { property_key: "status" } },
  filter: null,
  sorts: [],
  is_locked: false,
  position: 1,
};

function detail(views: ViewResponse[]): DatabaseDetailResponse {
  return {
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
      { id: "p2", data_source_id: "ds-1", user_id: "user-1", key: "status", name: "Status", type: "status", config: {}, description: null, storage: "jsonb", column_name: null, result_type: null, is_volatile: false, position: 1, created_at: "2026-01-01T00:00:00Z" },
    ],
    views,
  };
}

const DETAIL = detail([TABLE_VIEW]);

const ROWS: DatabaseRow[] = [
  { id: "row-1", properties: { titleKey: { type: "title", title: "First" } } },
  { id: "row-2", properties: { titleKey: { type: "title", title: "Second" } } },
];

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
  it("loads database detail, defaults activeViewId to the first view, and queries rows via POST .../query", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/db/databases/db-1") return Promise.resolve(jsonResponse(DETAIL));
      if (url === "/api/db/data-sources/ds-1/query" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ rows: ROWS }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDatabaseView("db-1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    expect(result.current.database?.title).toBe("My Database");
    expect(result.current.activeViewId).toBe("v1");
    expect(result.current.groups).toBeNull();
    expect(result.current.error).toBeNull();

    const queryCall = fetchMock.mock.calls.find(([url]) => url === "/api/db/data-sources/ds-1/query");
    expect(queryCall).toBeTruthy();
    const body = JSON.parse((queryCall![1] as RequestInit).body as string);
    expect(body).toEqual({ filter: null, sorts: [] });
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

  it("switching to a board view queries with group_by from its config and exposes `groups`, not `rows`", async () => {
    const boardDetail = detail([TABLE_VIEW, BOARD_VIEW]);
    const GROUPS: Group[] = [
      { key: "todo", label: "To do", row_count: 1, rows: [ROWS[0]], subgroups: null },
      { key: "done", label: "Done", row_count: 1, rows: [ROWS[1]], subgroups: null },
    ];

    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/db/databases/db-1") return Promise.resolve(jsonResponse(boardDetail));
      if (url === "/api/db/data-sources/ds-1/query" && init?.method === "POST") {
        const body = JSON.parse(init!.body as string);
        if (body.group_by) return Promise.resolve(jsonResponse({ groups: GROUPS }));
        return Promise.resolve(jsonResponse({ rows: ROWS }));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDatabaseView("db-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    act(() => result.current.setActiveViewId("v2"));

    await waitFor(() => expect(result.current.groups).not.toBeNull());
    expect(result.current.groups).toEqual(GROUPS);

    const queryCalls = fetchMock.mock.calls.filter(([url]) => url === "/api/db/data-sources/ds-1/query");
    const boardCall = queryCalls[queryCalls.length - 1];
    const body = JSON.parse((boardCall[1] as RequestInit).body as string);
    expect(body.group_by).toEqual({ property_key: "status" });
  });

  it("updateCell: applies optimistically, then reconciles with the server response", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/db/databases/db-1") return Promise.resolve(jsonResponse(DETAIL));
      if (url === "/api/db/data-sources/ds-1/query" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ rows: ROWS }));
      }
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
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

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
      if (url === "/api/db/data-sources/ds-1/query" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ rows: ROWS }));
      }
      if (url === "/api/db/data-sources/ds-1/rows/row-1" && init?.method === "PATCH") {
        return Promise.resolve(jsonResponse({ detail: "internal error" }, 500));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDatabaseView("db-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

    await act(async () => {
      await result.current.updateCell("row-1", "titleKey", { type: "title", title: "Edited" });
    });

    const row1 = result.current.rows.find((r) => r.id === "row-1");
    expect(row1?.properties.titleKey).toEqual({ type: "title", title: "First" });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("internal error", "error");
  });

  it("updateCell: rolls back and toasts on a 501 (All Notes write-not-implemented)", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/db/databases/db-1") return Promise.resolve(jsonResponse(DETAIL));
      if (url === "/api/db/data-sources/ds-1/query" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ rows: ROWS }));
      }
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
    await waitFor(() => expect(result.current.rows).toHaveLength(2));

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

  it("updateCell: on a grouped (board) view, re-queries so `groups` reflects the new column after a successful write", async () => {
    const boardDetail = detail([BOARD_VIEW]);
    const initialGroups: Group[] = [
      { key: "todo", label: "To do", row_count: 1, rows: [{ id: "row-1", properties: { titleKey: { type: "title", title: "First" }, status: { type: "status", status: "todo" } } }], subgroups: null },
      { key: "done", label: "Done", row_count: 0, rows: [], subgroups: null },
    ];
    const movedGroups: Group[] = [
      { key: "todo", label: "To do", row_count: 0, rows: [], subgroups: null },
      { key: "done", label: "Done", row_count: 1, rows: [{ id: "row-1", properties: { titleKey: { type: "title", title: "First" }, status: { type: "status", status: "done" } } }], subgroups: null },
    ];

    let queryCount = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/db/databases/db-1") return Promise.resolve(jsonResponse(boardDetail));
      if (url === "/api/db/data-sources/ds-1/query" && init?.method === "POST") {
        queryCount += 1;
        return Promise.resolve(jsonResponse({ groups: queryCount === 1 ? initialGroups : movedGroups }));
      }
      if (url === "/api/db/data-sources/ds-1/rows/row-1" && init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({ id: "row-1", properties: { titleKey: { type: "title", title: "First" }, status: { type: "status", status: "done" } } })
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDatabaseView("db-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.groups).toEqual(initialGroups));

    await act(async () => {
      await result.current.updateCell("row-1", "status", { type: "status", status: "done" });
    });

    await waitFor(() => expect(result.current.groups).toEqual(movedGroups));
  });

  it("updateCell: PATCH succeeds but the follow-up grouped refetch fails — doesn't roll back the write and doesn't show a false 'could not save' toast (task-17 fix round, finding 3)", async () => {
    const boardDetail = detail([BOARD_VIEW]);
    const initialGroups: Group[] = [
      {
        key: "todo",
        label: "To do",
        row_count: 1,
        rows: [
          {
            id: "row-1",
            properties: { titleKey: { type: "title", title: "First" }, status: { type: "status", status: "todo" } },
          },
        ],
        subgroups: null,
      },
      { key: "done", label: "Done", row_count: 0, rows: [], subgroups: null },
    ];

    let queryCount = 0;
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/db/databases/db-1") return Promise.resolve(jsonResponse(boardDetail));
      if (url === "/api/db/data-sources/ds-1/query" && init?.method === "POST") {
        queryCount += 1;
        // First query (initial load) succeeds; the second (updateCell's
        // post-write grouped refetch) simulates a transient network blip.
        if (queryCount === 1) return Promise.resolve(jsonResponse({ groups: initialGroups }));
        return Promise.reject(new Error("network blip"));
      }
      if (url === "/api/db/data-sources/ds-1/rows/row-1" && init?.method === "PATCH") {
        return Promise.resolve(
          jsonResponse({
            id: "row-1",
            properties: { titleKey: { type: "title", title: "First" }, status: { type: "status", status: "done" } },
          })
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDatabaseView("db-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.groups).toEqual(initialGroups));

    await act(async () => {
      await result.current.updateCell("row-1", "status", { type: "status", status: "done" });
    });

    // The PATCH succeeded — the property really did change server-side —
    // so the refetch failing afterward must not roll `groups` back to
    // something else or null it out.
    expect(result.current.groups).toEqual(initialGroups);

    // No false "could not save" toast: the write wasn't the thing that
    // failed. Exactly one toast fires, and it's the milder "out of date"
    // notice, distinguishable by variant from a real write failure.
    expect(showToast).toHaveBeenCalledTimes(1);
    const [message, variant] = showToast.mock.calls[0];
    expect(variant).toBe("info");
    expect(message).not.toMatch(/could not save/i);
    expect(message).toMatch(/saved.*out of date/i);
  });

  it("createView: POSTs to .../views and appends the created view to `views`", async () => {
    const created: ViewResponse = { ...BOARD_VIEW, id: "v3", name: "New view" };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/db/databases/db-1") return Promise.resolve(jsonResponse(DETAIL));
      if (url === "/api/db/data-sources/ds-1/query" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ rows: ROWS }));
      }
      if (url === "/api/db/data-sources/ds-1/views" && init?.method === "POST") {
        return Promise.resolve(jsonResponse(created, 201));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDatabaseView("db-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let returned: ViewResponse | undefined;
    await act(async () => {
      returned = await result.current.createView("New view", "board");
    });

    expect(returned).toEqual(created);
    expect(result.current.views.map((v) => v.id)).toEqual(["v1", "v3"]);

    const createCall = fetchMock.mock.calls.find(([url]) => url === "/api/db/data-sources/ds-1/views");
    expect(JSON.parse((createCall![1] as RequestInit).body as string)).toEqual({
      name: "New view",
      type: "board",
      icon: null,
    });
  });

  it("updateView: PATCHes .../views/{id} and updates the local view", async () => {
    const patched: ViewResponse = { ...TABLE_VIEW, config: { foo: "bar" } };
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === "/api/db/databases/db-1") return Promise.resolve(jsonResponse(DETAIL));
      if (url === "/api/db/data-sources/ds-1/query" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ rows: ROWS }));
      }
      if (url === "/api/db/views/v1" && init?.method === "PATCH") {
        return Promise.resolve(jsonResponse(patched));
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useDatabaseView("db-1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateView("v1", { config: { foo: "bar" } });
    });

    expect(result.current.views.find((v) => v.id === "v1")?.config).toEqual({ foo: "bar" });
  });
});
