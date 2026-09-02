# Form view — the owner's builder

> Ground truth: live capture, 2026-09-02, against the fixture database's own
> pre-existing "Form builder" view (`app.notion.com`) — screenshots taken
> inline during the session (not saved as numbered files under
> `screenshots/`, unlike the M1–M11 captures; see PROGRESS.md's Log entry for
> this milestone) plus targeted accessibility-tree reads (`read_page`/`find`)
> for exact row text, reproduced under "Rows" below.
> Implements: M12 (Form's own dedicated work)
> Binds to: `FormView.tsx`'s `config.questions[]` (each entry now carries
> `required`, `description?`, `long_answer?`, `display_as?`, `label?`,
> `sync_with_name?`), `config.is_form_closed`, `config.submit_screen`,
> `config.submission_permissions` (always `"none"`, task-44-brief.md)

## What this surface actually is

Real Notion's Form view is **not** a settings panel next to a data grid — it
IS the form, WYSIWYG. The page body renders the actual title/description/
question fields a respondent would see, each one editable in place. There is
no separate "preview" of the builder; the builder and the preview are the
same pixels, just non-interactive (every input in the builder is disabled —
you cannot actually type an answer while editing).

This is the one surface in the whole M1–M12 sweep with the least overlap
with anything already built — no `rows`/`properties` table exists for a
Form view at all (task-44-brief.md's own framing, restated in M12's task
breakdown) — so this spec captures it from scratch rather than diffing
against an existing surface.

## Trigger

Selecting a "Form builder"-type view tab. No hover state — the whole page
renders immediately; there is no collapsed/expanded toggle.

## Anchor

Not a popover — full page content, scrolling normally inside the view pane.
Two things DO open as popovers, both anchored to their own trigger:
- Each question card's `···` (top-right of the card) → "Question options",
  anchored under the trigger, matching every other MenuPanel in this app.
- The toolbar's sliders icon → "Form settings" (see "Toolbar" below).

## Rows — the page body, top to bottom

| # | Element | Notes |
|---|---|---|
| 1 | "Form title" | Placeholder-only when empty — **renders nothing to a respondent** when blank (confirmed: the live Preview modal showed no title block at all with an empty title). Editable inline. |
| 2 | "Description (optional)" | Same — renders nothing when blank. |
| 3 | Permission line | `🔒 Only members at <workspace> can fill out this form.` + a `Change` link. |
| 4 | One card per question, in `config.questions[]` order | See "Question card" below. |
| 5 | `+` circular button | Always visible below the last card (not hover-gated, unlike Gallery/Feed's row menus). Opens "Add question". |

**This app's own deviation, disclosed:** #1/#2 (form title/description shown
to respondents) are **not built** — `config` has no field for them, and
adding one would mean widening the contract Task 43's `PublicFormClient.tsx`
also reads, briefed and built independently (task-43-brief.md). Out of scope
for a single M12 session; see "Deferred" below. This app's own permission
line (#3) is unchanged from before this milestone — static text, no working
`Change` link — see "Change" below for why that's still correct.

## Question card

Each card is a bordered box containing:

| Element | Behavior |
|---|---|
| Label | The property's own `name`, bold. A red `*` suffix when `required`. |
| `···` trigger | Always visible (not hover-gated). Opens "Question options" (below). |
| Description line | Only rendered when the "Description" toggle is on — an inline, editable caption under the label. |
| Answer preview | A DISABLED input/radio-list/checkbox-list/etc., shaped per the property's type (see "Per-type preview" below). Never actually collects input here. |
| `+ Add option` | select/status/multi_select only — a REAL write (adds a new `Option N` placeholder option to the property, same convention `EditPropertyPanel.tsx`'s own `addOption` already uses), not part of the preview. |

### Per-type preview, as captured

Only `select`/`status` were captured with real content (the fixture's
`Select` property, option `Alpha`) — the other 7 of this app's 8 known
types were inferred from Notion's own "Question type" list shape (radio vs.
checkbox vs. single-line) and are marked accordingly:

| Property type | Preview | Captured? |
|---|---|---|
| `title`, `rich_text` | Single-line input, placeholder "Respondent's answer"; a textarea when "Long answer" is on | title/rich_text captured (Name question) |
| `select`, `status` | A disabled radio circle per option, plain text label (no colour pill — unlike this app's own database cells, the builder's preview is NOT coloured) | captured |
| `multi_select` | Disabled checkbox per option | inferred from Notion's own "Checkbox" question-type icon shape, **not captured directly** |
| `number` | Single-line input, same placeholder | inferred, **TBD** |
| `date` | A date-shaped field | inferred, **TBD** |
| `checkbox` | A single checkbox | inferred, **TBD** |

## Question options (the `···` popover)

Captured against both the title question (`Name`, `Question type: Title`)
and a `select`-type question (`Select`) — the row set is **conditional**,
not fixed:

| # | Row | Kind | Shown when | Notes |
|---|---|---|---|---|
| 1 | Required | toggle | always | |
| 2 | Description | toggle | always | reveals the card's inline description field |
| 3 | Long answer | toggle | `title`/`rich_text` only | switches the preview to a textarea |
| 4 | Show options as | submenu (List view / Dropdown) | `select`/`status` only | |
| 5 | Question type | value row, e.g. "Multiple choice" | always | **This app disables it** — see "Question type" below |
| 6 | View linked property | submenu | always | opens Notion's own generic name+type mini-panel for a type with no dedicated editor; for number/select/multi_select/status it opens the SAME richer config editor its own column header menu does |
| 7 | Sync with property name | toggle | always | captured OFF by default for a newly-added `select` question, ON for `title` — this app defaults it ON (`sync_with_name` absent = ON) for every question, since a freshly-added question has no reason to diverge yet |
| 8 | Move question | submenu (Move up / Move down) | only when there is more than one question | absent entirely on a lone question, confirmed by re-opening Title's own menu before and after adding a second question |
| 9 | Add conditional logic | row, blue upsell badge | always | **opens Notion's own Business-plan upgrade page** — confirmed live, not assumed |
| 10 | Duplicate question | row | always | |
| 11 | Delete question | row | always | |

### Question type

Notion's own 11 question types (captured via the type-picker's own menu,
both for adding a question and for changing an existing one's type):
Text, Multiple choice, Date, Person, Files & media, Number, Checkbox, Email,
URL, Phone, Place.

**This app disables the row** (`disabledReason`: "Change a property's type
from its own column header menu") rather than building a second, narrower
type-picker: this app's own type-conversion matrix (Phase 0b's B5,
`services/db/properties/convert.py`) already has ONE real entry point (the
column header menu's own "Change type" row, M1) with its own legality rules,
and duplicating it here with a different, Notion-shaped type list that
doesn't match our own convertible-type matrix would be a second, subtly
wrong copy — the exact failure mode `property-create-edit.md`'s own
"Deferred" section already named for formula/relation/rollup.

### View linked property

Opens Notion's own generic "Edit property" mini-panel for a type this app
has no dedicated config editor for (`Aa <name>` field, a locked `Type` row,
"Learn about properties") — confirmed live on the Title question (`Type:
Title`, not editable — title conversion is illegal in this app too, B5).
For number/select/multi_select/status, this app instead opens the SAME
`editPropertyPanel()` its own column header menu already uses (M2/M2b) —
one editor, two entry points, not a second copy (the exact principle
`property-create-edit.md` already states).

## Add question (the `+` popover)

Captured with the fixture's own remaining properties (Multi-select, Text,
Select, Number, Person, Number, Checkbox, URL — "Show 4 more"):

Two sections:
1. **Existing properties** — a searchable list, one row per unused
   property: icon + name, the type name as a caption underneath.
2. **New question** — the SAME 11 question types as "Question type" above,
   for creating a brand-new property directly from the form.

**This app builds only section 1.** Section 2 (creating a new property from
inside the form, rather than from the table's own `+` column) is real,
captured, and deliberately deferred — see "Deferred" below.

## Toolbar (outside this component, `ViewToolbar.tsx`)

Captured live: a Form view's own toolbar row shows exactly THREE icons —
Automations (⚡), AI Autofill (✨), Settings (⚙, sliders) — no Filter, no
Sort, no Search — plus a "Preview" text button and a filled blue "Share
form" button, neither of which are icon-only like the other three.

This is a genuine, capture-confirmed per-view-type difference from every
other view (which all show the full six-icon set). Fixed this session in
`ViewToolbar.tsx`: `view.type === "form"` now hides Filter/Sort/Search and
adds a "Preview" link (`/forms/{viewId}`, opens in a new tab). **"Share
form" was NOT added** — its own popover (Who can fill out / Anonymous
responses / Access to submission / copy link) is the same content this
app's `FormView.tsx` already renders inline in the page body (the
"Settings"/"Share" sections) — a second toolbar entry point opening the
identical content would be the same "two copies drift" failure mode this
workstream avoids everywhere else (M8's DatabasePageMenu, M10's row peek
`⋯`).

The toolbar's own sliders icon opens "Form settings" (rename view, New
question, Automations, Submit screen, Source, Delete form — see "Settings
panel" below) — **not built as a popover this session**; this app keeps
those controls inline in the page body instead (a disclosed simplification,
not an oversight — see "Deferred").

## Settings panel (captured, not built as its own popover)

| Row | Notes |
|---|---|
| View name | rename field, same as every other view's settings sidebar |
| New question | same picker as the page's own `+` button |
| Automations | same panel the toolbar's own ⚡ icon opens — a second entry point to the SAME thing, not a copy |
| Submit screen | **blue "Plus" badge — gated behind Notion's Plus plan.** Clicking it opens the plan-comparison/upgrade page, not an editor. Free-plan forms get a plain, non-customizable black Submit button. |
| Source | the data source picker, greyed here since this fixture has one source |
| Delete form | same `DELETE /db/views/{id}` (B1) every other view's delete-view flow already uses |

**This app's Submit screen editing (button text/color, confirmation
title/body) is ADDITIVE, not a parity gap** — real Notion doesn't offer
ANY submit-screen customization on the free plan this capture ran against.
Kept as-is, unchanged this session (same class of finding as M10's "Open in
Workspace" — a real capability with no Notion equivalent to match).

## Change (the permission popover)

Captured live: "Who can fill out" (3 options — workspace members with link
/ "Anyone on the web with link" `Public` / "No access" `Closed`),
"Anonymous responses" (toggle), "Access to submission" (a separate 
respondent-visibility control), a copy-link row.

**Confirms, rather than changes, task-44-brief.md's own existing call**:
both controls need a membership/respondent-account concept this
single-owner app has none of. This app's existing static permission line +
its own `is_form_closed` toggle (a simplified 2-state open/closed, folded
from Notion's 3-state picker) is correct as originally built — no code
change from this finding.

## Preview

Notion's own "Preview" button opens the respondent-facing form inside a
CENTER-peek modal (`?p=<id>&pm=c` — the identical URL shape this app's own
row peek already uses for every other page), with a "Submitting response as
<avatar> <name>" chip at the top (since "who can fill out" is
member-scoped here) and a plain black Submit button (see "Settings panel"
above — button-color customization is Plus-gated). Expanding it (⤢) opens
the same content as a full page at `/p/<id>` — this app's own
`/forms/{viewId}` public route is the equivalent.

This app's own "Preview" (added to the toolbar this session) opens
`/forms/{viewId}` in a new browser tab rather than a center-peek modal —
simpler, and correct in spirit (it shows the real respondent-facing page,
Task 43's own surface), but not a pixel-identical peek. Disclosed, not
silently different.

## Keyboard

Not captured — TBD, matching this workstream's own convention for every
other surface's keyboard behavior until specifically captured.

## States

Not systematically captured this session (empty/loading/error). The one
state that WAS captured: a brand-new Form builder view before any question
is added still shows the always-present title/description/permission-line/
`Name` (title property, auto-added) — there is no "0 questions" empty
state distinct from the normal render, since the title question is
mandatory and always present.

## Persistence

Unchanged shape from before this milestone: everything on this page PATCHes
`config` immediately except Submit-screen text/color fields, which debounce
at 600ms (matching `TemplateEditor.tsx`'s own convention). The five new
per-question fields (`description`/`long_answer`/`display_as`/`label`/
`sync_with_name`) PATCH immediately on toggle; the two TEXT fields they
reveal (the description caption, the un-synced label) commit on blur, not
per keystroke — matching `OptionRenameHeader`'s own blur-commit convention
(`EditPropertyPanel.tsx`) rather than inventing a new one.

## Checklist

Two separate live passes, both real (not guessed):

1. **Against real Notion** (the capture itself, `app.notion.com`) — the
   fixture database's own pre-existing "Form builder" view: the question
   card shape, the full "Question options" row set (including confirming
   "Add conditional logic" genuinely opens Notion's real Business-plan
   upgrade page, and "Submit screen" genuinely opens the Plus-plan upgrade
   page — neither guessed), the "Add question" picker's two sections, the
   toolbar's 3-icon-plus-Preview-plus-Share-form shape, and the `Preview`
   center-peek modal's respondent-facing render.
2. **Against this app's own build** (`localhost:3000`, a scratch database
   with a Select property/option added for the session): created a real
   Form view via the M7 create-flow grid, added Title and Select as
   questions via the `+` picker, confirmed the Select card's disabled radio
   list + working "+ Add option" (a real PATCH, confirmed via a genuinely
   new "Option 2" appearing), opened "Question options" on both questions
   and confirmed the row set differs correctly by type (Title gets "Long
   answer", not "Show options as"; Select gets the reverse), toggled "Long
   answer" and watched the Title preview swap to a textarea, toggled "Show
   options as: Dropdown" and watched the Select preview swap to a disabled
   dropdown button, opened "View linked property" on both (Title → the
   generic read-only name+type panel; Select → the SAME `editPropertyPanel`
   config editor the column header menu uses, with live Sort/Options rows),
   toggled "Description" and watched the inline caption field appear, and
   clicked the toolbar's new "Preview" link and confirmed it opens
   `/forms/{viewId}` — Task 43's own real public page — in a new tab.

A real bug was found and fixed during this second pass's own PREP work, not
the pass itself: `DatabaseShell.test.tsx`'s pre-existing "two config
PATCHes... race" test still clicked a bare `getByLabelText("Question 1
required")` checkbox that this rebuild removed (Required moved into the
"···" popover) — its `TestingLibraryElementError` throw was leaving
`user-event`/mock state in a way that cascaded into 3 OTHERWISE-UNRELATED
later tests in the same file (two `queueSortsUpdate`/`queueGroupByUpdate`
race tests, one Board-view-creation test) failing with `vi.waitFor`
timeouts — confirmed by isolating each failing test (all pass alone) and by
reverting `FormView.tsx` alone (all 35 pass). Not a jsdom timing flake, a
real test needing an update for the new UI; fixed by opening the popover
first, matching every other updated test in this milestone.

Unit tests (`FormView.test.tsx`, `ViewToolbar.test.tsx`,
`DatabaseShell.test.tsx`) cover every `config`-writing path listed above.
Frontend 61 files / 953 tests green, `tsc` clean.

## Deferred, ranked

1. **Form title/description shown to respondents** — real, captured,
   requires widening the `config` contract Task 43's `PublicFormClient.tsx`
   also reads. Out of scope for a unilateral single-session change.
2. **"New question" (create a brand-new property from the form)** — real,
   captured (the same 11-type picker as "Question type"). This app's `+`
   popover only offers linking an EXISTING property.
3. **Per-type answer previews for `number`/`date`/`checkbox`/
   `multi_select`** — built from inference, not a live capture of each
   one's exact Notion shape (only `title`/`rich_text`/`select` were
   captured with real content).
4. **A working "Form settings" toolbar popover** (rename view / Automations
   entry point / Source / Delete form) — this app keeps that content inline
   in the page instead; a disclosed simplification, not a retrofit of the
   real popover shape.
5. **A center-peek "Preview"** matching Notion's own `?p=&pm=c` modal — this
   app's own Preview opens the public route in a new tab instead.
6. **Keyboard**, **loading/error states** — not captured at all.
