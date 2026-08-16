// TypeScript mirrors of backend/models/database.py's Pydantic models
// (Milestone 2 — Notion-style databases). Field names and shapes match the
// backend exactly so `useDatabaseView` can treat a fetch response as this
// type with no per-field mapping. See backend/models/database.py for the
// authoritative docstrings this file doesn't repeat.

export interface DatabaseResponse {
  id: string;
  user_id: string;
  title: string;
  description: unknown[];
  icon: string | null;
  cover_url: string | null;
  is_inline: boolean;
  parent_note_id: string | null;
  is_locked: boolean;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface DataSourceResponse {
  id: string;
  database_id: string;
  user_id: string;
  name: string;
  system_kind: "notes" | null;
  position: number;
  created_at: string;
  /** True only for the synthesized "All Notes" source. */
  is_virtual: boolean;
}

export interface PropertyResponse {
  id: string;
  data_source_id: string;
  user_id: string;
  /** 8-char base62 key for jsonb-storage props; a `notes` column name for column-backed ones. */
  key: string;
  name: string;
  /** One of the REGISTRY type strings — see PROPERTY_TYPES below for the 8 this UI renders natively. */
  type: string;
  config: Record<string, unknown>;
  description: string | null;
  storage: "jsonb" | "column";
  column_name: string | null;
  result_type: string | null;
  is_volatile: boolean;
  position: number;
  created_at: string;
}

export interface ViewResponse {
  id: string;
  data_source_id: string;
  user_id: string;
  name: string;
  icon: string | null;
  type: string;
  config: Record<string, unknown>;
  filter: Record<string, unknown> | null;
  sorts: unknown[];
  is_locked: boolean;
  position: number;
}

export interface DatabaseDetailResponse {
  database: DatabaseResponse;
  data_source: DataSourceResponse;
  properties: PropertyResponse[];
  views: ViewResponse[];
}

/** JSON mirror of `services.db.query.grouping.GroupBySpec` (task-15's
 * `QueryRequest.group_by`/`sub_group_by`, and the shape stored verbatim at
 * `ViewResponse.config.group_by`/`config.sub_group_by` — spec §10's "config
 * follows Notion's own Views API verbatim"). Only `property_key` is
 * required; everything else is per-type/optional exactly as the backend
 * dataclass documents. */
export interface GroupBySpec {
  property_key: string;
  mode?: string;
  start_day_of_week?: number;
  range_start?: number | null;
  range_end?: number | null;
  range_size?: number | null;
  hide_empty_groups?: boolean;
}

/** JSON mirror of `GroupResult` (task-15's `QueryResponse.groups[]`).
 * `subgroups` is `null`/absent unless `sub_group_by` was requested, and —
 * same as the backend `Group` dataclass — never present on a subgroup
 * itself (sub-grouping is exactly two levels). */
export interface Group {
  key: string;
  label: string;
  row_count: number;
  rows: DatabaseRow[];
  subgroups: Group[] | null;
}

/** The property types `services.db.query.grouping.group_rows` can group a
 * Board view by without raising `ValueError`/`NotImplementedError` for a
 * missing mode (task-16-brief.md's "requires an existing groupable
 * property" — this app doesn't auto-create a status property the way
 * Notion does, so the Board-creation UI restricts its dropdown to these). */
export const GROUPABLE_PROPERTY_TYPES = ["select", "status", "multi_select"] as const;

export type GroupablePropertyType = (typeof GROUPABLE_PROPERTY_TYPES)[number];

export function isGroupablePropertyType(type: string): type is GroupablePropertyType {
  return (GROUPABLE_PROPERTY_TYPES as readonly string[]).includes(type);
}

/** Reads `config.group_by`/`config.sub_group_by` out of a view's opaque
 * `config` JSONB, tolerating a missing/malformed shape (undefined, not a
 * throw) — same "tolerates unknown... drops them at read" spirit spec §10
 * already states for view config generally. */
export function getGroupBySpec(config: Record<string, unknown>): GroupBySpec | undefined {
  const raw = config.group_by;
  if (raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).property_key === "string") {
    return raw as GroupBySpec;
  }
  return undefined;
}

export function getSubGroupBySpec(config: Record<string, unknown>): GroupBySpec | undefined {
  const raw = config.sub_group_by;
  if (raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).property_key === "string") {
    return raw as GroupBySpec;
  }
  return undefined;
}

/** One row's per-property values, keyed by `PropertyResponse.key`. Works for
 * both ordinary and virtual (All Notes) sources — see RowsResponse below.
 *
 * `cover_image_url` (task-17): a dedicated field, not a `properties[]` entry —
 * mirrors the backend's own choice (`routers/databases.py`'s
 * `_decode_all_notes_row`/`_decode_ordinary_row`, task-15's query endpoint)
 * to lift the `notes.cover_image_url` column out alongside `properties`
 * rather than exposing it as a new `COLUMN_BACKED` property, so it never
 * shows up as a Table/Board column. Only ever populated by `POST .../query`
 * (`useDatabaseView`'s `loadRows`) — `undefined` is the "this row came from
 * somewhere else, or the note has no cover" case; GalleryView's placeholder
 * treats both `undefined` and `null` the same way. */
export interface DatabaseRow {
  id: string;
  properties: Record<string, PropertyValue>;
  cover_image_url?: string | null;
}

export interface RowsResponse {
  rows: DatabaseRow[];
}

/** One row moved by a Milestone 7 dependency date-shift cascade — mirrors
 * `backend/models/database.py`'s `ShiftedRow` exactly. `properties` carries
 * only the one date property that moved, wrapped the same §3.3 way as any
 * other property value, so it merges into `DatabaseRow.properties` with the
 * same shape `updateCell` already handles for an ordinary write. */
export interface ShiftedRow {
  id: string;
  properties: Record<string, PropertyValue>;
}

export interface RowResponse {
  id: string;
  properties: Record<string, PropertyValue>;
  /** M7 combined-review Important finding 2: `PATCH .../rows/{note_id}`
   * returns this so a dependency cascade (edit row A's date, watch row B
   * move) can update the client without a refetch — non-`null`/non-`undefined`
   * only when this write triggered a cascade that actually moved rows.
   * `undefined` (the response omits the key entirely, since the backend's
   * `shifted_rows: list[ShiftedRow] | None = None` serialises an unset
   * `None` the same as an absent key over JSON) and `null` (an explicit
   * `None`) are both "no cascade" — `useDatabaseView`'s `updateCell` must
   * treat them the same. */
  shifted_rows?: ShiftedRow[] | null;
}

export interface RowPropertyUpdate {
  property_key: string;
  /** The same discriminated wrapper shape as a PropertyValue, or null to clear the property. */
  value: PropertyValue | null;
}

// ── Property value wrappers (spec §3.3's discriminated union) ─────────────
// Every cell value the backend returns is `{type: <type>, <type>: <inner>}`.
// These 8 are the ones this milestone renders with a dedicated cell
// component; any other `type` string falls back to a generic read-only
// rendering (see cells/GenericCell.tsx) rather than being dropped.

export interface TitleValue { type: "title"; title: string }
export interface RichTextValue { type: "rich_text"; rich_text: string }
export interface NumberValue { type: "number"; number: number | null }
export interface SelectValue { type: "select"; select: string | null }
export interface MultiSelectValue { type: "multi_select"; multi_select: string[] }
export interface StatusValue { type: "status"; status: string | null }
export interface DateValue {
  type: "date";
  date: { start: string; end: string | null; time_zone: string | null } | null;
}
export interface CheckboxValue { type: "checkbox"; checkbox: boolean }

/** Any wrapper shape not in the 8 above — rendered by the generic fallback cell. */
export interface UnknownValue {
  type: string;
  [key: string]: unknown;
}

export type PropertyValue =
  | TitleValue
  | RichTextValue
  | NumberValue
  | SelectValue
  | MultiSelectValue
  | StatusValue
  | DateValue
  | CheckboxValue
  | UnknownValue;

// ── Milestone 7: relations, sub-items, dependencies ────────────────────────
// Mirrors backend/models/database.py's RelatedRow/RelationLinksResponse
// (task-21) plus services.db.relations.DATE_SHIFT_MODES (task-20) — see
// backend/services/db/relations.py for the authoritative strings. Relation
// *values* never appear in DatabaseRow.properties (migration 015: they live
// in db_relation_links, not db_row_props.properties — see task-21-report.md
// judgement calls and task-22-report.md), so they get their own types here
// rather than joining the PropertyValue union above.

/** One linked row, as returned by every `.../relations/...` endpoint. */
export interface RelatedRow {
  id: string;
  title: string;
}

export interface RelationLinksResponse {
  rows: RelatedRow[];
}

/** `POST .../relations/{property_key}/links/bulk` (M7 combined-review
 * Important finding 3, the N+1 fix) — one entry per requested row id, keyed
 * by that row's own id, `[]` (not an absent key) for a row with no links.
 * Mirrors `backend/models/database.py`'s `RelationLinksBulkResponse`. */
export interface RelationLinksBulkResponse {
  links: Record<string, RelatedRow[]>;
}

/** `services.db.relations.DATE_SHIFT_MODES` verbatim — task-21-brief.md/
 * task-22-brief.md §4 both require these exact strings (not paraphrased)
 * to appear in the dependency settings UI. */
export const DATE_SHIFT_MODES = [
  "Shift only when dates overlap",
  "Shift & maintain time between items",
  "Do not automatically shift",
] as const;

export type DateShiftMode = (typeof DATE_SHIFT_MODES)[number];

/** The two `config.subtasks.display_mode` values this milestone renders
 * (research §3.4 also lists `hidden`/`disabled` — task-22-brief.md §3
 * explicitly scopes this task down to `show`/`flattened` only). Lives on
 * the *view's* config, not the property (research §3.2: the sub-item
 * property choice is data-source-global — there is exactly one sub-item
 * relation pair per data source, found via `config.system === "sub_item"`
 * on a `type: "relation"` property, not a per-view setting). */
export const SUBTASK_DISPLAY_MODES = ["show", "flattened"] as const;

export type SubtaskDisplayMode = (typeof SUBTASK_DISPLAY_MODES)[number];

/** Reads `config.subtasks.display_mode` out of a view's opaque `config`
 * JSONB, tolerating a missing/malformed shape — same spirit as
 * `getGroupBySpec`/`getSubGroupBySpec` above. */
export function getSubtaskDisplayMode(config: Record<string, unknown>): SubtaskDisplayMode | undefined {
  const raw = config.subtasks;
  if (raw && typeof raw === "object") {
    const mode = (raw as Record<string, unknown>).display_mode;
    if (typeof mode === "string" && (SUBTASK_DISPLAY_MODES as readonly string[]).includes(mode)) {
      return mode as SubtaskDisplayMode;
    }
  }
  return undefined;
}

/** Finds the one sub-item or dependency relation pair's forward/reverse
 * property on a data source's `properties[]`, by `config.system`/
 * `config.side` — mirrors how `routers/databases.py`'s own
 * `update_dependency_settings` looks up the forward dependency property.
 * `undefined` when the system relation hasn't been enabled yet. */
export function findSystemRelationProperty(
  properties: PropertyResponse[],
  system: "sub_item" | "dependency",
  side: "forward" | "reverse"
): PropertyResponse | undefined {
  return properties.find(
    (p) => p.type === "relation" && p.config?.system === system && p.config?.side === side
  );
}

/** The 8 property `type` strings this UI has a dedicated cell component for. */
export const KNOWN_PROPERTY_TYPES = [
  "title",
  "rich_text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
] as const;

export type KnownPropertyType = (typeof KNOWN_PROPERTY_TYPES)[number];

export function isKnownPropertyType(type: string): type is KnownPropertyType {
  return (KNOWN_PROPERTY_TYPES as readonly string[]).includes(type);
}
