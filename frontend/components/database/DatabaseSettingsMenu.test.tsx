import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const showToast = vi.fn();
vi.mock("@/app/providers", () => ({
  useToast: () => ({ showToast }),
}));

import { DatabaseSettingsMenu } from "./DatabaseSettingsMenu";
import type { PropertyResponse, ViewResponse } from "@/lib/database/types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function prop(overrides: Partial<PropertyResponse>): PropertyResponse {
  return {
    id: overrides.key ?? "id",
    data_source_id: "ds-1",
    user_id: "user-1",
    key: "key",
    name: "Name",
    type: "rich_text",
    config: {},
    description: null,
    storage: "jsonb",
    column_name: null,
    result_type: null,
    is_volatile: false,
    position: 0,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const TITLE_PROP = prop({ key: "title", name: "Title", type: "title", position: 0 });
const DUE_DATE_PROP = prop({ key: "due", name: "Due date", type: "date", position: 1 });

const VIEW: ViewResponse = {
  id: "v1",
  data_source_id: "ds-1",
  user_id: "user-1",
  name: "Table view",
  icon: null,
  type: "table",
  config: {},
  filter: null,
  sorts: [],
  is_locked: false,
  position: 0,
};

afterEach(() => {
  vi.unstubAllGlobals();
  showToast.mockClear();
});

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Database settings" }));
}

describe("DatabaseSettingsMenu", () => {
  it("Sub-items: shows a 'Turn on' button when not yet enabled, POSTs to the sub-items endpoint", async () => {
    const user = userEvent.setup();
    const onPropertiesChanged = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ forward: {}, reverse: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DatabaseSettingsMenu
        dataSourceId="ds-1"
        properties={[TITLE_PROP]}
        activeView={VIEW}
        onPropertiesChanged={onPropertiesChanged}
        onUpdateView={vi.fn()}
      />
    );
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Turn on sub-items" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/db/data-sources/ds-1/sub-items", { method: "POST" });
    await waitFor(() => expect(onPropertiesChanged).toHaveBeenCalled());
  });

  it("Sub-items: once enabled, offers the display-mode picker and PATCHes the view's config on change", async () => {
    const user = userEvent.setup();
    const onUpdateView = vi.fn().mockResolvedValue(VIEW);
    const subItemForward = prop({
      key: "subitem",
      name: "Sub-item",
      type: "relation",
      config: { relation_id: "rel-1", side: "forward", system: "sub_item", target_data_source_id: "ds-1" },
    });

    render(
      <DatabaseSettingsMenu
        dataSourceId="ds-1"
        properties={[TITLE_PROP, subItemForward]}
        activeView={VIEW}
        onPropertiesChanged={vi.fn()}
        onUpdateView={onUpdateView}
      />
    );
    await openMenu(user);
    expect(screen.queryByRole("button", { name: "Turn on sub-items" })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Sub-item display mode"), "flattened");

    expect(onUpdateView).toHaveBeenCalledWith("v1", { config: { subtasks: { display_mode: "flattened" } } });
  });

  it("Dependencies: shows a 'Turn on' button when not yet enabled, POSTs to the dependencies endpoint", async () => {
    const user = userEvent.setup();
    const onPropertiesChanged = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ forward: {}, reverse: {} }, 201));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DatabaseSettingsMenu
        dataSourceId="ds-1"
        properties={[TITLE_PROP]}
        activeView={VIEW}
        onPropertiesChanged={onPropertiesChanged}
        onUpdateView={vi.fn()}
      />
    );
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "Turn on dependencies" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/db/data-sources/ds-1/dependencies", { method: "POST" });
    await waitFor(() => expect(onPropertiesChanged).toHaveBeenCalled());
  });

  describe("Dependencies, once enabled", () => {
    const dependencyForward = prop({
      key: "blocking",
      name: "Blocking",
      type: "relation",
      config: { relation_id: "rel-2", side: "forward", system: "dependency", target_data_source_id: "ds-1" },
    });

    it("shows all three date-shift-mode strings verbatim (task-22-brief.md §4's exact Notion names)", async () => {
      const user = userEvent.setup();
      render(
        <DatabaseSettingsMenu
          dataSourceId="ds-1"
          properties={[TITLE_PROP, DUE_DATE_PROP, dependencyForward]}
          activeView={VIEW}
          onPropertiesChanged={vi.fn()}
          onUpdateView={vi.fn()}
        />
      );
      await openMenu(user);

      expect(screen.getByText("Shift only when dates overlap")).toBeInTheDocument();
      expect(screen.getByText("Shift & maintain time between items")).toBeInTheDocument();
      expect(screen.getByText("Do not automatically shift")).toBeInTheDocument();
      expect(screen.getByLabelText("Avoid weekends")).toBeInTheDocument();
    });

    it("selecting a date-shift mode PATCHes .../dependency-settings with the exact string", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "p", config: {} }));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <DatabaseSettingsMenu
          dataSourceId="ds-1"
          properties={[TITLE_PROP, DUE_DATE_PROP, dependencyForward]}
          activeView={VIEW}
          onPropertiesChanged={vi.fn()}
          onUpdateView={vi.fn()}
        />
      );
      await openMenu(user);
      await user.click(screen.getByLabelText("Shift & maintain time between items"));

      expect(fetchMock).toHaveBeenCalledWith(
        "/api/db/relations/rel-2/dependency-settings",
        expect.objectContaining({ method: "PATCH" })
      );
      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body as string)).toEqual({
        date_shift_mode: "Shift & maintain time between items",
      });
    });

    it("toggling 'Avoid weekends' PATCHes avoid_weekends", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "p", config: {} }));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <DatabaseSettingsMenu
          dataSourceId="ds-1"
          properties={[TITLE_PROP, DUE_DATE_PROP, dependencyForward]}
          activeView={VIEW}
          onPropertiesChanged={vi.fn()}
          onUpdateView={vi.fn()}
        />
      );
      await openMenu(user);
      await user.click(screen.getByLabelText("Avoid weekends"));

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body as string)).toEqual({ avoid_weekends: true });
    });

    it("picking a date property PATCHes date_property_key", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "p", config: {} }));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <DatabaseSettingsMenu
          dataSourceId="ds-1"
          properties={[TITLE_PROP, DUE_DATE_PROP, dependencyForward]}
          activeView={VIEW}
          onPropertiesChanged={vi.fn()}
          onUpdateView={vi.fn()}
        />
      );
      await openMenu(user);
      await user.selectOptions(screen.getByLabelText("Dependency date property"), "due");

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body as string)).toEqual({ date_property_key: "due" });
    });

    it("shows a one-line hint that dependency arrows are timeline-only and not available yet", async () => {
      const user = userEvent.setup();
      render(
        <DatabaseSettingsMenu
          dataSourceId="ds-1"
          properties={[TITLE_PROP, DUE_DATE_PROP, dependencyForward]}
          activeView={VIEW}
          onPropertiesChanged={vi.fn()}
          onUpdateView={vi.fn()}
        />
      );
      await openMenu(user);
      expect(screen.getByText(/timeline view, which isn.t available yet/i)).toBeInTheDocument();
    });
  });
});
