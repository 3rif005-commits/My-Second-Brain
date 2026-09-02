# View tab bar

> **Milestone:** M7
> **Ground truth:** `raw-dom/view-tab-bar.txt` · `screenshots/44-view-tab-menu.jpg`,
> `44b-view-display-as.jpg`, `44c-view-tab-menu-two-views.jpg`, `46-new-view-popover.jpg`,
> `46b-view-created-configure-after.jpg`
> **Today (2026-09-02):** `ViewTabs.tsx` renders a per-view tab with rename/duplicate/
> delete/display-as, all live-verified working. "+ New view" is a real create-first-
> configure-after popover (`AddViewGrid`): a 4-column, 10-card grid (Map excluded), one
> click creates the view immediately with no name/config prompt, opens the settings
> sidebar afterward. Chart is a disclosed exception — see its own section below.
> `?view=<viewId>` is read on load and written on every switch (`DatabaseShell.tsx`'s
> `selectView`), previously write-only since M7. Reorder tabs by drag is still unbuilt.
> **Binds to:** `ViewResponse`, `POST /db/data-sources/{id}/views`, `PATCH /db/views/{id}`,
> `DELETE /db/views/{id}` (Phase 0b, B1).

---

## Trigger

The tab bar itself, immediately under the database title.

| Gesture | Result |
|---|---|
| Click an **inactive** tab | Switches to that view |
| Click the **active** tab | Opens that view's menu |
| Click the `+` right of the last tab | Opens "Add a new view" |

Our `ViewTabs` only ever switches — clicking the active tab does nothing.

The `+` is revealed on hover/focus of the tab bar, not permanently visible.

---

## Anchor

| Popover | Placement | Width |
|---|---|---|
| View menu | Below the tab, left-aligned | ≈220px |
| "Display as" flyout | Right of the view menu, parent stays visible | ≈215px |
| "Add a new view" | Below the `+`, left-aligned | ≈390px |

---

## Rows — a view's own menu

**The row set depends on how many views exist.** Captured at one view and at two.

| # | Icon | Label | Right side | Sub-panel | 1 view | 2+ views |
|---|---|---|---|---|---|---|
| 1 | ✏ | **Rename** | — | ❌ | ✅ | ✅ |
| 2 | 🎨 | **Display as** | — | ✅ flyout | ✅ | ✅ |
| 3 | ⚙ | **Edit view** | — | ❌ | ✅ | ✅ |
| 4 | ⇄ | **Source** | `New database` | ✅ (2+ only) | greyed | **active, gains a chevron** |
| — | | *divider* | | | | |
| 5 | 🔗 | **Copy link to view** | — | ❌ | ✅ | ✅ |
| 6 | ▤ | **Add view to sidebar** | — | ❌ | ✅ | **greyed** |
| — | | *divider* | | | | |
| 7 | ⧉ | **Duplicate view** | — | ❌ | ✅ | ✅ |
| 8 | 🗑 | **Delete view** | — | ❌ | **absent** | **present** |

### Notes

- **`Delete view` is present iff view count > 1.** The last view cannot be deleted.
  Enforce client-side *and* server-side. This scopes plan gap **B1** — the endpoint is
  needed only for the multi-view case.
- **`Rename` is a row here**, yet the view settings sidebar renames a view via an inline
  input at the top of its own panel. Both exist. Notion is inconsistent; implement both,
  since users will reach for either.
- The `Source` and `Add view to sidebar` state changes between one and two views are
  **observed but unexplained**. Do not encode a rule from two data points — re-capture
  deliberately before speccing them.
- **`Add view to sidebar`** has no analogue: we have no per-view sidebar entries. Omit
  deliberately and say so.
- **`Duplicate view`** needs no new endpoint — `POST .../views` then `PATCH` the config is
  faithful.

### Sub-panel — "Display as"

Flyout, opens right. Governs **the tab's own presentation**, not the view type.

| Row | Right side |
|---|---|
| **Text and icon** | ✓ |
| **Text only** | — |
| **Icon only** | — |
| *divider* | |
| *Only applies to you* | footer, muted |

The footer marks this a **per-user** preference. It must **not** go into `view.config`,
which is shared — put it in local/user prefs. (Single-user app, so this is largely
informational, but the storage location still matters.)

---

## "Add a new view"

Header: **Add a new view**. Then a **four-column** card grid, each card an icon above a
label:

```
Table*    Board       Gallery    List
Chart     Dashboard   Timeline   Feed
Map       Calendar    Form
────────────────────────────────────
⧉  New data source
```

Eleven types. `Table` is the highlighted default.

### There are (at least) three different view-type card grids

| Grid | Types | Columns | Purpose |
|---|---|---|---|
| **Add a new view** | 11 — incl. Dashboard **and** Form | 4 | Create |
| Settings → Layout, on a **Table** | 9 — no Dashboard, no Form | 3 | Convert |
| New-view sidebar, on a **Board** | 10 — incl. Dashboard, no Form | 3 | Convert |

Form and Dashboard can be **created** but not **converted into**. The Table-vs-Board
difference is **observed, cause not established** — re-capture across several view types
before the spec asserts a rule.

**Do not build one shared view-type picker and assume it serves both.** Same card shape,
different eligible set, different column count.

Our `ViewTabs` offers exactly Notion's eleven minus Map, which we cut deliberately (no
geocoding or tile provider). **The gap is presentation, not coverage** — a native
`<select>` versus a card grid.

`New data source` creates an additional data source under the database. Our schema
supports it (`db_databases → db_data_sources` is 1:N) but `create_database` mints exactly
one and no endpoint adds another. **Out of scope — note, do not build.**

---

## Creation behaviour — create first, configure after

**Confirmed live.** One click on a card:

1. Creates the view **immediately** — no name prompt, no group-by prompt, no Create button,
   no validation gate.
2. Makes it the active tab, labelled with its **type** (`Board`), not a stored `"New view"`.
3. Renders it at once. A Board **auto-selected an existing `Status` property** to group by
   and drew real columns with counts.
4. Opens the view settings sidebar for configuring *afterwards*.

### Built (2026-09-02), and how it settles both of this section's own open questions

`ViewTabs.tsx`'s `AddViewGrid` now creates immediately, no name/config prompt, for every
type except Chart (see below). `DatabaseShell.tsx`'s `handleCreateView` auto-selects a
Board's group-by from an EXISTING select/status/multi_select property (restricted to that
three-type "kanban-native" family, not the wider `GROUPABLE_PROPERTY_TYPES` list the Group
panel and column header use — a fresh Board grouped by its own Title or a Created-time
property would be a strange first impression a real select-family property never risks),
and a Calendar/Timeline's date property from an existing `date` property, same pattern.

**Settled, live-tested against a real empty Notion database (2026-09-02):** when NO
select/status/multi-select property exists at all, Notion auto-creates a brand-new Status
property (Not started/In progress/Done) and mutates the schema. **Asked the user
directly rather than guessing which to build** (`AskUserQuestion`) — decision: **keep this
app's refusal to auto-create one.** A Board created with nothing to group by lands on
`BoardView.tsx`'s existing "no groupable property yet" placeholder instead, fixable
afterward via the settings sidebar's Group panel (M6) — the same "asks rather than
invents" spirit `task-16-brief.md` originally had, now confirmed against real evidence
instead of assumption. Calendar/Timeline mirror this with their own inline "Choose a date
property…" picker in the placeholder (new this session — there was previously no
post-creation way to ever set `date_property_id` at all, a real gap this create-flow
rewrite would otherwise have made worse by removing the only pre-creation entry point).

**Settled:** an empty-string `name` (this app's `createView("", type)`, not the literal
`"New view"` it used to store) DOES fall back to showing the view's type as the tab label
— `viewTabLabel` already handled this correctly from M7; only the create-time default
needed to change from the stored literal to a genuinely empty string.

### Chart is a disclosed, deliberate exception

Chart's card does not create immediately — it opens a second step in the SAME popover
(`ChartCreateFields`, the same x/y/stack-axis picker this flow used to show before every
type, per-type, gated on `canSubmit`). Reason: unlike Board (Group panel) and Calendar/
Timeline (their own placeholder's picker, above), there is still no surface anywhere that
can set a Chart's axes after creation — only this form can. Removing the gate without
building that surface first would create permanently-stuck Chart views. Matches the M12
plan's own sizing note ("Chart config panel already dense — mostly a `<select>` → MenuList
migration") — building a real post-creation Chart config panel is that future work, not
this session's.

---

## Keyboard

`TBD` throughout — not tested with real key events on this surface.

---

## States

| State | Behaviour |
|---|---|
| One view | No `Delete view`. `Source` greyed, `Add view to sidebar` active |
| Two or more views | `Delete view` present. `Source` active with a chevron, `Add view to sidebar` greyed |
| Unnamed view | Tab renders the view **type** |
| Active vs inactive tab | Active tab has a filled/raised background; clicking it opens the menu rather than switching |
| Read-only source (`is_virtual`) | All Notes has no `db_views` rows at all. Suppress the whole bar, matching `DatabaseShell.tsx:400` |
| Many views | Overflow behaviour `TBD` — our `ViewTabs` wraps (`flex-wrap`); Notion's is uncaptured |

---

## Persistence

| Action | Writes | When |
|---|---|---|
| Switch view | Client state + URL `?view=<viewId>` (built, read on load 2026-09-02) | Immediately |
| Rename | `PATCH /db/views/{id}` `{name}` | On blur / Enter |
| Create | `POST /db/data-sources/{id}/views` `{name: "", type}` — no config; Board/Calendar/ Timeline/Chart follow with one PATCH each if a value was auto-selected/configured | On card click (Chart: on its own Create) |
| Duplicate | `POST` + `PATCH`, through the hook's own `createView`/`updateView` (not a bare `fetch()` — that was a live-checklist regression, fixed M7-M11, re-verified live 2026-09-02) | Immediately |
| Delete | `DELETE /db/views/{id}` (Phase 0b, B1) | Immediately |
| Reorder tabs | `PATCH /db/views/{id}` `{position}` | On drop — **still unbuilt** |
| Display as | User prefs (`viewTabPrefs.ts` localStorage), not `view.config` | Immediately |

**Built and live-verified (2026-09-02):** the active view's `?view=` param — read once on
load (only overrides the hook's own "keep current tab, else first view" default when the
param names a real view of this database; a stale/foreign id is silently ignored) and
written on every switch, preserving every other param (`?p=`/`?pm=` included) — the
identical `router.replace`-preserving-params pattern `TableView.tsx`'s row peek already
used for its own `?p=`/`?pm=`. `DatabaseShell.tsx`'s `selectView` is the one place this
happens; every caller of the old bare `setActiveViewId` (tab click, post-create select,
duplicate, delete's fall-back-to-remaining) now routes through it.

---

## Checklist

1. Open a database with exactly one view. → assert one tab and no `+` until the bar is hovered.
2. Hover the tab bar. → assert a `+` appears right of the last tab.
3. Click the **active** tab. → assert a menu opens (not a no-op switch).
4. → assert rows: Rename, Display as, Edit view, Source, Copy link to view, Add view to sidebar, Duplicate view.
5. → assert **`Delete view` is absent** with only one view.
6. Click `Display as`. → assert a flyout right of the menu with Text and icon ✓ / Text only / Icon only, and a muted `Only applies to you` footer.
7. Click `Edit view`. → assert the view settings sidebar opens (the M3 surface).
8. Click `+`. → assert a popover headed `Add a new view` with a **four-column** card grid of 11 types, `Table` highlighted.
9. → assert `Dashboard` and `Form` are present here.
10. Open Settings → Layout on a Table view. → assert its grid has **three** columns and **omits** Form.
11. Click the `Board` card. → assert the view is created **immediately**: no name prompt, no group-by prompt, no Create button.
12. → assert the board renders at once with real group columns, each showing a name and a count.
13. → assert a settings sidebar opens for post-creation configuration.
14. → assert the new tab's label is the view **type**, not the literal `New view`.
15. Open the new view's menu. → assert **`Delete view` is now present**.
16. Click `Duplicate view`. → assert a third tab appears with the same type and config.
17. Click `Delete view`. → assert the tab disappears and the view is gone after reload.
18. Delete down to one view, open its menu. → assert `Delete view` is absent again.
19. Rename a view. → assert the tab label updates and persists across reload.
20. Switch views. → assert the URL's `?view=` changes and a reload restores the same view.

**Re-verified live against the running app, 2026-09-02** (the M7-M11-era passes only ever
tested the OLD select-based create form): 7, 8 (our own 4-column, 10-card grid — Map
excluded, matching this app's own established deviation, not Notion's 11), 11-14 (Gallery
card: created immediately, tab showed `Gallery`, settings sidebar opened, `?view=` in the
URL), 16 (Duplicate: new tab appeared immediately, selected, config copied), 17 (Delete:
confirm dialog, tab removed, fell back to Default view), 19 (Rename → reload → persisted),
20 (`?view=` restored the exact same tab after a hard reload). One real bug found and
fixed along the way (not a checklist step, since this create flow didn't exist before this
session): Chart's own settings-sidebar-opens-afterward silently never fired — see
`REVIEW-LOG.md`'s "view-tab-bar.md, M7 create-flow rewrite" entry. Steps 1, 2, 5, 6, 10,
18 not independently re-run this session (no code path affecting them changed) — see
PROGRESS.md's M7 section for their last confirmed pass.
