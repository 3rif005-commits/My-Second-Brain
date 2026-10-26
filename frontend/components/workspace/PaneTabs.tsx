"use client";

// A pane's row of tabs. Any tab — a source, a note, the AI — can be dragged to
// another pane's row, or sent across with ⇄; a note or a source can float as a
// window over the panes (FloatingTab); × closes it (it stays in the
// session, the picker lists it). The note being written in carries a pen. The
// focused pane's shown tab has the blue underline, the others a grey one, so
// "here" is always visible. Replaced SourceTabs (sources only) on 2026-10-25.
import { useState } from "react";
import { AlertCircle, AppWindow, ArrowLeftRight, FileText, PenLine, Plus, Sparkles, X } from "lucide-react";
import { Popover } from "@/components/ui/primitives/Popover";

export const TAB_MIME = "application/x-sb-tab";

export interface TabView {
  key: string;
  title: string;
  kind: "source" | "note" | "ask";
  color?: string;
  status?: "working" | "failed" | null;
  /** The note captures and AI results go to. */
  isTarget?: boolean;
  /** Shown in its pane. */
  shown: boolean;
  /** Which pane it lives in (the one-pane strip mixes them). */
  pane: number;
  /** May lift out into a floating window. */
  canFloat?: boolean;
}

interface PaneTabsProps {
  tabs: TabView[];
  focused: boolean;
  canMove: boolean;
  onActivate: (key: string, pane: number) => void;
  onClose: (key: string) => void;
  onMove: (key: string) => void;
  onFloat: (key: string) => void;
  /** A tab dragged here from anywhere. */
  onDropTab: (key: string) => void;
  pickerOpen: boolean;
  onPickerOpenChange: (open: boolean) => void;
  picker: React.ReactNode;
}

export function TabIcon({ t }: { t: TabView }) {
  if (t.kind === "ask") return <Sparkles size={13} className="shrink-0" />;
  if (t.kind === "note") {
    return t.isTarget
      ? <PenLine size={13} className="shrink-0 text-accent" aria-label="You're writing here" />
      : <FileText size={13} className="shrink-0" />;
  }
  if (t.status === "failed") return <AlertCircle size={13} className="shrink-0 text-ink-danger" aria-label="Couldn't read" />;
  if (t.status === "working") {
    return (
      <span aria-label="Reading" className="size-3 shrink-0 animate-spin rounded-full border-[1.5px]"
        style={{ borderColor: t.color, borderTopColor: "transparent" }} />
    );
  }
  return <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />;
}

export function PaneTabs({
  tabs, focused, canMove, onActivate, onClose, onMove, onFloat, onDropTab, pickerOpen, onPickerOpenChange, picker,
}: PaneTabsProps) {
  const [dropping, setDropping] = useState(false);
  const isTabDrag = (e: React.DragEvent) => e.dataTransfer.types.includes(TAB_MIME);

  return (
    <div
      onDragOver={(e) => { if (isTabDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!isTabDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        const key = e.dataTransfer.getData(TAB_MIME);
        if (key) onDropTab(key);
      }}
      className={`flex h-[38px] shrink-0 items-end gap-0.5 border-b border-line pl-1.5 pr-1 transition-colors ${
        dropping ? "bg-accent/10" : ""}`}
    >
      <div role="tablist" className="ws-scroll-x flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto">
        {tabs.map((t) => {
          const underline = t.shown ? (focused ? "shadow-[inset_0_-2px_0_var(--c-accent)]" : "shadow-[inset_0_-2px_0_var(--c-border-strong)]") : "";
          return (
            <div
              key={t.key}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData(TAB_MIME, t.key); e.dataTransfer.effectAllowed = "move"; }}
              // Tabs not shown give way first (down to their icon and a few
              // letters), so three or four fit a 460 px pane before it scrolls.
              className={`group relative flex h-8 items-center rounded-t-md transition-colors duration-instant ${underline} ${
                t.shown ? "max-w-[190px] shrink-0 bg-surface text-ink" : "min-w-[64px] max-w-[160px] shrink text-ink-secondary hover:bg-surface-hover"}`}
            >
              <button
                type="button"
                role="tab"
                aria-selected={t.shown}
                onClick={() => onActivate(t.key, t.pane)}
                title={t.kind === "note" && t.isTarget ? `${t.title} — you're writing here` : t.title}
                className={`flex h-full min-w-0 items-center gap-2 pl-2.5 text-[13px] ${t.shown ? "pr-1" : "pr-2.5"}`}
              >
                <TabIcon t={t} />
                <span className="truncate">{t.title}</span>
              </button>
              {/* A tab not shown keeps its whole width for the title (the buttons used to
                  hold 40 px of empty room, leaving one letter): they cover its end when pointed at. */}
              <div className={t.shown ? "contents" : "pointer-events-none absolute inset-y-0 right-0 flex items-center rounded-tr-md ws-tab-cover pl-0.5 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"}>
                {/* Where the tab goes, folded like the AI panel's dock switch: ⇄ shows,
                    pointing at it slides "float" out to its left. On the shown tab only: a tab
                    behind covers just its end with × (two buttons hid a short title whole), and
                    can still be dragged. */}
                {t.shown && (canMove || t.canFloat) && (
                  <div role="group" aria-label={`Where ${t.title} sits`} className="group/place flex items-center rounded">
                    {t.canFloat && (
                      <button
                        type="button"
                        aria-label={`Float ${t.title} as a window`}
                        title="Float as a window over the panes"
                        onClick={() => onFloat(t.key)}
                        className={canMove ? [
                          "flex h-5 w-0 shrink-0 items-center justify-center overflow-hidden rounded text-ink-icon opacity-0",
                          "transition-[width,opacity] duration-150 hover:bg-surface-active hover:text-ink",
                          "pointer-events-none group-hover/place:pointer-events-auto group-hover/place:w-5 group-hover/place:opacity-100",
                          "group-focus-within/place:pointer-events-auto group-focus-within/place:w-5 group-focus-within/place:opacity-100",
                        ].join(" ") : "flex size-5 shrink-0 items-center justify-center rounded text-ink-icon hover:bg-surface-active hover:text-ink"}
                      >
                        <AppWindow size={12} />
                      </button>
                    )}
                    {canMove && (
                      <button
                        type="button"
                        aria-label={`Move ${t.title} to the other side`}
                        title={t.canFloat ? "Move to the other side (or drag the tab) — point here to float it" : "Move to the other side (or drag the tab)"}
                        onClick={() => onMove(t.key)}
                        className="flex size-5 shrink-0 items-center justify-center rounded text-ink-icon hover:bg-surface-active hover:text-ink"
                      >
                        <ArrowLeftRight size={12} />
                      </button>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  aria-label={`Close ${t.title}`}
                  title="Close tab (it stays in this session)"
                  onClick={() => onClose(t.key)}
                  className="mr-1 flex size-5 shrink-0 items-center justify-center rounded text-ink-icon hover:bg-surface-active hover:text-ink"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex h-[37px] shrink-0 items-center">
        <Popover
          open={pickerOpen}
          onOpenChange={onPickerOpenChange}
          align="end"
          width={340}
          label="Open here"
          maxHeight="none"
          trigger={
            <button
              type="button"
              aria-label="Open a note or a source here"
              title="Open a note or a source here (Ctrl+K)"
              className="flex size-7 items-center justify-center rounded-md text-ink-icon hover:bg-surface-hover data-[state=open]:bg-surface-active"
            >
              <Plus size={16} />
            </button>
          }
        >
          {pickerOpen && picker}
        </Popover>
      </div>
    </div>
  );
}
