import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Group, ViewResponse } from "@/lib/database/types";

// ListView (task-17) navigates via next/navigation's useRouter — outside a
// real Next.js app router tree (as here, a plain RTL render) that throws
// "invariant expected app router to be mounted" unless mocked, same as
// ListView.test.tsx does on its own.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

const mockHook: {
  database: unknown;
  dataSource: unknown;
  properties: unknown[];
  views: ViewResponse[];
  activeViewId: string;
  setActiveViewId: ReturnType<typeof vi.fn>;
  rows: unknown[];
  groups: Group[] | null;
  loading: boolean;
  error: string | null;
  updateCell: ReturnType<typeof vi.fn>;
  createView: ReturnType<typeof vi.fn>;
  updateView: ReturnType<typeof vi.fn>;
  refetch: ReturnType<typeof vi.fn>;
} = {
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
  dataSource: {
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
    { id: "p1", data_source_id: "ds-1", user_id: "user-1", key: "title", name: "Title", type: "title", config: {}, description: null, storage: "jsonb", column_name: null, result_type: null, is_volatile: false, position: 0, created_at: "2026-01-01T00:00:00Z" },
    { id: "p2", data_source_id: "ds-1", user_id: "user-1", key: "status", name: "Status", type: "status", config: {}, description: null, storage: "jsonb", column_name: null, result_type: null, is_volatile: false, position: 1, created_at: "2026-01-01T00:00:00Z" },
  ],
  views: [
    { id: "v1", data_source_id: "ds-1", user_id: "user-1", name: "Table view", icon: null, type: "table", config: {}, filter: null, sorts: [], is_locked: false, position: 0 },
  ],
  activeViewId: "v1",
  setActiveViewId: vi.fn(),
  rows: [{ id: "row-1", properties: { title: { type: "title", title: "First" } } }],
  groups: null,
  loading: false,
  error: null,
  updateCell: vi.fn(),
  createView: vi.fn(),
  updateView: vi.fn(),
  refetch: vi.fn(),
};

vi.mock("@/lib/database/useDatabaseView", () => ({
  useDatabaseView: () => mockHook,
}));

import { DatabaseShell } from "./DatabaseShell";

beforeEach(() => {
  mockHook.activeViewId = "v1";
  mockHook.views = [
    { id: "v1", data_source_id: "ds-1", user_id: "user-1", name: "Table view", icon: null, type: "table", config: {}, filter: null, sorts: [], is_locked: false, position: 0 },
  ];
  mockHook.groups = null;
  vi.clearAllMocks();
});

describe("DatabaseShell", () => {
  it("renders TableView for a table-typed active view", () => {
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.getByText("First")).toBeInTheDocument();
  });

  it("renders BoardView for a board-typed active view", () => {
    mockHook.views = [
      { id: "v2", data_source_id: "ds-1", user_id: "user-1", name: "Board", icon: null, type: "board", config: { group_by: { property_key: "status" } }, filter: null, sorts: [], is_locked: false, position: 0 },
    ];
    mockHook.activeViewId = "v2";
    mockHook.groups = [
      { key: "todo", label: "To do", row_count: 1, rows: [{ id: "row-1", properties: { title: { type: "title", title: "First" } } }], subgroups: null },
    ];
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.getByText("To do")).toBeInTheDocument();
  });

  it("renders a plain placeholder — not a crash — for an unrecognized view type", () => {
    mockHook.views = [
      // "calendar" (not yet built by any milestone) rather than "gallery" —
      // Task 17 gives gallery/list/feed real branches below, so this test's
      // own unrecognized-type example has to be one of the ones that
      // actually stays unimplemented.
      { id: "v3", data_source_id: "ds-1", user_id: "user-1", name: "Calendar", icon: null, type: "calendar", config: {}, filter: null, sorts: [], is_locked: false, position: 0 },
    ];
    mockHook.activeViewId = "v3";
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.getByText(/this view type isn.t supported yet/i)).toBeInTheDocument();
  });

  it("renders GalleryView for a gallery-typed active view", () => {
    mockHook.views = [
      { id: "v4", data_source_id: "ds-1", user_id: "user-1", name: "Gallery", icon: null, type: "gallery", config: {}, filter: null, sorts: [], is_locked: false, position: 0 },
    ];
    mockHook.activeViewId = "v4";
    mockHook.rows = [{ id: "row-1", properties: { title: { type: "title", title: "Gallery row" } } }];
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.getByText("Gallery row")).toBeInTheDocument();
    expect(screen.getByLabelText("Cover size")).toBeInTheDocument();
  });

  it("renders ListView for a list-typed active view", () => {
    mockHook.views = [
      { id: "v5", data_source_id: "ds-1", user_id: "user-1", name: "List", icon: null, type: "list", config: {}, filter: null, sorts: [], is_locked: false, position: 0 },
    ];
    mockHook.activeViewId = "v5";
    mockHook.rows = [{ id: "row-1", properties: { title: { type: "title", title: "List row" } } }];
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.getByText("List row")).toBeInTheDocument();
  });

  it("renders FeedView for a feed-typed active view", () => {
    mockHook.views = [
      { id: "v6", data_source_id: "ds-1", user_id: "user-1", name: "Feed", icon: null, type: "feed", config: {}, filter: null, sorts: [], is_locked: false, position: 0 },
    ];
    mockHook.activeViewId = "v6";
    mockHook.rows = [{ id: "row-1", properties: { title: { type: "title", title: "Feed row" } } }];
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.getByText("Feed row")).toBeInTheDocument();
  });

  it("clicking a different view tab calls setActiveViewId", async () => {
    mockHook.views = [
      { id: "v1", data_source_id: "ds-1", user_id: "user-1", name: "Table view", icon: null, type: "table", config: {}, filter: null, sorts: [], is_locked: false, position: 0 },
      { id: "v2", data_source_id: "ds-1", user_id: "user-1", name: "Board", icon: null, type: "board", config: {}, filter: null, sorts: [], is_locked: false, position: 1 },
    ];
    const user = userEvent.setup();
    render(<DatabaseShell databaseId="db-1" />);
    await user.click(screen.getByText("Board"));
    expect(mockHook.setActiveViewId).toHaveBeenCalledWith("v2");
  });

  it("creating a Board view via the '+ New view' form: creates it, sets group_by config, then switches to it", async () => {
    const user = userEvent.setup();
    const createdView = { id: "v9", data_source_id: "ds-1", user_id: "user-1", name: "New view", icon: null, type: "board", config: {}, filter: null, sorts: [], is_locked: false, position: 1 };
    mockHook.createView.mockResolvedValue(createdView);
    mockHook.updateView.mockResolvedValue({ ...createdView, config: { group_by: { property_key: "status" } } });

    render(<DatabaseShell databaseId="db-1" />);

    await user.click(screen.getByText("+ New view"));
    await user.selectOptions(screen.getByLabelText(/view type/i), "board");
    await user.selectOptions(screen.getByLabelText(/group by/i), "status");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(mockHook.createView).toHaveBeenCalledWith("New view", "board");
    expect(mockHook.updateView).toHaveBeenCalledWith("v9", { config: { group_by: { property_key: "status" } } });
    expect(mockHook.setActiveViewId).toHaveBeenCalledWith("v9");
  });
});
