import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ViewLayoutPanel } from "./ViewLayoutPanel";
import type { PropertyResponse } from "@/lib/database/types";

function prop(overrides: Partial<PropertyResponse>): PropertyResponse {
  return {
    id: overrides.key ?? "id",
    data_source_id: "ds-1",
    user_id: "user-1",
    key: "key",
    name: "Name",
    type: "select",
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

const STATUS_PROP = prop({ key: "status", name: "Status", type: "select", position: 0 });
const NUMBER_PROP = prop({ key: "score", name: "Score", type: "number", position: 1 });

describe("ViewLayoutPanel", () => {
  it("renders a 3x3 grid of view-type cards with the current type selected", () => {
    render(<ViewLayoutPanel viewType="table" config={{}} onPatchConfig={vi.fn()} />);

    const cards = screen.getAllByRole("button", { name: /Table|Board|Timeline|Calendar|List|Gallery|Chart|Feed|Dashboard/ });
    expect(cards).toHaveLength(9);

    const tableCard = screen.getByRole("button", { name: "Table" });
    expect(tableCard).toBeEnabled();
    const boardCard = screen.getByRole("button", { name: "Board" });
    expect(boardCard).toBeDisabled();
  });

  it("renders the three display toggles reflecting config, defaulting to on", () => {
    render(<ViewLayoutPanel viewType="table" config={{}} onPatchConfig={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "Show vertical lines" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Show page icon" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Wrap all content" })).toHaveAttribute("aria-checked", "true");
  });

  it("toggling 'Show vertical lines' off patches show_vertical_lines: false", async () => {
    const user = userEvent.setup();
    const onPatchConfig = vi.fn();
    render(<ViewLayoutPanel viewType="table" config={{}} onPatchConfig={onPatchConfig} />);

    await user.click(screen.getByRole("switch", { name: "Show vertical lines" }));
    expect(onPatchConfig).toHaveBeenCalledWith({ show_vertical_lines: false });
  });

  it("Open pages in shows the current mode and opens a popover with all three options", async () => {
    const user = userEvent.setup();
    render(<ViewLayoutPanel viewType="table" config={{}} onPatchConfig={vi.fn()} />);

    expect(screen.getByText("Side peek")).toBeInTheDocument();
    await user.click(screen.getByText("Open pages in"));

    expect(screen.getByRole("option", { name: /Side peek/ })).toBeInTheDocument();
    expect(screen.getByText("Center peek")).toBeInTheDocument();
    expect(screen.getByText("Full page")).toBeInTheDocument();
    expect(screen.getByText("Default for Table")).toBeInTheDocument();
  });

  it("selecting a mode patches open_pages_in and closes the popover", async () => {
    const user = userEvent.setup();
    const onPatchConfig = vi.fn();
    render(<ViewLayoutPanel viewType="table" config={{}} onPatchConfig={onPatchConfig} />);

    await user.click(screen.getByText("Open pages in"));
    await user.click(screen.getByText("Center peek"));

    expect(onPatchConfig).toHaveBeenCalledWith({ open_pages_in: "center" });
    expect(screen.queryByText("Full page")).not.toBeInTheDocument();
  });

  // M12 (Chart's own dedicated work, 2026-09-02) — view-tab-bar.md's own
  // "Chart is a disclosed exception" section named this as missing: before
  // this, only the create-time popover could ever set a chart's axes.
  describe("Chart section (M12)", () => {
    it("does not render for a non-chart view type", () => {
      render(<ViewLayoutPanel viewType="table" config={{}} onPatchConfig={vi.fn()} />);
      expect(screen.queryByLabelText("Chart type")).not.toBeInTheDocument();
    });

    it("renders for a chart view, seeded from the CURRENT config, not the creation-time default", () => {
      render(
        <ViewLayoutPanel
          viewType="chart"
          config={{
            chart_type: "donut",
            y_axis: { aggregator: "sum", property_id: "score" },
            x_axis: { property_id: "status" },
          }}
          onPatchConfig={vi.fn()}
          properties={[STATUS_PROP, NUMBER_PROP]}
        />
      );

      expect(screen.getByLabelText("Chart type")).toHaveValue("donut");
      expect(screen.getByLabelText("Y-axis aggregator")).toHaveValue("sum");
      expect(screen.getByLabelText("Y-axis property")).toHaveValue("score");
      expect(screen.getByLabelText("X-axis property")).toHaveValue("status");
      // donut has no stacking concept — no picker at all.
      expect(screen.queryByLabelText("Stack by")).not.toBeInTheDocument();
    });

    it("changing the y-axis aggregator patches the full chart config, not just the changed field", async () => {
      const user = userEvent.setup();
      const onPatchConfig = vi.fn();
      render(
        <ViewLayoutPanel
          viewType="chart"
          config={{
            chart_type: "column",
            y_axis: { aggregator: "sum", property_id: "score" },
            x_axis: { property_id: "status" },
          }}
          onPatchConfig={onPatchConfig}
          properties={[STATUS_PROP, NUMBER_PROP]}
        />
      );

      await user.selectOptions(screen.getByLabelText("Y-axis aggregator"), "average");

      const lastPatch = onPatchConfig.mock.calls[onPatchConfig.mock.calls.length - 1][0];
      expect(lastPatch.y_axis).toEqual({ aggregator: "average", property_id: "score" });
      expect(lastPatch.x_axis).toEqual({ property_id: "status" });
    });

    // buildChartConfigPatch's own reason for existing rather than reusing
    // buildChartViewConfig verbatim: an EDIT must actively clear fields that
    // no longer apply, not just omit them from the patch (onPatchConfig only
    // merges keys present in the patch — an omitted key leaves the OLD
    // value in place).
    it("switching chart_type to 'number' clears x_axis and stack_by, not just leaves them stale", async () => {
      const user = userEvent.setup();
      const onPatchConfig = vi.fn();
      render(
        <ViewLayoutPanel
          viewType="chart"
          config={{
            chart_type: "column",
            y_axis: { aggregator: "count" },
            x_axis: { property_id: "status" },
            stack_by: { property_id: "status" },
          }}
          onPatchConfig={onPatchConfig}
          properties={[STATUS_PROP, NUMBER_PROP]}
        />
      );

      await user.selectOptions(screen.getByLabelText("Chart type"), "number");

      expect(onPatchConfig).toHaveBeenCalledWith({
        chart_type: "number",
        y_axis: { aggregator: "count" },
        x_axis: null,
        hide_empty_groups: false,
        stack_by: null,
      });
    });

    it("clearing 'Stack by' back to 'No stacking' patches stack_by: null, not an omitted key", async () => {
      const user = userEvent.setup();
      const onPatchConfig = vi.fn();
      render(
        <ViewLayoutPanel
          viewType="chart"
          config={{
            chart_type: "column",
            y_axis: { aggregator: "count" },
            x_axis: { property_id: "status" },
            stack_by: { property_id: "status" },
          }}
          onPatchConfig={onPatchConfig}
          properties={[STATUS_PROP, NUMBER_PROP]}
        />
      );

      await user.selectOptions(screen.getByLabelText("Stack by"), "");

      const lastPatch = onPatchConfig.mock.calls[onPatchConfig.mock.calls.length - 1][0];
      expect(lastPatch.stack_by).toBeNull();
    });
  });
});
