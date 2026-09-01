import { describe, expect, it } from "vitest";
import {
  appendChild,
  asFilterNode,
  countConditions,
  defaultConditionFor,
  isFilterableProperty,
  removeAtPath,
  updateAtPath,
  type FilterCondition,
  type FilterGroup,
} from "./filterAst";
import type { PropertyResponse } from "./types";

function prop(overrides: Partial<PropertyResponse>): PropertyResponse {
  return {
    id: overrides.key ?? "id",
    data_source_id: "ds-1",
    user_id: "u1",
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

const cond = (property: string, operator = "contains"): FilterCondition => ({
  type: "condition",
  property,
  operator,
});

describe("asFilterNode", () => {
  it("returns null for null/undefined/malformed input", () => {
    expect(asFilterNode(null)).toBeNull();
    expect(asFilterNode(undefined)).toBeNull();
    expect(asFilterNode({})).toBeNull();
    expect(asFilterNode({ type: "condition" })).toBeNull();
    expect(asFilterNode({ type: "group", op: "and" })).toBeNull();
  });

  it("accepts a well-formed condition or group", () => {
    expect(asFilterNode({ type: "condition", property: "name", operator: "contains" })).toEqual(
      cond("name")
    );
    const group: FilterGroup = { type: "group", op: "or", children: [cond("a"), cond("b")] };
    expect(asFilterNode(group as unknown as Record<string, unknown>)).toEqual(group);
  });
});

describe("countConditions", () => {
  it("is 0 for null, 1 for a bare condition", () => {
    expect(countConditions(null)).toBe(0);
    expect(countConditions(cond("a"))).toBe(1);
  });

  it("counts leaves across nested groups, not top-level children", () => {
    const tree: FilterGroup = {
      type: "group",
      op: "and",
      children: [cond("a"), { type: "group", op: "or", children: [cond("b"), cond("c")] }],
    };
    expect(countConditions(tree)).toBe(3);
  });
});

describe("updateAtPath / removeAtPath / appendChild", () => {
  const tree: FilterGroup = {
    type: "group",
    op: "and",
    children: [cond("a"), cond("b")],
  };

  it("updateAtPath replaces the node at an empty path (the root)", () => {
    const next = updateAtPath(tree, [], (node) => ({ ...(node as FilterGroup), op: "or" }));
    expect((next as FilterGroup).op).toBe("or");
    expect(tree.op).toBe("and"); // original untouched
  });

  it("updateAtPath replaces a child by index, leaving siblings untouched", () => {
    const next = updateAtPath(tree, [1], (node) => ({ ...(node as FilterCondition), operator: "equals" }));
    expect((next as FilterGroup).children[1]).toEqual(cond("b", "equals"));
    expect((next as FilterGroup).children[0]).toEqual(cond("a"));
  });

  it("removeAtPath drops one child, keeping the group", () => {
    const next = removeAtPath(tree, [0]);
    expect(next).toEqual({ type: "group", op: "and", children: [cond("b")] });
  });

  it("removeAtPath prunes a nested group once its last child is removed", () => {
    const nested: FilterGroup = {
      type: "group",
      op: "and",
      children: [cond("a"), { type: "group", op: "or", children: [cond("b")] }],
    };
    const next = removeAtPath(nested, [1, 0]);
    expect(next).toEqual({ type: "group", op: "and", children: [cond("a")] });
  });

  it("removeAtPath on the root's own path (empty) returns null", () => {
    expect(removeAtPath(tree, [])).toBeNull();
  });

  it("appendChild adds a new child to the group at path", () => {
    const next = appendChild(tree, [], cond("c"));
    expect((next as FilterGroup).children).toHaveLength(3);
    expect((next as FilterGroup).children[2]).toEqual(cond("c"));
  });
});

describe("defaultConditionFor / isFilterableProperty", () => {
  it("picks the first operator for the property's type", () => {
    expect(defaultConditionFor(prop({ key: "title", type: "title" }))).toEqual({
      type: "condition",
      property: "title",
      operator: "equals",
    });
    expect(defaultConditionFor(prop({ key: "kind", type: "select" }))).toEqual({
      type: "condition",
      property: "kind",
      operator: "equals",
    });
  });

  it("place/button/formula/rollup are not filterable", () => {
    expect(isFilterableProperty(prop({ type: "place" }))).toBe(false);
    expect(isFilterableProperty(prop({ type: "button" }))).toBe(false);
    expect(isFilterableProperty(prop({ type: "formula" }))).toBe(false);
    expect(isFilterableProperty(prop({ type: "rollup" }))).toBe(false);
  });

  it("every other captured type is filterable", () => {
    for (const type of ["title", "rich_text", "number", "select", "multi_select", "status", "date", "checkbox", "url", "files"]) {
      expect(isFilterableProperty(prop({ type }))).toBe(true);
    }
  });
});
