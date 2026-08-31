"use client";

// The heart of the primitive layer. Renders a MenuPanel; every menu-shaped
// surface in the database UI is one of these plus a host.
//
// Three things here came directly from capturing live Notion, and each would
// have been wrong if designed from memory (docs/ui-specs/raw-dom/):
//
//  1. SUBMENUS ARE FLYOUTS *OR* PUSH PANELS. Popover-hosted menus (column
//     header, row menu) open a second panel beside the parent with the parent
//     still visible; the docked config sidebar replaces its contents and shows
//     a back arrow. Both exist. `nav` picks one.
//  2. NESTING IS UNBOUNDED and each level flips independently — Calculate ->
//     Count -> the functions, where level three opens LEFTWARD for want of
//     room. Each submenu is therefore its own Radix Popover, so collision
//     handling is per level rather than computed once.
//  3. COLUMN COUNT IS PER-PANEL. The same property-type list is a 2-column
//     grid in "+ Add property" and a 1-column list in "Change type".
//
// KEYBOARD IS A DELIBERATE DEVIATION. Notion's column header menu has no
// arrow-key navigation at all — focus sits in the name field and the arrows
// move the text caret (verified with real key events). We implement arrow
// navigation on EVERY panel regardless: a 14-row menu that cannot be driven
// from the keyboard is an accessibility regression against the native <select>
// elements this work replaces. See docs/ui-specs/table-column-header.md.
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { Popover } from "./Popover";
import type { MenuNav, MenuPanel, MenuRow } from "./types";

export interface MenuListProps {
  root: MenuPanel;
  /** "flyout" for popover hosts, "push" for the docked config sidebar. */
  nav?: MenuNav;
  onClose: () => void;
  label?: string;
}

interface FlatRow {
  row: MenuRow;
  index: number;
}

function matches(row: MenuRow, query: string): boolean {
  if (!query) return true;
  return row.label.toLowerCase().includes(query.toLowerCase());
}

export function MenuList({ root, nav = "flyout", onClose, label }: MenuListProps) {
  // `push` keeps a stack so the back arrow has somewhere to go. `flyout`
  // never pushes — its submenus are nested Popovers rendered by the row.
  const [stack, setStack] = useState<MenuPanel[]>([root]);
  const panel = stack[stack.length - 1];

  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const baseId = useId();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const columns = panel.columns ?? 1;
  const canPop = nav === "push" && stack.length > 1;

  // Visible rows, flattened in DOM order, so arrow keys can walk them
  // regardless of section boundaries. Disabled rows stay in the list and are
  // skipped when moving — they are semantic (an illegal type conversion), not
  // absent, so they must remain visible and announced.
  const sections = useMemo(
    () =>
      panel.sections.map((section) => {
        const filtered =
          section.searchable === false ? section.rows : section.rows.filter((r) => matches(r, query));
        return { ...section, rows: filtered };
      }),
    [panel, query]
  );

  const flat = useMemo(() => {
    const out: FlatRow[] = [];
    let i = 0;
    for (const section of sections) for (const row of section.rows) out.push({ row, index: i++ });
    return out;
  }, [sections]);

  const move = useCallback(
    (delta: number) => {
      if (flat.length === 0) return;
      let next = active;
      for (let guard = 0; guard < flat.length; guard++) {
        next = (next + delta + flat.length) % flat.length;
        if (!flat[next].row.disabled) break;
      }
      setActive(next);
    },
    [active, flat]
  );

  const activate = useCallback(
    (row: MenuRow) => {
      if (row.disabled) return;
      if (row.submenu && nav === "push") {
        setStack((s) => [...s, row.submenu!()]);
        setQuery("");
        setActive(0);
        return;
      }
      row.onSelect?.();
      // A toggle keeps the panel open — you often flip several in a row
      // ("Show vertical lines", "Show page icon", "Wrap all content").
      if (row.kind !== "toggle" && !row.submenu) onClose();
    },
    [nav, onClose]
  );

  const pop = useCallback(() => {
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
    setQuery("");
    setActive(0);
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    const current = flat[active]?.row;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(columns);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(-columns);
        break;
      case "ArrowRight":
        if (columns > 1) {
          e.preventDefault();
          move(1);
        } else if (current?.submenu && nav === "push") {
          e.preventDefault();
          activate(current);
        }
        break;
      case "ArrowLeft":
        if (columns > 1) {
          e.preventDefault();
          move(-1);
        } else if (canPop) {
          e.preventDefault();
          pop();
        }
        break;
      case "Enter":
        if (current) {
          e.preventDefault();
          activate(current);
        }
        break;
      case "Escape":
        e.preventDefault();
        // Esc pops one level before closing, so a nested panel does not throw
        // away the whole menu.
        if (canPop) pop();
        else onClose();
        break;
      case "Tab":
        onClose();
        break;
      default:
        break;
    }
  }

  const activeId = flat[active] ? `${baseId}-row-${flat[active].index}` : undefined;
  const listboxId = `${baseId}-listbox`;

  return (
    <div className="py-1 text-menu text-menu-fg" onKeyDown={onKeyDown} data-testid="menu-list">
      {(panel.title || canPop) && (
        <div className="flex items-center gap-1 px-2 pb-1">
          {canPop && (
            <button
              type="button"
              aria-label="Back"
              onClick={pop}
              className="flex h-5 w-5 items-center justify-center rounded hover:bg-menu-hover"
            >
              ←
            </button>
          )}
          {panel.title && <span className="font-medium">{panel.title}</span>}
        </div>
      )}

      {panel.search && (
        <div className="px-2 pb-1">
          <input
            ref={searchRef}
            autoFocus
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            aria-label={panel.search.placeholder}
            placeholder={panel.search.placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            className="h-menu-row w-full rounded bg-menu-field px-2 text-menu outline-none placeholder:text-menu-disabled"
          />
        </div>
      )}

      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label={label ?? panel.title}
        aria-activedescendant={panel.search ? undefined : activeId}
        tabIndex={panel.search ? -1 : 0}
        className="outline-none"
      >
        {sections.map((section, si) => (
          <div key={section.label ?? si}>
            {si > 0 && <div role="separator" className="my-1 h-px bg-menu-divider" />}
            {(section.label || section.action) && (
              <div className="flex items-center justify-between px-2 py-1 text-menu-disabled">
                {section.label && <span>{section.label}</span>}
                {section.action && (
                  <button
                    type="button"
                    onClick={section.action.onSelect}
                    className="hover:text-menu-fg"
                  >
                    {section.action.label}
                  </button>
                )}
              </div>
            )}
            <div className={columns === 2 ? "grid grid-cols-2" : ""}>
              {section.rows.map((row) => {
                const flatIndex = flat.find((f) => f.row === row)?.index ?? -1;
                return (
                  <Row
                    key={row.id}
                    row={row}
                    id={`${baseId}-row-${flatIndex}`}
                    isActive={flatIndex === active}
                    nav={nav}
                    onActivate={() => activate(row)}
                    onHover={() => flatIndex >= 0 && !row.disabled && setActive(flatIndex)}
                    onClose={onClose}
                  />
                );
              })}
            </div>
          </div>
        ))}
        {flat.length === 0 && (
          <div className="px-2 py-2 text-menu-disabled">No results</div>
        )}
      </div>

      {panel.footer && (
        <>
          <div role="separator" className="my-1 h-px bg-menu-divider" />
          <div className="px-2 py-1 text-menu-disabled">{panel.footer}</div>
        </>
      )}
    </div>
  );
}

interface RowProps {
  row: MenuRow;
  id: string;
  isActive: boolean;
  nav: MenuNav;
  onActivate: () => void;
  onHover: () => void;
  onClose: () => void;
}

function Row({ row, id, isActive, nav, onActivate, onHover, onClose }: RowProps) {
  const body = (
    <div
      id={id}
      role="option"
      aria-selected={isActive}
      aria-disabled={row.disabled || undefined}
      title={row.disabled ? row.disabledReason : undefined}
      onMouseEnter={onHover}
      onClick={onActivate}
      // min-h, not h: rows carrying a description are taller than the 28px base.
      className={[
        "flex min-h-menu-row cursor-pointer select-none items-center gap-2 px-2",
        isActive && !row.disabled ? "bg-menu-hover" : "",
        row.disabled ? "cursor-default text-menu-disabled" : "",
        row.danger && !row.disabled ? "text-red-500" : "",
      ].join(" ")}
    >
      {row.icon !== undefined && (
        <span className="flex w-menu-icon shrink-0 items-center justify-center">{row.icon}</span>
      )}
      <span className="flex min-w-0 flex-col py-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate">{row.label}</span>
          {row.badge && (
            <span className="shrink-0 rounded bg-menu-badge px-1 text-[11px]">{row.badge}</span>
          )}
        </span>
        {row.description && (
          <span className="text-[12px] text-menu-disabled">{row.description}</span>
        )}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-menu-disabled">
        {row.value && <span>{row.value}</span>}
        {row.hint && <span>{row.hint}</span>}
        {row.kind === "toggle" && (
          <span
            role="switch"
            aria-checked={Boolean(row.checked)}
            aria-label={row.label}
            className={`h-3.5 w-6 rounded-full ${row.checked ? "bg-brand" : "bg-menu-divider"}`}
          />
        )}
        {row.kind !== "toggle" && row.checked && <span aria-hidden>✓</span>}
        {row.submenu && <span aria-hidden>›</span>}
      </span>
    </div>
  );

  // In flyout mode a submenu row is itself a Popover trigger, so every level
  // gets its own collision handling — which is what makes a third level able
  // to flip leftward independently of its parent.
  if (row.submenu && nav === "flyout" && !row.disabled) {
    return (
      <Popover
        trigger={body}
        side="right"
        align="start"
        sideOffset={2}
        width="sm"
        label={row.label}
      >
        <MenuList root={row.submenu()} nav="flyout" onClose={onClose} label={row.label} />
      </Popover>
    );
  }

  return body;
}
