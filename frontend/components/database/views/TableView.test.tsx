import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TableView } from "./TableView";
import { KNOWN_PROPERTY_TYPES } from "@/lib/database/types";
import type { DatabaseRow, PropertyResponse, RelatedRow } from "@/lib/database/types";

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

    it("'show' mode: pre-fetches sub-item links via ensureRelationLinksBulk (ONE call for all visible rows), not one ensureRelationLinks call per row (M7 combined-review Important finding 3)", () => {
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

      expect(ensureRelationLinksBulk).toHaveBeenCalledTimes(1);
      expect(ensureRelationLinksBulk).toHaveBeenCalledWith(["parent-1", "child-1"], "subitem");
    });

    it("'flattened' mode: pre-fetches via ensureRelationLinksBulk using the reverse (parent item) property key", () => {
      const ensureRelationLinksBulk = vi.fn();
      render(
        <TableView
          properties={PROPS_WITH_SUBITEMS}
          rows={TREE_ROWS}
          editable={true}
          onCellChange={vi.fn()}
          relationLinks={{ "child-1:parentitem": [{ id: "parent-1", title: "Parent" }] }}
          ensureRelationLinksBulk={ensureRelationLinksBulk}
          subItemDisplayMode="flattened"
        />
      );

      expect(ensureRelationLinksBulk).toHaveBeenCalledWith(["parent-1", "child-1"], "parentitem");
    });

    it("falls back to one ensureRelationLinks call per row when ensureRelationLinksBulk is omitted (older/other caller)", () => {
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
      expect(ensureRelationLinks).toHaveBeenCalledTimes(2);
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
});
