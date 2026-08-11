import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TableView } from "./TableView";
import { KNOWN_PROPERTY_TYPES } from "@/lib/database/types";
import type { DatabaseRow, PropertyResponse } from "@/lib/database/types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

const PROPERTIES: PropertyResponse[] = [
  prop({ key: "title", name: "Title", type: "title", position: 0 }),
  prop({ key: "notes", name: "Notes", type: "rich_text", position: 1 }),
  prop({ key: "count", name: "Count", type: "number", position: 2 }),
  prop({ key: "kind", name: "Kind", type: "select", position: 3 }),
  prop({ key: "topics", name: "Topics", type: "multi_select", position: 4 }),
  prop({ key: "mastery", name: "Mastery", type: "status", position: 5 }),
  prop({ key: "due", name: "Due", type: "date", position: 6 }),
  prop({ key: "done", name: "Done", type: "checkbox", position: 7 }),
  prop({ key: "url", name: "URL", type: "url", position: 8 }), // no dedicated cell -> GenericCell fallback
];

const ROWS: DatabaseRow[] = [
  {
    id: "row-1",
    properties: {
      title: { type: "title", title: "First Note" },
      notes: { type: "rich_text", rich_text: "some text" },
      count: { type: "number", number: 3 },
      kind: { type: "select", select: "article" },
      topics: { type: "multi_select", multi_select: ["rust", "async"] },
      mastery: { type: "status", status: "learning" },
      due: { type: "date", date: { start: "2026-08-08", end: null, time_zone: null } },
      done: { type: "checkbox", checkbox: true },
      url: { type: "url", url: "https://example.com" },
    },
  },
];

describe("TableView", () => {
  it("renders all 8 known property types plus a generic fallback, read-only, with no editable inputs when editable=false", () => {
    render(<TableView properties={PROPERTIES} rows={ROWS} editable={false} onCellChange={vi.fn()} />);

    expect(screen.getByText("First Note")).toBeInTheDocument();
    expect(screen.getByText("some text")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("article")).toBeInTheDocument();
    expect(screen.getByText("rust")).toBeInTheDocument();
    expect(screen.getByText("async")).toBeInTheDocument();
    expect(screen.getByText("learning")).toBeInTheDocument();
    expect(screen.getByText("https://example.com")).toBeInTheDocument();
    // Checkbox renders but is disabled (visible, not interactive).
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox).toBeDisabled();
    expect(checkbox.checked).toBe(true);
    // No text/number inputs anywhere — nothing is click-to-edit.
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  });

  it("renders column headers from properties[] in position order", () => {
    render(<TableView properties={PROPERTIES} rows={ROWS} editable={false} onCellChange={vi.fn()} />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(headers).toEqual(["Title", "Notes", "Count", "Kind", "Topics", "Mastery", "Due", "Done", "URL"]);
  });

  it("shows an empty state when there are no rows", () => {
    render(<TableView properties={PROPERTIES} rows={[]} editable={false} onCellChange={vi.fn()} />);
    expect(screen.getByText(/no rows yet/i)).toBeInTheDocument();
  });

  it("is editable when editable=true: editing the Title cell calls onCellChange with the row id, property key, and new value", async () => {
    const user = userEvent.setup();
    const onCellChange = vi.fn();
    render(<TableView properties={PROPERTIES} rows={ROWS} editable={true} onCellChange={onCellChange} />);

    await user.click(screen.getByText("First Note"));
    const input = screen.getByRole("textbox");
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");

    expect(onCellChange).toHaveBeenCalledWith("row-1", "title", { type: "title", title: "Renamed" });
  });

  it("checkbox cell is interactive and calls onCellChange when editable", async () => {
    const user = userEvent.setup();
    const onCellChange = vi.fn();
    render(<TableView properties={PROPERTIES} rows={ROWS} editable={true} onCellChange={onCellChange} />);

    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).not.toBeDisabled();
    await user.click(checkbox);

    expect(onCellChange).toHaveBeenCalledWith("row-1", "done", { type: "checkbox", checkbox: false });
  });

  describe("empty-state gap fix", () => {
    it("still renders column headers (not just a bare message) when there are no rows", () => {
      render(
        <TableView properties={PROPERTIES} rows={[]} editable={false} onCellChange={vi.fn()} />
      );
      expect(screen.getByText(/no rows yet/i)).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Title" })).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Notes" })).toBeInTheDocument();
    });

    it("shows both add-controls alongside the empty-state message when editable", () => {
      render(
        <TableView
          properties={PROPERTIES}
          rows={[]}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          refetch={vi.fn()}
        />
      );
      expect(screen.getByText(/no rows yet/i)).toBeInTheDocument();
      expect(screen.getByRole("columnheader", { name: "Title" })).toBeInTheDocument();
      expect(screen.getByLabelText(/add property/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ New" })).toBeInTheDocument();
    });
  });

  describe("Add property", () => {
    it("is hidden when editable=false", () => {
      render(<TableView properties={PROPERTIES} rows={ROWS} editable={false} onCellChange={vi.fn()} />);
      expect(screen.queryByLabelText(/add property/i)).not.toBeInTheDocument();
    });

    it("is shown when editable=true", () => {
      render(
        <TableView
          properties={PROPERTIES}
          rows={ROWS}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          refetch={vi.fn()}
        />
      );
      expect(screen.getByLabelText(/add property/i)).toBeInTheDocument();
    });

    it("offers exactly the 7 non-title KNOWN_PROPERTY_TYPES in its type picker", async () => {
      const user = userEvent.setup();
      render(
        <TableView
          properties={PROPERTIES}
          rows={ROWS}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          refetch={vi.fn()}
        />
      );
      await user.click(screen.getByLabelText(/add property/i));
      const select = screen.getByLabelText(/property type/i) as HTMLSelectElement;
      const values = Array.from(select.options).map((o) => o.value);
      expect(values).toEqual(KNOWN_PROPERTY_TYPES.filter((t) => t !== "title"));
      expect(values).not.toContain("title");
      expect(values).toHaveLength(7);
    });

    it("submitting POSTs {name, type} to the properties endpoint, then refetches", async () => {
      const user = userEvent.setup();
      const refetch = vi.fn().mockResolvedValue(undefined);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "prop-2" }, 201));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <TableView
          properties={PROPERTIES}
          rows={ROWS}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          refetch={refetch}
        />
      );

      await user.click(screen.getByLabelText(/add property/i));
      await user.type(screen.getByLabelText(/property name/i), "Priority");
      await user.selectOptions(screen.getByLabelText(/property type/i), "select");
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      await waitFor(() => expect(refetch).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/db/data-sources/ds-1/properties",
        expect.objectContaining({ method: "POST" })
      );
      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body as string)).toEqual({ name: "Priority", type: "select" });
    });
  });

  describe("Add row", () => {
    it("is visible whenever editable=true, including the empty-rows case", () => {
      render(
        <TableView
          properties={PROPERTIES}
          rows={[]}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          refetch={vi.fn()}
        />
      );
      expect(screen.getByRole("button", { name: "+ New" })).toBeInTheDocument();
    });

    it("is hidden when editable=false", () => {
      render(<TableView properties={PROPERTIES} rows={ROWS} editable={false} onCellChange={vi.fn()} />);
      expect(screen.queryByRole("button", { name: "+ New" })).not.toBeInTheDocument();
    });

    it("clicking it POSTs to the rows endpoint with no body, then refetches", async () => {
      const user = userEvent.setup();
      const refetch = vi.fn().mockResolvedValue(undefined);
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "row-2", properties: {} }, 201));
      vi.stubGlobal("fetch", fetchMock);

      render(
        <TableView
          properties={PROPERTIES}
          rows={ROWS}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          refetch={refetch}
        />
      );

      await user.click(screen.getByRole("button", { name: "+ New" }));

      await waitFor(() => expect(refetch).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/db/data-sources/ds-1/rows",
        expect.objectContaining({ method: "POST" })
      );
      const [, init] = fetchMock.mock.calls[0];
      expect(init).not.toHaveProperty("body");
    });
  });
});
