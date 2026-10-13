"use client";

// M8 — database creation, title, icon, description (database-header.md).
//
// SCOPED DOWN FROM THE FULL CAPTURE, deliberately, and noted here rather
// than silently:
//  - The creation flow (a full-viewport data-source-picker modal with LIVE
//    mini-previews of existing sources) is NOT built. The spec itself flags
//    the previews as "a real build cost, flag before committing" — Sidebar's
//    existing "New Database" already creates an empty database and
//    navigates, which is the one card ("Empty database") that matters
//    functionally; the picker chrome around it is presentation, not new
//    capability.
//  - Cover is deferred entirely (spec's own call: no upload pipeline).
//  - The page-level `⋯` menu is DatabasePageMenu.tsx, scoped down for the
//    same "most rows already have a home elsewhere" reason — see its own
//    comment.
//
// What IS built: a database can be renamed, iconed and described for the
// first time ever (Phase 0b's B2 had nowhere to be called from before this).
import { useState } from "react";
import { AlignLeft, Smile } from "lucide-react";
import { useToast } from "@/app/providers";
import { HoverAffordance, IconPicker, Popover, randomEmoji } from "@/components/ui/primitives";
import type { DatabaseResponse, DataSourceResponse } from "@/lib/database/types";
import { DatabasePageMenu } from "./DatabasePageMenu";

/** `DatabaseResponse.description` is JSONB rich text (`list[Any]`), with no
 * shown/hidden flag of its own (database-header.md's own TBD). Nothing else
 * in this codebase reads or writes this field yet, so this picks the
 * simplest internally-consistent shape — one plain-text block — rather than
 * modelling real rich text no editor here produces. */
function descriptionText(description: unknown[]): string {
  const first = description[0];
  return first && typeof first === "object" && "text" in (first as Record<string, unknown>)
    ? String((first as Record<string, unknown>).text ?? "")
    : "";
}
function toDescription(text: string): unknown[] {
  return text ? [{ text }] : [];
}

export interface DatabaseHeaderProps {
  database: DatabaseResponse;
  dataSource: DataSourceResponse;
  editable: boolean;
  onUpdate: (patch: Partial<Pick<DatabaseResponse, "title" | "icon" | "description" | "is_locked">>) => Promise<unknown>;
  onDelete: () => Promise<void>;
  /** DatabaseShell's existing gear-icon DatabaseSettingsMenu — rendered
   * alongside DatabasePageMenu in the same right-aligned slot, same
   * `trailing` pattern ViewTabs.tsx already uses for its own toolbar. */
  trailing?: React.ReactNode;
  /** "inline" (default) draws the page ⋯ menu and `trailing` beside the title;
   * "none" leaves them to the caller — DatabaseShell puts them in its top bar,
   * where Notion has them. */
  menus?: "inline" | "none";
}

export function DatabaseHeader({ database, dataSource, editable, onUpdate, onDelete, trailing, menus = "inline" }: DatabaseHeaderProps) {
  const { showToast } = useToast();
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  const [titleDraft, setTitleDraft] = useState(database.title);
  const [describing, setDescribing] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(() => descriptionText(database.description));

  const hasDescription = descriptionText(database.description).length > 0;
  // Can rename/icon/describe an ORDINARY database; All Notes has no
  // `db_databases` row at all to PATCH — hidden, not disabled, matching
  // DatabaseShell.tsx:400's own established rule for this exact source.
  const canEditHeader = editable && !dataSource.is_virtual;

  async function addIcon() {
    try {
      await onUpdate({ icon: randomEmoji() });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not set the icon", "error");
    }
  }
  async function pickIcon(emoji: string) {
    try {
      await onUpdate({ icon: emoji });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not set the icon", "error");
    }
  }
  async function removeIcon() {
    setIconPickerOpen(false);
    try {
      await onUpdate({ icon: null });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not remove the icon", "error");
    }
  }
  async function commitTitle() {
    const trimmed = titleDraft.trim();
    if (!trimmed) {
      setTitleDraft(database.title);
      return;
    }
    if (trimmed === database.title) return;
    try {
      await onUpdate({ title: trimmed });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not rename the database", "error");
      setTitleDraft(database.title);
    }
  }
  async function commitDescription() {
    if (descriptionDraft === descriptionText(database.description)) return;
    try {
      await onUpdate({ description: toDescription(descriptionDraft) });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not save the description", "error");
    }
  }

  // ONE Popover, rendered at exactly one location depending on whether an
  // icon exists yet — never both. Two separate `<Popover>` elements sharing
  // one `open` boolean would each independently mount their own Content
  // when true, showing two pickers at once; a single shared JSX value
  // placed at one of two possible spots avoids that outright rather than
  // needing to coordinate two Radix roots.
  const quiet =
    "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-sm text-ink-tertiary transition-colors duration-instant hover:bg-surface-hover";

  const iconPopover = (
    <Popover
      open={iconPickerOpen}
      onOpenChange={setIconPickerOpen}
      label="Database icon"
      trigger={
        database.icon ? (
          <button
            type="button"
            aria-label="Change icon"
            className="flex size-[46px] shrink-0 items-center justify-center rounded-md text-[38px] leading-none transition-colors duration-instant hover:bg-surface-hover"
          >
            {database.icon}
          </button>
        ) : (
          <button type="button" onClick={addIcon} className={quiet}>
            <Smile size={14} /> Add icon
          </button>
        )
      }
    >
      <IconPicker value={database.icon} onPick={pickIcon} onRemove={database.icon ? removeIcon : undefined} />
    </Popover>
  );

  // Notion's full-page database header (database-table.md §1): on hover a quiet
  // "Add icon · Add description" bar above the title; the title is 32px/700.
  return (
    <div className="group">
      {canEditHeader && (
        // Reserved space, opacity-toggled — must not shift the title below it.
        <HoverAffordance className="mb-1 flex items-center gap-0.5">
          {!database.icon && iconPopover}
          <button type="button" onClick={() => setDescribing((d) => !d)} className={quiet}>
            <AlignLeft size={14} />
            {describing || hasDescription ? "Hide description" : "Add description"}
          </button>
        </HoverAffordance>
      )}

      <div className="flex items-center gap-2">
        {database.icon &&
          (canEditHeader ? iconPopover : <span className="text-[38px] leading-none">{database.icon}</span>)}

        {canEditHeader ? (
          <input
            aria-label="Database title"
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") setTitleDraft(database.title);
            }}
            placeholder="New database"
            className="min-w-0 flex-1 bg-transparent px-0.5 text-[32px] font-bold leading-[38.4px] text-ink outline-none placeholder:text-ink-placeholder"
          />
        ) : (
          <h1 className="px-0.5 text-[32px] font-bold leading-[38.4px] text-ink">{database.title}</h1>
        )}

        {dataSource.is_virtual && (
          <span className="rounded bg-surface-chip px-1 py-0.5 text-[11px] font-medium text-ink-icon">Read only</span>
        )}

        {menus === "inline" && (canEditHeader || trailing) && (
          <div className="ml-auto flex items-center gap-1">
            {canEditHeader && (
              <DatabasePageMenu
                databaseId={database.id}
                databaseTitle={database.title}
                isLocked={database.is_locked}
                onToggleLocked={() => onUpdate({ is_locked: !database.is_locked })}
                onDelete={onDelete}
              />
            )}
            {trailing}
          </div>
        )}
      </div>

      {canEditHeader && (describing || hasDescription) && (
        <input
          aria-label="Database description"
          value={descriptionDraft}
          onChange={(e) => setDescriptionDraft(e.target.value)}
          onBlur={commitDescription}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="Add a description…"
          className="mt-1 w-full bg-transparent px-0.5 text-sm text-ink-secondary outline-none placeholder:text-ink-placeholder"
        />
      )}
    </div>
  );
}
