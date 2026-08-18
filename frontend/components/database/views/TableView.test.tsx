import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TableView } from "./TableView";
import { KNOWN_PROPERTY_TYPES, ROLLUP_FUNCTIONS } from "@/lib/database/types";
import type { DatabaseRow, PropertyResponse, RelatedRow, RowTemplateResponse } from "@/lib/database/types";

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

    it("offers the 7 non-title KNOWN_PROPERTY_TYPES plus relation/formula/rollup in its type picker (task-31)", async () => {
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
      expect(values).toEqual([
        ...KNOWN_PROPERTY_TYPES.filter((t) => t !== "title"),
        "relation",
        "formula",
        "rollup",
      ]);
      expect(values).not.toContain("title");
      expect(values).toHaveLength(10);
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

  describe("Add relation property (task-31 Part 1)", () => {
    const DATABASES_RESPONSE = {
      databases: [
        {
          database: { id: "db-1", title: "This Database" },
          data_source: { id: "ds-1" },
        },
        {
          database: { id: "db-2", title: "Other Database" },
          data_source: { id: "ds-2" },
        },
      ],
    };

    it("fetches GET /api/db/databases and offers every database (including this one, for self-relations) once Relation is picked", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DATABASES_RESPONSE));
      vi.stubGlobal("fetch", fetchMock);

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
      await user.selectOptions(screen.getByLabelText(/property type/i), "relation");

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/db/databases"));
      await screen.findByRole("option", { name: /other database/i });
      const targetSelect = screen.getByLabelText(/target database/i);
      const optionLabels = Array.from((targetSelect as HTMLSelectElement).options).map((o) => o.textContent);
      // Self-relation (target == the current data source, ds-1) must be
      // offerable, not filtered out (task-31-brief.md §"Self-relations").
      expect(optionLabels.some((l) => l?.includes("This Database") && l?.includes("this database"))).toBe(true);
      expect(optionLabels.some((l) => l?.includes("Other Database"))).toBe(true);
    });

    it("two-way defaults on and shows a reverse-name field; unchecking it hides the field", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(DATABASES_RESPONSE)));

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
      await user.selectOptions(screen.getByLabelText(/property type/i), "relation");
      await screen.findByRole("option", { name: /other database/i });

      const twoWayCheckbox = screen.getByLabelText(/two-way/i) as HTMLInputElement;
      expect(twoWayCheckbox.checked).toBe(true);
      expect(screen.getByLabelText(/reverse property name/i)).toBeInTheDocument();

      await user.click(twoWayCheckbox);
      expect(screen.queryByLabelText(/reverse property name/i)).not.toBeInTheDocument();
    });

    it("submitting a two-way relation POSTs {name, target_data_source_id, two_way, reverse_name} to the relations endpoint, then refetches", async () => {
      const user = userEvent.setup();
      const refetch = vi.fn().mockResolvedValue(undefined);
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === "/api/db/databases") return Promise.resolve(jsonResponse(DATABASES_RESPONSE));
        return Promise.resolve(jsonResponse({ forward: { id: "prop-rel" }, reverse: { id: "prop-rev" } }, 201));
      });
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
      await user.type(screen.getByLabelText(/property name/i), "Related tasks");
      await user.selectOptions(screen.getByLabelText(/property type/i), "relation");
      await screen.findByRole("option", { name: /other database/i });
      await user.selectOptions(screen.getByLabelText(/target database/i), "ds-2");
      await user.type(screen.getByLabelText(/reverse property name/i), "Related from");
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      await waitFor(() => expect(refetch).toHaveBeenCalled());
      const relationsCall = fetchMock.mock.calls.find(([url]) => url === "/api/db/data-sources/ds-1/relations");
      expect(relationsCall).toBeDefined();
      const [, init] = relationsCall!;
      expect(init).toMatchObject({ method: "POST" });
      expect(JSON.parse(init.body as string)).toEqual({
        name: "Related tasks",
        target_data_source_id: "ds-2",
        two_way: true,
        reverse_name: "Related from",
      });
    });

    it("submitting a one-way relation sends two_way: false and reverse_name: null, without requiring a reverse name", async () => {
      const user = userEvent.setup();
      const refetch = vi.fn().mockResolvedValue(undefined);
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === "/api/db/databases") return Promise.resolve(jsonResponse(DATABASES_RESPONSE));
        return Promise.resolve(jsonResponse({ forward: { id: "prop-rel" }, reverse: null }, 201));
      });
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
      await user.type(screen.getByLabelText(/property name/i), "Blocking");
      await user.selectOptions(screen.getByLabelText(/property type/i), "relation");
      await screen.findByRole("option", { name: /other database/i });
      await user.selectOptions(screen.getByLabelText(/target database/i), "ds-2");
      await user.click(screen.getByLabelText(/two-way/i));
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      await waitFor(() => expect(refetch).toHaveBeenCalled());
      const relationsCall = fetchMock.mock.calls.find(([url]) => url === "/api/db/data-sources/ds-1/relations");
      expect(JSON.parse(relationsCall![1].body as string)).toEqual({
        name: "Blocking",
        target_data_source_id: "ds-2",
        two_way: false,
        reverse_name: null,
      });
    });

    it("self-relation: choosing this data source as the target is allowed and POSTs target_data_source_id equal to dataSourceId", async () => {
      const user = userEvent.setup();
      const refetch = vi.fn().mockResolvedValue(undefined);
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === "/api/db/databases") return Promise.resolve(jsonResponse(DATABASES_RESPONSE));
        return Promise.resolve(jsonResponse({ forward: { id: "prop-rel" }, reverse: { id: "prop-rev" } }, 201));
      });
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
      await user.type(screen.getByLabelText(/property name/i), "Sub-tasks");
      await user.selectOptions(screen.getByLabelText(/property type/i), "relation");
      await screen.findByRole("option", { name: /other database/i });
      await user.selectOptions(screen.getByLabelText(/target database/i), "ds-1");
      await user.type(screen.getByLabelText(/reverse property name/i), "Parent task");
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      await waitFor(() => expect(refetch).toHaveBeenCalled());
      const relationsCall = fetchMock.mock.calls.find(([url]) => url === "/api/db/data-sources/ds-1/relations");
      expect(JSON.parse(relationsCall![1].body as string)).toMatchObject({
        target_data_source_id: "ds-1",
      });
    });

    it("does not submit without a chosen target database, and shows an error instead", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(DATABASES_RESPONSE));
      vi.stubGlobal("fetch", fetchMock);

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
      await user.selectOptions(screen.getByLabelText(/property type/i), "relation");
      await screen.findByRole("option", { name: /other database/i });
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      expect(await screen.findByText(/choose a target database/i)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalledWith(
        "/api/db/data-sources/ds-1/relations",
        expect.anything()
      );
    });
  });

  describe("Add formula property (task-31 Part 2)", () => {
    function stubFetch() {
      return vi.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("/formulas/validate")) {
          return Promise.resolve(
            jsonResponse({
              valid: false,
              errors: [{ message: "unexpected token 'EOF'", pos: 1, line: 1, col: 2 }],
              result_type: null,
              referenced_properties: [],
              is_volatile: false,
            })
          );
        }
        return Promise.resolve(jsonResponse({ id: "prop-formula" }, 201));
      });
    }

    it("selecting Formula renders the FormulaEditor's expression textarea", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", stubFetch());
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
      await user.selectOptions(screen.getByLabelText(/property type/i), "formula");
      expect(screen.getByRole("textbox", { name: /formula expression/i })).toBeInTheDocument();
    });

    it("submits {type: \"formula\", config: {expression}} to the properties endpoint even while the expression still has parse errors -- the Create button is NOT gated on valid: true (research §1.9)", async () => {
      const user = userEvent.setup();
      const refetch = vi.fn().mockResolvedValue(undefined);
      const fetchMock = stubFetch();
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
      await user.type(screen.getByLabelText(/property name/i), "Total");
      await user.selectOptions(screen.getByLabelText(/property type/i), "formula");
      // A deliberately unparseable expression -- the validate endpoint
      // (stubbed above) reports it invalid, and this test does NOT wait for
      // that response before submitting, proving Add works regardless.
      await user.type(screen.getByRole("textbox", { name: /formula expression/i }), 'prop("Price") *');
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      await waitFor(() => expect(refetch).toHaveBeenCalled());
      const propsCall = fetchMock.mock.calls.find(([url]) => url === "/api/db/data-sources/ds-1/properties");
      expect(propsCall).toBeDefined();
      expect(JSON.parse(propsCall![1].body as string)).toEqual({
        name: "Total",
        type: "formula",
        config: { expression: 'prop("Price") *' },
      });
    });

    it("does not submit an empty expression, and shows an error instead", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch();
      vi.stubGlobal("fetch", fetchMock);

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
      await user.selectOptions(screen.getByLabelText(/property type/i), "formula");
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      expect(await screen.findByText(/formula expression is required/i)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalledWith(
        "/api/db/data-sources/ds-1/properties",
        expect.anything()
      );
    });

    it("surfaces a dependency-cycle rejection's message verbatim", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("/formulas/validate")) {
          return Promise.resolve(
            jsonResponse({ valid: true, errors: [], result_type: "number", referenced_properties: [], is_volatile: false })
          );
        }
        return Promise.resolve(
          jsonResponse({ detail: "saving this formula would create a dependency cycle: A -> B -> A" }, 400)
        );
      });
      vi.stubGlobal("fetch", fetchMock);

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
      await user.selectOptions(screen.getByLabelText(/property type/i), "formula");
      await user.type(screen.getByRole("textbox", { name: /formula expression/i }), 'prop("B")');
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      expect(await screen.findByText(/dependency cycle: A -> B -> A/i)).toBeInTheDocument();
    });
  });

  describe("Add rollup property (task-31 Part 3)", () => {
    const RELATION_PROP = prop({
      key: "related",
      name: "Related tasks",
      type: "relation",
      position: 9,
      config: { relation_id: "rel-1", side: "forward", target_data_source_id: "ds-2" },
    });
    const PROPS_WITH_RELATION = [...PROPERTIES, RELATION_PROP];

    const DATABASES_RESPONSE = {
      databases: [
        { database: { id: "db-1", title: "This Database" }, data_source: { id: "ds-1" } },
        { database: { id: "db-2", title: "Other Database" }, data_source: { id: "ds-2" } },
      ],
    };
    const TARGET_DETAIL_RESPONSE = {
      database: { id: "db-2" },
      data_source: { id: "ds-2" },
      properties: [
        prop({ key: "target_title", name: "Title", type: "title" }),
        prop({ key: "target_num", name: "Amount", type: "number" }),
      ],
      views: [],
    };

    function stubFetch() {
      return vi.fn().mockImplementation((url: string) => {
        if (url === "/api/db/databases") return Promise.resolve(jsonResponse(DATABASES_RESPONSE));
        if (url === "/api/db/databases/db-2") return Promise.resolve(jsonResponse(TARGET_DETAIL_RESPONSE));
        return Promise.resolve(jsonResponse({ id: "prop-rollup" }, 201));
      });
    }

    it('says "add a relation property first" instead of offering an empty dropdown when this data source has no relation properties', async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", stubFetch());
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
      await user.selectOptions(screen.getByLabelText(/property type/i), "rollup");
      expect(screen.getByText(/add a relation property first/i)).toBeInTheDocument();
      expect(screen.queryByLabelText(/rollup relation/i)).not.toBeInTheDocument();
    });

    it("the function dropdown offers exactly the 22 ROLLUP_FUNCTIONS", async () => {
      const user = userEvent.setup();
      vi.stubGlobal("fetch", stubFetch());
      render(
        <TableView
          properties={PROPS_WITH_RELATION}
          rows={ROWS}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          refetch={vi.fn()}
        />
      );
      await user.click(screen.getByLabelText(/add property/i));
      await user.selectOptions(screen.getByLabelText(/property type/i), "rollup");
      const select = screen.getByLabelText(/rollup function/i) as HTMLSelectElement;
      const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
      expect(values).toEqual([...ROLLUP_FUNCTIONS]);
      expect(values).toHaveLength(22);
    });

    it("choosing a relation fetches the target database's properties for the target-property dropdown, and submitting POSTs the full computed config", async () => {
      const user = userEvent.setup();
      const refetch = vi.fn().mockResolvedValue(undefined);
      const fetchMock = stubFetch();
      vi.stubGlobal("fetch", fetchMock);

      render(
        <TableView
          properties={PROPS_WITH_RELATION}
          rows={ROWS}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          refetch={refetch}
        />
      );
      await user.click(screen.getByLabelText(/add property/i));
      await user.type(screen.getByLabelText(/property name/i), "Total Amount");
      await user.selectOptions(screen.getByLabelText(/property type/i), "rollup");
      await user.selectOptions(screen.getByLabelText(/rollup relation/i), "related");

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/db/databases/db-2"));
      await user.selectOptions(await screen.findByLabelText(/rollup target property/i), "target_num");
      await user.selectOptions(screen.getByLabelText(/rollup function/i), "sum");
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      await waitFor(() => expect(refetch).toHaveBeenCalled());
      const propsCall = fetchMock.mock.calls.find(([url]) => url === "/api/db/data-sources/ds-1/properties");
      expect(propsCall).toBeDefined();
      expect(JSON.parse(propsCall![1].body as string)).toEqual({
        name: "Total Amount",
        type: "rollup",
        config: {
          relation_key: "related",
          target_data_source_id: "ds-2",
          target_key: "target_num",
          function: "sum",
        },
      });
    });

    it("does not submit without a chosen target property or function, and shows an error instead", async () => {
      const user = userEvent.setup();
      const fetchMock = stubFetch();
      vi.stubGlobal("fetch", fetchMock);

      render(
        <TableView
          properties={PROPS_WITH_RELATION}
          rows={ROWS}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          refetch={vi.fn()}
        />
      );
      await user.click(screen.getByLabelText(/add property/i));
      await user.selectOptions(screen.getByLabelText(/property type/i), "rollup");
      await user.selectOptions(screen.getByLabelText(/rollup relation/i), "related");
      await user.click(screen.getByRole("button", { name: /^add$/i }));

      expect(await screen.findByText(/choose a property on the target database/i)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalledWith(
        "/api/db/data-sources/ds-1/properties",
        expect.anything()
      );
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

    it("clicking it POSTs to the rows endpoint with no body, then refetches rows specifically", async () => {
      // Regression test: useDatabaseView's `refetch` (=`load`) only re-fetches
      // database/properties/views — its `loadRows` has a separate effect keyed
      // to activeView's id/type/filter/sorts/config, none of which change when
      // a row is merely added. Live-verified bug: calling `refetch` alone after
      // POSTing a new row left the table showing "No rows yet." forever, even
      // though the row was created successfully server-side (confirmed via the
      // network log: POST .../rows → 201, followed only by GET .../databases,
      // never another POST .../query). `refetchRows` (=`loadRows`) is the one
      // that actually needs to be called here — asserting only "some refetch
      // happened" (the original version of this test) is exactly how this
      // shipped without being caught.
      const user = userEvent.setup();
      const refetch = vi.fn().mockResolvedValue(undefined);
      const refetchRows = vi.fn().mockResolvedValue(undefined);
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
          refetchRows={refetchRows}
        />
      );

      await user.click(screen.getByRole("button", { name: "+ New" }));

      await waitFor(() => expect(refetchRows).toHaveBeenCalled());
      expect(refetch).not.toHaveBeenCalled();
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/db/data-sources/ds-1/rows",
        expect.objectContaining({ method: "POST" })
      );
      const [, init] = fetchMock.mock.calls[0];
      expect(init).not.toHaveProperty("body");
    });
  });

  describe("relation cells (task-22)", () => {
    const RELATION_PROP = prop({
      key: "related",
      name: "Related",
      type: "relation",
      position: 9,
      config: { relation_id: "rel-1", side: "forward", target_data_source_id: "ds-2" },
    });
    const PROPS_WITH_RELATION = [...PROPERTIES, RELATION_PROP];

    it("calls ensureRelationLinks once per visible relation cell on mount", () => {
      const ensureRelationLinks = vi.fn();
      render(
        <TableView
          properties={PROPS_WITH_RELATION}
          rows={ROWS}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={{}}
          ensureRelationLinks={ensureRelationLinks}
          setRelationLinks={vi.fn()}
        />
      );
      expect(ensureRelationLinks).toHaveBeenCalledWith("row-1", "related");
    });

    it("renders linked titles from the relationLinks cache, and removing one calls setRelationLinks with the remainder", async () => {
      const user = userEvent.setup();
      const setRelationLinks = vi.fn();
      render(
        <TableView
          properties={PROPS_WITH_RELATION}
          rows={ROWS}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={{ "row-1:related": [{ id: "row-9", title: "Linked Note" }] }}
          ensureRelationLinks={vi.fn()}
          setRelationLinks={setRelationLinks}
        />
      );
      expect(screen.getByText("Linked Note")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Remove Linked Note" }));
      expect(setRelationLinks).toHaveBeenCalledWith("row-1", "related", []);
    });

    it("falls back to a read-only placeholder when relation handler props are omitted (older/other-view callers)", () => {
      render(<TableView properties={PROPS_WITH_RELATION} rows={ROWS} editable={true} onCellChange={vi.fn()} />);
      // GenericCell's fallback for an absent value — no crash, no picker controls.
      expect(screen.queryByRole("button", { name: /link a row/i })).not.toBeInTheDocument();
    });
  });

  describe("relation N+1 fix (task-31 Part 4)", () => {
    // Live-verified bug this reproduces the shape of: 58 relation requests
    // for a two-row table. Before this fix, TableView's own pre-fetch
    // effect only ever warmed ONE relation column (whichever sub-item
    // property matched the active display mode) — every OTHER relation
    // column had no bulk pre-fetch at all, so each of ITS cells fell back
    // to one `ensureRelationLinks` HTTP request per row: for M relation
    // columns and N rows, that's O(N×M) requests, growing with the row
    // count. The fix warms every relation column via
    // `ensureRelationLinksBulk` — exactly one call per column (M calls
    // total), each a single request covering every row id, regardless of
    // how many rows there are: O(M), not O(N×M).
    function manyRelationProps(count: number): PropertyResponse[] {
      return Array.from({ length: count }, (_, i) =>
        prop({
          key: `rel${i}`,
          name: `Relation ${i}`,
          type: "relation",
          position: 100 + i,
          config: { relation_id: `rel-pair-${i}`, side: "forward", target_data_source_id: "ds-2" },
        })
      );
    }

    function manyRows(count: number): DatabaseRow[] {
      return Array.from({ length: count }, (_, i) => ({
        id: `row-${i}`,
        properties: { title: { type: "title", title: `Row ${i}` } },
      }));
    }

    it("issues exactly M ensureRelationLinksBulk calls (one per relation column) for N rows and M relation columns — NOT N×M", () => {
      const M = 4;
      const N = 12;
      const relationProps = manyRelationProps(M);
      const rows = manyRows(N);
      const ensureRelationLinksBulk = vi.fn();

      render(
        <TableView
          properties={[...PROPERTIES, ...relationProps]}
          rows={rows}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={{}}
          ensureRelationLinksBulk={ensureRelationLinksBulk}
        />
      );

      // Exactly M calls (one per relation column) — a call count that
      // would have been N×M = 48 before this fix (one per row per
      // column, via each cell's own `ensureRelationLinks`), or even just
      // 0 (no pre-fetch at all) for any non-sub-item relation column,
      // leaving those N×M requests to individual cell mounts instead. A
      // test that merely checked "data appears" would pass either way —
      // this asserts the actual request-count shape.
      expect(ensureRelationLinksBulk).toHaveBeenCalledTimes(M);
      const allRowIds = rows.map((r) => r.id);
      for (let i = 0; i < M; i++) {
        expect(ensureRelationLinksBulk).toHaveBeenCalledWith(allRowIds, `rel${i}`);
      }
    });

    it("stays at exactly M calls even as N grows — proves the call count is independent of row count", () => {
      const M = 3;
      const relationProps = manyRelationProps(M);
      const ensureRelationLinksBulkSmall = vi.fn();
      const ensureRelationLinksBulkLarge = vi.fn();

      const { unmount } = render(
        <TableView
          properties={[...PROPERTIES, ...relationProps]}
          rows={manyRows(2)}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={{}}
          ensureRelationLinksBulk={ensureRelationLinksBulkSmall}
        />
      );
      expect(ensureRelationLinksBulkSmall).toHaveBeenCalledTimes(M);
      unmount();

      render(
        <TableView
          properties={[...PROPERTIES, ...relationProps]}
          rows={manyRows(50)}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={{}}
          ensureRelationLinksBulk={ensureRelationLinksBulkLarge}
        />
      );
      // Same M, 25x the rows — an O(N×M) implementation would call this 25x
      // more; an O(M) one calls it exactly the same number of times.
      expect(ensureRelationLinksBulkLarge).toHaveBeenCalledTimes(M);
    });
  });

  describe("sub-item nesting (task-22)", () => {
    const SUBITEM_FORWARD = prop({
      key: "subitem",
      name: "Sub-item",
      type: "relation",
      position: 10,
      config: { relation_id: "rel-2", side: "forward", system: "sub_item", target_data_source_id: "ds-1" },
    });
    const SUBITEM_REVERSE = prop({
      key: "parentitem",
      name: "Parent item",
      type: "relation",
      position: 11,
      config: { relation_id: "rel-2", side: "reverse", system: "sub_item", target_data_source_id: "ds-1" },
    });
    const PROPS_WITH_SUBITEMS = [...PROPERTIES, SUBITEM_FORWARD, SUBITEM_REVERSE];

    const PARENT_ROW: DatabaseRow = {
      id: "parent-1",
      properties: { title: { type: "title", title: "Parent" } },
    };
    const CHILD_ROW: DatabaseRow = {
      id: "child-1",
      properties: { title: { type: "title", title: "Child" } },
    };
    const TREE_ROWS = [PARENT_ROW, CHILD_ROW];

    function relationLinksFor(childrenOfParent: RelatedRow[]): Record<string, RelatedRow[]> {
      return {
        "parent-1:subitem": childrenOfParent,
        "child-1:subitem": [],
      };
    }

    it("'show' mode: nests a child under its parent, indented, with an expand/collapse toggle", () => {
      render(
        <TableView
          properties={PROPS_WITH_SUBITEMS}
          rows={TREE_ROWS}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={relationLinksFor([{ id: "child-1", title: "Child" }])}
          ensureRelationLinks={vi.fn()}
          setRelationLinks={vi.fn()}
          subItemDisplayMode="show"
        />
      );

      // `getByRole("button", ...)` (not `getByText`) specifically targets
      // TitleCell's own button (its accessible name is the bare title) —
      // the Sub-item relation column, rendered as a column in its own
      // right, *also* shows "Child" as a chip on the parent's row (it's
      // linked there), which would make a plain text query ambiguous.
      expect(screen.getByRole("button", { name: "Parent" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Child" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
    });

    it("'show' mode: collapsing the parent hides the child row", async () => {
      const user = userEvent.setup();
      render(
        <TableView
          properties={PROPS_WITH_SUBITEMS}
          rows={TREE_ROWS}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={relationLinksFor([{ id: "child-1", title: "Child" }])}
          ensureRelationLinks={vi.fn()}
          setRelationLinks={vi.fn()}
          subItemDisplayMode="show"
        />
      );

      await user.click(screen.getByRole("button", { name: "Collapse" }));

      expect(screen.getByRole("button", { name: "Parent" })).toBeInTheDocument();
      // The child *row* is gone — its own TitleCell button no longer
      // exists — even though "Child" the text still appears elsewhere (the
      // parent's own Sub-item relation column still shows its link chip;
      // collapsing hides the child's *row*, not that unrelated chip).
      expect(screen.queryByRole("button", { name: "Child" })).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    });

    it("'show' mode: a root row with no children has no toggle button", () => {
      render(
        <TableView
          properties={PROPS_WITH_SUBITEMS}
          rows={[PARENT_ROW]}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={{ "parent-1:subitem": [] }}
          ensureRelationLinks={vi.fn()}
          setRelationLinks={vi.fn()}
          subItemDisplayMode="show"
        />
      );
      expect(screen.queryByRole("button", { name: /collapse|expand/i })).not.toBeInTheDocument();
    });

    it("'flattened' mode: renders every row at one level (no nesting/toggle), with a parent indicator on the sub-item", () => {
      render(
        <TableView
          properties={PROPS_WITH_SUBITEMS}
          rows={TREE_ROWS}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={{ "child-1:parentitem": [{ id: "parent-1", title: "Parent" }] }}
          ensureRelationLinks={vi.fn()}
          setRelationLinks={vi.fn()}
          subItemDisplayMode="flattened"
        />
      );

      expect(screen.getByRole("button", { name: "Parent" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Child" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /collapse|expand/i })).not.toBeInTheDocument();
      expect(screen.getByText(/↳ Parent/)).toBeInTheDocument();
    });

    it("pre-fetches sub-item links (both forward AND reverse columns) via ensureRelationLinksBulk, not one ensureRelationLinks call per row (M7 combined-review Important finding 3, generalized by task-31 Part 4)", () => {
      const ensureRelationLinksBulk = vi.fn();
      // `ensureRelationLinks` is deliberately omitted here: TableView only
      // wires a relation column up to a live RelationCell (which calls
      // `ensureRelationLinks` itself, on mount, for its own single-cell
      // load — unrelated to this pre-fetch effect) when BOTH
      // `ensureRelationLinks` and `setRelationLinks` are provided. Omitting
      // it isolates what THIS effect calls from what the per-cell
      // RelationCell components for the sub-item/parent-item columns
      // would otherwise also call, which would make a bare call-count
      // assertion meaningless.
      //
      // task-31 Part 4: this effect no longer gates on `subItemDisplayMode`
      // at all — it warms EVERY relation column (here: both "subitem" and
      // "parentitem", since both are `type: "relation"` properties), so
      // both fire regardless of which (if any) display mode is active.
      render(
        <TableView
          properties={PROPS_WITH_SUBITEMS}
          rows={TREE_ROWS}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={relationLinksFor([{ id: "child-1", title: "Child" }])}
          ensureRelationLinksBulk={ensureRelationLinksBulk}
          subItemDisplayMode="show"
        />
      );

      expect(ensureRelationLinksBulk).toHaveBeenCalledTimes(2);
      expect(ensureRelationLinksBulk).toHaveBeenCalledWith(["parent-1", "child-1"], "subitem");
      expect(ensureRelationLinksBulk).toHaveBeenCalledWith(["parent-1", "child-1"], "parentitem");
    });

    it("falls back to one ensureRelationLinks call per row per relation column when ensureRelationLinksBulk is omitted (older/other caller)", () => {
      const ensureRelationLinks = vi.fn();
      // `setRelationLinks` is deliberately omitted (same reasoning as
      // above, inverted): without it, `renderCellValue`'s relationExtras
      // stay `undefined` for the sub-item/parent-item columns too, so no
      // RelationCell mounts to make its own independent `ensureRelationLinks`
      // calls — the only calls left are this effect's own per-row
      // fallback loop, which is exactly what this test asserts the shape
      // of.
      render(
        <TableView
          properties={PROPS_WITH_SUBITEMS}
          rows={TREE_ROWS}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={relationLinksFor([{ id: "child-1", title: "Child" }])}
          ensureRelationLinks={ensureRelationLinks}
          subItemDisplayMode="show"
        />
      );

      expect(ensureRelationLinks).toHaveBeenCalledWith("parent-1", "subitem");
      expect(ensureRelationLinks).toHaveBeenCalledWith("child-1", "subitem");
      expect(ensureRelationLinks).toHaveBeenCalledWith("parent-1", "parentitem");
      expect(ensureRelationLinks).toHaveBeenCalledWith("child-1", "parentitem");
      expect(ensureRelationLinks).toHaveBeenCalledTimes(4);
    });

    it("with no sub-item display mode set, renders flat with no tree/indicator controls at all", () => {
      render(
        <TableView
          properties={PROPS_WITH_SUBITEMS}
          rows={TREE_ROWS}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={relationLinksFor([{ id: "child-1", title: "Child" }])}
          ensureRelationLinks={vi.fn()}
          setRelationLinks={vi.fn()}
        />
      );
      expect(screen.queryByRole("button", { name: /collapse|expand/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/↳/)).not.toBeInTheDocument();
    });
  });

  // Milestone 12 (task-40): the "+ New" split-button's dropdown. The plain
  // "+ New" click path itself (handleAddRow, tested in "Add row" above) is
  // untouched by any of this — this task's own regression bar for this
  // file — so none of those existing tests were modified.
  describe("New row from template (task-40)", () => {
    function rowTemplate(overrides: Partial<RowTemplateResponse>): RowTemplateResponse {
      return {
        id: "tmpl-1",
        data_source_id: "ds-1",
        user_id: "user-1",
        name: "Weekly review",
        icon: null,
        properties: {},
        content: [],
        is_default: false,
        repeat_config: null,
        next_run_at: null,
        position: 0,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        ...overrides,
      };
    }

    it("renders no chevron at all when there are zero templates", () => {
      render(
        <TableView
          properties={PROPERTIES}
          rows={[]}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          templates={[]}
        />
      );
      expect(screen.getByRole("button", { name: "+ New" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Choose a template" })).not.toBeInTheDocument();
    });

    it("renders no chevron at all when the `templates` prop is simply omitted (older/other caller)", () => {
      render(
        <TableView properties={PROPERTIES} rows={[]} editable={true} onCellChange={vi.fn()} dataSourceId="ds-1" />
      );
      expect(screen.queryByRole("button", { name: "Choose a template" })).not.toBeInTheDocument();
    });

    it("the dropdown lists one entry per NON-default template — the default one is omitted (plain \"+ New\" already produces it)", async () => {
      const user = userEvent.setup();
      const templates = [
        rowTemplate({ id: "default-1", name: "Default one", is_default: true }),
        rowTemplate({ id: "extra-1", name: "Extra template", is_default: false }),
      ];
      render(
        <TableView
          properties={PROPERTIES}
          rows={[]}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          templates={templates}
          onInstantiateTemplate={vi.fn()}
        />
      );

      await user.click(screen.getByRole("button", { name: "Choose a template" }));

      expect(screen.getByRole("menuitem", { name: "Extra template" })).toBeInTheDocument();
      expect(screen.queryByRole("menuitem", { name: "Default one" })).not.toBeInTheDocument();
    });

    it("clicking a template entry calls onInstantiateTemplate then refetchRows", async () => {
      const user = userEvent.setup();
      const onInstantiateTemplate = vi.fn().mockResolvedValue({ id: "row-9", properties: {} });
      const refetchRows = vi.fn().mockResolvedValue(undefined);
      const templates = [rowTemplate({ id: "extra-1", name: "Extra template" })];

      render(
        <TableView
          properties={PROPERTIES}
          rows={[]}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          refetchRows={refetchRows}
          templates={templates}
          onInstantiateTemplate={onInstantiateTemplate}
        />
      );

      await user.click(screen.getByRole("button", { name: "Choose a template" }));
      await user.click(screen.getByRole("menuitem", { name: "Extra template" }));

      await waitFor(() => expect(onInstantiateTemplate).toHaveBeenCalledWith("extra-1"));
      await waitFor(() => expect(refetchRows).toHaveBeenCalled());
    });

    it("a failed instantiate shows a toast and does not call refetchRows", async () => {
      const user = userEvent.setup();
      const onInstantiateTemplate = vi.fn().mockRejectedValue(new Error("could not create row"));
      const refetchRows = vi.fn();
      const templates = [rowTemplate({ id: "extra-1", name: "Extra template" })];

      render(
        <TableView
          properties={PROPERTIES}
          rows={[]}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          refetchRows={refetchRows}
          templates={templates}
          onInstantiateTemplate={onInstantiateTemplate}
        />
      );

      await user.click(screen.getByRole("button", { name: "Choose a template" }));
      await user.click(screen.getByRole("menuitem", { name: "Extra template" }));

      await waitFor(() => expect(onInstantiateTemplate).toHaveBeenCalled());
      expect(refetchRows).not.toHaveBeenCalled();
    });

    it("the plain \"+ New\" button's click behavior is unaffected by templates being present", async () => {
      const user = userEvent.setup();
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "row-2", properties: {} }, 201));
      vi.stubGlobal("fetch", fetchMock);
      const refetchRows = vi.fn().mockResolvedValue(undefined);
      const onInstantiateTemplate = vi.fn();
      const templates = [rowTemplate({ id: "extra-1", name: "Extra template" })];

      render(
        <TableView
          properties={PROPERTIES}
          rows={[]}
          editable={true}
          onCellChange={vi.fn()}
          dataSourceId="ds-1"
          refetchRows={refetchRows}
          templates={templates}
          onInstantiateTemplate={onInstantiateTemplate}
        />
      );

      await user.click(screen.getByRole("button", { name: "+ New" }));

      await waitFor(() => expect(refetchRows).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/db/data-sources/ds-1/rows",
        expect.objectContaining({ method: "POST" })
      );
      expect(onInstantiateTemplate).not.toHaveBeenCalled();
    });
  });
});
