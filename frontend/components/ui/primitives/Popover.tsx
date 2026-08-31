"use client";

// Anchored popover. Thin wrapper over Radix so we get flip/shift collision
// handling, portalling, Esc, outside-click and focus return without writing
// them — every visual decision stays here.
//
// Collision handling is the reason this is a dependency rather than hand-rolled:
// live Notion nests menus three deep and the third level FLIPS to the left when
// it runs out of room (Calculate -> Count, observed twice). Getting that right
// by hand, per surface, is where this class of work dies.
import * as RadixPopover from "@radix-ui/react-popover";
import type { ReactNode } from "react";

export type PopoverWidth = "sm" | "md" | "lg" | "trigger" | number;

const WIDTH_CLASS: Record<string, string> = {
  sm: "w-menu-sm",
  md: "w-menu-md",
  lg: "w-menu-lg",
};

export interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  sideOffset?: number;
  width?: PopoverWidth;
  /** Constrains height and lets the panel scroll. Notion's menus scroll rather
   * than growing past the viewport. */
  maxHeight?: number | string;
  /** Test hook / a11y label for the surface. */
  label?: string;
  className?: string;
}

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  side = "bottom",
  align = "start",
  sideOffset = 4,
  width = "sm",
  maxHeight = "min(70vh, 520px)",
  label,
  className = "",
}: PopoverProps) {
  const isNamedWidth = typeof width === "string" && width in WIDTH_CLASS;
  const widthClass = isNamedWidth ? WIDTH_CLASS[width as string] : "";
  const style: React.CSSProperties = {
    maxHeight,
    ...(typeof width === "number" ? { width } : {}),
    ...(width === "trigger" ? { width: "var(--radix-popover-trigger-width)" } : {}),
  };

  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={8}
          aria-label={label}
          style={style}
          // No border: the 1px edge is the third layer of --menu-shadow, in
          // both themes. See the design doc §5.
          className={`z-50 overflow-y-auto overscroll-contain rounded-menu bg-menu-bg shadow-menu ${widthClass} ${className}`}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
