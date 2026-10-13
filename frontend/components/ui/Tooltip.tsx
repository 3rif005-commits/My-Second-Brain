"use client";

// Notion's tooltip: near-black card in both themes, 12px text, 6px below the trigger,
// after ~0.5s; an optional shortcut on its own grey line (menus-overlays.md §3).
import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export interface TooltipProps {
  content: ReactNode;
  /** Shown on a second line in grey, e.g. "Ctrl+\\". */
  shortcut?: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  children: ReactNode;
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={500} skipDelayDuration={300}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({ content, shortcut, side = "bottom", align = "center", children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className="z-[10001] max-w-[300px] rounded-md bg-surface-tooltip px-2 py-[5px] text-xs leading-[16.8px] text-ink-on-tooltip shadow-tooltip animate-[tooltip-in_50ms_ease-out]"
        >
          <div>{content}</div>
          {shortcut && <div className="text-ink-tooltip-hint">{shortcut}</div>}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
