"use client";

// M12 (Feed build) — extracted out of RowGutter.tsx, the same reasoning as
// useRowPeek.ts's own extraction this session: Feed's real Notion capture
// (row-affordances.md) shows the identical row menu (Favorite/Edit icon/
// Edit property/Open in/Comment/Copy link/Duplicate/Move to Trash), just
// triggered from a top-right "···" icon on the card instead of RowGutter's
// left-gutter drag handle. Rather than a second copy of the favorite/
// copyLink/moveToTrash handlers and Popover+MenuList wiring, both now share
// this. Behavior is unchanged from RowGutter's own pre-extraction version.
import { useState } from "react";
import type { ReactNode } from "react";
import { useToast } from "@/app/providers";
import { Popover, MenuList } from "@/components/ui/primitives";
import { noteWorkspacePath } from "@/lib/database/useOpenNote";
import { buildRowMenu } from "./RowMenu";

async function errorMessage(res: Response): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.detail || body?.error || `Request failed (${res.status})`;
}

export interface RowMenuTriggerProps {
  rowId: string;
  onOpenSidePeek: (rowId: string) => void;
  /** Caller's own refetch — called after a successful trash. */
  onTrashed: () => void | Promise<void>;
  trigger: ReactNode;
}

export function RowMenuTrigger({ rowId, onOpenSidePeek, onTrashed, trigger }: RowMenuTriggerProps) {
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);

  async function favorite() {
    try {
      const res = await fetch(`/api/notes/${rowId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_favorited: true }),
      });
      if (!res.ok) throw new Error(await errorMessage(res));
      showToast("Added to Favorites", "info");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not favorite this row", "error");
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname}?p=${rowId}&pm=s`);
      showToast("Link copied to clipboard", "info");
    } catch {
      showToast("Could not copy the link", "error");
    }
  }

  async function moveToTrash() {
    try {
      const res = await fetch(`/api/notes/${rowId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await errorMessage(res));
      await onTrashed();
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not move this row to Trash", "error");
    }
  }

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen} label="Row options" trigger={trigger}>
      <MenuList
        root={buildRowMenu({
          onFavorite: () => {
            setMenuOpen(false);
            favorite();
          },
          onOpenNewTab: () => {
            setMenuOpen(false);
            window.open(noteWorkspacePath(rowId), "_blank");
          },
          onOpenSidePeek: () => {
            setMenuOpen(false);
            onOpenSidePeek(rowId);
          },
          onCopyLink: () => {
            setMenuOpen(false);
            copyLink();
          },
          onMoveToTrash: () => {
            setMenuOpen(false);
            moveToTrash();
          },
        })}
        nav="flyout"
        onClose={() => setMenuOpen(false)}
        label="Row options"
      />
    </Popover>
  );
}
