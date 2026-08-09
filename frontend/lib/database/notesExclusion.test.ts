import { afterEach, describe, expect, it, vi } from "vitest";
import { applyNotesExclusion, excludedDatabaseRowIds } from "./notesExclusion";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("applyNotesExclusion", () => {
  it("returns the query unchanged, without calling .not(), when there is nothing to exclude (null)", () => {
    const query = { not: vi.fn() };
    const result = applyNotesExclusion(query as any, null);
    expect(result).toBe(query);
    expect(query.not).not.toHaveBeenCalled();
  });

  it("returns the query unchanged, without calling .not(), for an empty exclusion list (the sharp edge)", () => {
    // .not("id", "in", "()") is invalid SQL — an empty list must short-circuit
    // to no filter at all, not an empty one.
    const query = { not: vi.fn() };
    const result = applyNotesExclusion(query as any, []);
    expect(result).toBe(query);
    expect(query.not).not.toHaveBeenCalled();
  });

  it("calls .not('id', 'in', ...) with a parenthesised id list when ids are present", () => {
    const notResult = { filtered: true };
    const query = { not: vi.fn().mockReturnValue(notResult) };
    const result = applyNotesExclusion(query as any, ["id-1", "id-2"]);
    expect(query.not).toHaveBeenCalledTimes(1);
    expect(query.not).toHaveBeenCalledWith("id", "in", "(id-1,id-2)");
    expect(result).toBe(notResult);
  });
});

describe("excludedDatabaseRowIds", () => {
  function makeSupabaseStub(result: { data: unknown[] | null; error: unknown }) {
    const eq = vi.fn().mockResolvedValue(result);
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    return { stub: { from } as any, from, select, eq };
  }

  it("short-circuits to null without querying Supabase when DATABASE_ROWS_ENABLED is unset (the default)", async () => {
    vi.stubEnv("DATABASE_ROWS_ENABLED", "");
    const { stub, from } = makeSupabaseStub({ data: [], error: null });

    const result = await excludedDatabaseRowIds(stub, "user-1");

    expect(result).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("short-circuits to null without querying Supabase when DATABASE_ROWS_ENABLED is any non-'true' value", async () => {
    vi.stubEnv("DATABASE_ROWS_ENABLED", "1");
    const { stub, from } = makeSupabaseStub({ data: [], error: null });

    const result = await excludedDatabaseRowIds(stub, "user-1");

    expect(result).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("queries db_row_props scoped to the user and returns note ids when the flag is on and rows exist", async () => {
    vi.stubEnv("DATABASE_ROWS_ENABLED", "true");
    const { stub, from, select, eq } = makeSupabaseStub({
      data: [{ note_id: "row-1" }, { note_id: "row-2" }],
      error: null,
    });

    const result = await excludedDatabaseRowIds(stub, "user-1");

    expect(result).toEqual(["row-1", "row-2"]);
    expect(from).toHaveBeenCalledWith("db_row_props");
    expect(select).toHaveBeenCalledWith("note_id");
    expect(eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("returns null (not []) when the flag is on but the user has no database rows yet", async () => {
    vi.stubEnv("DATABASE_ROWS_ENABLED", "true");
    const { stub } = makeSupabaseStub({ data: [], error: null });

    const result = await excludedDatabaseRowIds(stub, "user-1");

    expect(result).toBeNull();
  });

  it("fails open (returns null) and logs when the Supabase query errors", async () => {
    vi.stubEnv("DATABASE_ROWS_ENABLED", "true");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { stub } = makeSupabaseStub({ data: null, error: { message: "relation does not exist" } });

    const result = await excludedDatabaseRowIds(stub, "user-1");

    expect(result).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
