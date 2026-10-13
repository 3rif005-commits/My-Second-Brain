# Settings window

Source: `_raw/j-settings.md` (measured 2026-10-13, read-only, viewport 1300×597). Every preference with its options and default is listed in `../preferences.md`.

Screenshots (personal data blanked to "Jane Doe" / "user@example.com" / "Workspace"):
[Preferences](../screenshots/j-preferences-light.png) · [2](../screenshots/j-preferences-2-light.png) · [3](../screenshots/j-preferences-3-light.png) · [dark](../screenshots/j-preferences-dark.png) · [Theme select menu](../screenshots/j-select-menu-theme-light.png) ·
[My account](../screenshots/j-my-account-light.png) · [2](../screenshots/j-my-account-2-light.png) · [3](../screenshots/j-my-account-3-light.png) · [dark](../screenshots/j-my-account-dark.png) ·
[Notifications](../screenshots/j-notifications-light.png) · [2](../screenshots/j-notifications-2-light.png) · [3](../screenshots/j-notifications-3-light.png) · [dark](../screenshots/j-notifications-dark.png) ·
[Mail & Calendar](../screenshots/j-mail-calendar-light.png) ·
[General](../screenshots/j-general-light.png) · [2](../screenshots/j-general-2-light.png) · [3](../screenshots/j-general-3-light.png) · [3 dark](../screenshots/j-general-3-dark.png) ·
[People (guests)](../screenshots/j-people-light.png) · [People (members)](../screenshots/j-people-members-light.png) ·
[Import](../screenshots/j-import-light.png) · [2](../screenshots/j-import-2-light.png) ·
[Notion AI](../screenshots/j-notion-ai-light.png) · [2](../screenshots/j-notion-ai-2-light.png) · [3](../screenshots/j-notion-ai-3-light.png) · [models picker](../screenshots/j-notion-ai-models-picker-light.png) · [connectors](../screenshots/j-notion-ai-connectors-light.png) · [skills](../screenshots/j-notion-ai-skills-light.png) ·
[Meeting notes](../screenshots/j-meeting-notes-light.png) · [2](../screenshots/j-meeting-notes-2-light.png) ·
[Connections](../screenshots/j-connections-light.png) · [connected](../screenshots/j-connections-connected-light.png) ·
[Notion MCP](../screenshots/j-notion-mcp-light.png) ·
[Public pages](../screenshots/j-public-pages-light.png) · [2](../screenshots/j-public-pages-2-light.png) ·
[Emoji](../screenshots/j-emoji-light.png) · [Developer](../screenshots/j-developer-light.png) · [Teamspaces](../screenshots/j-teamspaces-light.png) ·
[Settings search](../screenshots/j-search-results-light.png)

---

## 1. Modal
- It opens from the **workspace switcher → Settings**, with the **Preferences** tab active by default.
- Backdrop `rgba(15,15,15,0.6)` (dark 0.8). The card is **90vw (max 1512px) × calc(100% − 100px)**, centred, **radius 12px**, `shadow.modal`, `transition: transform .2s`. Close **×** is 22×22, round, 12px from the top-right corner, over the content.
- Esc closes it.

## 2. Left navigation (240px)
- Panel bg **`rgb(249,248,247)`** (dark `rgb(32,32,32)`). There is no border; the contrast with the content is the divider. In dark the nav is *lighter* than the content (`rgb(25,25,25)`).
- **Search field** at the top (outside the scroll): 224×28, 8px from the top and left, radius 6px, bg `rgba(66,35,3,0.03)`, inset ring `rgba(28,19,1,0.11)`, padding 4px 6px, 14px, "Search settings". It is **auto-focused** with the blue ring.
- The list has padding 8px and gap 2px, and scrolls on its own.
- **Section headers** (Account, Workspace, Features, Admin, Access & billing): **12px / 500 / 16px `rgb(161,158,153)`** (dark `rgb(125,122,117)`), padding 6px 8px. Each has ≈6px of extra space above it.
- **Items** (`role=tab`): **209×28, radius 6px, padding 4px 6px, gap 6px**, 20px icon `rgb(142,139,134)`. Label **14px / 500 / 20px**: inactive `rgb(95,94,89)`, **active `rgb(44,44,43)`** (dark `rgb(188,186,182)` / `rgb(240,239,237)`).
- **Active and hover bg: `rgba(33,27,23,0.05)`** (dark active `rgba(255,255,255,0.082)`). `transition: background .1s ease-in-out`.
- The first Account item is the **user's avatar (22px circle) + name** (→ "Account" page).
- Badge "New": 11px / 500 blue on `rgba(0,124,215,0.094)`, radius 4px, padding 2px 4px, right-aligned.
- "Upgrade plan" (Access & billing): blue ⬆ icon + 14px / 500 `rgb(39,131,222)` label.

**Tabs in this build (in order):**
| Section | Tabs |
|---|---|
| Account | <name> (Account) · Preferences · Notifications · Mail & Calendar |
| Workspace | General · People · Import |
| Features | Notion AI · Meeting notes [New] · Connections · Notion MCP · Public pages · Emoji · Developer |
| Admin | Teamspaces |
| Access & billing | Upgrade plan |

There are **no** separate Security, Identity, Billing or Language & region tabs. Language lives in Preferences.

**Settings search:** typing **replaces the nav list with results**, grouped under breadcrumb lines ("Account / Preferences", with the tab icon). Each result has two lines: the label (14px / 500, matched text bold/dark) and the help text (13px grey). Both truncate. A round ⊗ clear button appears in the field.

## 3. Content column
- Scroller padding **36px 60px 44px**. The inner column has **max-width 800px**, and a **44px gap** sits between the page header and the first section.
- **Page title:** **26px / 600 / 32px**, primary colour. **Description** 16px / 24px primary, 8px below.
- **Section header:** **16px / 500 / 24px**, padding-bottom 12px, **border-bottom 1px `rgba(42,28,0,0.07)`**, margin-bottom 16px. Sections are **48px** apart.
  - Variant on the Notion AI, Meeting notes, Developer and Connections tabs: **17px / 600 / 22px**, sometimes **without** the hairline.
  - A header can carry a 14px ⓘ after its text.
- **Setting row:** flex, space-between, gap 12px, vertically centred. **Rows are 24px apart.**
  - Left: **label 14px / 500 / 20px** primary, then **help text 13px / 400 / 18px `rgb(125,122,117)`** (dark `rgb(173,169,163)`) 4px below. Help wraps at ≈60% of the row width. A one-line-help row is 42px tall; a two-line one is 60px.
  - Right: the control.
  - **Stacked variant** (General tab): label and help on top, then a full-width control 12px below.
- Help-text links are underlined in the same grey. `<strong>` key names are weight 700 in the same grey. Body-copy links (outside help text) are blue `rgb(39,131,222)` with no underline.
- Beta badge: 11px / 500 `rgb(142,139,134)` on `rgba(42,28,0,0.07)`, radius 4px, padding 2px 4px, 6px after the label.
- "ID" rows (User ID, Workspace ID): a 12px grey label, the UUID right-aligned in 12px grey, and a 24×24 copy button.

## 4. Controls
| Control | Spec |
|---|---|
| **Select button** ("Light ⌄") | height 28, width = content, **padding 0 8px, gap 6px, radius 6px, border 1px solid `rgba(28,19,1,0.11)`**, 14px / 500 primary, chevron 8.6×14 `rgb(142,139,134)`. Transparent at rest. Hover/open bg `rgba(33,27,23,0.05)`. **Disabled: opacity 0.4** |
| **Select menu** | 250px wide (wider for long lists), **right-aligned to the button, 4px below**, radius 10px, `shadow.menu`, padding 4px. Items 28px, 14px. **Selected = ✓ at the right, no bg.** Long lists scroll and use two-line items (e.g. Language: native name 14px + English name 12px grey). Date format items show a grey example on the right |
| **Toggle** | 30×18, radius 44px, padding 2px. Off `rgba(135,131,120,0.3)` (dark `rgba(202,204,206,0.3)`), on `rgb(39,131,222)`. 14px white knob, `translateX(12px)` when on. Disabled-on: blue at opacity 0.4. Locked: a lock icon before the toggle, at opacity 0.4 |
| **Text input** (inline) | 250×28, bg `rgba(66,35,3,0.03)`, ring `rgba(28,19,1,0.11) 0 0 0 1px`, radius 6px, padding 4px 10px, 14px |
| **Text input** (stacked) | 400×34, **15px / 26px**, the same field style |
| **Token input** | full width × 32, radius 4px, field style, padding 7px 9px 0, placeholder "Type an email domain…" |
| **Primary button** | height 28, padding 0 8px, radius 6px, 14px / 500, bg `rgb(39,131,222)`, text `rgb(243,249,253)`. Disabled opacity 0.4 |
| **Secondary button** | transparent, **border 1px `rgba(28,19,1,0.11)`** (dark `rgba(255,255,235,0.1)`), primary text, hover `rgba(33,27,23,0.05)` |
| **Danger button** | **bg `rgba(223,22,0,0.094)`** (dark `rgba(255,104,92,0.24)`), **text `rgb(229,100,88)`**, no border. A filled pale red, unlike the outlined danger button in confirm dialogs |
| **Blue-tint button** ("Copy link") | bg `rgba(0,124,215,0.094)`, text `rgb(39,131,222)`, 14px / 500 |
| **Split primary** ("Add members ⌄") | blue 103×28 (radius `6px 0 0 6px`) + 24×28 chevron (radius `0 6px 6px 0`), with a thin lighter divider |
| **Help link-button** ("ⓘ Learn about …") | 24px tall, padding 0 6px, radius 6px, 14px `rgb(161,158,153)`, ? icon |
| **Pill sub-tabs** (People, Import, Notion AI, Connections) | 28px (32px on Connections/MCP), **radius 9999px**, padding 0 10px (14px), 14px / 500. Active bg `rgba(33,27,23,0.05)` + primary text. Inactive `rgb(161,158,153)`, no bg. A count may follow the label |
| **Filter chips** (Teamspaces) | 24px, radius 32px, padding 0 8px, gap 6px, 14px `rgb(125,122,117)`, 16px icon + chevron. An applied chip is blue text on pale blue |
| **Info banner** (passkey) | bg `rgb(229,242,252)` (dark `rgb(35,56,80)`), radius 8px, padding 16px, blue 14px text + icon |
| **Promo card** (Mail & Calendar) | 1px border `rgb(240,239,237)`, radius 8px, padding ≈32px, title 14px / 600, grey body, primary button, illustration on the right |
| **Stat card** (Public pages) | 256×123, border 1px `rgb(240,239,237)`, radius 8px, padding 16px, shadow `rgba(0,0,0,0.02) 0 4px 0 -2px`, 12px label, **20px / 600** number |
| **App/integration tile** | 36×36 (Notifications; border 1px `rgb(240,239,237)`, radius 8px) or 56×56 (Connections/MCP; bg #fff, radius 12px, shadow `rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px`) |
| **Numbered step** | a 20px circle with bg `rgba(84,72,49,0.08)` and 10px / 600 `rgb(95,94,91)` text |
| **Dashed empty state** | border 1px dashed `rgba(70,68,64,0.45)`, radius 4px, centred icon, 14px / 500 title, a secondary button |
| **Drop zone** (Import) | bg `rgba(0,128,213,0.047)`, **border 1px dashed `rgb(39,131,222)`**, radius 8px, padding 32px |
| **Status pill** ("● Live") | bg `rgba(123,183,129,0.27)`, radius 10px, padding 0 8px, 13px, with a green dot |
| **Tables** (devices, members) | header 32px, 12px grey sortable header buttons (padding 3px 5px, radius 4px), hairline row dividers, 13–14px cells |

## 5. Tab contents (summary)
- **Account:** a profile block (62px avatar + "Preferred name" input + "Add a photo / Notion Faces" links), a passkey banner, Account security (Email, Passkeys, Two-factor, Password), Support (Support access toggle, **Delete my account** danger), Devices (Log out of all devices + a devices table), User ID.
- **Preferences:** Appearance · Input options · Language & time · Desktop app · Privacy (see `preferences.md`).
- **Notifications:** In-app (live meeting steps ①②③), Connected apps (Slack, Discord, Microsoft Teams: "Connect"), Email notifications (4 toggles + "Manage settings ↗").
- **Mail & Calendar:** two promo cards (email, calendar).
- **General:** workspace name, icon, custom landing page, sidebar, allowed domains, export, analytics, people, **Danger zone**, workspace ID.
- **People:** invite link (Copy link + toggle), pill tabs Guests · Members · Groups · Contacts, a members table with a Role select.
- **Import:** a drop zone and card grids for file-based and third-party imports.
- **Notion AI:** General / AI connectors / Skills sub-tabs (web search, models, personalization, instructions, data sharing).
- **Meeting notes:** workspace settings + personal preferences.
- **Connections / Notion MCP:** a search, filter pills and 2-column grids of app cards.
- **Public pages:** stat cards, a domains table, one toggle.
- **Emoji, Developer, Teamspaces:** one toggle each, plus an empty state, PATs, or a teamspace table.

## 6. Dark-mode deltas
Nav `rgb(32,32,32)` · content `rgb(25,25,25)` · active nav item `rgba(255,255,255,0.082)` · help text `rgb(173,169,163)` · hairlines `rgba(255,255,243,0.082)` · borders and rings `rgba(255,255,235,0.1)` · field bg `rgba(252,252,252,0.03)` · danger bg `rgba(255,104,92,0.24)` · banner `rgb(35,56,80)` with `rgb(56,125,201)` text · step circle `rgb(47,47,47)` with `rgb(127,127,127)` text. Primary button and toggle-on are unchanged.
