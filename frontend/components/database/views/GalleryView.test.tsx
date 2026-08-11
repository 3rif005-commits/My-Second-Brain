import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { GalleryView } from "./GalleryView";
import type { DatabaseRow, PropertyResponse } from "@/lib/database/types";

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
});
