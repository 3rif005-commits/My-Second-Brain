# View tab bar

> **Milestone:** M7
> **Ground truth:** `raw-dom/view-tab-bar.txt` · `screenshots/44-view-tab-menu.jpg`,
> `44b-view-display-as.jpg`, `44c-view-tab-menu-two-views.jpg`, `46-new-view-popover.jpg`,
> `46b-view-created-configure-after.jpg`
> **Today:** `ViewTabs.tsx` renders a bare `<button>` per view and an inline creation form
> with a native `<select>`. No per-view menu, no rename, no duplicate, no delete, no
> reorder, no icon.
> **Binds to:** `ViewResponse`, `POST /db/data-sources/{id}/views`, `PATCH /db/views/{id}`,
> and **`DELETE /db/views/{id}` — which does not exist (plan gap B1).**

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

### Against ours

`ViewTabs.tsx:99-122` collects name + type + group-by **before** creating, and `canSubmit`
blocks creation when a Board has no group-by chosen, or when no groupable property exists.

`task-16-brief.md` justified that gate as avoiding Notion's "auto-creates a status property
and mutates the schema". **On this evidence that justification is only half right** —
Notion invented nothing; a Status property already existed and it auto-selected it. The
real difference is *auto-select* versus *require-select*.

> **Open question for the user, not for me to settle:** what does Notion do when **no**
> groupable property exists at all? That is the case the original deviation actually
> guarded. Re-test on a database with no select/status/multi-select before deciding
> whether to keep our gate.

### An unnamed view shows its type

At creation the tab read `New view` with an empty name input; once the sidebar closed
without a name typed, the tab read `Board`. So Notion appears to leave `name` empty and
render the **type** as a fallback label.

Our `createView` defaults `name` to `"New view"` and **stores** it. That is a data-model
difference, not a label: renaming to `""` should show the type again. `TBD` — confirm
before implementing.

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
| Switch view | Client state + URL `?v=<viewId>` | Immediately |
| Rename | `PATCH /db/views/{id}` `{name}` | On blur / Enter |
| Create | `POST /db/data-sources/{id}/views` `{type}` — **no name, no config** | On card click |
| Duplicate | `POST` + `PATCH` client-side | Immediately |
| **Delete** | **`DELETE /db/views/{id}` — does not exist (gap B1)** | Immediately |
| Reorder tabs | `PATCH /db/views/{id}` `{position}` | On drop |
| Display as | **User prefs, not `view.config`** | Immediately |

The active view is already in the URL as `?v=<viewId>` — Notion does this and so should we;
`DatabaseShell` keeps it in component state only.

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
20. Switch views. → assert the URL's `?v=` changes and a reload restores the same view.
