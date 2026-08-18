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
  RelatedRow,
  RelationLinksBulkResponse,
  RelationLinksResponse,
  RowResponse,
  ViewResponse,
} from "./types";
import { getQueryExtras } from "./types";

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
  // Milestone 10 (task-35): the ungrouped counterpart of `Group.aggregates`
  // — populated only for a Chart view's "number" mode (no `group_by`, one
  // scalar over the whole filtered/sorted row set). `null` whenever the
  // active view's query had no `aggregations` or was grouped (aggregates
  // then live per-group in `groups[].aggregates` instead, never duplicated
  // here) — mirrors `QueryResponse.aggregates`'s own "`None` unless
  // ungrouped + aggregations" contract.
  const [aggregates, setAggregates] = useState<Record<string, number> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Milestone 7 (task-21/task-22): a relation property's value never lands
  // in `rows[i].properties` — migration 015 keeps `db_relation_links` as
  // the single source of truth, and `update_row_property` even rejects a
  // relation key outright (task-21-report.md). So relation values need
  // their own cache here, keyed by `${rowId}:${propertyKey}` (one row can
  // have more than one relation property, e.g. both "Sub-item" and
  // "Blocking" on the same data source) rather than living on `DatabaseRow`
  // itself. `undefined` for a key means "not fetched yet" — distinct from
  // `[]` ("fetched, no links") the same way `getGroupBySpec`-style helpers
  // above distinguish "absent" from "empty".
  const [relationLinks, setRelationLinksState] = useState<Record<string, RelatedRow[]>>({});

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
   * own "exactly one of rows/groups" response contract (task-15). Board and
   * Chart (task-35) both need extra request fields beyond filter/sorts —
   * `getQueryExtras` (types.ts) is the single dispatch point for that, so
   * this function doesn't grow an `if (type === X)` branch per view type;
   * every other view type gets `{}` back (byte-identical request body to
   * before Chart existed). */
  const loadRows = useCallback(async () => {
    if (!dataSource || !activeView) return;
    const body: Record<string, unknown> = {
      filter: activeView.filter ?? null,
      sorts: activeView.sorts ?? [],
      ...getQueryExtras(activeView),
    };

    const res = await fetch(`/api/db/data-sources/${dataSource.id}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(await errorMessage(res));
    const data: { rows?: DatabaseRow[]; groups?: Group[]; aggregates?: Record<string, number> } =
      await res.json();
    if (data.groups) {
      setGroups(data.groups);
      setRows([]);
      setAggregates(null);
    } else {
      setRows(data.rows ?? []);
      setGroups(null);
      setAggregates(data.aggregates ?? null);
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
   * unchanged from before this task.
   *
   * task-17 fix round, finding 3: the PATCH and the follow-up grouped
   * `loadRows()` are two *separate* failure modes, and only the first one
   * means the write didn't happen. Originally both were inside one
   * try/catch, so a `loadRows()` throw (e.g. a transient network blip on
   * the refetch, nothing wrong with the write itself) rolled `rows` back to
   * its pre-edit state and showed "could not save that change" — a lie:
   * the PATCH had already succeeded, the property really did change
   * server-side, only the client's picture of the new grouping is stale.
   * Splitting the two: a PATCH failure keeps the real rollback + real error
   * toast (unchanged); a post-success refetch failure does neither —
   * instead a milder "info" toast, since the write is real and rolling it
   * back client-side would be actively wrong (the next full reload would
   * show the change again, and the user would have no idea why "editing
   * again" mysteriously never seemed to fail). No retry loop here: a single
   * transient failure is common enough to not be worth toasting loudly
   * over, and a real outage will surface again on the next interaction (or
   * `refetch()`) rather than justifying open-ended retries inside a single
   * cell edit.
   *
   * M7 combined-review Important finding 2: `updated.shifted_rows` (a
   * dependency date-shift cascade's side effect, task-21-brief.md §4) used
   * to be silently dropped here -- the backend computed it correctly and
   * returned it, but nothing on this side ever read the field, so a
   * cascaded row (task B's date, moved because task A's date moved) stayed
   * visibly stale in an ungrouped Table view until a full reload. Each
   * `ShiftedRow.properties` carries only the one date property that moved
   * (not a full row), so it's *merged* into that row's existing
   * `properties`, not a wholesale replace. */
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

    let updated: RowResponse;
    try {
      const res = await fetch(`/api/db/data-sources/${dataSource.id}/rows/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ property_key: propertyKey, value }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      updated = await res.json();
    } catch (e) {
      setRows(previousRows);
      showToast(e instanceof Error ? e.message : "Could not save that change", "error");
      return;
    }

    // The write itself is done and confirmed at this point — nothing below
    // this line rolls it back.
    const shiftedById = new Map((updated.shifted_rows ?? []).map((s) => [s.id, s.properties]));
    setRows((prev) =>
      prev.map((row) => {
        if (row.id === updated.id) return { id: updated.id, properties: updated.properties };
        const shifted = shiftedById.get(row.id);
        // Merge, not replace: a ShiftedRow only ever carries the one date
        // property the cascade moved, not the row's other properties.
        return shifted ? { ...row, properties: { ...row.properties, ...shifted } } : row;
      })
    );

    if (wasGrouped) {
      try {
        await loadRows();
      } catch (e) {
        showToast(
          e instanceof Error
            ? `Saved, but the board view may be out of date: ${e.message}`
            : "Saved, but the board view may be out of date — refresh to see the latest.",
          "info"
        );
      }
    }
  }

  function relationCacheKey(rowId: string, propertyKey: string): string {
    return `${rowId}:${propertyKey}`;
  }

  /** Lazily fetches one row/property's linked rows (with titles —
   * `GET .../relations/{property_key}`) into `relationLinks`, unless
   * already cached. `RelationCell` calls this once on mount so its chips
   * have something to render; the sub-item tree builder in `TableView`
   * calls it up front for every row it needs a parent/child answer for.
   * No-op (not an error) when the key is already cached — this is a cache
   * warm, not a refresh; call `refetchRows`/`refetch` for that. */
  const ensureRelationLinks = useCallback(
    async (rowId: string, propertyKey: string) => {
      if (!dataSource) return;
      const key = relationCacheKey(rowId, propertyKey);
      if (key in relationLinks) return;
      try {
        const res = await fetch(
          `/api/db/data-sources/${dataSource.id}/rows/${rowId}/relations/${propertyKey}`
        );
        if (!res.ok) throw new Error(await errorMessage(res));
        const data: RelationLinksResponse = await res.json();
        setRelationLinksState((prev) => ({ ...prev, [key]: data.rows }));
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Could not load related rows", "error");
      }
    },
    [dataSource, relationLinks, showToast]
  );

  /** Bulk form of `ensureRelationLinks` above — `POST .../relations/
   * {property_key}/links/bulk` (M7 combined-review Important finding 3:
   * the N+1 fix). `TableView`'s sub-item tree pre-fetch used to call
   * `ensureRelationLinks` once per visible row, issuing one HTTP request
   * per row even though `services.db.relations.list_links_bulk` (built by
   * task 20 for exactly this) was sitting there unused. This warms the
   * same `relationLinks` cache, same key shape, same "cached entries are a
   * no-op" contract — only the ids not already cached are actually
   * requested, and only one request is made regardless of how many ids
   * that is (up to the backend's own `_BULK_RELATION_ROW_IDS_LIMIT`). A
   * no-op for an empty `rowIds` (nothing to ask about) rather than an
   * empty-body request. */
  const ensureRelationLinksBulk = useCallback(
    async (rowIds: string[], propertyKey: string) => {
      if (!dataSource) return;
      const missing = rowIds.filter((rowId) => !(relationCacheKey(rowId, propertyKey) in relationLinks));
      if (missing.length === 0) return;
      try {
        const res = await fetch(
          `/api/db/data-sources/${dataSource.id}/relations/${propertyKey}/links/bulk`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ row_ids: missing }),
          }
        );
        if (!res.ok) throw new Error(await errorMessage(res));
        const data: RelationLinksBulkResponse = await res.json();
        setRelationLinksState((prev) => {
          const next = { ...prev };
          for (const [rowId, rows] of Object.entries(data.links)) {
            next[relationCacheKey(rowId, propertyKey)] = rows;
          }
          return next;
        });
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Could not load related rows", "error");
      }
    },
    [dataSource, relationLinks, showToast]
  );

  /** Replaces one row/property's whole link list — `PUT
   * .../relations/{property_key}` (task-21). Optimistic update, then
   * write, then reconcile with the server's response (its own current
   * link list, per `RelationLinksResponse`'s contract); rollback + error
   * toast on a failed write, same shape as `updateCell` above.
   *
   * Unlike `updateCell`, the PUT response is already the reconciled truth
   * — no separate read is needed to know the new link list. But a
   * relation write can still change what the *rest* of the table should
   * show (most concretely: editing the sub-item relation changes which
   * rows are parents/children, which `TableView`'s tree builder derives
   * from `rows`, not from `relationLinks` alone) — so, same as
   * `updateCell`'s grouped-view case, a `refetchRows()` follows a
   * successful write. Copying `updateCell`'s hard-won split (task-17 fix
   * round, finding 3) rather than re-deriving it: if that follow-up
   * refetch itself fails, the already-successful write must NOT be rolled
   * back and must NOT show a false "could not save" error — only a milder
   * "saved, but may be out of date" info toast. */
  async function setRelationLinks(rowId: string, propertyKey: string, rows: RelatedRow[]) {
    if (!dataSource) return;
    const key = relationCacheKey(rowId, propertyKey);
    const hadPrevious = key in relationLinks;
    const previous = relationLinks[key];

    setRelationLinksState((prev) => ({ ...prev, [key]: rows }));

    let result: RelationLinksResponse;
    try {
      const res = await fetch(
        `/api/db/data-sources/${dataSource.id}/rows/${rowId}/relations/${propertyKey}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ row_ids: rows.map((r) => r.id) }),
        }
      );
      if (!res.ok) throw new Error(await errorMessage(res));
      result = await res.json();
    } catch (e) {
      setRelationLinksState((prev) => {
        const next = { ...prev };
        if (hadPrevious) next[key] = previous!;
        else delete next[key];
        return next;
      });
      showToast(e instanceof Error ? e.message : "Could not save that change", "error");
      return;
    }

    // The write itself is done and confirmed at this point — nothing below
    // this line rolls it back.
    setRelationLinksState((prev) => ({ ...prev, [key]: result.rows }));

    try {
      await loadRows();
    } catch (e) {
      showToast(
        e instanceof Error
          ? `Saved, but some rows may be out of date: ${e.message}`
          : "Saved, but some rows may be out of date — refresh to see the latest.",
        "info"
      );
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
    aggregates,
    loading,
    error,
    updateCell,
    relationLinks,
    ensureRelationLinks,
    ensureRelationLinksBulk,
    setRelationLinks,
    createView,
    updateView,
    refetch: load,
    // `load` only re-fetches database/properties/views — `loadRows`'s own
    // effect is keyed to activeView's id/type/filter/sorts/config, none of
    // which change when a row is merely added or removed, so it never
    // re-runs on its own after a write that only affects row *data*.
    // Exposed separately (not folded into `refetch`) so a caller that only
    // changed a property doesn't pay for an unnecessary rows re-query, and
    // a caller that only added/removed a row doesn't pay for an
    // unnecessary properties re-fetch.
    refetchRows: loadRows,
  };
}
