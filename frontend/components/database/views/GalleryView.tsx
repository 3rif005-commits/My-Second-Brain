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

// Exported for BoardView.tsx's own M12 dedicated-work session: real
// Notion's Board Layout panel has the identical "list vs. compact" concept
// (captured live, `docs/ui-specs/board-view.md`) — same semantics, reused
// rather than a third copy.
export const CARD_LAYOUTS = ["list", "compact"] as const;
export type CardLayout = (typeof CARD_LAYOUTS)[number];

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

export function readCardLayout(config: Record<string, unknown>): CardLayout {
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
export function extractFileUrl(value: PropertyValue | undefined): string | undefined {
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

/** A card with no cover: Notion shows a plain faint fill, no image glyph. */
export function CoverPlaceholder() {
  return <div data-testid="cover-placeholder" className="h-full w-full bg-surface-field" />;
}

/** A property value with nothing to show; Notion hides these on cards. */
export function isEmptyCardValue(v: unknown): boolean {
  if (!v || typeof v !== "object" || !("type" in v)) return true;
  const inner = (v as Record<string, unknown>)[(v as { type: string }).type];
  if (inner === null || inner === undefined || inner === "" || inner === false) return true;
  if (Array.isArray(inner)) return inner.length === 0;
  return false;
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
      // Notion's gallery card: radius 10px, the card shadow, hover tint (§J).
      className={`group relative ${COVER_SIZE_CLASSES[coverSize]} shrink-0 overflow-hidden rounded-card bg-surface-elevated shadow-card transition-colors duration-instant hover:bg-surface-hover`}
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
                className="flex h-6 w-6 items-center justify-center rounded-md bg-surface-elevated text-ink-icon shadow-float hover:bg-surface-hover"
              >
                <MoreHorizontal size={13} />
              </button>
            }
          />
        )}
      </HoverAffordance>

      {cardPreview !== "none" && (
        <div className="relative aspect-video border-b border-line">
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
      <div className={cardLayout === "compact" ? "px-2.5 py-1.5" : "px-2.5 pb-2 pt-2"}>
        {!titleHidden && titleProp && (
          <div className="mb-1 truncate text-sm font-medium text-ink">
            {renderCellValue(titleProp, row.properties[titleProp.key], editable, (value) =>
              onCellChange(row.id, titleProp.key, value)
            )}
          </div>
        )}
        {cardLayout === "list" ? (
          <div className="flex flex-col gap-1">
            {otherProps.filter((p) => !isEmptyCardValue(row.properties[p.key])).map((p) => (
              <div key={p.key} className="flex min-h-[22px] items-start text-xs leading-[18px] text-ink">
                {/* Notion shows no property labels on cards; kept for screen readers. */}
                <span className="sr-only">{p.name}:</span>
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
            <div className="truncate text-xs text-ink-secondary">
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

/** Gallery's own layout options (Card preview, Cover size, Cover fit, Layout, Hide
 * title), shown in View settings › Layout as in Notion. */
export type GalleryLayoutOptionsProps = Pick<GalleryViewProps, "properties" | "config" | "onConfigChange"> &
  Partial<GalleryViewProps>;

export function GalleryLayoutOptions({ properties, config, onConfigChange }: GalleryLayoutOptionsProps) {
  const coverSize = readCoverSize(config);
  const coverAspect = readCoverAspect(config);
  const cardLayout = readCardLayout(config);
  const filesProperties = properties.filter((p) => p.type === "files");
  const cardPreview = readCardPreview(config, filesProperties);
  const hiddenProperties = readHiddenProperties(config);
  const titleProp = properties.find((p) => p.type === "title");
  const titleHidden = titleProp ? hiddenProperties.includes(titleProp.key) : false;

  function toggleHideTitle() {
    if (!titleProp) return;
    const next = titleHidden
      ? hiddenProperties.filter((k) => k !== titleProp.key)
      : [...hiddenProperties, titleProp.key];
    onConfigChange({ hidden_properties: next });
  }

  return (
  <div className="flex flex-col gap-px">
    <label className="flex min-h-menu-row w-full items-center justify-between gap-2 px-2 text-menu">
      Card preview
      <select
        aria-label="Card preview"
        value={cardPreview}
        onChange={(e) => onConfigChange({ card_preview: e.target.value })}
        className="h-7 rounded-md border border-line-strong bg-transparent px-1.5 text-sm text-ink outline-none"
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
    <label className="flex min-h-menu-row w-full items-center justify-between gap-2 px-2 text-menu">
      Cover size
      <select
        aria-label="Cover size"
        value={coverSize}
        onChange={(e) => onConfigChange({ cover_size: e.target.value })}
        className="h-7 rounded-md border border-line-strong bg-transparent px-1.5 text-sm text-ink outline-none"
      >
        {COVER_SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
    <label className="flex min-h-menu-row w-full items-center justify-between gap-2 px-2 text-menu">
      Cover fit
      <select
        aria-label="Cover fit"
        value={coverAspect}
        onChange={(e) => onConfigChange({ cover_aspect: e.target.value })}
        className="h-7 rounded-md border border-line-strong bg-transparent px-1.5 text-sm text-ink outline-none"
      >
        {COVER_ASPECTS.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
    </label>
    <label className="flex min-h-menu-row w-full items-center justify-between gap-2 px-2 text-menu">
      Layout
      <select
        aria-label="Card layout"
        value={cardLayout}
        onChange={(e) => onConfigChange({ card_layout: e.target.value })}
        className="h-7 rounded-md border border-line-strong bg-transparent px-1.5 text-sm text-ink outline-none"
      >
        {CARD_LAYOUTS.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
    </label>
    {titleProp && (
      <label className="flex min-h-menu-row w-full items-center justify-between gap-2 px-2 text-menu">
        <input type="checkbox" checked={titleHidden} onChange={toggleHideTitle} />
        Hide title
      </label>
    )}
  </div>
  );
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
      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-tertiary">
          No rows yet.
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-wrap content-start gap-4 overflow-auto pb-6 pt-1">
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
