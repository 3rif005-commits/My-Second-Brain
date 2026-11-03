"use client";

// Notion's block menu (click ⋮⋮) and table row/column menu, in place of
// BlockNote's defaults: those were a lone "Delete" pill, or three bare text rows.
// Built from BlockNote's own menu parts, so dragging, positioning and closing keep
// working; app/editor.css (".bn-notion-menu") gives them Notion's measured card
// (docs/notion-reference/surfaces/blocks.md §4): 265px, radius 10px, 28px rows,
// 20px icons, grey shortcut hints on the right.
import { useEffect, type ReactNode } from "react";
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CheckSquare, Code, Copy, Eraser,
  Heading1, Heading2, Heading3, Link2, List, ListOrdered, ListCollapse, Paintbrush, Quote,
  Repeat2, Rows3, Sparkles, Trash2, Type,
} from "lucide-react";
import { AIExtension } from "@blocknote/xl-ai";
import { SideMenuExtension, TableHandlesExtension } from "@blocknote/core/extensions";
import {
  BlockColorsItem, useBlockNoteEditor, useComponentsContext, useExtension, useExtensionState,
} from "@blocknote/react";
import { useToast } from "@/app/providers";
import { selectBlocksById, selectedBlockIds, withoutIds } from "./blockSelectionExtension";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBlock = any;

const IS_MAC = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl+";

/** One row: icon · label · shortcut hint. (A submenu's › is drawn by BlockNote.) */
function Row({ icon, label, hint }: { icon: ReactNode; label: string; hint?: string; sub?: boolean }) {
  return (
    <span className="bn-notion-row">
      <span className="bn-notion-icon" aria-hidden>{icon}</span>
      <span className="bn-notion-label">{label}</span>
      {hint && <span className="bn-notion-hint">{hint}</span>}
    </span>
  );
}

const TURN_INTO: { label: string; icon: ReactNode; type: string; props?: Record<string, unknown> }[] = [
  { label: "Text", icon: <Type />, type: "paragraph" },
  { label: "Heading 1", icon: <Heading1 />, type: "heading", props: { level: 1 } },
  { label: "Heading 2", icon: <Heading2 />, type: "heading", props: { level: 2 } },
  { label: "Heading 3", icon: <Heading3 />, type: "heading", props: { level: 3 } },
  { label: "Bulleted list", icon: <List />, type: "bulletListItem" },
  { label: "Numbered list", icon: <ListOrdered />, type: "numberedListItem" },
  { label: "To-do list", icon: <CheckSquare />, type: "checkListItem" },
  { label: "Toggle list", icon: <ListCollapse />, type: "toggleListItem" },
  { label: "Quote", icon: <Quote />, type: "quote" },
  { label: "Code", icon: <Code />, type: "codeBlock" },
];

/** What Notion puts in the section header: the block's own kind. */
function blockLabel(block: AnyBlock): string {
  if (block.type === "heading") return `Heading ${block.props?.level ?? 1}`;
  const hit = TURN_INTO.find((t) => t.type === block.type);
  if (hit) return hit.label;
  const words = String(block.type).replace(/([A-Z])/g, " $1").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The blocks a menu action applies to: every selected block when the menu's
 *  block is part of a block selection (Notion), else just that block. */
function targetsOf(editor: AnyBlock, block: AnyBlock): AnyBlock[] {
  const ids = selectedBlockIds(editor);
  if (!ids.includes(block.id)) return [block];
  return ids.map((id) => editor.getBlock(id)).filter(Boolean);
}

/** Click ⋮⋮: Notion's block action menu. */
export function NotionBlockMenu({ noteId }: { noteId?: string }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<AnyBlock, AnyBlock, AnyBlock>();
  const aiExt = useExtension(AIExtension);
  const { showToast } = useToast();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (s) => s?.block });
  // Opening the menu selects its block, painted with the block-selection
  // overlay, unless the block is already part of a larger block selection —
  // then the menu acts on all of them.
  const blockId = block?.id as string | undefined;
  useEffect(() => {
    if (!blockId) return;
    if (!selectedBlockIds(editor).includes(blockId)) selectBlocksById(editor, [blockId]);
    // When the menu closes, the keyboard goes back to the page with the blocks
    // still selected (Notion): ↑/↓, Delete, Ctrl+Z… act on them right away
    // instead of on the ⋮⋮ button the menu would hand focus back to.
    return () => {
      window.setTimeout(() => {
        if (selectedBlockIds(editor).length) editor.prosemirrorView?.focus();
      }, 0);
    };
  }, [editor, blockId]);
  if (!block) return null;

  const textLike = Array.isArray(block.content);
  const url = noteId && typeof window !== "undefined"
    ? `${window.location.origin}/brain/${noteId}#${block.id}` : null;

  return (
    <Components.Generic.Menu.Dropdown className="bn-menu-dropdown bn-drag-handle-menu bn-notion-menu">
      <Components.Generic.Menu.Label>{blockLabel(block)}</Components.Generic.Menu.Label>
      {textLike && (
        <Components.Generic.Menu.Root position="right" sub>
          <Components.Generic.Menu.Trigger sub>
            <Components.Generic.Menu.Item className="bn-menu-item" subTrigger>
              <Row icon={<Repeat2 />} label="Turn into" sub />
            </Components.Generic.Menu.Item>
          </Components.Generic.Menu.Trigger>
          <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown bn-notion-menu">
            {TURN_INTO.map((t) => {
              const current = block.type === t.type
                && (t.type !== "heading" || block.props?.level === t.props?.level);
              return (
                <Components.Generic.Menu.Item key={t.label} className="bn-menu-item" checked={current}
                  onClick={() => {
                    for (const b of targetsOf(editor, block)) {
                      if (Array.isArray(b.content)) editor.updateBlock(b, { type: t.type, props: t.props ?? {} });
                    }
                  }}>
                  <Row icon={t.icon} label={t.label} />
                </Components.Generic.Menu.Item>
              );
            })}
          </Components.Generic.Menu.Dropdown>
        </Components.Generic.Menu.Root>
      )}
      <BlockColorsItem><Row icon={<Paintbrush />} label="Color" sub /></BlockColorsItem>
      <Components.Generic.Menu.Divider />
      {url && (
        <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => {
          navigator.clipboard.writeText(url).then(
            () => showToast("Link to block copied"),
            () => showToast("Couldn't copy the link"));
        }}>
          <Row icon={<Link2 />} label="Copy link to block" />
        </Components.Generic.Menu.Item>
      )}
      <Components.Generic.Menu.Item className="bn-menu-item"
        onClick={() => {
          const targets = targetsOf(editor, block);
          const copies = editor.insertBlocks(targets.map(withoutIds), targets[targets.length - 1], "after");
          selectBlocksById(editor, copies.map((b: AnyBlock) => b.id));
        }}>
        <Row icon={<Copy />} label="Duplicate" />
      </Components.Generic.Menu.Item>
      <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => editor.removeBlocks(targetsOf(editor, block))}>
        <Row icon={<Trash2 />} label="Delete" hint="Del" />
      </Components.Generic.Menu.Item>
      {aiExt && textLike && (
        <>
          <Components.Generic.Menu.Divider />
          <Components.Generic.Menu.Item className="bn-menu-item"
            onClick={() => aiExt.openAIMenuAtBlock(block.id)}>
            <Row icon={<Sparkles />} label="Ask AI" hint={`${MOD}K`} />
          </Components.Generic.Menu.Item>
        </>
      )}
    </Components.Generic.Menu.Dropdown>
  );
}

// ── table rows and columns ───────────────────────────────────────────────────

/** A cell emptied, keeping whichever shape the table uses (TableCell object or bare content). */
function emptyCell(cell: AnyBlock): AnyBlock {
  return Array.isArray(cell) ? [] : { ...cell, content: [] };
}

/** The row/column handle's menu, Notion's way: insert, duplicate, clear, delete. */
export function NotionTableHandleMenu({ orientation }: { orientation: "row" | "column" }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor<AnyBlock, AnyBlock, AnyBlock>();
  const tableHandles = useExtension(TableHandlesExtension);
  const state = useExtensionState(TableHandlesExtension);
  const index = orientation === "row" ? state?.rowIndex : state?.colIndex;
  const table = state?.block as AnyBlock | undefined;
  if (!tableHandles || index === undefined || !table || table.type !== "table") return null;

  const content = table.content;
  const update = (next: AnyBlock) => editor.updateBlock(table, { type: "table", content: { ...content, ...next } });
  const row = orientation === "row";

  const duplicate = () => {
    if (row) {
      const rows = [...content.rows];
      rows.splice(index + 1, 0, structuredClone(rows[index]));
      update({ rows });
    } else {
      const rows = content.rows.map((r: AnyBlock) => {
        const cells = [...r.cells];
        cells.splice(index + 1, 0, structuredClone(cells[index]));
        return { ...r, cells };
      });
      const columnWidths = content.columnWidths ? [...content.columnWidths] : undefined;
      columnWidths?.splice(index + 1, 0, columnWidths[index]);
      update({ rows, ...(columnWidths ? { columnWidths } : {}) });
    }
  };
  const clear = () => {
    const rows = content.rows.map((r: AnyBlock, ri: number) => ({
      ...r,
      cells: r.cells.map((c: AnyBlock, ci: number) => ((row ? ri : ci) === index ? emptyCell(c) : c)),
    }));
    update({ rows });
  };
  const isHeader = row ? index === 0 && (content.headerRows ?? 0) > 0 : index === 0 && (content.headerCols ?? 0) > 0;

  return (
    <Components.Generic.Menu.Dropdown className="bn-table-handle-menu bn-notion-menu">
      {index === 0 && (
        <>
          <Components.Generic.Menu.Item className="bn-menu-item" checked={isHeader}
            onClick={() => update(row ? { headerRows: isHeader ? undefined : 1 } : { headerCols: isHeader ? undefined : 1 })}>
            <Row icon={<Rows3 />} label={row ? "Header row" : "Header column"} />
          </Components.Generic.Menu.Item>
          <Components.Generic.Menu.Divider />
        </>
      )}
      <Components.Generic.Menu.Item className="bn-menu-item"
        onClick={() => tableHandles.addRowOrColumn(index, row ? { orientation: "row", side: "above" } : { orientation: "column", side: "left" })}>
        <Row icon={row ? <ArrowUp /> : <ArrowLeft />} label={row ? "Insert above" : "Insert left"} />
      </Components.Generic.Menu.Item>
      <Components.Generic.Menu.Item className="bn-menu-item"
        onClick={() => tableHandles.addRowOrColumn(index, row ? { orientation: "row", side: "below" } : { orientation: "column", side: "right" })}>
        <Row icon={row ? <ArrowDown /> : <ArrowRight />} label={row ? "Insert below" : "Insert right"} />
      </Components.Generic.Menu.Item>
      <Components.Generic.Menu.Item className="bn-menu-item" onClick={duplicate}>
        <Row icon={<Copy />} label="Duplicate" />
      </Components.Generic.Menu.Item>
      <Components.Generic.Menu.Item className="bn-menu-item" onClick={clear}>
        <Row icon={<Eraser />} label="Clear contents" />
      </Components.Generic.Menu.Item>
      <Components.Generic.Menu.Item className="bn-menu-item"
        onClick={() => tableHandles.removeRowOrColumn(index, orientation)}>
        <Row icon={<Trash2 />} label="Delete" hint="Del" />
      </Components.Generic.Menu.Item>
    </Components.Generic.Menu.Dropdown>
  );
}

