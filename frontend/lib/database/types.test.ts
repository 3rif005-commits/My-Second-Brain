import { describe, expect, it } from "vitest";
import { getGroupBySpec, getSubGroupBySpec, isGroupablePropertyType } from "./types";

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

  it("rejects other types", () => {
    expect(isGroupablePropertyType("rich_text")).toBe(false);
    expect(isGroupablePropertyType("number")).toBe(false);
  });
});
