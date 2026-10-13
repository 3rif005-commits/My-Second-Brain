"use client";

// Tab row over a data source's views + the "+ New view" create-first-
// configure-after popover (view-tab-bar.md, M7 create-flow rewrite).
// Kept as its own component rather than folded into DatabaseShell.tsx —
// even the trimmed create flow (a card grid, plus Chart's own follow-up
// step) has enough of its own state that inlining it would make
// DatabaseShell noticeably harder to read.
import { useState } from "react";
import {
  BarChart3,
  Calendar,
  ClipboardList,
  GalleryHorizontal,
  GanttChartSquare,
  Kanban,
  LayoutDashboard,
  List,
  Rss,
  Table2,
  Plus,
} from "lucide-react";
import { useToast } from "@/app/providers";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MenuList, Popover } from "@/components/ui/primitives";
import type { PropertyResponse, ViewResponse } from "@/lib/database/types";
import type { ViewPatch } from "@/lib/database/useDatabaseView";
import { getDisplayAs, setDisplayAs } from "@/lib/database/viewTabPrefs";
import { buildViewTabMenu } from "./ViewTabMenu";
import {
  ChartCreateFields,
  DEFAULT_CHART_DRAFT,
  buildChartViewConfig,
  isChartConfigComplete,
} from "./views/ChartView";
import type { ChartDraftConfig } from "./views/ChartView";

/** view-tab-bar.md: "Our `createView` defaults `name` to `\"New view\"` and
 * stores it... renaming to `\"\"` should show the type again. TBD." Rather
 * than resolve that storage question (unconfirmed against live Notion),
 * this only fixes the DISPLAY: an empty or still-literally-default name
 * renders as the view's TYPE, matching the captured "unnamed view shows its
 * type" behaviour, without changing what's persisted. */
export function viewTabLabel(view: ViewResponse): string {
  if (view.name && view.name !== "New view") return view.name;
  return view.type.charAt(0).toUpperCase() + view.type.slice(1);
}

interface ViewTabsProps {
  views: ViewResponse[];
  activeViewId: string;
  onSelect: (viewId: string) => void;
  /** Handed to Chart's own follow-up `ChartCreateFields` step (task-35) —
   * the one type this create flow still asks to be configured before it
   * creates anything (see the `handlePickViewType` comment below). Every
   * other type's creation-time config (Board's group-by, Calendar/
   * Timeline's date property) is now auto-selected by `onCreateView`'s
   * caller (`DatabaseShell.handleCreateView`) from its OWN `properties`,
   * not chosen here — this component no longer needs the groupable/date
   * property lists for anything but Chart. */
  properties: PropertyResponse[];
  onCreateView: (input: { type: string; chartConfig?: Record<string, unknown> }) => Promise<void>;
  /** M3's view toolbar (Filter/Sort/Automations/AI Autofill/Search/Settings)
   * — rendered in THIS SAME row, right-aligned via its own `ml-auto`, per
   * view-options-panel.md's diagram (`[ Table ▾ ] ... [toolbar] [ New ▾ ]`).
   * A prop rather than DatabaseShell wrapping this component in a second
   * flex row: this row is already `flex-wrap`, and nesting another flex
   * container around it risks the tabs wrapping oddly next to the toolbar. */
  trailing?: React.ReactNode;
  // M7 (view-tab-bar.md): the active tab's own menu — rename, display as,
  // edit view, source, copy link, duplicate, delete. All optional on the
  // same "an older/other caller gets a degraded but non-crashing
  // behaviour" convention M1's ColumnHeader props already established —
  // omitting them (e.g. a stale test) just means clicking the active tab
  // does nothing, same as before this milestone.
  dataSourceName?: string;
  onUpdateView?: (viewId: string, patch: ViewPatch) => Promise<ViewResponse>;
  onDeleteView?: (viewId: string) => Promise<void>;
  /** The hook's own raw `createView` — unlike `onCreateView` (which layers
   * on Board/Calendar/Chart's own creation-time config), this returns the
   * bare created `ViewResponse` AND updates the shared `views` list, which
   * `duplicateView` below needs (it does its own follow-up config PATCH via
   * `onUpdateView`, not `onCreateView`'s type-specific one). */
  onCreateViewRaw?: (name: string, type: string, icon: string | null) => Promise<ViewResponse>;
  onOpenSettings?: () => void;
}

// view-tab-bar.md's "Add a new view" card grid: 11 types, 4 columns, Table
// highlighted as the default — we cut Map (deliberate, whole-milestone
// decision: no geocoding/tile provider), so 10 cards in the same 4-column
// shape, same row order the capture shows (Table/Board/Gallery/List ·
// Chart/Dashboard/Timeline/Feed · Map/Calendar/Form minus Map). Icons reuse
// ViewLayoutPanel.tsx's own set for the eight types both grids share, so a
// type doesn't wear two different icons across the app; Form has no
// existing icon anywhere else in this codebase to reuse.
export const ADD_VIEW_TYPES = [
  { type: "table", label: "Table", icon: <Table2 size={17} /> },
  { type: "board", label: "Board", icon: <Kanban size={17} /> },
  { type: "gallery", label: "Gallery", icon: <GalleryHorizontal size={17} /> },
  { type: "list", label: "List", icon: <List size={17} /> },
  { type: "chart", label: "Chart", icon: <BarChart3 size={17} /> },
  { type: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={17} /> },
  { type: "timeline", label: "Timeline", icon: <GanttChartSquare size={17} /> },
  { type: "feed", label: "Feed", icon: <Rss size={17} /> },
  { type: "calendar", label: "Calendar", icon: <Calendar size={17} /> },
  { type: "form", label: "Form", icon: <ClipboardList size={17} /> },
] as const;

/** The icon Notion shows before a view's name in its tab, by layout. */
const VIEW_TYPE_ICONS: Record<string, React.ElementType> = {
  table: Table2,
  board: Kanban,
  gallery: GalleryHorizontal,
  list: List,
  chart: BarChart3,
  dashboard: LayoutDashboard,
  timeline: GanttChartSquare,
  feed: Rss,
  calendar: Calendar,
  form: ClipboardList,
};

function AddViewGrid({ onPick }: { onPick: (type: string) => void }) {
  return (
    <div className="py-1">
      <div className="px-2.5 pb-2 pt-1 text-xs font-medium text-ink-secondary">
        Add a new view
      </div>
      <div className="grid grid-cols-4 gap-1 px-2 pb-2">
        {ADD_VIEW_TYPES.map((card) => (
          <button
            key={card.type}
            type="button"
            onClick={() => onPick(card.type)}
            // Table is the default: Notion draws it in blue with a 2px ring.
            className={`flex h-[62px] flex-col items-center justify-center gap-1 rounded-md text-xs hover:bg-surface-hover ${
              card.type === "table" ? "text-accent shadow-[inset_0_0_0_2px_var(--c-accent)]" : "text-ink [&>svg]:text-ink-icon-strong"
            }`}
          >
            {card.icon}
            {card.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ViewTabs({
  views,
  activeViewId,
  onSelect,
  properties,
  onCreateView,
  trailing,
  dataSourceName = "",
  onUpdateView,
  onDeleteView,
  onCreateViewRaw,
  onOpenSettings,
}: ViewTabsProps) {
  const { showToast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmingDeleteViewId, setConfirmingDeleteViewId] = useState<string | null>(null);
  // Bumped on every "Display as" write so the active tab's label re-reads
  // localStorage — the pref lives outside React state entirely (per-user,
  // not `view.config`; see viewTabPrefs.ts), so nothing else would
  // otherwise trigger a re-render when it changes.
  const [displayAsTick, setDisplayAsTick] = useState(0);

  function startRename(view: ViewResponse) {
    setRenameDraft(viewTabLabel(view));
    setRenamingViewId(view.id);
    setMenuOpen(false);
  }

  async function commitRename(view: ViewResponse) {
    const trimmed = renameDraft.trim();
    setRenamingViewId(null);
    if (!onUpdateView || !trimmed || trimmed === viewTabLabel(view)) return;
    try {
      await onUpdateView(view.id, { name: trimmed });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not rename the view", "error");
    }
  }

  async function copyViewLink(view: ViewResponse) {
    const url = `${window.location.origin}${window.location.pathname}?view=${view.id}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied to clipboard", "info");
    } catch {
      showToast("Could not copy the link", "error");
    }
  }

  // "Duplicate view needs no new endpoint — POST .../views then PATCH the
  // config is faithful" (view-tab-bar.md). Switches to the new tab
  // afterward — the point of duplicating is almost always to edit the copy.
  //
  // Live-checklist regression: this used to fetch() the two requests
  // directly instead of going through `onCreateViewRaw`/`onUpdateView` (the
  // hook's own `createView`/`updateView`, which both call `setViews` on
  // success). The duplicate really was created server-side, but the local
  // `views` array DatabaseShell holds never learned about it, so the new
  // tab was invisible until a reload — and `onSelect(created.id)` was
  // switching the active view to an id `views` didn't contain at all.
  async function duplicateView(view: ViewResponse) {
    if (!onCreateViewRaw || !onUpdateView) return;
    try {
      const created = await onCreateViewRaw(`${viewTabLabel(view)} (copy)`, view.type, view.icon);
      await onUpdateView(created.id, { config: view.config, filter: view.filter, sorts: view.sorts });
      onSelect(created.id);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not duplicate the view", "error");
    }
  }

  async function confirmDeleteView() {
    const viewId = confirmingDeleteViewId;
    setConfirmingDeleteViewId(null);
    if (!viewId || !onDeleteView) return;
    try {
      await onDeleteView(viewId);
      if (viewId === activeViewId) {
        const remaining = views.filter((v) => v.id !== viewId);
        if (remaining[0]) onSelect(remaining[0].id);
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not delete the view", "error");
    }
  }

  // view-tab-bar.md's "create first, configure after": one click on a card
  // creates the view IMMEDIATELY — no name prompt, no group-by prompt, no
  // Create button, no validation gate — for every type except Chart. Chart
  // is a disclosed, deliberate exception: unlike Board (M6's Group panel)
  // and Calendar/Timeline (their own placeholder's inline picker, added
  // alongside this rewrite), there is still no post-creation surface
  // anywhere that can set Chart's x/y/stack axes — only `ChartCreateFields`
  // here can. Removing this gate without building that surface first (real
  // scope, matching M12's own "Chart config panel already dense" sizing
  // note — future work, not this session's) would create permanently-stuck
  // Chart views with no way to ever configure them. So Chart alone keeps a
  // pre-creation step, reached only after its own card is clicked, not
  // gating any other type's immediate creation.
  const [addViewOpen, setAddViewOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Notion shows the first tabs and folds the rest into "N more…" (database-table.md
  // §1). The active view always stays visible.
  const MAX_TABS = 5;
  let visibleViews = views.slice(0, MAX_TABS);
  if (views.length > MAX_TABS && !visibleViews.some((v) => v.id === activeViewId)) {
    const active = views.find((v) => v.id === activeViewId);
    if (active) visibleViews = [...visibleViews.slice(0, MAX_TABS - 1), active];
  }
  const hiddenViews = views.filter((v) => !visibleViews.includes(v));
  const [addViewStep, setAddViewStep] = useState<"grid" | "chart">("grid");
  const [chartDraft, setChartDraft] = useState<ChartDraftConfig>(DEFAULT_CHART_DRAFT);

  function closeAddView() {
    setAddViewOpen(false);
    setAddViewStep("grid");
    setChartDraft(DEFAULT_CHART_DRAFT);
  }

  async function handlePickViewType(type: string) {
    if (type === "chart") {
      setAddViewStep("chart");
      return;
    }
    closeAddView();
    try {
      await onCreateView({ type });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not create view", "error");
    }
  }

  // Live-found bug, fixed here: this used to close the popover only AFTER
  // `await onCreateView(...)` resolved — the one place this create flow
  // diverged from `handlePickViewType`'s own "close, THEN create" order.
  // `onCreateView`'s caller (DatabaseShell.handleCreateView) opens the
  // settings sidebar as its very last step, so with the old order that open
  // happened while THIS popover was still mounted — two Radix overlays
  // alive at once, and this popover's own dismissal (triggered by
  // `closeAddView()` a tick later) silently closed the sidebar right back.
  // Reproduced live: the settings sidebar never appeared after creating a
  // Chart, though it opened correctly for every other type. `chartConfig`
  // is read into a local BEFORE closing (which resets `chartDraft`), same
  // reasoning `handlePickViewType` never had to think about since it never
  // reads component state after starting its own close.
  async function handleCreateChart() {
    if (!isChartConfigComplete(chartDraft)) return;
    const chartConfig = buildChartViewConfig(chartDraft, properties);
    closeAddView();
    try {
      await onCreateView({ type: "chart", chartConfig });
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not create view", "error");
    }
  }

  return (
    // Notion's views bar (database-table.md §1): 40px, pill tabs (32px, radius 20px,
    // 14px/500, a 20px layout icon), no underline and no border below.
    <div className="flex h-10 min-w-0 items-center gap-px">
      <div className="flex min-w-0 flex-1 items-center gap-px overflow-x-auto [scrollbar-width:none]">
      {visibleViews.map((view) => {
        const isActive = view.id === activeViewId;
        const tabClassName = `inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-[20px] px-3 text-sm font-medium leading-[16.8px] transition-colors duration-fast ${
          isActive
            ? "bg-surface-active text-ink"
            : "text-ink-secondary hover:bg-surface-hover"
        }`;

        if (renamingViewId === view.id) {
          return (
            <input
              key={view.id}
              autoFocus
              aria-label="View name"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => commitRename(view)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setRenamingViewId(null);
              }}
              className="h-8 rounded-[20px] bg-surface-field px-3 text-sm font-medium text-ink shadow-input outline-none"
            />
          );
        }

        const displayAs = getDisplayAs(view.id);
        void displayAsTick; // read to force re-render after a "Display as" write
        const label = viewTabLabel(view);
        const tabBody = (
          <>
            {displayAs !== "text_only" &&
              (view.icon ? (
                <span className="mr-1.5 text-base leading-none">{view.icon}</span>
              ) : (
                (() => {
                  const Icon = VIEW_TYPE_ICONS[view.type] ?? Table2;
                  return <Icon size={18} strokeWidth={1.75} className="mr-1.5 shrink-0" aria-hidden />;
                })()
              ))}
            {displayAs !== "icon_only" && label}
          </>
        );

        // "Click the active tab -> opens that view's menu. Click an
        // inactive tab -> switches." Only the active tab is a menu trigger;
        // an inactive one keeps the plain switch-on-click behaviour it
        // always had.
        if (!isActive || !onUpdateView) {
          return (
            <button key={view.id} type="button" onClick={() => onSelect(view.id)} className={tabClassName}>
              {tabBody}
            </button>
          );
        }

        return (
          <Popover
            key={view.id}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            width="sm"
            label={`${label} view options`}
            trigger={
              <button
                type="button"
                aria-haspopup="menu"
                aria-label={`${label} view options`}
                className={tabClassName}
              >
                {tabBody}
              </button>
            }
          >
            <MenuList
              root={buildViewTabMenu({
                viewCount: views.length,
                dataSourceName,
                displayAs,
                onSetDisplayAs: (mode) => {
                  setDisplayAs(view.id, mode);
                  setDisplayAsTick((t) => t + 1);
                },
                onRename: () => startRename(view),
                onEditView: () => {
                  setMenuOpen(false);
                  setTimeout(() => onOpenSettings?.(), 0);
                },
                onCopyLink: () => copyViewLink(view),
                onDuplicate: () => {
                  setMenuOpen(false);
                  duplicateView(view);
                },
                onDelete: () => {
                  setMenuOpen(false);
                  setConfirmingDeleteViewId(view.id);
                },
              })}
              nav="flyout"
              onClose={() => setMenuOpen(false)}
              label={`${label} view options`}
            />
          </Popover>
        );
      })}

      {hiddenViews.length > 0 && (
        <Popover
          open={moreOpen}
          onOpenChange={setMoreOpen}
          width={290}
          label="More views"
          trigger={
            <button
              type="button"
              className="inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-[20px] px-2.5 text-sm text-ink-secondary transition-colors duration-fast hover:bg-surface-hover"
            >
              {hiddenViews.length} more…
            </button>
          }
        >
          <div className="p-1">
            {hiddenViews.map((v) => {
              const Icon = VIEW_TYPE_ICONS[v.type] ?? Table2;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    onSelect(v.id);
                  }}
                  className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-ink hover:bg-surface-hover"
                >
                  {v.icon ? <span className="w-5 text-center">{v.icon}</span> : <Icon size={18} strokeWidth={1.75} className="text-ink-icon-strong" />}
                  <span className="truncate">{viewTabLabel(v)}</span>
                </button>
              );
            })}
          </div>
        </Popover>
      )}

      <Popover
        open={addViewOpen}
        onOpenChange={(open) => (open ? setAddViewOpen(true) : closeAddView())}
        // view-tab-bar.md's Anchor table: "Add a new view" ≈390px — the
        // named `sm`/`md`/`lg` tokens (248/285/378px) are all narrower than
        // the 4-column card grid needs, so this is the one popover on this
        // surface with an explicit numeric width instead of a token.
        width={390}
        label="Add a new view"
        trigger={
          <button
            type="button"
            aria-label="Add a new view"
            title="Add a new view"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-ink-icon transition-colors duration-fast hover:bg-surface-hover"
          >
            <Plus size={16} />
          </button>
        }
      >
        {addViewStep === "grid" ? (
          <AddViewGrid onPick={handlePickViewType} />
        ) : (
          <div className="p-2.5 flex flex-col gap-1.5">
            <div className="mb-1 text-xs font-medium text-ink-secondary">Configure chart</div>
            <ChartCreateFields properties={properties} value={chartDraft} onChange={setChartDraft} />
            <div className="flex items-center gap-1.5 mt-1">
              <button
                type="button"
                disabled={!isChartConfigComplete(chartDraft)}
                onClick={handleCreateChart}
                className="h-7 rounded-md bg-accent px-2 text-sm font-medium text-ink-on-accent hover:bg-accent-hover disabled:opacity-40"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setAddViewStep("grid")}
                className="h-7 rounded-md px-2 text-sm text-ink-secondary hover:bg-surface-hover"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </Popover>
      </div>
      {trailing}

      <ConfirmDialog
        open={confirmingDeleteViewId !== null}
        title="Delete this view?"
        description="This only removes the view. The rows themselves are unaffected."
        confirmLabel="Delete view"
        onConfirm={confirmDeleteView}
        onCancel={() => setConfirmingDeleteViewId(null)}
      />
    </div>
  );
}
