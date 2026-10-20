import * as ReactNS from 'react';

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
	/** Every type this property may be changed into (backend Phase 0b, B5).
	 *
	 * Served with the property so the "Change type" list greys illegal rows
	 * against the SAME source of truth the PATCH enforces. Do not hardcode a
	 * client-side matrix — it would be a second copy and it would drift.
	 *
	 * OPTIONAL because it is DERIVED: the backend always sends it, but callers
	 * that construct a PropertyResponse locally (the public form page, test
	 * fixtures) legitimately have no conversion rules to state. Consumers
	 * default to `[]`, which greys every conversion — the safe direction. */
	convertible_to?: string[];
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
/** JSON mirror of `services.db.query.grouping.GroupBySpec` (task-15's
 * `QueryRequest.group_by`/`sub_group_by`, and the shape stored verbatim at
 * `ViewResponse.config.group_by`/`config.sub_group_by` — spec §10's "config
 * follows Notion's own Views API verbatim"). Only `property_key` is
 * required; everything else is per-type/optional exactly as the backend
 * dataclass documents.
 *
 * `group_order`/`group_order_manual`/`hidden_groups` (M6, 2026-09-01) are
 * UI-only additions living on this SAME object, per group-panel.md's own
 * capture (`config.group_by.group_order`, not a sibling config key) — but
 * they must NEVER reach `POST .../query`'s `group_by` field as-is:
 * `grouping.GroupBySpec` is a plain dataclass (`GroupBySpec(**body.
 * group_by)`), which raises `TypeError` on any unknown kwarg, surfaced as a
 * 400 that would break grouping entirely the moment any of these three is
 * ever set. `backendGroupBySpec` below is the one place that strips them
 * before a request goes out — every reader of this type must go through it
 * rather than forwarding `config.group_by` verbatim. */
export interface GroupBySpec {
	property_key: string;
	mode?: string;
	start_day_of_week?: number;
	range_start?: number | null;
	range_end?: number | null;
	range_size?: number | null;
	hide_empty_groups?: boolean;
	/** Group ORDERING (group-panel.md §A) — distinct from the view's row
	 * `Sort`. Defaults to "manual" when absent. */
	group_order?: "manual" | "alphabetical" | "reverse_alphabetical";
	/** Explicit group key order for `group_order: "manual"` — groups not
	 * listed here (e.g. a brand new option) sort after the ones that are. */
	group_order_manual?: string[];
	/** Group keys hidden from the table (per-group visibility, group-
	 * panel.md's per-group 👁/👁̸ toggle) — independent of `hide_empty_groups`,
	 * which hides only groups with zero rows. */
	hidden_groups?: string[];
}
/** JSON mirror of `GroupResult` (task-15's `QueryResponse.groups[]`).
 * `subgroups` is `null`/absent unless `sub_group_by` was requested, and —
 * same as the backend `Group` dataclass — never present on a subgroup
 * itself (sub-grouping is exactly two levels).
 *
 * `aggregates` (Milestone 10, task-32) is `undefined`/`null` whenever the
 * request's `aggregations` was empty (byte-identical to before that field
 * existed — see `AggregationSpec`'s own docstring on the backend); when
 * present it's one `{spec.key: value}` entry per requested aggregation,
 * computed from *this* group's own rows (or, for a subgroup entry, that
 * subgroup's own rows). Chart (task-35) is the first consumer — it always
 * requests exactly one aggregation keyed `"y"`, so `aggregates?.y` is the
 * bar/line-point/donut-slice value for that group. */
export interface Group {
	key: string;
	label: string;
	row_count: number;
	rows: DatabaseRow[];
	subgroups: Group[] | null;
	aggregates?: Record<string, number> | null;
}
declare function defaultGroupBySpec(property: Pick<PropertyResponse, "key" | "type">): GroupBySpec;
declare function getGroupBySpec(config: Record<string, unknown>): GroupBySpec | undefined;
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
export interface TitleValue {
	type: "title";
	title: string;
}
export interface RichTextValue {
	type: "rich_text";
	rich_text: string;
}
export interface NumberValue {
	type: "number";
	number: number | null;
}
export interface SelectValue {
	type: "select";
	select: string | null;
}
export interface MultiSelectValue {
	type: "multi_select";
	multi_select: string[];
}
export interface StatusValue {
	type: "status";
	status: string | null;
}
export interface DateValue {
	type: "date";
	date: {
		start: string;
		end: string | null;
		time_zone: string | null;
	} | null;
}
export interface CheckboxValue {
	type: "checkbox";
	checkbox: boolean;
}
export interface UrlValue {
	type: "url";
	url: string;
}
export interface EmailValue {
	type: "email";
	email: string;
}
export interface PhoneValue {
	type: "phone_number";
	phone_number: string;
}
/** Any wrapper shape not in the 8 above — rendered by the generic fallback cell. */
export interface UnknownValue {
	type: string;
	[key: string]: unknown;
}
export type PropertyValue = TitleValue | RichTextValue | NumberValue | SelectValue | MultiSelectValue | StatusValue | DateValue | CheckboxValue | UrlValue | EmailValue | PhoneValue | UnknownValue;
export type FilterArgType = "str" | "num" | "bool" | "date" | "uuid" | "uuid_or_me" | "str_or_list" | "verification_status" | "none";
export interface FilterOperator {
	name: string;
	argType: FilterArgType;
	/** Notion's own copy where captured (Text/Select's 8/4); our own
	 * plain-English equivalent, not captured, for the 10 extra Date
	 * operators our engine has that Notion's UI doesn't expose the same way. */
	label: string;
}
declare function isFilterableType(type: string): boolean;
declare function operatorsForType(type: string): FilterOperator[];
export declare const PLUGIN_API_VERSION = 1;
export type Unsubscribe = () => void;
/** A BlockNote block, as much of it as plugins can rely on. */
export interface Block {
	id: string;
	type: string;
	props?: Record<string, unknown>;
	content?: unknown;
	children?: Block[];
}
/** manifest.json, next to main.js. */
export interface PluginManifest {
	/** Stable, lowercase, dashes: "webmcp". Also the storage key. */
	id: string;
	name: string;
	version: string;
	description?: string;
	author?: string;
	/** Oldest app version that can run this plugin ("0.2.0"). */
	minAppVersion?: string;
	/** Plugin API version it was built against; defaults to 1. */
	apiVersion?: number;
}
/** What main.js must default-export. */
interface Plugin$1 {
	onload(api: PluginAPI): void | Promise<void>;
	/** Everything registered through `api` is undone by the host anyway;
	 *  this is for what the plugin set up on its own (timers, globals). */
	onunload?(): void;
}
/** Something on screen whose state changes while it stays open. `current()`
 *  is always the latest state; `subscribe` fires after it changed. */
export interface LiveHandle<S> {
	current(): S;
	subscribe(listener: () => void): Unsubscribe;
}
export interface NoteState {
	id: string;
	title: string;
	mastery: string | null;
	topics: string[];
}
export interface NoteHandle extends LiveHandle<NoteState> {
	/** The live document, unsaved edits included. Null while the editor mounts. */
	getBlocks(): Block[] | null;
	/** Parse Markdown and append it at the end of the note; it is saved. */
	appendMarkdown(markdown: string): Promise<void>;
	/** "not_started" | "learning" | "reviewing" | "mastered" */
	setMastery(status: string): Promise<void>;
}
export interface DatabaseState {
	name: string;
	dataSourceId: string;
	properties: PropertyResponse[];
	views: ViewResponse[];
	activeViewId: string | null;
	rows: DatabaseRow[];
	groups: Group[] | null;
}
export interface DatabaseHandle extends LiveHandle<DatabaseState> {
	/** Switch view exactly as clicking its tab does (the URL follows). */
	selectView(viewId: string): void;
	updateCell(rowId: string, propertyKey: string, value: PropertyValue | null): Promise<void>;
	updateView(viewId: string, patch: Record<string, unknown>): Promise<ViewResponse>;
	refetchRows(): Promise<void> | void;
}
/** A note or database page "opening" calls `cb` with its handle; what `cb`
 *  returns runs when that page closes. Already-open pages are reported at
 *  once, so a plugin enabled mid-session sees what is on screen. */
export type OpenCallback<H> = (handle: H) => void | (() => void);
export interface PluginAPI {
	apiVersion: number;
	appVersion: string;
	manifest: PluginManifest;
	/** The app's React. Plugins must not bundle their own (hooks would break). */
	react: typeof ReactNS;
	workspace: {
		onNoteOpen(cb: OpenCallback<NoteHandle>): Unsubscribe;
		onDatabaseOpen(cb: OpenCallback<DatabaseHandle>): Unsubscribe;
		/** Client-side navigation, e.g. navigate(`/brain/${noteId}`). */
		navigate(path: string): void;
	};
	ui: {
		/** A floating panel over the brain pages (bottom-right, stacked). */
		addPanel(id: string, render: () => ReactNS.ReactNode): Unsubscribe;
		/** A <style> owned by this plugin; removed when it unloads. */
		addStyle(css: string): Unsubscribe;
	};
	/** Small per-user key/value store for this plugin (this browser only). */
	storage: {
		get<T = unknown>(key: string): T | undefined;
		set(key: string, value: unknown): void;
	};
	/** App helpers plugins commonly need, so they stay in step with the app. */
	helpers: {
		calloutPalette: Record<string, {
			color: string;
			icon: string;
			label: string;
		}>;
		defaultGroupBySpec: typeof defaultGroupBySpec;
		getGroupBySpec: typeof getGroupBySpec;
		isFilterableType: typeof isFilterableType;
		operatorsForType: typeof operatorsForType;
	};
}

export {
	Plugin$1 as Plugin,
};

export {};
