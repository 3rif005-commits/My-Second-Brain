# j. Settings window (all tabs) — raw capture

Date: 2026-10-13. Viewport 1300x597 CSS px, DPR 1 (see `_method.md`). Opened via sidebar workspace switcher → **Settings**.
Strictly read-only: no setting was changed. Selects were opened only to read their options, then closed with Escape.
Privacy: the user's name/email/workspace/time zone city are shown as placeholders ("Jane Doe", "user@example.com", "Workspace", "(GMT+00:00) Time zone").
Screenshots are `zoom` crops of the dialog only (x65..1235, y50..547), so the private sidebar behind the backdrop is not in the frame.

**Container verified (no re-measure):** `div.notion-dialog[role=dialog]` 1170x497 at x65,y50, radius 12px, bg #fff. Matches §7 of `i-empty-menus-overlays.md`.

## 0. Left-nav structure (in order, with section headers)

| Section header | Items (icon, label) |
|---|---|
| *(top)* | Search field "Search settings" |
| **Account** | [avatar 22px circle] **<user name>** (= "My account" tab) · Preferences (sliders icon) · Notifications (bell) · Mail & Calendar (envelope) |
| **Workspace** | General (gear) · People (two people) · Import (download arrow) |
| **Features** | Notion AI (Notion AI face) · Meeting notes (doc+mic) + blue **New** badge · Connections (4-square grid) · Notion MCP (nodes graph) · Public pages (globe) · Emoji (smiley) · Developer (code) |
| **Admin** | Teamspaces (building icon) |
| **Access & billing** | **Upgrade plan** (blue ⬆ circle icon + blue text, 14px/500 `rgb(39,131,222)`) |

The default tab when Settings opens from the switcher is **Preferences**. (No separate "Language & region", "Security", "Identity", "Billing" tabs in this Notion build: language lives in Preferences; billing is only the "Upgrade plan" entry under the "Access & billing" header; there is no Security tab on this plan.)

## 1. Shared anatomy (measured on Preferences, Light)

### Left nav
- Panel: 240px wide, full dialog height, **bg `rgb(249,248,247)`**, no border-right (contrast against the white content is the only divider).
- Search field (top, outside the scrolling list): 224x28 at x73,y58 (8px from the dialog's top/left), radius 6px, bg `rgba(66,35,3,0.03)`, **inset 1px ring `rgba(28,19,1,0.11)`** (blue ring `rgb(35,131,226)` when focused; it is auto-focused on open), padding 4px 6px, 14px/20px, magnifier icon left, placeholder "Search settings" grey.
- Scrolling list: padding 8px, flex column **gap 2px**, own thin scrollbar (dialog shows arrows + grey thumb at x≈297).
- Section header ("Account", "Workspace", "Features", "Admin"): 209x28 box, padding 6px 8px, **12px/500, lh 16px, `rgb(161,158,153)`**. Section spacing: last item → next header = +36px (vs. +30 between items), i.e. a header gets ~6px extra top space.
- Item: `div[role=tab]` **209x28, radius 6px, padding 4px 6px, gap 6px**, `transition: background 0.1s ease-in-out`. Icon svg **20x20, fill `rgb(142,139,134)`**. Label span **14px/500, lh 20px**: inactive `rgb(95,94,89)`, **active `rgb(44,44,43)`**.
- Active item bg **`rgba(33,27,23,0.05)`**; hover bg is the same `rgba(33,27,23,0.05)`.
- Account item: avatar = 22px white circle, 1-letter initial 11px `rgb(142,139,134)` (or the photo), followed by the user's name.
- "New" badge: 30x18, **11px/500 `rgb(39,131,222)`, bg `rgba(0,124,215,0.094)`, radius 4px, padding 2px 4px**, right-aligned in the row.
- Close (×) button: top-right of the dialog, 22x22, radius 100%, at 12px from the top/right edges; it sits over the content column.

### Content column
- Scroller: the whole right side (930 wide), `overflow-y auto`, **padding 36px 60px 44px**. Inner column **max-width 800px** (795 visible at this size), flex column, **gap 44px** between the page header block and the first section.
- **Page title** (e.g. "Preferences"): **26px / 600, lh 32px, `rgb(44,44,43)`**.
- **Page description**: 16px/400, lh 24px, `rgb(44,44,43)`, 8px under the title.
- **Section header inside a page** ("Appearance", "Input options", "Language & time", "Desktop app", "Privacy"): **16px/500, lh 24px**, padding-bottom 12px, **border-bottom 1px `rgba(42,28,0,0.07)`** (the hairline divider), margin-bottom 16px. Groups are separated by **48px** (end of last row → next section header).
- **Setting row**: flex, `justify-content: space-between`, gap 12px, align centre; rows separated by **24px** (flex gap on the group). Left side: **label 14px/500 lh 20px `rgb(44,44,43)`**, then help text **13px/400 lh 18px `rgb(125,122,117)`** 4px below (label+help = 42px tall). Help text wraps at about 60% of the row width (≈ 580px) on long descriptions. Control on the right edge, vertically centred.
- **Beta badge** next to a label: 11px/500 `rgb(142,139,134)`, bg `rgba(42,28,0,0.07)`, radius 4px, padding 2px 4px, inline after the label with a 6px gap.
- **Inline link in help text** ("Cookie Notice", "Learn more"): same 13px grey `rgb(125,122,117)`, **underline** (decoration colour = text colour).
- Bold key names inside help text ("Cmd/Ctrl", "Enter"): `<strong>`, weight 700, same grey `rgb(125,122,117)`.

### Controls
- **Select / dropdown button** ("Light ⌄", "Use system setting ⌄", "Customize ⌄"): `div[role=button]`, **height 28px, width = content, padding 0 8px, gap 6px, radius 6px, border 1px solid `rgba(28,19,1,0.11)`**, text **14px/500 `rgb(44,44,43)`**, chevron-down svg 8.6x14 fill `rgb(142,139,134)` on the right. bg transparent at rest; **hover / open bg `rgba(33,27,23,0.05)`**; `transition: background 0.02s ease-in`; keyboard focus = 2px blue ring (seen on "Customize" after Escape). Disabled (Time zone when auto is on): `aria-disabled=true`, **opacity 0.4**.
- **Select options menu** (screenshots/j-select-menu-theme-light.png): popup **250px wide** (wider for long lists), right-aligned to the button's right edge, top = button bottom + 4px, **radius 10px**, bg #fff, shadow `rgba(25,25,25,0.05) 0 20px 24px 0, rgba(25,25,25,0.027) 0 5px 8px 0, rgba(42,28,0,0.07) 0 0 0 1px`, padding 4px. Items `role=menuitem` 242x28, radius 6px, label 14px/400 `rgb(44,44,43)` at 8px inset; **selected = checkmark svg 16x16 `rgb(44,44,43)` at the right** (no bg). Hover = standard `rgba(33,27,23,0.05)`. Long lists (Language: 22 items) scroll inside a fixed-height menu and use **two-line items** (native name 14px dark + English name 12px grey under it).
- **Toggle switch**: `input[role=switch]` 30x18 overlaying a track div. Track **30x18, radius 44px, padding 2px**; OFF bg **`rgba(135,131,120,0.3)`**, ON bg **`rgb(39,131,222)`**; `transition: background 0.2s, box-shadow 0.2s`. Knob **14x14 white, radius 44px, no shadow**, at 2px inset; ON = `translateX(12px)`; `transition: transform 0.2s ease-out, background 0.2s ease-out`. **Disabled-ON** (cookie "Strictly necessary"): same blue, container opacity 0.4.
- **Small popover with toggles** (Cookie settings → Customize): card 260x254, radius 10px, standard popup shadow, opens below-right of the button; each line = 14px label, 12px grey help (2-3 lines), toggle on the right.

## 2. Account → Preferences (screenshots/j-preferences-light.png, -2-, -3-)
Title "Preferences", description "Choose how you want Notion to look and behave". Five sections:

| Section | Setting (label) | Help text (verbatim) | Control | Options | Current |
|---|---|---|---|---|---|
| Appearance | Theme | Choose a theme for Notion on this device | select 63px | Use system setting / Light / Dark | Light |
| Appearance | High contrast `Beta` | Increase contrast for improved visibility | select 151px | Use system setting / Standard contrast / High contrast | Use system setting |
| Input options | Use Enter to add a new line | Applies to chat, comments, and other input fields. Press **Cmd/Ctrl** + **Enter** to send. | toggle | on/off | off |
| Language & time | Language | Choose the language you want to use Notion in | select | 22 languages (two-line items, native + English): Arabic, Danish, Dutch, English (UK), English (US), Finnish, French (France), German, Hebrew, Indonesian, Italian, Japanese, Korean, Norwegian, Portuguese (Brazil), Simplified Chinese, Spanish (Latin America), Spanish (Spain), Swedish, Thai, Traditional Chinese, Vietnamese | English (US) |
| Language & time | Number format | Choose how numbers and currencies are formatted. Default uses your language setting. | select | Default / 1,000,000.00 / 1.000.000,00 | Default |
| Language & time | Always show text direction controls | Show the option to change text direction (left to right or right to left) in the editor, regardless of what language you're using | toggle | | off |
| Language & time | Start week on Monday | This will affect the way your calendars appear in Notion | toggle | | off |
| Language & time | Date format | Set the default format for new @date mentions | select | Full date (@October 13, 2026) / Short date (@Oct 13) / Month/Day/Year (@10/13/2026) / Day/Month/Year (@13/10/2026) / Year/Month/Day (@2026/10/13) / Relative (@Today). Items are two-part: name + grey example on the right | Relative |
| Language & time | Set time zone automatically using your location | Reminders, notifications, and emails will be delivered to you based on your time zone | toggle | | on |
| Language & time | Time zone | Choose your time zone | select "(GMT±h:mm) City" — **disabled (opacity 0.4) while the auto toggle above is on** (not opened) | full IANA list | auto (city withheld) |
| Desktop app | Open on start | Choose what page opens when you start Notion and when you switch workspaces | select | Last visited page / Top page in sidebar / Library / Notion AI | Last visited page |
| Privacy | Cookie settings | See the [Cookie Notice] for more information | "Customize ⌄" select-style button → popover of toggles: Strictly necessary ("Essential for the site to function. Always On.", ON + disabled), Functional ("Used to remember preference selections and provide enhanced features.", off), Analytics ("Used to measure usage and improve your experience.", off), Marketing ("Used for targeted advertising.", off) | — |
| Privacy | Show my view history | People with edit or full access will be able to see when you've viewed a page. [Learn more]. | toggle | | on |
| Privacy | Profile discoverability | Users who know your email will see your Notion name and profile picture when inviting you to a new workspace. [Learn more.] | toggle | | on |

Measured row positions: rows with one-line help are 42px; with two-line help 60px. Select width = content (Light 63, English (US) 111, Default 77, Relative 83, Last visited page 138, Customize 99).

## 3. Account → My account (nav label = user name; page title "Account") (screenshots/j-my-account-light.png, -2-, -3-)
Title **"Account"**, description "Manage your profile, login information, and devices".

| Section | Row | Help / content | Control (not clicked) |
|---|---|---|---|
| Profile | Avatar | 62x62 circle (radius 50%), initial letter ~26px grey on light bg, clickable `div[role=button]` (opens photo menu) | — |
| Profile | Preferred name | small label above the field: 12px/400 `rgb(125,122,117)` | **text input** 250x28: bg `rgba(66,35,3,0.03)`, ring `rgba(28,19,1,0.11) 0 0 0 1px`, radius 6px, padding 4px 10px, 14px/20px; 20px right of the avatar |
| Profile | (line under) | "Add a photo" or "create a custom self-portrait" with Notion Faces — links are **blue `rgb(39,131,222)`, no underline**, 14px; the rest grey | links |
| Profile | Passkey banner | full-width callout: **bg `rgb(229,242,252)`, radius 8px, padding 16px, 54px tall**, shield-lock icon + blue 14px text "Add a passkey for stronger security and faster, one touch sign-in"; below it a **primary button "Add passkey"** | primary button |
| Account security | Email | user@example.com (shown as help text) | secondary "Manage emails" |
| Account security | Passkeys `Recommended` (blue badge) | Sign in with on-device biometric authentication | secondary "Add passkey" |
| Account security | Two-factor authentication | Add another layer of security to your account | secondary "Add verification method" — **disabled look** (text + border faded, ~0.4 opacity) |
| Account security | Password | Set a password for your account | secondary "Add password" |
| Support | Support access | Grant Notion's support team temporary access to your account to help troubleshoot problems or recover content on your behalf. You can revoke access anytime. | toggle (off) |
| Support | Delete my account | Permanently delete your account. You'll no longer be able to access your pages or any of the workspaces you belong to. | **danger button "Delete my account"** |
| Devices (ⓘ after header) | Log out of all devices | Log out of active sessions on all your devices, other than this one | danger button "Log out of all devices" |
| Devices | Table | columns **Device Name / Last Active ⓘ / Location**, header row 32px: header cells are `div[role=button]` (sortable) 12px/400 grey `rgb(125,122,117)`, padding 3px 5px, radius 4px; rows ~45-54px with hairline `rgba(42,28,0,0.07)` dividers, 13px text; first row has a blue 11px "This Device" sub-label; other rows end with a small secondary "Log out" button (58x28); footer row "↓ Load N more devices" 12px light grey | — |
| User ID | User ID | the UUID right-aligned in grey 12px + copy icon button | — |

### Buttons (measured here; same everywhere)
All buttons: `div[role=button]`, **height 28px, padding 0 8px, radius 6px, 14px/500**, width = content.
- **Primary (blue)**: bg **`rgb(39,131,222)`**, text `rgb(243,249,253)` (near white), no border. (Hover reading returned the same colour; a darker hover was not captured.)
- **Secondary (outlined)**: transparent bg, **border 1px `rgba(28,19,1,0.11)`**, text `rgb(44,44,43)`; hover/pressed bg `rgba(33,27,23,0.05)`.
- **Danger**: bg **`rgba(223,22,0,0.094)`** (pale red), text **`rgb(229,100,88)`**, no border.
- **Disabled**: faded (opacity ~0.4), cursor default.
- Text links in body copy: blue `rgb(39,131,222)` no underline (profile line) vs grey underlined inside help text.
No user-customizable *preferences* on this tab except Preferred name (text) and Support access (toggle, off).

## 4. Account → Notifications (screenshots/j-notifications-light.png, -2-, -3-)
Title "Notifications", description "Decide when and how you want to be notified".

| Section | Setting | Help text | Control | Current |
|---|---|---|---|---|
| In-app notifications | **Live meeting activity** (a sub-heading row, no control) | Configure which in-app popups appear when you're in video conferences and taking AI Meeting Notes | — | — |
| In-app notifications | ① Join video conferencing and start transcribing ⓘ | (tooltip only) | toggle, **locked**: lock icon left of it, toggle disabled (opacity 0.4) | off (locked) |
| In-app notifications | ② Meeting is being transcribed ⓘ | | toggle | on |
| In-app notifications | ③ Meeting is being summarized ⓘ | | toggle, locked | off (locked) |
| Connected apps | Slack | Get Slack notifications about activity in your Notion workspace | secondary "Connect" | not connected |
| Connected apps | Discord | Get Discord notifications about activity in your Notion workspace | secondary "Connect" | not connected |
| Connected apps | Microsoft Teams | Get Microsoft Teams notifications about activity in your Notion workspace | secondary "Connect" | not connected |
| Email notifications | Activity in my workspace | Get emails about comments, mentions, page invites, reminders, access requests, and database property changes | toggle | on |
| Email notifications | Always send email notifications | Get emails about workspace activity even when you're active in Notion | toggle | on |
| Email notifications | Page updates | Get email digests about pages you've [turned on notifications for] and pages you've created | toggle | on |
| Email notifications | Workspace digest | Get email digests about what's happening in your workspace | toggle | on |
| Email notifications | Announcements and update emails | Get occasional emails about new features from Notion | secondary "↗ Manage settings" (external-link arrow icon before the text, 135px) | — |
| (footer) | "ⓘ Learn about notifications" | help link-button: 14px/400 **`rgb(161,158,153)`** (light grey), ? icon, padding 0 6px, radius 6px, 24px tall, ~64px below the last section | | |

Anatomy specific to this tab:
- **Numbered step rows**: number in a **20px circle, bg `rgba(84,72,49,0.08)`, 10px/600 `rgb(95,94,91)`**; label 14px/500 at +30px; ⓘ 14px grey help icon after the label; rows ~55px tall separated by hairlines `rgba(42,28,0,0.07)`; control right.
- **App rows**: 36x36 icon tile (**1px border `rgb(240,239,237)`, radius 8px**, 22px logo centred), then label 14px/500 + help 13px grey at +48px, button right.

## 5. Account → Mail & Calendar (screenshots/j-mail-calendar-light.png)
Title "Mail & Calendar", description "Manage emails and calendars connected to your Notion account". No preferences, only two empty-state promo cards.
- Section "Connected emails" — here the section header has **no hairline divider**; instead a 14px grey description line under it: "Add email threads to Notion databases, let Agents draft and organize messages, and more."
- **Promo card**: 795x196, **1px border `rgb(240,239,237)`, radius 8px**, very light gradient bg on the right, padding ~32px; left: title **14px/600** "Connect your email to Notion", body 13-14px grey "All your email context in one place. Search, draft, and ask questions with Notion AI or sync email messages into your databases.", then **primary "Get started"** button (85x28); right: illustration (Gmail + Outlook logos → a mock Notion chat window).
- Section "Connected calendars": "Manage Notion databases in your calendar, let Agents schedule and take notes for your meetings, and more. Try it in [Notion Calendar]" (link grey 14px), card "Connect your calendar to Notion" / "Manage all your time in one place. Coordinate meetings, optimize your schedule, and walk into every call prepared with Notion AI." + primary "Get started".

## 6. Workspace → General (screenshots/j-general-light.png, -2-, -3-)
Title "General", description "Manage your workspace name, domains, and more".
Here many rows are **stacked** (label + help on top, full-width control below) instead of label-left/control-right.

| Section | Setting | Help text | Control | Current |
|---|---|---|---|---|
| Workspace settings | Workspace name | Your workspace name can be up to 65 characters | **stacked text input 400x34** (bg `rgba(66,35,3,0.03)`, ring `rgba(28,19,1,0.11) 0 0 0 1px`, radius 6px, padding 4px 10px, **15px/26px**), 12px below the help | "Workspace" |
| Workspace settings | Icon | Upload an image or pick an emoji. This icon will appear in your sidebar and notifications. | stacked **64x64 icon button**, radius 4px, light 1px border (opens icon picker) | (image, hidden for privacy) |
| Workspace settings | Custom landing page | When a new member joins this workspace, this will be the first page they land on. | select "Select page ⌄" (page picker, not opened: it lists private pages) | none |
| Sidebar ⓘ | Show other Notion apps in sidebar | Show Notion Calendar in your sidebar | toggle | off |
| Allowed email domains | Allowed domains | Anyone with email addresses at these domains can automatically join your workspace as a member | stacked **token input** 795x32, radius 4px, bg `rgba(66,35,3,0.03)`, ring 1px, padding 7px 9px 0, 14px, placeholder "Type an email domain…" | empty |
| Export | Workspace content | Export all pages in Workspace. This can take longer depending on the size of the workspace. [Learn more] | secondary "Export" (not clicked) | — |
| Export | Members (+ plan-gated link icon) | "Upgrade to get a list of members and guests in your workspace" (link-button) | secondary "Export" | — |
| Analytics | Save and display page view analytics | Collect page view data for all pages in Workspace. People with edit and full access to a page will be able to see how many views it has. + "ⓘ Learn more" grey link-button | toggle | on |
| People | People directory | Enable the people directory and profile pages for this workspace | toggle | on |
| People | Show recent activity on people profiles | Show people's recently created and edited pages, along with their recent comments | toggle | on |
| People | Hover cards | Show people's profile information when you hover over their name | toggle | on |
| Danger zone | Delete workspace | Permanently delete this workspace, including all pages and files. | **danger "Delete workspace"** (127x28) + under the row "ⓘ Learn about deleting workspaces." grey link-button | — |
| Workspace ID | Workspace ID | UUID right-aligned, 12px grey, + 24x24 copy icon button | — | — |

Notes: a section header can carry a 14px ⓘ help icon after its text ("Sidebar"). The "ID" rows use a 12px grey label on the left (not 14px/500).

## 7. Workspace → People (screenshots/j-people-light.png = Guests sub-tab, j-people-members-light.png = Members)
Title "People", description "Manage people in your workspace and their roles" + inline **blue "Learn more"** link (16px, `rgb(39,131,222)`, no underline, 8px gap).
- Right-aligned small link "View People Directory ↗" (12px grey `rgb(125,122,117)`, arrow icon), ~44px under the header.
- Row **Add members via link** — help "Only people with permission to invite members to this workspace can view this link. You can also [generate a new link]." — controls: **blue-tinted button "Copy link"** (bg `rgba(0,124,215,0.094)`, text `rgb(39,131,222)`, 14px/500, 28px, radius 6px, padding 0 8px) + toggle (**on**).
- **Pill sub-tabs**: Guests · Members `1` · Groups · Contacts. Each tab 28px tall, **radius 9999px, padding 0 10px, 14px/500**; active: bg `rgba(33,27,23,0.05)` text `rgb(44,44,43)`; inactive: no bg, text `rgb(161,158,153)`; count "1" after the label in lighter grey. No underline.
- Right of the tabs: 28x28 search icon button + **split primary button** "Add members | ⌄" (left part 103x28 radius `6px 0 0 6px`, right chevron part 24x28 radius `0 6px 6px 0`, both `rgb(39,131,222)`, thin lighter divider between). Not clicked.
- **Guests (empty state)**: dashed box 795x296, **border 1px dashed `rgba(70,68,64,0.45)`, radius 4px, padding 16px**, centred person-add icon, "No guests yet" 14px/500, then secondary button "Import contacts" (32px tall, padding 12px... rendered 122x32).
- **Members table**: header row 32px, hairline top/bottom; header cells "User ↑" (sortable button, 14px/400 grey `rgb(125,122,117)`, radius 4px, padding 0 6px), "Teamspaces", "Groups", "Role". Member row ~42px: 28px avatar circle + name 14px dark + email 12px grey stacked; "No access" / "None" grey `rgb(161,158,153)`; Role = **borderless select "Workspace owner ⌄"** (14px/400, 28px, radius 6px, padding 0 8px, chevron grey). Not opened.
No personal preferences here (workspace admin only). Groups / Contacts sub-tabs not opened.

## 8. Workspace → Import (screenshots/j-import-light.png, -2-)
Title "Import", description "Import data from other apps and files into Notion" + blue "Learn more". No preferences. Pill sub-tabs **Discover** (active) · Completed (same pill style as People).
- Group "Import your content" (14px/500 title + 12px grey help "If you import a ZIP file, we'll convert each file inside into its own page" — **no hairline here**, a lighter "group" header style).
- **Drop zone**: 795x194, **bg `rgba(0,128,213,0.047)`, border 1px dashed `rgb(39,131,222)`, radius 8px, padding 32px, gap 12px**, centred: cloud-upload icon (light blue), "Import your content to Notion" 14px/600, "Drag and drop ZIP, CSV, PDF, text, markdown, or HTML files, or [choose a file]" 12px grey + blue link, "ZIP files can be a maximum of 5GB" 12px lighter grey.
- Group "File-based imports" ("Import DOCX, CSV, PDF, text, markdown, HTML, or EPUB files to convert them to pages"): **3-column grid of cards** (`grid-template-columns: repeat(3, 1fr)`, gap 4px 20px... rendered 250px cards with ~20px gaps): card 250x70, bg #fff, radius 4px, padding 12px, faint 1px ring; 20px icon + title 14px/500, help 12px grey under. Cards: CSV (Import structured data from spreadsheets), PDF (Extract content from PDF documents), Text & Markdown (Import plain text and formatted notes), HTML (Import web pages and structured content), Word (Bring your Word documents into Notion).
- Group "Third-party imports" ("Migrate content from third-party apps"): Asana, Confluence, Trello, Workflowy, Evernote, Jira, Monday.com, Quip, Google Docs (same cards, brand logos). Nothing clicked.

## 9. Features → Notion AI (screenshots/j-notion-ai-light.png, -2-, -3-, j-notion-ai-models-picker-light.png, j-notion-ai-connectors-light.png, j-notion-ai-skills-light.png)
Title "Notion AI", description "Choose how you want to use AI features and manage AI connectors". Pill sub-tabs: **General** · [3 tiny app logos] AI connectors · Skills.
**Different section-header style on this tab:** "Workspace settings", "Web", "Model controls", "Personalization", "Instructions", "Privacy", "Manage Skills" are **17px / 600, lh 22px** (bolder and bigger than the 16px/500 headers elsewhere), still with the hairline below for most. "Workspace settings" is a group title sitting above an empty hairline.

### General sub-tab
| Section | Setting | Help text | Control | Current |
|---|---|---|---|---|
| Web | Enable web search for workspace | Allow AI to search the web for up-to-date information when answering questions. | toggle | on |
| Web | Enable web browser for computer `Beta` | Allow Computer to access the internet and data within your workspace and connectors. [Learn more] | toggle | on |
| Web | Enable 'Skip all approvals' | Allow agents to take action without your approval | toggle | on |
| Model controls | Allowed models for Notion Agent | Choose which models Notion Agent can use. Restricted models are grayed out in the Notion Agent model picker, and chats set to Auto will respect these restrictions. | **borderless select 153x32, radius 8px, padding 0 10px**: stacked provider logos + "32 models ⌄" | 32 models (all) |
| Personalization | Pick a name and an accessory for your Notion AI | (help-only row, stacked) | secondary "✎ Personalize" + illustration of 3 AI faces on the right | — |
| Instructions | Instructions allow you to customize how your Agent works and interacts with you | (stacked) | secondary "✎ Add instructions" | none |
| Privacy | Share data to improve Notion AI | Help improve Notion AI by allowing data from this workspace to be shared with Notion. By enabling the Learning and Early Access Program you are agreeing to the [LEAP Terms]. [Learn more]. | toggle | off |

**Allowed-models picker** (opened, Escape, nothing changed): popover ~320 wide, radius 10px, standard shadow; top search input "Search models" (blue focus ring); rows 28px: provider logo 16px + name 14px + grey count "8 of 8" + toggle (on) + chevron › (drills into per-model list). Providers: GPT 8 of 8, Gemini 4 of 4, Claude 9 of 9, SpaceXAI 4 of 4, DeepSeek 3 of 3, Kimi 1 of 1, GLM 3 of 3. Footer 12px grey "Disabling top level providers restrict all existing and future models" + full-width primary **Save** (disabled = pale blue, ~0.4 opacity).

### AI connectors sub-tab
"Workspace AI connectors ⓘ" (14px/500) + "Workspace owners can connect all your team's knowledge, across all apps you use for work." + blue ⬆ "Upgrade" link "to Business". **3-column grid of connector cards**: 260x48, radius 4px, padding 12px, **shadow `rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px`**, logo 16px + name 14px (+ `Beta` badge) + round blue "+" icon button on the right. Unavailable cards: bg `rgb(240,239,237)`, ring `rgba(28,19,1,0.11)`, **opacity 0.4**. Apps: Asana, Box (Beta, unavailable), GitHub, Gmail, Google Calendar (Beta), Google Drive, Jira (Beta), Linear, Microsoft Teams, Outlook, Salesforce (Beta, unavailable), SharePoint, Slack.

### Skills sub-tab
| Section | Setting | Help | Control | Current |
|---|---|---|---|---|
| Manage Skills | Skills | Discover and configure your skills in the Library | secondary "📄 Open Library" | — |
| Workspace settings | Disable skills for workspace | Prevent all members and agents from using skills | toggle | off |
| Workspace settings | Allow local skill downloads | Let members download skills to their local computer for agent use | toggle | on |

## 10. Features → Meeting notes (screenshots/j-meeting-notes-light.png, -2-)
Title "Meeting notes", description "Manage your meeting notes preferences and workspace settings." Section headers are the **17px/600 style with NO hairline** ("Workspace settings", "Personal preferences"); first row 16px under the header. Large ~100px gap before "Personal preferences".

| Section | Setting | Help text | Control | Options | Current |
|---|---|---|---|---|---|
| Workspace settings | Enable Meeting notes for workspace | Allow everyone in your workspace to access AI Meeting Notes. | toggle | | on |
| Workspace settings | Store audio locally | Allow members to temporarily store a local, on-device copy of their meeting audio for added reliability. [Learn more] | toggle | | off |
| Workspace settings | Automatic transcript deletion | (⬆ blue "Upgrade" link) to set transcript auto-deletion timing. | select "Never", **disabled** (plan-gated, faded) | (not opened) | Never |
| Workspace settings | Enforce consent for all workspace members | Enforce playing an audio consent message at the start of every transcription for all workspace members | toggle | | off |
| Personal preferences | Hide Meeting notes tab | Hides it only from your sidebar | select | **Never / Always** | Never |
| Personal preferences | Auto-share with internal calendar event participants | Automatically shares AI Meeting Notes with calendar event participants who are members of your workspace. Only applies to AI Meeting Notes that are linked to calendar events. | toggle | | off |
| Personal preferences | Auto play consent message on start | Automatically play an audio consent message at the start of every transcription. | toggle | | on |
| Personal preferences | Select default meetings database | Link or create a new database to store new AI meeting notes. | **wide combobox-select 300x28** (outlined, placeholder "Search for a database…" 14px/500 grey `rgb(142,139,134)`, chevron right) | (not opened: lists private DBs) | none |

## 11. Features → Connections (screenshots/j-connections-light.png, j-connections-connected-light.png)
Title "Connections", description (wraps at ~460px): "Connect apps to use in Notion. Let Notion and Notion AI search, sync, and take actions in Slack, Drive, Jira and more." + blue "Learn more". No preferences.
- Pill sub-tabs (slightly bigger: 32px tall, padding 0 14px): **Browse Connections** · Connected `1` (count in a small grey square badge) · Manage.
- Toolbar: search input "Search connections" 404x28 (bg `rgba(66,35,3,0.03)`, ring 1px, radius 6px, padding 4px 10px, magnifier) · **filter pills** "All categories ⌄" / "All types ⌄" (borderless, radius 9999px, padding 0 10px, 14px/500 grey `rgb(125,122,117)`) · primary "+ Add connection ⌄" (with chevron). Nothing opened.
- Category headers **17px/500** (no hairline): For Workspace, Communication, Calendars & meetings, Docs, Projects & tasks, Design, Developer tools, Data & analytics, Sales & marketing, Customer support, Finance & operations, Security & IT, Automation, Other, Developer connections.
- Connection cards in a **2-column grid** (each ~362x65): **56x56 logo tile (bg #fff, radius 12px, shadow `rgba(0,0,0,0.04) 0 2px 4px 0, rgba(42,28,0,0.07) 0 0 0 1px`)**, then name 14px/500 + "✓ Built by Notion" badge (10px grey `rgb(161,158,153)` with a check-seal icon), 13px grey 2-line description, secondary "Connect" button on the right. Also a promo line "Box, GitHub, Gmail, and more" / "Use Notion in ChatGPT, Claude, and Cursor: Notion MCP".
- **Connected** sub-tab: table header "Connection" (12px grey), row: green check-circle status, 24px coloured initial tile (radius 4px), name 14px, "🏢 Internal" 10px grey tag, secondary "Manage" button right. (Integration name blanked to "My integration".)

## 12. Features → Notion MCP (screenshots/j-notion-mcp-light.png)
Title "Notion MCP", description "Use Notion inside another app. Let agents, apps, and tools take actions in this workspace through the Notion MCP server." + blue "Learn more". No preferences.
- Pill sub-tabs (32px): **Discover MCP clients** · Manage workspace clients (not opened).
- Header row: "Clients to use with Notion MCP" **17px/600** + right: 28x28 search icon button + primary "+ Add an MCP client".
- **2-column grid of client cards**: each `div[role=button]` 386x88, **radius 8px, padding 12px** (hover bg standard), 56px logo tile (same as Connections), name 14px/500, 13px grey 2-line description, small **"Enable" button: 24px tall, bg #fff, border 1px `rgba(28,19,1,0.11)`, radius 6px, padding 0 6px, 14px/500**.
- Clients: ChatGPT, Claude, Composio, Cursor, Devin, Figma, GitHub, Grok Bot, HubSpot, Make, Mistral, Muse, Poke, VS Code, Zapier; footer prompt "Want to bring your Google Drive, Slack, or GitHub PRs into Notion?" (link to Connections).

## 13. Features → Public pages (screenshots/j-public-pages-light.png, -2-; nav scrolled, shows the lower nav)
Title "Public pages", description "Manage public content from your workspace".
- **Stat cards**, 3-column grid (gap ~15px): `div[role=button]` 256x123, **border 1px `rgb(240,239,237)`, radius 8px, padding 16px, shadow `rgba(0,0,0,0.02) 0 4px 0 -2px`**; label 12px grey; big number **20px/600 `rgb(29,27,22)`**; 20px round grey "›" button on the right; footer 12px light grey. Cards: Notion Sites 0 "No published sites", Public forms 0 "No public forms", Anyone with the link 0 "No public share links", Shared AI chats 0 "No shared chats".
- Section "Domains" (16px/500, help "You can publish Notion Sites on this domain. ⬆ Upgrade for multiple domains", **no hairline under the header; the table carries the lines**) + secondary "New domain" (disabled look). Table: Domain / Homepage / Status headers 12px grey; row: domain in a grey code-like chip (`workspace.notion.site`, bg light grey, radius 4px) + flag icon, "⬆ Upgrade to Plus", status pill **"● Live": bg `rgba(123,183,129,0.27)`, radius 10px, padding 0 8px, 13px, green dot**, "…" 24px menu button.
- Section "Settings": **Always indicate that a page is live as a Notion Site** — "A banner will appear at the top of pages to indicate they have been published as a Notion Site" — toggle, **on**.

## 14. Features → Emoji (screenshots/j-emoji-light.png)
Title "Emoji", description "See all workspace emojis and add new ones".
- Row **Limit custom emoji creation to workspace owners** — "Any existing emojis can still be edited or deleted by the person who added them" — toggle, **off**. Row sits directly under the header (no section header) and is followed by a full-width hairline.
- Empty state, centred: 48px outline smiley (grey `rgb(161,158,153)`-ish), 12px grey 3-line text "This workspace doesn't have any custom emojis yet. Add your first emoji to get started." (max-width ~190px), secondary button "Add emoji" (32px tall).

## 15. Features → Developer (screenshots/j-developer-light.png)
Title "Developer", description "Enable features for developing Workers, connections"; **right-aligned on the description line: blue link "Open developer tools ↗"** (16px). Section headers 17px/600 without hairline.
| Section | Setting | Help | Control | Current |
|---|---|---|---|---|
| Developer UI | Enable developer features | Activate developer UI including developer toolbar, developer menu, and quick access to developer tools. | toggle | off |
| Personal access tokens (PATs) | Create a personal access token ⓘ | Generate a personal access token to make requests to the Notion API. [Manage your tokens]. | secondary "New token" (not clicked) | — |

## 16. Admin → Teamspaces (screenshots/j-teamspaces-light.png)
Title "Teamspaces", description "Manage teamspaces in this workspace" + blue "Learn more".
- Row **Limit teamspace creation to workspace owners** — "Allow only workspace owners to create teamspaces" — toggle, **off**; hairline below.
- Group "Teamspaces" (14px/500) / "Manage all teamspaces you have access to here" (13px grey).
- **Filter chips**: Active ⌄ (archive icon) · Owner ⌄ (person icon; currently applied = blue text on pale-blue bg) · Access ⌄ (key icon) · Security ⌄ (shield icon). Chip: 24px tall, **radius 32px, padding 0 8px, gap 6px, 14px/400 grey `rgb(125,122,117)`**, icon 16px, chevron.
- Right: search icon button + primary "New teamspace" (not clicked).
- Table headers Teamspace / Owners / Access / Updated ↓ (12px grey, sortable); empty row "Could not find any teamspaces." 12px grey centred.

## 17. Access & billing → Upgrade plan — NOT OPENED
Per the rules (never click upgrade/plans/billing) this entry was not clicked. Nav anatomy only: blue 20px ⬆-in-circle icon + "Upgrade plan" 14px/500 `rgb(39,131,222)`, under the "Access & billing" section header.

## 18. Settings search (screenshots/j-search-results-light.png)
Typing in "Search settings" (query "date", then cleared) **replaces the left nav list with results** while the content pane keeps the current tab. Field gains blue focus ring + a round grey ⊗ clear button on the right. Results are grouped by breadcrumb: group line = tab icon (20px grey) + "Account / Preferences" (14px grey, like a nav item); under it each match is a 2-line item: setting label 14px/500 dark (truncated with …) + help text 13px grey (truncated), the matched substring rendered **bold/dark**. Groups ~16px apart. Matches cover labels, help text and keywords (e.g. "date" matched "Announcements and update emails" and "Enable web search… up-to-date"). Clicking a result (not done) jumps to that tab/row.

## 19. ALL PREFERENCES (consolidated)
Scope: P = personal (affects only this user), W = workspace-wide (admin). Control: T = toggle, S = select, B = button, I = text input. "Current" = state seen 2026-10-13 (nothing was changed).

| # | Tab | Setting | Scope | Control | Options | Current | Help text |
|---|---|---|---|---|---|---|---|
| 1 | Preferences | Theme | P | S | Use system setting / Light / Dark | Light | Choose a theme for Notion on this device |
| 2 | Preferences | High contrast (Beta) | P | S | Use system setting / Standard contrast / High contrast | Use system setting | Increase contrast for improved visibility |
| 3 | Preferences | Use Enter to add a new line | P | T | | off | Applies to chat, comments, and other input fields. Press Cmd/Ctrl + Enter to send. |
| 4 | Preferences | Language | P | S | 22 languages (see §2) | English (US) | Choose the language you want to use Notion in |
| 5 | Preferences | Number format | P | S | Default / 1,000,000.00 / 1.000.000,00 | Default | Choose how numbers and currencies are formatted. Default uses your language setting. |
| 6 | Preferences | Always show text direction controls | P | T | | off | Show the option to change text direction (left to right or right to left) in the editor, regardless of what language you're using |
| 7 | Preferences | Start week on Monday | P | T | | off | This will affect the way your calendars appear in Notion |
| 8 | Preferences | Date format | P | S | Full date / Short date / Month/Day/Year / Day/Month/Year / Year/Month/Day / Relative | Relative | Set the default format for new @date mentions |
| 9 | Preferences | Set time zone automatically using your location | P | T | | on | Reminders, notifications, and emails will be delivered to you based on your time zone |
| 10 | Preferences | Time zone | P | S (disabled while #9 on) | (GMT±h:mm) City list | auto | Choose your time zone |
| 11 | Preferences | Open on start | P | S | Last visited page / Top page in sidebar / Library / Notion AI | Last visited page | Choose what page opens when you start Notion and when you switch workspaces |
| 12 | Preferences | Cookie settings | P | B "Customize" → popover of T | Strictly necessary (locked on) / Functional / Analytics / Marketing | on/off/off/off | See the Cookie Notice for more information |
| 13 | Preferences | Show my view history | P | T | | on | People with edit or full access will be able to see when you've viewed a page. Learn more. |
| 14 | Preferences | Profile discoverability | P | T | | on | Users who know your email will see your Notion name and profile picture when inviting you to a new workspace. Learn more. |
| 15 | My account | Preferred name | P | I | | (name) | — |
| 16 | My account | Photo / Notion Faces | P | avatar B + links | | initial | Add a photo or create a custom self-portrait with Notion Faces |
| 17 | My account | Support access | P | T | | off | Grant Notion's support team temporary access to your account… You can revoke access anytime. |
| 18 | Notifications | ① Join video conferencing and start transcribing | P | T (locked) | | off | (tooltip) |
| 19 | Notifications | ② Meeting is being transcribed | P | T | | on | (tooltip) |
| 20 | Notifications | ③ Meeting is being summarized | P | T (locked) | | off | (tooltip) |
| 21 | Notifications | Slack / Discord / Microsoft Teams | P | B "Connect" each | | not connected | Get <App> notifications about activity in your Notion workspace |
| 22 | Notifications | Activity in my workspace | P | T | | on | Get emails about comments, mentions, page invites, reminders, access requests, and database property changes |
| 23 | Notifications | Always send email notifications | P | T | | on | Get emails about workspace activity even when you're active in Notion |
| 24 | Notifications | Page updates | P | T | | on | Get email digests about pages you've turned on notifications for and pages you've created |
| 25 | Notifications | Workspace digest | P | T | | on | Get email digests about what's happening in your workspace |
| 26 | Notifications | Announcements and update emails | P | B "Manage settings ↗" | | — | Get occasional emails about new features from Notion |
| 27 | General | Workspace name | W | I | ≤65 chars | (name) | Your workspace name can be up to 65 characters |
| 28 | General | Icon | W | icon B | image / emoji | (image) | Upload an image or pick an emoji. This icon will appear in your sidebar and notifications. |
| 29 | General | Custom landing page | W | S (page picker) | any page | Select page | When a new member joins this workspace, this will be the first page they land on. |
| 30 | General | Show other Notion apps in sidebar | W | T | | off | Show Notion Calendar in your sidebar |
| 31 | General | Allowed domains | W | token I | | empty | Anyone with email addresses at these domains can automatically join your workspace as a member |
| 32 | General | Save and display page view analytics | W | T | | on | Collect page view data for all pages in Workspace. People with edit and full access to a page will be able to see how many views it has. |
| 33 | General | People directory | W | T | | on | Enable the people directory and profile pages for this workspace |
| 34 | General | Show recent activity on people profiles | W | T | | on | Show people's recently created and edited pages, along with their recent comments |
| 35 | General | Hover cards | W | T | | on | Show people's profile information when you hover over their name |
| 36 | People | Add members via link | W | T + "Copy link" | | on | Only people with permission to invite members to this workspace can view this link… |
| 37 | Notion AI | Enable web search for workspace | W | T | | on | Allow AI to search the web for up-to-date information when answering questions. |
| 38 | Notion AI | Enable web browser for computer (Beta) | W | T | | on | Allow Computer to access the internet and data within your workspace and connectors. |
| 39 | Notion AI | Enable 'Skip all approvals' | W | T | | on | Allow agents to take action without your approval |
| 40 | Notion AI | Allowed models for Notion Agent | W | S → picker (provider T + Save) | GPT 8, Gemini 4, Claude 9, SpaceXAI 4, DeepSeek 3, Kimi 1, GLM 3 | 32 models | Choose which models Notion Agent can use… |
| 41 | Notion AI | Personalization (AI name + accessory) | P? | B "Personalize" | | default | Pick a name and an accessory for your Notion AI |
| 42 | Notion AI | Instructions | P | B "Add instructions" | | none | Instructions allow you to customize how your Agent works and interacts with you |
| 43 | Notion AI | Share data to improve Notion AI | W | T | | off | Help improve Notion AI by allowing data from this workspace to be shared with Notion… |
| 44 | Notion AI › Skills | Disable skills for workspace | W | T | | off | Prevent all members and agents from using skills |
| 45 | Notion AI › Skills | Allow local skill downloads | W | T | | on | Let members download skills to their local computer for agent use |
| 46 | Meeting notes | Enable Meeting notes for workspace | W | T | | on | Allow everyone in your workspace to access AI Meeting Notes. |
| 47 | Meeting notes | Store audio locally | W | T | | off | Allow members to temporarily store a local, on-device copy of their meeting audio for added reliability. |
| 48 | Meeting notes | Automatic transcript deletion | W | S (disabled, plan) | — | Never | Upgrade to set transcript auto-deletion timing. |
| 49 | Meeting notes | Enforce consent for all workspace members | W | T | | off | Enforce playing an audio consent message at the start of every transcription for all workspace members |
| 50 | Meeting notes | Hide Meeting notes tab | P | S | Never / Always | Never | Hides it only from your sidebar |
| 51 | Meeting notes | Auto-share with internal calendar event participants | P | T | | off | Automatically shares AI Meeting Notes with calendar event participants who are members of your workspace… |
| 52 | Meeting notes | Auto play consent message on start | P | T | | on | Automatically play an audio consent message at the start of every transcription. |
| 53 | Meeting notes | Select default meetings database | P | combobox S | any database | none | Link or create a new database to store new AI meeting notes. |
| 54 | Public pages | Always indicate that a page is live as a Notion Site | W | T | | on | A banner will appear at the top of pages to indicate they have been published as a Notion Site |
| 55 | Emoji | Limit custom emoji creation to workspace owners | W | T | | off | Any existing emojis can still be edited or deleted by the person who added them |
| 56 | Developer | Enable developer features | P | T | | off | Activate developer UI including developer toolbar, developer menu, and quick access to developer tools. |
| 57 | Teamspaces | Limit teamspace creation to workspace owners | W | T | | off | Allow only workspace owners to create teamspaces |

**Most relevant for a personal "customize your experience" page:** #1-14 (Preferences: appearance, input, language & time, start page, privacy), #22-25 (email notifications), #50-52, #56.

## 20. Dark pass (screenshots/j-preferences-dark.png, j-my-account-dark.png, j-notifications-dark.png, j-general-3-dark.png)
Toggled with Ctrl+Shift+L (Theme select then shows "Dark"); toggled back afterwards.

| Token | Light | Dark |
|---|---|---|
| Left nav panel bg | `rgb(249,248,247)` | **`rgb(32,32,32)`** |
| Content pane bg | `#fff` (dialog bg) | **`rgb(25,25,25)`** (dialog bg itself `rgb(32,32,32)`) — so in dark the nav is *lighter* than the content |
| Nav item active bg | `rgba(33,27,23,0.05)` | `rgba(255,255,255,0.082)` |
| Nav item text active / inactive | `rgb(44,44,43)` / `rgb(95,94,89)` | `rgb(240,239,237)` / `rgb(188,186,182)` |
| Nav section header | `rgb(161,158,153)` | `rgb(125,122,117)` |
| Search field bg / ring | `rgba(66,35,3,0.03)` / `rgba(28,19,1,0.11)` inset | `rgba(252,252,252,0.03)` / `rgba(255,255,235,0.1)` inset |
| Page title, section header, row label | `rgb(44,44,43)` | `rgb(240,239,237)` |
| Help text | `rgb(125,122,117)` | `rgb(173,169,163)` |
| Section hairline | `rgba(42,28,0,0.07)` | `rgba(255,255,243,0.082)` |
| Select / secondary button border | `rgba(28,19,1,0.11)` | `rgba(255,255,235,0.1)`; text `rgb(240,239,237)` |
| Text input bg / ring | `rgba(66,35,3,0.03)` / `rgba(28,19,1,0.11)` | `rgba(252,252,252,0.03)` / `rgba(255,255,235,0.1)` |
| Toggle OFF track | `rgba(135,131,120,0.3)` | `rgba(202,204,206,0.3)` |
| Toggle ON track / knob | `rgb(39,131,222)` / #fff | same |
| Primary button | bg `rgb(39,131,222)`, text `rgb(243,249,253)` | same |
| Danger button bg / text | `rgba(223,22,0,0.094)` / `rgb(229,100,88)` | **`rgba(255,104,92,0.24)`** / `rgb(229,100,88)` |
| Beta badge bg | `rgba(42,28,0,0.07)` | `rgba(255,255,235,0.1)` (text `rgb(142,139,134)`) |
| Info banner (passkey) bg / text | `rgb(229,242,252)` / `rgb(39,131,222)` | **`rgb(35,56,80)`** / `rgb(56,125,201)` |
| Step number circle bg / text | `rgba(84,72,49,0.08)` / `rgb(95,94,91)` | `rgb(47,47,47)` / `rgb(127,127,127)` |
| Close × button | 22px round | 22px round, visible dark-grey disc bg at rest in dark |
| "New" badge | blue on `rgba(0,124,215,0.094)` | blue on a darker navy tint |

## Problems / not captured
- **Upgrade plan** (Access & billing) not opened, by rule. No separate Security / Identity / Billing / Language-region tabs exist in this build.
- Not opened (would show private data or risk a change): Custom landing page picker, default meetings database picker, Time zone list (disabled anyway), People › Groups/Contacts, Notion MCP › Manage workspace clients, Connections › Manage, all Connect/Enable/Export/New buttons.
- Hover colour of the primary button not captured (reading returned the rest colour). Select hover read transparent; open/pressed state = `rgba(33,27,23,0.05)`.
- Client-side blanking: the Preferred name / Workspace name inputs had their DOM value replaced (no focus, no input event → nothing saved); the page was reloaded at the end to drop all client-side edits; the real workspace name was verified unchanged in the sidebar after reload.
