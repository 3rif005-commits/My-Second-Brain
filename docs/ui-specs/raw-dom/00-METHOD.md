# How these captures were taken, and what they can and cannot prove

**Tooling:** the `claude-in-chrome` extension against a real logged-in Notion tab
(`app.notion.com` — note `notion.so` redirects there, which matters when granting
extension permissions).

**Capabilities available at capture time:**

| Tool | Status | Used for |
|---|---|---|
| `read_page` (accessibility tree) | ✅ granted | ARIA roles, labels, structure |
| `javascript_tool` | ✅ granted | opening menus, reading `innerText`, walking the overlay container |
| `get_page_text` | ✅ granted | page-level text |
| `computer` (click / hover / screenshot / real keys) | ✅ **granted mid-session** | real clicks, real keys, screenshots |

Menus are opened with **synthetic** `element.click()` from `javascript_tool`, which
works: Notion's buttons respond to it and their overlay renders normally.

## What these captures CANNOT establish — read before writing a spec's Keyboard section

**Synthetic `KeyboardEvent`s do not reach Notion's handlers.** Dispatching
`Escape` at `document`, `document.body` and `document.activeElement` — with `key`,
`code`, `keyCode` and `which` all set — left the page-level `···` menu open. An
outside-click closed it.

This is **not** evidence that Escape fails to close Notion menus. It is evidence that
synthetic key events are not a valid instrument for that question. React's synthetic
event system and Notion's own key handling both discriminate against untrusted events
(`event.isTrusted === false`).

**`computer` permission was granted partway through the session**, so real key events are
now available and keyboard behaviour IS establishable. Everything captured *before* that
grant used synthetic events; anything keyboard-related from that window must be re-tested.

Therefore:

- **A spec's Keyboard section may only cite a capture taken with real key events.** Mark
  each capture with which instrument it used. Do not fill one in from a synthetic result.
- Because `computer` now works, screenshots no longer have to be taken by hand — the
  SCREENSHOT-CHECKLIST can largely be executed from here, EXCEPT that this workspace is in
  **dark mode**, and §1–§16 need light mode for token derivation.
- Hover-only affordances have the same problem in weaker form: a dispatched `mouseover`
  triggers CSS `:hover`-independent JS handlers but not the CSS `:hover` state itself.
  Treat hover findings as provisional and confirm against the user's screenshots.
- Row order, labels, icons, shortcut hints, sub-panel structure and disabled states **are**
  reliable from these captures — they are read out of the rendered DOM, not inferred.

## Privacy

These captures come from the user's real personal workspace. Row *labels and menu
structure* are what this phase needs; their page titles, note contents and database rows
are not. Personal content is stripped from anything committed here — if a capture cannot be
made useful without it, it is not committed.
