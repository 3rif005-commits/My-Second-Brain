import { describe, expect, it } from "vitest";
import { getGroupBySpec, getQueryExtras, getSubGroupBySpec, isGroupablePropertyType } from "./types";

describe("getGroupBySpec", () => {
  it("returns the spec when config.group_by has a property_key", () => {
    const config = { group_by: { property_key: "status", hide_empty_groups: true } };
    expect(getGroupBySpec(config)).toEqual({ property_key: "status", hide_empty_groups: true });
  });

  it("returns undefined when config.group_by is absent", () => {
    expect(getGroupBySpec({})).toBeUndefined();
  });

  it("returns undefined when config.group_by is malformed (no property_key)", () => {
    expect(getGroupBySpec({ group_by: { mode: "option" } })).toBeUndefined();
  });
});

describe("getSubGroupBySpec", () => {
  it("returns the spec when config.sub_group_by has a property_key", () => {
    const config = { sub_group_by: { property_key: "priority" } };
    expect(getSubGroupBySpec(config)).toEqual({ property_key: "priority" });
  });

  it("returns undefined when config.sub_group_by is absent", () => {
    expect(getSubGroupBySpec({})).toBeUndefined();
  });
});

describe("isGroupablePropertyType", () => {
  it("accepts select/status/multi_select", () => {
    expect(isGroupablePropertyType("select")).toBe(true);
    expect(isGroupablePropertyType("status")).toBe(true);
    expect(isGroupablePropertyType("multi_select")).toBe(true);
  });

  // Phase 0c (2026-09-01) widened this to match the grouping engine's real
  // support — rich_text/number/date/checkbox/etc. are groupable now; only
  // `grouping._NOT_GROUPABLE` and `formula` (needs Milestone 8) still aren't.
  it("accepts the types the engine gained range/bucket/exact-value support for", () => {
    expect(isGroupablePropertyType("rich_text")).toBe(true);
    expect(isGroupablePropertyType("number")).toBe(true);
    expect(isGroupablePropertyType("date")).toBe(true);
    expect(isGroupablePropertyType("checkbox")).toBe(true);
  });

  it("rejects the types grouping.group_rows genuinely can't group by", () => {
    expect(isGroupablePropertyType("files")).toBe(false);
    expect(isGroupablePropertyType("rollup")).toBe(false);
    expect(isGroupablePropertyType("unique_id")).toBe(false);
    expect(isGroupablePropertyType("verification")).toBe(false);
    expect(isGroupablePropertyType("button")).toBe(false);
    expect(isGroupablePropertyType("place")).toBe(false);
    // Deferred to Milestone 8 — needs the formula engine's result type first.
    expect(isGroupablePropertyType("formula")).toBe(false);
  });
});

describe("getQueryExtras — table view (M6)", () => {
  it("sends group_by when config.group_by is set", () => {
    const view = { type: "table", config: { group_by: { property_key: "kind" } } };
    expect(getQueryExtras(view)).toEqual({ group_by: { property_key: "kind" } });
  });

  it("sends {} when config.group_by is absent", () => {
    expect(getQueryExtras({ type: "table", config: {} })).toEqual({});
  });

  it("never sends sub_group_by, even if present in config — Table has no sub-group control", () => {
    const view = {
      type: "table",
      config: { group_by: { property_key: "kind" }, sub_group_by: { property_key: "status" } },
    };
    expect(getQueryExtras(view)).toEqual({ group_by: { property_key: "kind" } });
  });
});
