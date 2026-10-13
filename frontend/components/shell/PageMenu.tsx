"use client";

// Notion's page `⋯` menu (shell.md §2): 256px, opening under the top bar at the right,
// with a focused "Search actions…" field, the three font tiles, the Small text and
// Full width toggles, then the page's own actions and a grey meta footer.
import { useMemo, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";
import { Popover } from "@/components/ui/primitives/Popover";
import { cx } from "@/components/ui/cx";
import type { PageStyle } from "@/lib/pageStyle";

export interface PageMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  /** Right-aligned grey hint, e.g. a shortcut. */
  hint?: string;
  danger?: boolean;
  /** A toggle row instead of an action. */
  checked?: boolean;
}

export interface PageMenuProps {
  style?: PageStyle;
  onStyleChange?: (patch: Partial<PageStyle>) => void;
  /** Groups of actions, separated by dividers. */
  sections: PageMenuItem[][];
  /** Grey footer lines (word count, last edited…). */
  meta?: ReactNode[];
  label?: string;
}

const FONTS: { value: PageStyle["font"]; caption: string; className: string }[] = [
  { value: "default", caption: "Default", className: "font-sans text-2xl" },
  { value: "serif", caption: "Serif", className: "font-serif text-[25px]" },
  { value: "mono", caption: "Mono", className: "font-page-mono text-[26px] tracking-[-1px]" },
];

export function PageMenu({ style, onStyleChange, sections, meta, label = "Page settings & actions" }: PageMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const visibleSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sections;
    return sections.map((s) => s.filter((i) => i.label.toLowerCase().includes(q))).filter((s) => s.length);
  }, [sections, query]);

  const styleRows: PageMenuItem[] =
    style && onStyleChange
      ? [
          { label: "Small text", checked: style.smallText, onSelect: () => onStyleChange({ smallText: !style.smallText }) },
          { label: "Full width", checked: style.fullWidth, onSelect: () => onStyleChange({ fullWidth: !style.fullWidth }) },
        ]
      : [];
  const q = query.trim().toLowerCase();
  const shownStyleRows = styleRows.filter((r) => !q || r.label.toLowerCase().includes(q));

  function run(item: PageMenuItem) {
    item.onSelect();
    if (item.checked === undefined) setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
      align="end"
      width={256}
      maxHeight="80vh"
      label={label}
      trigger={
        <button
          type="button"
          aria-label={label}
          title={label}
          className="flex size-7 items-center justify-center rounded-md text-ink-icon-strong transition-colors duration-instant hover:bg-surface-active data-[state=open]:bg-surface-active"
        >
          <MoreHorizontal size={22} strokeWidth={1.75} />
        </button>
      }
    >
      <div className="flex flex-col gap-px px-1 pb-1 pt-2">
        <div className="px-2 pb-1">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search actions…"
            aria-label="Search actions"
            className="h-7 w-full rounded-md bg-surface-field px-1.5 text-sm text-ink shadow-[inset_0_0_0_1px_var(--c-border-strong)] outline-none placeholder:text-ink-placeholder focus:shadow-input"
          />
        </div>

        {style && onStyleChange && !q && (
          <div className="flex justify-between px-2 pb-1 pt-1">
            {FONTS.map((f) => {
              const selected = style.font === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onStyleChange({ font: f.value })}
                  className={cx(
                    "flex h-[61px] w-[72px] flex-col items-center rounded px-1.5 pb-1.5 pt-2.5 transition-colors duration-300 hover:bg-surface-hover",
                    selected ? "text-accent" : "text-ink",
                  )}
                >
                  <span className={cx("leading-none", f.className)}>Ag</span>
                  <span className={cx("mt-1 text-xs leading-4", selected ? "text-accent" : "text-ink-secondary")}>{f.caption}</span>
                </button>
              );
            })}
          </div>
        )}

        {[shownStyleRows, ...visibleSections].filter((s) => s.length).map((section, si) => (
          <div key={si} className="flex flex-col gap-px">
            {si > 0 && <div className="mx-3 my-1 h-px bg-line" />}
            {section.map((item) => (
              <button
                key={item.label}
                type="button"
                role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                aria-checked={item.checked}
                onClick={() => run(item)}
                className={cx(
                  "group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm leading-[16.8px] transition-colors duration-instant hover:bg-surface-active",
                  item.danger ? "text-ink hover:text-ink-danger" : "text-ink",
                )}
              >
                {item.icon && (
                  <span className={cx("flex size-5 shrink-0 items-center justify-center text-ink-icon-strong [&>svg]:size-[18px]", item.danger && "group-hover:text-ink-danger")}>
                    {item.icon}
                  </span>
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {item.hint && <span className="shrink-0 text-xs text-ink-tertiary">{item.hint}</span>}
                {item.checked !== undefined && <SwitchVisual on={item.checked} />}
              </button>
            ))}
          </div>
        ))}

        {meta && meta.length > 0 && !q && (
          <>
            <div className="mx-3 my-1 h-px bg-line" />
            <div className="px-2 pb-1">
              {meta.map((m, i) => (
                <div key={i} className="my-1 text-xs leading-4 text-ink-tertiary">
                  {m}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </Popover>
  );
}

/** The toggle drawn inside a menu row: the whole row is the control (Notion's
 * pattern), so this is presentational, never a nested button. */
function SwitchVisual({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cx(
        "relative inline-flex h-[18px] w-[30px] shrink-0 items-center rounded-[44px] p-0.5 transition-colors duration-200",
        on ? "bg-accent" : "bg-toggle-off",
      )}
    >
      <span className={cx("size-3.5 rounded-full bg-white transition-transform duration-200 ease-out", on ? "translate-x-3" : "translate-x-0")} />
    </span>
  );
}
