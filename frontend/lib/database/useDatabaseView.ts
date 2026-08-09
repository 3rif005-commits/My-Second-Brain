"use client";

// Data-fetching hook for one database's table view — mirrors the shape and
// conventions of lib/hooks/useNotes.ts: "use client", useState/useEffect/
// useCallback, plain fetch against this app's own /api routes (auth is
// handled by app/api/db/[...path]/route.ts, so no token handling here).
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/app/providers";
import type {
  DatabaseDetailResponse,
  DatabaseRow,
  DatabaseResponse,
  DataSourceResponse,
  PropertyResponse,
  PropertyValue,
  RowResponse,
  ViewResponse,
} from "./types";

/** Best-effort extraction of a human-readable message from a failed
 * fetch's body — FastAPI's HTTPException responses are `{"detail": "..."}`,
 * this proxy's own 401/503 shapes are `{"error": "..."}`. Falls back to a
 * generic message that still includes the status code. */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
    if (typeof body?.error === "string") return body.error;
  } catch {
    // body wasn't JSON (or was empty) — fall through to the generic message
  }
  return `Request failed (${res.status})`;
}

export function useDatabaseView(databaseId: string) {
  const { showToast } = useToast();

  const [database, setDatabase] = useState<DatabaseResponse | null>(null);
  const [dataSource, setDataSource] = useState<DataSourceResponse | null>(null);
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [views, setViews] = useState<ViewResponse[]>([]);
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detailRes = await fetch(`/api/db/databases/${databaseId}`);
      if (!detailRes.ok) throw new Error(await errorMessage(detailRes));
      const detail: DatabaseDetailResponse = await detailRes.json();
      setDatabase(detail.database);
      setDataSource(detail.data_source);
      setProperties(detail.properties);
      setViews(detail.views);

      const rowsRes = await fetch(`/api/db/data-sources/${detail.data_source.id}/rows`);
      if (!rowsRes.ok) throw new Error(await errorMessage(rowsRes));
      const rowsData: { rows: DatabaseRow[] } = await rowsRes.json();
      setRows(rowsData.rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [databaseId]);

  useEffect(() => {
    load();
  }, [load]);

  /** Update one property on one row: optimistic update, then PATCH; on any
   * non-ok response (a 500, or the 501 the All Notes virtual source returns
   * for writes) roll the row back to its pre-edit state and toast — the
   * milestone's explicit test case. `value: null` clears the property. */
  async function updateCell(rowId: string, propertyKey: string, value: PropertyValue | null) {
    if (!dataSource) return;
    const previousRows = rows;

    setRows((prev) =>
      prev.map((row) => {
        if (row.id !== rowId) return row;
        if (value === null) {
          const { [propertyKey]: _omit, ...rest } = row.properties;
          return { ...row, properties: rest };
        }
        return { ...row, properties: { ...row.properties, [propertyKey]: value } };
      })
    );

    try {
      const res = await fetch(`/api/db/data-sources/${dataSource.id}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_key: propertyKey, value }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      const updated: RowResponse = await res.json();
      setRows((prev) =>
        prev.map((row) => (row.id === rowId ? { id: updated.id, properties: updated.properties } : row))
      );
    } catch (e) {
      setRows(previousRows);
      showToast(e instanceof Error ? e.message : "Could not save that change", "error");
    }
  }

  return {
    database,
    dataSource,
    properties,
    views,
    rows,
    loading,
    error,
    updateCell,
    refetch: load,
  };
}
