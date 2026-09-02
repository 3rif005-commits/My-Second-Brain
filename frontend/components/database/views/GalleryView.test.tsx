import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// GalleryCard renders an OpenNoteButton (task-17 fix round, finding 1),
// which navigates via next/navigation's useRouter — outside a real Next.js
// app router tree that throws unless mocked, same as ListView.test.tsx. M12:
// GalleryView also reads/writes the row peek's `?p=&pm=` via `useRowPeek`
// now — mocked the same way.
const push = vi.fn();
const routerReplace = vi.fn();
let mockSearch = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: routerReplace }),
  usePathname: () => "/brain/db/ds-1",
  useSearchParams: () => new URLSearchParams(mockSearch),
}));

// RowPeek mounts a real BlockEditor — heavy (BlockNote), stubbed the same
// way TableView.test.tsx/ListView.test.tsx already do.
vi.mock("@/components/editor/BlockEditor", () => ({
  BlockEditor: () => <div data-testid="block-editor-stub" />,
}));

import { GalleryView } from "./GalleryView";
import type { DatabaseRow, PropertyResponse } from "@/lib/database/types";

beforeEach(() => {
  mockSearch = "";
  push.mockClear();
  routerReplace.mockClear();
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

const TITLE_PROP = prop({ key: "title", name: "Title", type: "title", position: 0 });
const STATUS_PROP = prop({ key: "status", name: "Status", type: "status", position: 1 });
const NUMBER_PROP = prop({ key: "number", name: "Number", type: "number", position: 2 });
const FILES_PROP = prop({ key: "attachments", name: "Attachments", type: "files", position: 3 });

function row(id: string, title: string, extra: Partial<DatabaseRow> = {}): DatabaseRow {
  return { id, properties: { title: { type: "title", title } }, ...extra };
}

describe("GalleryView", () => {
  it("renders a cover image when row.cover_image_url is present", () => {
    render(
      <GalleryView
        properties={[TITLE_PROP]}
        rows={[row("row-1", "First", { cover_image_url: "https://example.com/cover.png" })]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={vi.fn()}
      />
    );

    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://example.com/cover.png");
    expect(screen.queryByTestId("cover-placeholder")).not.toBeInTheDocument();
  });

  it("renders a neutral placeholder when cover_image_url is absent", () => {
    render(
      <GalleryView
        properties={[TITLE_PROP]}
        rows={[row("row-1", "First")]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.getByTestId("cover-placeholder")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("cover_size round-trips through onConfigChange", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(
      <GalleryView
        properties={[TITLE_PROP]}
        rows={[row("row-1", "First")]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={onConfigChange}
      />
    );

    await user.selectOptions(screen.getByLabelText("Cover size"), "large");
    expect(onConfigChange).toHaveBeenCalledWith({ cover_size: "large" });
  });

  it("cover_aspect round-trips through onConfigChange", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(
      <GalleryView
        properties={[TITLE_PROP]}
        rows={[row("row-1", "First")]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={onConfigChange}
      />
    );

    await user.selectOptions(screen.getByLabelText("Cover fit"), "contain");
    expect(onConfigChange).toHaveBeenCalledWith({ cover_aspect: "contain" });
  });

  it("card_layout round-trips through onConfigChange", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(
      <GalleryView
        properties={[TITLE_PROP]}
        rows={[row("row-1", "First")]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={onConfigChange}
      />
    );

    await user.selectOptions(screen.getByLabelText("Card layout"), "compact");
    expect(onConfigChange).toHaveBeenCalledWith({ card_layout: "compact" });
  });

  it("hide-title toggle calls onConfigChange with the title key added to hidden_properties", async () => {
    const user = userEvent.setup();
    const onConfigChange = vi.fn();
    render(
      <GalleryView
        properties={[TITLE_PROP, STATUS_PROP]}
        rows={[row("row-1", "First")]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={onConfigChange}
      />
    );

    await user.click(screen.getByRole("checkbox", { name: /hide title/i }));
    expect(onConfigChange).toHaveBeenCalledWith({ hidden_properties: ["title"] });
  });

  it("title is actually hidden when hidden_properties already contains the title key", () => {
    render(
      <GalleryView
        properties={[TITLE_PROP]}
        rows={[row("row-1", "First")]}
        editable={false}
        onCellChange={vi.fn()}
        config={{ hidden_properties: ["title"] }}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.queryByText("First")).not.toBeInTheDocument();
  });

  // M12: cards used to always show every non-title property in schema
  // `position` order, ignoring `config.property_order` — the same class of
  // silent-no-op bug Table's own `orderedProperties` already had fixed once
  // (`hidden_properties` was already wired here; the ORDER never was).
  it("property_order (config) reorders which property renders first on a card", () => {
    render(
      <GalleryView
        properties={[TITLE_PROP, STATUS_PROP, NUMBER_PROP]}
        rows={[
          row("row-1", "First", {
            properties: {
              title: { type: "title", title: "First" },
              status: { type: "status", status: "todo" },
              number: { type: "number", number: 42 },
            },
          }),
        ]}
        editable={false}
        onCellChange={vi.fn()}
        config={{ property_order: ["title", "number", "status"] }}
        onConfigChange={vi.fn()}
      />
    );

    const labels = [screen.getByText("Number:"), screen.getByText("Status:")];
    expect(labels[0].compareDocumentPosition(labels[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("renders 'No rows yet.' for an empty rows array", () => {
    render(
      <GalleryView
        properties={[TITLE_PROP]}
        rows={[]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={vi.fn()}
      />
    );

    expect(screen.getByText(/no rows yet/i)).toBeInTheDocument();
  });

  // M12: a card's Open button now opens the row's side peek (the same
  // `?p=&pm=s` URL Table/List/Feed/Board already write) instead of always
  // hard-navigating, replacing the old task-17 bare-navigation fix.
  it("clicking a card's Open button opens the row's side peek (writes ?p=&pm=s), not a bare navigation", async () => {
    const user = userEvent.setup();
    render(
      <GalleryView
        properties={[TITLE_PROP]}
        rows={[row("row-1", "First")]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(push).not.toHaveBeenCalled();
    expect(routerReplace).toHaveBeenCalled();
    const [url] = routerReplace.mock.calls[routerReplace.mock.calls.length - 1];
    expect(url).toContain("p=row-1");
    expect(url).toContain("pm=s");
  });

  // M12 (Gallery's own dedicated work, 2026-09-02): found and fixed the
  // same OPEN/CLOSE-doesn't-actually-toggle bug M10 already fixed once for
  // Table (row-peek.md) — Gallery/Board had never gotten that fix, both
  // still wired `onOpenRow={openRow}` (always re-opens) instead of
  // `toggleRow`. Reuses the SAME button element across both clicks (rather
  // than re-querying by accessible name) since RowPeek's own close control
  // also reads "Close" once the peek is open, the identical disambiguation
  // TableView.test.tsx's own "the Close button closes the peek" already
  // documents.
  it("OPEN/CLOSE actually toggles — a second click on the same button closes the peek, not re-opens it", async () => {
    const user = userEvent.setup();
    render(
      <GalleryView
        properties={[TITLE_PROP]}
        rows={[row("row-1", "First")]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={vi.fn()}
      />
    );

    const openBtn = screen.getByRole("button", { name: "Open" });
    await user.click(openBtn);
    expect(routerReplace).toHaveBeenLastCalledWith("/brain/db/ds-1?p=row-1&pm=s", { scroll: false });
    expect(openBtn).toHaveAccessibleName("Close");

    await user.click(openBtn);
    expect(routerReplace).toHaveBeenLastCalledWith("/brain/db/ds-1", { scroll: false });
  });

  // M12 (Gallery's own dedicated work, 2026-09-02, live capture — real
  // Notion's card hover reveals a "···" row-menu trigger alongside the
  // pencil/Open icon, byte-identical in content to every other view's own
  // row menu. Previously ABSENT entirely — the M12 code survey named Board
  // and Gallery as the two views with no row menu at all.
  it("hovering a card reveals a row-options menu trigger with the shared row menu", async () => {
    const user = userEvent.setup();
    render(
      <GalleryView
        properties={[TITLE_PROP]}
        rows={[row("row-1", "First")]}
        editable={false}
        onCellChange={vi.fn()}
        config={{}}
        onConfigChange={vi.fn()}
      />
    );

    await user.click(screen.getByRole("button", { name: "Row options" }));
    expect(screen.getByText("Move to Trash")).toBeInTheDocument();
    expect(screen.getByText("Add to Favorites")).toBeInTheDocument();
  });

  // M12 (Gallery's own dedicated work) — real Notion's Layout panel "Card
  // preview" setting, live-captured 2026-09-02: None / Page cover / a
  // picked `files`-type property / Page content (not offered — see
  // GalleryView.tsx's own top comment).
  describe("Card preview (M12)", () => {
    it("'None' renders no cover slot at all, even when cover_image_url is present", () => {
      render(
        <GalleryView
          properties={[TITLE_PROP]}
          rows={[row("row-1", "First", { cover_image_url: "https://example.com/cover.png" })]}
          editable={false}
          onCellChange={vi.fn()}
          config={{ card_preview: "none" }}
          onConfigChange={vi.fn()}
        />
      );

      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.queryByTestId("cover-placeholder")).not.toBeInTheDocument();
    });

    it("a picked files-property source renders that property's file URL as the card image", () => {
      render(
        <GalleryView
          properties={[TITLE_PROP, FILES_PROP]}
          rows={[
            row("row-1", "First", {
              properties: {
                title: { type: "title", title: "First" },
                attachments: { type: "files", files: [{ url: "https://example.com/a.png", name: "a.png" }] },
              },
            }),
          ]}
          editable={false}
          onCellChange={vi.fn()}
          config={{ card_preview: "attachments" }}
          onConfigChange={vi.fn()}
        />
      );

      expect(screen.getByRole("img")).toHaveAttribute("src", "https://example.com/a.png");
    });

    it("a files-property source with no value falls back to the neutral placeholder, not a broken image", () => {
      render(
        <GalleryView
          properties={[TITLE_PROP, FILES_PROP]}
          rows={[row("row-1", "First")]}
          editable={false}
          onCellChange={vi.fn()}
          config={{ card_preview: "attachments" }}
          onConfigChange={vi.fn()}
        />
      );

      expect(screen.getByTestId("cover-placeholder")).toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    });

    it("an invalid/stale card_preview value falls back to 'cover'", () => {
      render(
        <GalleryView
          properties={[TITLE_PROP]}
          rows={[row("row-1", "First", { cover_image_url: "https://example.com/cover.png" })]}
          editable={false}
          onCellChange={vi.fn()}
          config={{ card_preview: "a-deleted-property-key" }}
          onConfigChange={vi.fn()}
        />
      );

      expect(screen.getByRole("img")).toHaveAttribute("src", "https://example.com/cover.png");
    });

    it("card_preview round-trips through onConfigChange, offering each files-typed property by name", async () => {
      const user = userEvent.setup();
      const onConfigChange = vi.fn();
      render(
        <GalleryView
          properties={[TITLE_PROP, FILES_PROP]}
          rows={[row("row-1", "First")]}
          editable={false}
          onCellChange={vi.fn()}
          config={{}}
          onConfigChange={onConfigChange}
        />
      );

      const select = screen.getByLabelText("Card preview");
      expect(within(select).getByText("Attachments")).toBeInTheDocument();
      await user.selectOptions(select, "none");
      expect(onConfigChange).toHaveBeenCalledWith({ card_preview: "none" });
    });
  });
});
