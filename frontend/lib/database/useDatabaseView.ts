"use client";

// Data-fetching hook for one database's active view — mirrors the shape and
// conventions of lib/hooks/useNotes.ts: "use client", useState/useEffect/
// useCallback, plain fetch against this app's own /api routes (auth is
// handled by app/api/db/[...path]/route.ts, so no token handling here).
//
// Task-16: row-fetching moved from the unconditional `GET .../rows` to the
// filtered/sorted/(optionally) grouped `POST .../query` endpoint task-15
// built, driven by whichever view is currently active. `rows` stays
// populated for an ungrouped view (byte-identical shape to the old `GET
// .../rows` response, per task-15's own contract); a new `groups` is
// populated instead for a grouped (Board) view — the backend already does
// the grouping work, so this hook never re-derives it client-side.
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/app/providers";
import type {
  DatabaseDetailResponse,
  DatabaseRow,
  DatabaseResponse,
  DataSourceResponse,
  Group,
  PropertyResponse,
  PropertyValue,
  RowResponse,
  ViewResponse,
} from "./types";
import { getGroupBySpec, getSubGroupBySpec } from "./types";

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

/** Fields `PATCH /db/views/{id}` (Milestone 2, `_VIEW_UPDATABLE_FIELDS`)
 * accepts. `id`/`data_source_id`/`user_id` are never patchable. */
type ViewPatch = Partial<
  Pick<ViewResponse, "name" | "icon" | "config" | "filter" | "sorts" | "is_locked" | "position">
>;

export function useDatabaseView(databaseId: string) {
  const { showToast } = useToast();

  const [database, setDatabase] = useState<DatabaseResponse | null>(null);
  const [dataSource, setDataSource] = useState<DataSourceResponse | null>(null);
  const [properties, setProperties] = useState<PropertyResponse[]>([]);
  const [views, setViews] = useState<ViewResponse[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [rows, setRows] = useState<DatabaseRow[]>([]);
  const [groups, setGroups] = useState<Group[] | null>(null);
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
      // Keep the current tab selected across a refetch of the same
      // database (e.g. after a property change) if it still exists;
      // otherwise (first load, or a still-mounted hook pointed at a new
      // databaseId) fall back to the first view.
      setActiveViewId((prev) =>
        prev && detail.views.some((v) => v.id === prev) ? prev : (detail.views[0]?.id ?? null)
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [databaseId]);

  useEffect(() => {
    load();
  }, [load]);

  const activeView = views.find((v) => v.id === activeViewId) ?? null;

  /** Runs `activeView`'s filter/sorts/group_by through `POST .../query`
   * and populates exactly one of `rows`/`groups`, mirroring the endpoint's
   * own "exactly one of rows/groups" response contract (task-15). Only
   * board views pass group_by/sub_group_by — every other view type queries
   * ungrouped, same as the old unconditional `GET .../rows` did. */
  const loadRows = useCallback(async () => {
    if (!dataSource || !activeView) return;
    const body: Record<string, unknown> = {
      filter: activeView.filter ?? null,
      sorts: activeView.sorts ?? [],
    };
    if (activeView.type === "board") {
      const groupBy = getGroupBySpec(activeView.config);
      const subGroupBy = getSubGroupBySpec(activeView.config);
      if (groupBy) body.group_by = groupBy;
      if (subGroupBy) body.sub_group_by = subGroupBy;
    }

    const res = await fetch(`/api/db/data-sources/${dataSource.id}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const data: { rows?: DatabaseRow[]; groups?: Group[] } = await res.json();
    if (data.groups) {
      setGroups(data.groups);
      setRows([]);
    } else {
      setRows(data.rows ?? []);
      setGroups(null);
    }
  }, [dataSource, activeView]);

  useEffect(() => {
    loadRows().catch((e) => {
      setError(e instanceof Error ? e.message : "Unknown error");
    });
    // activeView is an object pulled fresh from `views` on every render;
    // depending on its id/filter/sorts/config (rather than the object
    // itself) avoids re-fetching on every unrelated re-render while still
    // refetching whenever the query-relevant shape actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dataSource?.id,
    activeView?.id,
    activeView?.type,
    JSON.stringify(activeView?.filter ?? null),
    JSON.stringify(activeView?.sorts ?? []),
    JSON.stringify(activeView?.config ?? {}),
  ]);

  /** Update one property on one row: optimistic update, then PATCH; on any
   * non-ok response (a 500, or the 501 the All Notes virtual source returns
   * for writes) roll the row back to its pre-edit state and toast — the
   * milestone's explicit test case. `value: null` clears the property.
   *
   * When the active view is grouped (Board), a successful write is
   * followed by a re-query rather than a client-side group move — the
   * backend already computed the grouping once (task-15), so this doesn't
   * duplicate that logic to guess which column a row belongs in now; it
   * just asks again. Table's (ungrouped) `rows` keeps updating in place,
   * unchanged from before this task. */
  async function updateCell(rowId: string, propertyKey: string, value: PropertyValue | null) {
    if (!dataSource) return;
    const previousRows = rows;
    const wasGrouped = groups !== null;

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
        prev.map((row) => (row.id === updated.id ? { id: updated.id, properties: updated.properties } : row))
      );
      if (wasGrouped) {
        await loadRows();
      }
    } catch (e) {
      setRows(previousRows);
      showToast(e instanceof Error ? e.message : "Could not save that change", "error");
    }
  }

  /** `POST /db/data-sources/{id}/views` (task-15) — the first way to
   * create a non-default view. Appends to local `views` state; does not
   * switch `activeViewId` itself, leaving sequencing (e.g. "create, then
   * set a Board's group_by via updateView, then switch to it") to the
   * caller. */
  async function createView(name: string, type: string, icon: string | null = null): Promise<ViewResponse> {
    if (!dataSource) throw new Error("No data source loaded yet");
    const res = await fetch(`/api/db/data-sources/${dataSource.id}/views`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, type, icon }),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const created: ViewResponse = await res.json();
    setViews((prev) => [...prev, created]);
    return created;
  }

  /** `PATCH /db/views/{id}` (Milestone 2) — partial update, e.g. setting a
   * Board's `config.group_by` right after creation, or flipping
   * `config.group_by.hide_empty_groups`. */
  async function updateView(viewId: string, patch: ViewPatch): Promise<ViewResponse> {
    const res = await fetch(`/api/db/views/${viewId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const updated: ViewResponse = await res.json();
    setViews((prev) => prev.map((v) => (v.id === viewId ? updated : v)));
    return updated;
  }

  return {
    database,
    dataSource,
    properties,
    views,
    activeViewId,
    setActiveViewId,
    rows,
    groups,
    loading,
    error,
    updateCell,
    createView,
    updateView,
    refetch: load,
  };
}
