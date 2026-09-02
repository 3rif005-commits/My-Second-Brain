"use client";

// Research: "structurally identical to Board minus grouping" — this is
// `rows` (the ungrouped shape task-15's query endpoint already returns
// when no `group_by` is sent, same as TableView) rendered as a card grid
// instead of a table/columns. No drag-and-drop, no groups.
//
// Card cover (task-17-brief.md's original scope call): `page_cover` mode —
// `row.cover_image_url` (task-17's dedicated field on `DatabaseRow`, lifted
// server-side from the `notes.cover_image_url` column, see
// `routers/databases.py`'s decode functions and `services/db/query/
// builder.py`'s `_columns()`) — was the only source built at first. M12
// (Gallery's own dedicated work, 2026-09-02, live-captured against real
// Notion's Layout panel) added the other two real options: "None" (no image
// slot) and a picked `files`-type property (`extractFileUrl` below). "Page
// content" (Notion's own default — "uses first block on the page") is still
// NOT offered: it needs parsing block content for a first image, a real
// build cost this workstream keeps flagging and skipping wherever it comes
// up, not just here. A card with no resolved image (whichever source is
// configured) renders a plain neutral placeholder, never broken layout.
//
// `cover_size`/`cover_aspect`/`card_layout`/`card_preview` are opaque
// strings in `activeView.config`, persisted via the same `PATCH
// /db/views/{id}` DatabaseShell already wires up for Board's
// `hide_empty_groups` — this component receives the current `config` and
// reports changes through `onConfigChange`, leaving the actual PATCH call
// (and merging into the rest of `config`) to DatabaseShell, exactly like
// Board's `onToggleHideEmptyGroups`.
//
// Hide-title (research: "Gallery-specific affordance for pure image
// grids"): TableView has no existing `properties[].visible` column-
// visibility mechanism to reuse (checked before writing this — Milestone 3+
// scope, not built yet), so this uses the brief's documented fallback: a
// per-view `config.hidden_properties: string[]` of property keys, title's
// included when hidden. A minimal, documented simplification — not a
// general column-visibility feature.
//
// Click-to-open (task-17 fix round, finding 1): a small `OpenNoteButton`,
// not the whole card — the title is rendered through TitleCell
// (`renderCellValue`), whose own click starts inline editing, so making the
// whole card navigate would fire both on a title click. See
// `OpenNoteButton.tsx` for the full reasoning (same call as BoardView). M12
// (2026-09-02) moved it (plus a new `RowMenuTrigger` "···") off the cover
// and onto the card itself, hover-revealed via `HoverAffordance` — real
// Notion's live capture shows both icons appearing on hover regardless of
// whether a card even HAS a cover (`Card preview: None` still shows them),
// and previously they were always-visible, not hover-gated at all. Also
// closed the row menu gap the M12 code survey named: "Board and Gallery
// have [OpenNoteButton]... none has the gutter, bulk bar, or row menu at
// all" — Gallery cards had zero access to Favorites/Copy link/Move to
// Trash/etc. before this.
import { MoreHorizontal } from "lucide-react";
import type { DatabaseRow, PropertyResponse, PropertyValue } from "@/lib/database/types";
import { orderProperties } from "@/lib/database/viewConfig";
import { useRowPeek } from "@/lib/database/useRowPeek";
import { HoverAffordance } from "@/components/ui/primitives";
import { renderCellValue } from "../cells/renderCellValue";
import { OpenNoteButton } from "../OpenNoteButton";
import { RowMenuTrigger } from "../RowMenuTrigger";
import { RowPeek } from "../RowPeek";

const COVER_SIZES = ["small", "medium", "large"] as const;
type CoverSize = (typeof COVER_SIZES)[number];

const COVER_ASPECTS = ["contain", "cover"] as const;
type CoverAspect = (typeof COVER_ASPECTS)[number];

const CARD_LAYOUTS = ["list", "compact"] as const;
type CardLayout = (typeof CARD_LAYOUTS)[number];

const COVER_SIZE_CLASSES: Record<CoverSize, string> = {
  small: "w-40",
  medium: "w-56",
  large: "w-72",
};

function readCoverSize(config: Record<string, unknown>): CoverSize {
  return (COVER_SIZES as readonly string[]).includes(config.cover_size as string)
    ? (config.cover_size as CoverSize)
    : "medium";
}

function readCoverAspect(config: Record<string, unknown>): CoverAspect {
  return (COVER_ASPECTS as readonly string[]).includes(config.cover_aspect as string)
    ? (config.cover_aspect as CoverAspect)
    : "cover";
}

function readCardLayout(config: Record<string, unknown>): CardLayout {
  return (CARD_LAYOUTS as readonly string[]).includes(config.card_layout as string)
    ? (config.card_layout as CardLayout)
    : "list";
}

function readHiddenProperties(config: Record<string, unknown>): string[] {
  return Array.isArray(config.hidden_properties)
    ? (config.hidden_properties as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
}

/** M12 (Gallery's own dedicated work) — real Notion's "Card preview" setting
 * (Layout panel, captured live 2026-09-02): None / Page cover / a picked
 * `files`-type property / Page content ("Uses first block on the page").
 * Page content is deliberately NOT offered — it needs parsing block content
 * for a first image, the same real build cost this workstream has already
 * flagged and skipped elsewhere (task-17-brief.md's own original call for
 * this file). Default is "cover" — NOT Notion's own "Page content" default —
 * because `row.cover_image_url` is the one real image source this schema
 * actually has; defaulting to an unbuilt source would silently blank every
 * existing Gallery view's cards. A stale/invalid config value (a property
 * that no longer exists, or isn't `files`-typed) falls back to "cover",
 * same defensive pattern as `readCoverSize`/`readCoverAspect` above. */
function readCardPreview(config: Record<string, unknown>, filesProperties: PropertyResponse[]): string {
  const raw = config.card_preview;
  if (raw === "none") return "none";
  if (typeof raw === "string" && filesProperties.some((p) => p.key === raw)) return raw;
  return "cover";
}

/** A `files` value's wire shape (`services/db/recompute.py`'s own words):
 * "a files entry may be a bare string or an object with a url/name field."
 * No dedicated `FilesValue` type exists anywhere in this app yet (no
 * `FilesCell` editor either — `renderCellValue` falls through to
 * `GenericCell`), so this parses defensively rather than assuming a shape. */
function extractFileUrl(value: PropertyValue | undefined): string | undefined {
  const raw = value && typeof value === "object" && "files" in value ? (value as { files?: unknown }).files : undefined;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const first = raw[0];
  if (typeof first === "string") return first;
  if (first && typeof first === "object") {
    const url = (first as Record<string, unknown>).url;
    if (typeof url === "string") return url;
  }
  return undefined;
}

function CoverPlaceholder() {
  return (
    <div
      data-testid="cover-placeholder"
      className="w-full h-full flex items-center justify-center bg-gray-100 dark:bg-gray-800 text-gray-300 dark:text-gray-600"
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    </div>
  );
}

function GalleryCard({
  row,
  properties,
  otherProps,
  editable,
  onCellChange,
  coverSize,
  coverAspect,
  cardLayout,
  cardPreview,
  hiddenProperties,
  onOpenRow,
  isPeekOpen,
  onOpenSidePeek,
  onTrashed,
}: {
  row: DatabaseRow;
  properties: PropertyResponse[];
  /** M12: precomputed by `GalleryView` via `viewConfig.ts`'s
   * `orderProperties` — Gallery's own `hidden_properties` reading (which
   * ALSO allows hiding the title, a deliberate difference from Table/List/
   * Board/Feed, left untouched) already worked; `property_order` never did,
   * cards stayed in schema `position` order regardless of a drag-reorder in
   * the Property Visibility panel. */
  otherProps: PropertyResponse[];
  editable: boolean;
  onCellChange: GalleryViewProps["onCellChange"];
  coverSize: CoverSize;
  coverAspect: CoverAspect;
  cardLayout: CardLayout;
  /** "cover" (this schema's real image source, `row.cover_image_url`),
   * "none" (no image slot at all), or a `files`-property key. */
  cardPreview: string;
  hiddenProperties: string[];
  /** M12: `useRowPeek`'s own `openRow`/`peekRowId` — threaded down instead
   * of a bare `useOpenNote` navigation, so a Gallery card respects the
   * view's "Open pages in" default the same way Table/List/Feed/Board do.
   * Gallery's own dedicated-work session (2026-09-02) fixed the same
   * OPEN/CLOSE-doesn't-actually-toggle bug M10 already fixed once for
   * Table (row-peek.md) — this now receives `toggleRow`, not bare
   * `openRow`, from `GalleryView`. */
  onOpenRow?: (noteId: string) => void;
  isPeekOpen?: boolean;
  /** M12 (Gallery's own dedicated work, 2026-09-02): real Notion's card
   * hover reveals a pencil ("open") icon AND a separate "···" row-menu
   * trigger, top-right — confirmed by live capture, `row-affordances.md`'s
   * new "Gallery view" section. Previously ABSENT entirely (Board/Gallery
   * were the two views the M12 code survey named as having no row menu at
   * all). Optional so a caller that omits it (none today) gets no menu,
   * matching every other optional row-peek prop's graceful-fallback
   * convention in this file. */
  onOpenSidePeek?: (rowId: string) => void;
  onTrashed?: () => void | Promise<void>;
}) {
  const titleProp = properties.find((p) => p.type === "title");
  const titleHidden = titleProp ? hiddenProperties.includes(titleProp.key) : false;
  const coverUrl =
    cardPreview === "cover"
      ? row.cover_image_url ?? undefined
      : cardPreview === "none"
        ? undefined
        : extractFileUrl(row.properties[cardPreview]);

  return (
    <div
      className={`group relative ${COVER_SIZE_CLASSES[coverSize]} shrink-0 rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden`}
    >
      {/* Real Notion (live capture, 2026-09-02): both icons are hover-only,
        * top-right of the WHOLE card — not anchored to the cover, since
        * "Card preview: None" removes the cover entirely but the icons
        * still appear. */}
      <HoverAffordance className="absolute top-1 right-1 z-10 flex items-center gap-0.5">
        <OpenNoteButton noteId={row.id} onOpen={onOpenRow} isOpen={onOpenRow ? isPeekOpen : undefined} />
        {onOpenSidePeek && (
          <RowMenuTrigger
            rowId={row.id}
            onOpenSidePeek={onOpenSidePeek}
            onTrashed={onTrashed ?? (() => {})}
            trigger={
              <button
                type="button"
                aria-label="Row options"
                aria-haspopup="menu"
                className="flex h-5 w-5 items-center justify-center rounded bg-white/80 dark:bg-gray-900/80 text-gray-500 hover:bg-white hover:text-gray-800 dark:hover:bg-gray-900 dark:hover:text-gray-100"
              >
                <MoreHorizontal size={13} />
              </button>
            }
          />
        )}
      </HoverAffordance>

      {cardPreview !== "none" && (
        <div className="relative aspect-video">
          {coverUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary
            // user-provided URLs, not a local/optimizable asset Next's <Image>
            // is built for.
            <img
              src={coverUrl}
              alt="Cover"
              className={`w-full h-full ${coverAspect === "contain" ? "object-contain" : "object-cover"}`}
            />
          ) : (
            <CoverPlaceholder />
          )}
        </div>
      )}
      <div className={cardLayout === "compact" ? "p-1.5" : "p-2.5"}>
        {!titleHidden && titleProp && (
          <div className="text-sm font-medium mb-1 text-gray-900 dark:text-gray-100 truncate">
            {renderCellValue(titleProp, row.properties[titleProp.key], editable, (value) =>
              onCellChange(row.id, titleProp.key, value)
            )}
          </div>
        )}
        {cardLayout === "list" ? (
          <div className="space-y-1">
            {otherProps.map((p) => (
              <div key={p.key} className="text-xs flex items-start gap-1">
                <span className="text-gray-400 shrink-0">{p.name}:</span>
                <span className="min-w-0 flex-1 truncate">
                  {renderCellValue(p, row.properties[p.key], editable, (value) =>
                    onCellChange(row.id, p.key, value)
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          otherProps.length > 0 && (
            <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">
              {otherProps
                .map((p) => {
                  const v = row.properties[p.key];
                  const text =
                    v && typeof v === "object" && "type" in v
                      ? (v as Record<string, unknown>)[v.type]
                      : undefined;
                  return typeof text === "string" || typeof text === "number" ? String(text) : null;
                })
                .filter(Boolean)
                .join(" · ")}
            </div>
          )
        )}
      </div>
    </div>
  );
}

export interface GalleryViewProps {
  properties: PropertyResponse[];
  rows: DatabaseRow[];
  editable: boolean;
  onCellChange: (rowId: string, propertyKey: string, value: PropertyValue | null) => void;
  config: Record<string, unknown>;
  onConfigChange: (patch: Record<string, unknown>) => void;
  dataSourceId?: string;
  refetch?: () => void | Promise<void>;
}

export function GalleryView({
  properties,
  rows,
  editable,
  onCellChange,
  config,
  onConfigChange,
  dataSourceId,
  refetch,
}: GalleryViewProps) {
  const { peekRowId, peekMode, openRow, closePeek, toggleRow } = useRowPeek(config);
  const coverSize = readCoverSize(config);
  const coverAspect = readCoverAspect(config);
  const cardLayout = readCardLayout(config);
  const filesProperties = properties.filter((p) => p.type === "files");
  const cardPreview = readCardPreview(config, filesProperties);
  const hiddenProperties = readHiddenProperties(config);
  const titleProp = properties.find((p) => p.type === "title");
  const titleHidden = titleProp ? hiddenProperties.includes(titleProp.key) : false;
  const otherProps = orderProperties(properties, config).filter(
    (p) => p.type !== "title" && !hiddenProperties.includes(p.key)
  );
  const peekRow = peekRowId ? rows.find((r) => r.id === peekRowId) : undefined;

  function toggleHideTitle() {
    if (!titleProp) return;
    const next = titleHidden
      ? hiddenProperties.filter((k) => k !== titleProp.key)
      : [...hiddenProperties, titleProp.key];
    onConfigChange({ hidden_properties: next });
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 flex items-center gap-3 flex-wrap border-b border-gray-100 dark:border-gray-800 shrink-0 text-xs text-gray-500 dark:text-gray-400">
        <label className="flex items-center gap-1.5">
          Card preview
          <select
            aria-label="Card preview"
            value={cardPreview}
            onChange={(e) => onConfigChange({ card_preview: e.target.value })}
            className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            <option value="cover">Page cover</option>
            <option value="none">None</option>
            {filesProperties.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Cover size
          <select
            aria-label="Cover size"
            value={coverSize}
            onChange={(e) => onConfigChange({ cover_size: e.target.value })}
            className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            {COVER_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Cover fit
          <select
            aria-label="Cover fit"
            value={coverAspect}
            onChange={(e) => onConfigChange({ cover_aspect: e.target.value })}
            className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            {COVER_ASPECTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Layout
          <select
            aria-label="Card layout"
            value={cardLayout}
            onChange={(e) => onConfigChange({ card_layout: e.target.value })}
            className="px-1.5 py-0.5 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          >
            {CARD_LAYOUTS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        {titleProp && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={titleHidden} onChange={toggleHideTitle} />
            Hide title
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-sm text-gray-400 dark:text-gray-500">
          No rows yet.
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto flex flex-wrap gap-3 p-3 content-start">
          {rows.map((row) => (
            <GalleryCard
              key={row.id}
              row={row}
              properties={properties}
              otherProps={otherProps}
              editable={editable}
              onCellChange={onCellChange}
              coverSize={coverSize}
              coverAspect={coverAspect}
              cardLayout={cardLayout}
              cardPreview={cardPreview}
              hiddenProperties={hiddenProperties}
              onOpenRow={toggleRow}
              isPeekOpen={peekRowId === row.id}
              onOpenSidePeek={(id) => openRow(id, "side")}
              onTrashed={() => refetch?.()}
            />
          ))}
        </div>
      )}

      {peekRow && (
        <RowPeek
          row={peekRow}
          properties={properties}
          editable={editable}
          onCellChange={onCellChange}
          onClose={closePeek}
          mode={peekMode === "center" ? "center" : "side"}
          dataSourceId={dataSourceId}
          onPropertyCreated={refetch}
        />
      )}
    </div>
  );
}
