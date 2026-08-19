import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Group, RelatedRow, RowTemplateResponse, ViewResponse } from "@/lib/database/types";

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
  aggregates: Record<string, number> | null;
  loading: boolean;
  error: string | null;
  updateCell: ReturnType<typeof vi.fn>;
  relationLinks: Record<string, RelatedRow[]>;
  ensureRelationLinks: ReturnType<typeof vi.fn>;
  setRelationLinks: ReturnType<typeof vi.fn>;
  createView: ReturnType<typeof vi.fn>;
  updateView: ReturnType<typeof vi.fn>;
  templates: RowTemplateResponse[];
  createTemplate: ReturnType<typeof vi.fn>;
  updateTemplate: ReturnType<typeof vi.fn>;
  deleteTemplate: ReturnType<typeof vi.fn>;
  instantiateTemplate: ReturnType<typeof vi.fn>;
  refetch: ReturnType<typeof vi.fn>;
  refetchRows: ReturnType<typeof vi.fn>;
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
  aggregates: null,
  loading: false,
  error: null,
  updateCell: vi.fn(),
  relationLinks: {},
  ensureRelationLinks: vi.fn(),
  setRelationLinks: vi.fn(),
  createView: vi.fn(),
  updateView: vi.fn(),
  templates: [],
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  instantiateTemplate: vi.fn(),
  refetch: vi.fn(),
  refetchRows: vi.fn(),
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
  mockHook.aggregates = null;
  // Reset in case a test (e.g. the "group by a Select property" test below)
  // appends to this array — `mockHook.properties` is otherwise a single
  // module-scoped object every test shares, so a mutation would otherwise
  // leak into every test declared after it.
  mockHook.properties = [
    { id: "p1", data_source_id: "ds-1", user_id: "user-1", key: "title", name: "Title", type: "title", config: {}, description: null, storage: "jsonb", column_name: null, result_type: null, is_volatile: false, position: 0, created_at: "2026-01-01T00:00:00Z" },
    { id: "p2", data_source_id: "ds-1", user_id: "user-1", key: "status", name: "Status", type: "status", config: {}, description: null, storage: "jsonb", column_name: null, result_type: null, is_volatile: false, position: 1, created_at: "2026-01-01T00:00:00Z" },
  ];
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
      // "__unsupported_test_type__" rather than "calendar" — Task 33 gives
      // calendar a real branch below (and gallery/list/feed already have
      // theirs from Task 17), so this test's own unrecognized-type example
      // has to be a string that actually stays unimplemented, not a stale
      // stand-in for a type that's since shipped.
      { id: "v3", data_source_id: "ds-1", user_id: "user-1", name: "Unsupported", icon: null, type: "__unsupported_test_type__", config: {}, filter: null, sorts: [], is_locked: false, position: 0 },
    ];
    mockHook.activeViewId = "v3";
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.getByText(/this view type isn.t supported yet/i)).toBeInTheDocument();
  });

  it("renders CalendarView for a calendar-typed active view", () => {
    mockHook.views = [
      { id: "v7", data_source_id: "ds-1", user_id: "user-1", name: "Calendar", icon: null, type: "calendar", config: { date_property_id: "due" }, filter: null, sorts: [], is_locked: false, position: 0 },
    ];
    mockHook.activeViewId = "v7";
    mockHook.properties = [
      ...mockHook.properties,
      { id: "p4", data_source_id: "ds-1", user_id: "user-1", key: "due", name: "Due", type: "date", config: {}, description: null, storage: "jsonb", column_name: null, result_type: null, is_volatile: false, position: 2, created_at: "2026-01-01T00:00:00Z" },
    ];
    render(<DatabaseShell databaseId="db-1" />);
    // The Calendar view's own toolbar (view-range select) is a stable
    // render signal that doesn't depend on the visible month/week's actual
    // day contents (which vary with the real current date).
    expect(screen.getByLabelText("View range")).toBeInTheDocument();
  });

  it("renders TimelineView for a timeline-typed active view", () => {
    mockHook.views = [
      { id: "v8", data_source_id: "ds-1", user_id: "user-1", name: "Timeline", icon: null, type: "timeline", config: { date_property_id: "due" }, filter: null, sorts: [], is_locked: false, position: 0 },
    ];
    mockHook.activeViewId = "v8";
    mockHook.properties = [
      ...mockHook.properties,
      { id: "p4", data_source_id: "ds-1", user_id: "user-1", key: "due", name: "Due", type: "date", config: {}, description: null, storage: "jsonb", column_name: null, result_type: null, is_volatile: false, position: 2, created_at: "2026-01-01T00:00:00Z" },
    ];
    render(<DatabaseShell databaseId="db-1" />);
    // The Timeline view's own toolbar (zoom-level select) is a stable
    // render signal that doesn't depend on the plotted rows' actual dates.
    expect(screen.getByLabelText("Zoom level")).toBeInTheDocument();
  });

  it("renders ChartView for a chart-typed active view", () => {
    mockHook.views = [
      {
        id: "v9",
        data_source_id: "ds-1",
        user_id: "user-1",
        name: "Chart",
        icon: null,
        type: "chart",
        config: { chart_type: "column", x_axis: { property_id: "status" }, y_axis: { aggregator: "count" } },
        filter: null,
        sorts: [],
        is_locked: false,
        position: 0,
      },
    ];
    mockHook.activeViewId = "v9";
    mockHook.groups = [
      { key: "todo", label: "To do", row_count: 1, rows: [], subgroups: null, aggregates: { y: 1 } },
    ];
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.getByTestId("chart-view")).toBeInTheDocument();
  });

  it("forces editable={false} for ChartView regardless of the caller's own editable (dataSource) state — the one place this view type diverges from every other view's read/write gating", () => {
    // is_virtual=false would make every OTHER view editable=true.
    mockHook.dataSource = { ...(mockHook.dataSource as Record<string, unknown>), is_virtual: false };
    mockHook.views = [
      {
        id: "v9",
        data_source_id: "ds-1",
        user_id: "user-1",
        name: "Chart",
        icon: null,
        type: "chart",
        config: { chart_type: "column", x_axis: { property_id: "status" }, y_axis: { aggregator: "count" } },
        filter: null,
        sorts: [],
        is_locked: false,
        position: 0,
      },
    ];
    mockHook.activeViewId = "v9";
    mockHook.groups = [
      { key: "todo", label: "To do", row_count: 1, rows: [], subgroups: null, aggregates: { y: 1 } },
    ];
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.getByTestId("chart-view")).toHaveAttribute("data-editable", "false");
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

  it("renders FormView (not some other component, not a blank fallback) for a form-typed active view", () => {
    mockHook.views = [
      {
        id: "v11",
        data_source_id: "ds-1",
        user_id: "user-1",
        name: "Form",
        icon: null,
        type: "form",
        config: { questions: [{ property_key: "title", required: false }] },
        filter: null,
        sorts: [],
        is_locked: false,
        position: 0,
      },
    ];
    mockHook.activeViewId = "v11";
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.getByTestId("form-view")).toBeInTheDocument();
    // The seeded question renders by its property name, proof `properties`
    // reached FormView and config.questions was read correctly — not just
    // that some placeholder rendered.
    expect(screen.getByText("Title")).toBeInTheDocument();
  });

  it("Form view's onConfigChange PATCHes through updateView with the rest of activeView.config preserved, same as every other config-driven view", async () => {
    const user = userEvent.setup();
    mockHook.views = [
      {
        id: "v11",
        data_source_id: "ds-1",
        user_id: "user-1",
        name: "Form",
        icon: null,
        type: "form",
        config: { submit_screen: { button_text: "Go", button_color: "#000000", confirmation_title: "Thanks!", confirmation_body: "" } },
        filter: null,
        sorts: [],
        is_locked: false,
        position: 0,
      },
    ];
    mockHook.activeViewId = "v11";
    render(<DatabaseShell databaseId="db-1" />);

    await user.click(screen.getByLabelText("Closed for submissions"));

    expect(mockHook.updateView).toHaveBeenCalledWith("v11", {
      config: {
        submit_screen: { button_text: "Go", button_color: "#000000", confirmation_title: "Thanks!", confirmation_body: "" },
        is_form_closed: true,
        submission_permissions: "none",
      },
    });
  });

  it("renders DashboardView (not some other component, not a blank fallback) for a dashboard-typed active view", () => {
    // Empty config.rows -- no widgets to mount, so no per-widget fetch is
    // needed for this render-dispatch check (DashboardView.test.tsx owns
    // the widget-content/fetch-driven behaviour).
    mockHook.views = [
      { id: "v12", data_source_id: "ds-1", user_id: "user-1", name: "Dashboard", icon: null, type: "dashboard", config: {}, filter: null, sorts: [], is_locked: false, position: 0 },
    ];
    mockHook.activeViewId = "v12";
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.getByTestId("dashboard-view")).toBeInTheDocument();
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

  it("creating a Board view grouped by a Status property: creates it, sets group_by with mode='option', then switches to it", async () => {
    // Regression, live-verified: services.db.query.grouping.GroupBySpec has no
    // implicit default `mode` for `status` (Milestone 4's own "fail loud, don't
    // guess" decision) — omitting it isn't a no-op, it's a real 400 from
    // POST .../query the moment this view is opened. Confirmed by actually
    // creating a Board grouped by Status in the running app and watching it get
    // stuck on "Loading…" forever (a 400 with no error surfaced). This test
    // previously asserted the buggy shape (`{ property_key: "status" }`, no
    // `mode`) and passed, which is exactly how it shipped uncaught.
    const user = userEvent.setup();
    const createdView = { id: "v9", data_source_id: "ds-1", user_id: "user-1", name: "New view", icon: null, type: "board", config: {}, filter: null, sorts: [], is_locked: false, position: 1 };
    mockHook.createView.mockResolvedValue(createdView);
    mockHook.updateView.mockResolvedValue({
      ...createdView,
      config: { group_by: { property_key: "status", mode: "option" } },
    });

    render(<DatabaseShell databaseId="db-1" />);

    await user.click(screen.getByText("+ New view"));
    await user.selectOptions(screen.getByLabelText(/view type/i), "board");
    await user.selectOptions(screen.getByLabelText(/group by/i), "status");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(mockHook.createView).toHaveBeenCalledWith("New view", "board");
    expect(mockHook.updateView).toHaveBeenCalledWith("v9", {
      config: { group_by: { property_key: "status", mode: "option" } },
    });
    expect(mockHook.setActiveViewId).toHaveBeenCalledWith("v9");
  });

  it("creating a Board view grouped by a Select property: no mode needed, group_by stays bare", async () => {
    mockHook.properties = [
      ...mockHook.properties,
      { id: "p3", data_source_id: "ds-1", user_id: "user-1", key: "priority", name: "Priority", type: "select", config: {}, description: null, storage: "jsonb", column_name: null, result_type: null, is_volatile: false, position: 2, created_at: "2026-01-01T00:00:00Z" },
    ];
    const user = userEvent.setup();
    const createdView = { id: "v10", data_source_id: "ds-1", user_id: "user-1", name: "New view", icon: null, type: "board", config: {}, filter: null, sorts: [], is_locked: false, position: 1 };
    mockHook.createView.mockResolvedValue(createdView);
    mockHook.updateView.mockResolvedValue({ ...createdView, config: { group_by: { property_key: "priority" } } });

    render(<DatabaseShell databaseId="db-1" />);

    await user.click(screen.getByText("+ New view"));
    await user.selectOptions(screen.getByLabelText(/view type/i), "board");
    await user.selectOptions(screen.getByLabelText(/group by/i), "priority");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    expect(mockHook.updateView).toHaveBeenCalledWith("v10", {
      config: { group_by: { property_key: "priority" } },
    });
  });

  it("threads dataSource.id and refetchRows down to TableView's Add row control (task-18)", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "row-2", properties: {} }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<DatabaseShell databaseId="db-1" />);
    await user.click(screen.getByRole("button", { name: "+ New" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/db/data-sources/ds-1/rows",
      expect.objectContaining({ method: "POST" })
    );
    // Regression: adding a row must refetch *rows*, not just database
    // metadata — `refetch` (=`load`) never re-runs the rows query, so
    // asserting it alone is a false-positive that let a real live-verified
    // bug ship (the new row never appeared, "No rows yet." stuck forever).
    await vi.waitFor(() => expect(mockHook.refetchRows).toHaveBeenCalled());
    expect(mockHook.refetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it("renders the database settings menu button for an editable (ordinary) database", () => {
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.getByRole("button", { name: "Database settings" })).toBeInTheDocument();
  });

  it("hides the database settings menu entirely for the read-only All Notes source (not merely disabled)", () => {
    mockHook.dataSource = { ...(mockHook.dataSource as Record<string, unknown>), is_virtual: true };
    render(<DatabaseShell databaseId="db-1" />);
    expect(screen.queryByRole("button", { name: "Database settings" })).not.toBeInTheDocument();
    mockHook.dataSource = { ...(mockHook.dataSource as Record<string, unknown>), is_virtual: false };
  });

  it("threads relationLinks/ensureRelationLinks/setRelationLinks and the active view's subtasks display mode down to TableView", async () => {
    mockHook.views = [
      {
        id: "v1",
        data_source_id: "ds-1",
        user_id: "user-1",
        name: "Table view",
        icon: null,
        type: "table",
        config: { subtasks: { display_mode: "flattened" } },
        filter: null,
        sorts: [],
        is_locked: false,
        position: 0,
      },
    ];
    mockHook.properties = [
      ...mockHook.properties,
      {
        id: "p-sub",
        data_source_id: "ds-1",
        user_id: "user-1",
        key: "subitem",
        name: "Sub-item",
        type: "relation",
        config: { relation_id: "rel-1", side: "forward", system: "sub_item", target_data_source_id: "ds-1" },
        description: null,
        storage: "jsonb",
        column_name: null,
        result_type: null,
        is_volatile: false,
        position: 2,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    mockHook.relationLinks = { "row-1:subitem": [] };

    render(<DatabaseShell databaseId="db-1" />);

    // A relation column renders via RelationCell, which calls
    // ensureRelationLinks on mount — proof the prop actually reached
    // TableView rather than being silently dropped along the way.
    expect(mockHook.ensureRelationLinks).toHaveBeenCalledWith("row-1", "subitem");
  });
});
