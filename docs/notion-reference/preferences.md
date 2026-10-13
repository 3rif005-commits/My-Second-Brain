# Notion user preferences and settings

Every customizable setting in Notion's Settings window, as of 2026-10-13 (read-only capture, `_raw/j-settings.md`).
**Current** is the value on the captured account. These are Notion's defaults unless the user changed them; Light theme and Relative date format may be user choices.
Scope: **P** = personal (only this user), **W** = workspace-wide (admins). Control: toggle / select / button / input.

> For My Second Brain's "customize your experience" page, the personal rows (P) are the ones to copy, especially §1. Workspace rows are listed for completeness.

## 1. Preferences tab (P): the core "customize your experience" set

| Section | Setting | Control | Options | Default / current | Help text |
|---|---|---|---|---|---|
| Appearance | **Theme** | select | Use system setting · Light · Dark | Light (system is the usual default) | Choose a theme for Notion on this device |
| Appearance | **High contrast** (Beta) | select | Use system setting · Standard contrast · High contrast | Use system setting | Increase contrast for improved visibility |
| Input options | **Use Enter to add a new line** | toggle | | off | Applies to chat, comments, and other input fields. Press **Cmd/Ctrl** + **Enter** to send. |
| Language & time | **Language** | select (two-line items: native + English name) | Arabic · Danish · Dutch · English (UK) · English (US) · Finnish · French (France) · German · Hebrew · Indonesian · Italian · Japanese · Korean · Norwegian · Portuguese (Brazil) · Simplified Chinese · Spanish (Latin America) · Spanish (Spain) · Swedish · Thai · Traditional Chinese · Vietnamese | English (US) | Choose the language you want to use Notion in |
| Language & time | **Number format** | select | Default · 1,000,000.00 · 1.000.000,00 | Default | Choose how numbers and currencies are formatted. Default uses your language setting. |
| Language & time | **Always show text direction controls** | toggle | | off | Show the option to change text direction (left to right or right to left) in the editor, regardless of what language you're using |
| Language & time | **Start week on Monday** | toggle | | off (week starts Sunday) | This will affect the way your calendars appear in Notion |
| Language & time | **Date format** | select (with an example on the right) | Full date (@October 13, 2026) · Short date (@Oct 13) · Month/Day/Year (@10/13/2026) · Day/Month/Year (@13/10/2026) · Year/Month/Day (@2026/10/13) · Relative (@Today) | Relative | Set the default format for new @date mentions |
| Language & time | **Set time zone automatically using your location** | toggle | | on | Reminders, notifications, and emails will be delivered to you based on your time zone |
| Language & time | **Time zone** | select (**disabled while the toggle above is on**) | "(GMT±h:mm) City" for every IANA zone | automatic | Choose your time zone |
| Desktop app | **Open on start** | select | Last visited page · Top page in sidebar · Library · Notion AI | Last visited page | Choose what page opens when you start Notion and when you switch workspaces |
| Privacy | **Cookie settings** | "Customize ⌄" button → popover of toggles | Strictly necessary (always on, locked) · Functional · Analytics · Marketing | on · off · off · off | See the Cookie Notice for more information |
| Privacy | **Show my view history** | toggle | | on | People with edit or full access will be able to see when you've viewed a page. Learn more. |
| Privacy | **Profile discoverability** | toggle | | on | Users who know your email will see your Notion name and profile picture when inviting you to a new workspace. Learn more. |

## 2. Account (P)
| Setting | Control | Default / current | Notes |
|---|---|---|---|
| Preferred name | text input | (name) | |
| Photo / Notion Faces | avatar button + links | initial letter | "Add a photo or create a custom self-portrait with Notion Faces" |
| Email | "Manage emails" button | — | |
| Passkeys (Recommended) | "Add passkey" button | none | Sign in with on-device biometric authentication |
| Two-factor authentication | "Add verification method" | none | |
| Password | "Add password" | none | |
| Support access | toggle | off | Grant Notion's support team temporary access to your account… |
| Delete my account | danger button | — | |
| Log out of all devices | danger button + devices table | — | |

## 3. Notifications (P)
| Section | Setting | Control | Default / current | Help text |
|---|---|---|---|---|
| In-app (live meeting activity) | Join video conferencing and start transcribing | toggle (locked) | off | — |
| In-app | Meeting is being transcribed | toggle | on | — |
| In-app | Meeting is being summarized | toggle (locked) | off | — |
| Connected apps | Slack · Discord · Microsoft Teams | "Connect" button each | not connected | Get <App> notifications about activity in your Notion workspace |
| Email | Activity in my workspace | toggle | on | Get emails about comments, mentions, page invites, reminders, access requests, and database property changes |
| Email | Always send email notifications | toggle | on | Get emails about workspace activity even when you're active in Notion |
| Email | Page updates | toggle | on | Get email digests about pages you've turned on notifications for and pages you've created |
| Email | Workspace digest | toggle | on | Get email digests about what's happening in your workspace |
| Email | Announcements and update emails | "Manage settings ↗" | — | Get occasional emails about new features from Notion |

## 4. Feature preferences (P)
| Tab | Setting | Control | Options | Default / current |
|---|---|---|---|---|
| Notion AI | Personalization (AI name + accessory) | "Personalize" button | | default |
| Notion AI | Instructions (custom agent instructions) | "Add instructions" button | | none |
| Meeting notes | Hide Meeting notes tab | select | Never · Always | Never |
| Meeting notes | Auto-share with internal calendar event participants | toggle | | off |
| Meeting notes | Auto play consent message on start | toggle | | on |
| Meeting notes | Select default meetings database | combobox | any database | none |
| Developer | Enable developer features | toggle | | off |

## 5. Workspace settings (W, admin)
| Tab | Setting | Control | Options | Default / current |
|---|---|---|---|---|
| General | Workspace name | input (≤65 chars) | | (name) |
| General | Icon | icon picker | image / emoji | (image) |
| General | Custom landing page | page picker | any page | none |
| General | Show other Notion apps in sidebar (Notion Calendar) | toggle | | off |
| General | Allowed email domains | token input | | empty |
| General | Export workspace content / members | buttons | | — |
| General | Save and display page view analytics | toggle | | on |
| General | People directory | toggle | | on |
| General | Show recent activity on people profiles | toggle | | on |
| General | Hover cards | toggle | | on |
| General | Delete workspace | danger button | | — |
| People | Add members via link | toggle + Copy link | | on |
| Notion AI | Enable web search for workspace | toggle | | on |
| Notion AI | Enable web browser for computer (Beta) | toggle | | on |
| Notion AI | Enable 'Skip all approvals' | toggle | | on |
| Notion AI | Allowed models for Notion Agent | picker (per-provider toggles + Save) | GPT, Gemini, Claude, SpaceXAI, DeepSeek, Kimi, GLM | all 32 models |
| Notion AI | Share data to improve Notion AI | toggle | | off |
| Notion AI › Skills | Disable skills for workspace | toggle | | off |
| Notion AI › Skills | Allow local skill downloads | toggle | | on |
| Meeting notes | Enable Meeting notes for workspace | toggle | | on |
| Meeting notes | Store audio locally | toggle | | off |
| Meeting notes | Automatic transcript deletion | select (plan-gated) | | Never |
| Meeting notes | Enforce consent for all workspace members | toggle | | off |
| Public pages | Always indicate that a page is live as a Notion Site | toggle | | on |
| Emoji | Limit custom emoji creation to workspace owners | toggle | | off |
| Teamspaces | Limit teamspace creation to workspace owners | toggle | | off |

## 6. Per-page and per-view preferences (not in Settings)
These live in context menus, and a clone's settings page may choose to expose defaults for them:
| Where | Setting | Options | Default |
|---|---|---|---|
| Page ⋯ menu | Font | Default · Serif · Mono | Default |
| Page ⋯ menu | Small text | toggle | off |
| Page ⋯ menu | Full width | toggle | off |
| Page ⋯ menu | Lock page | toggle | off |
| Page ⋯ menu | Notify me | (Comments …) | Comments |
| Sidebar | Width (drag) / collapsed | 270px default | expanded |
| View settings › Layout | Show vertical lines, Show page icon, Wrap all content | toggles | on, on, on (Table) |
| View settings › Layout | Open pages in | Side peek · Center peek · Full page | Side peek (Table/Board), Center peek (Gallery) |
| View settings › Layout (Board) | Color columns · Card preview · Card size · Card layout | toggle · None/Page cover/Page properties/Page content · Small/Medium/Large · Compact/List | on · None · Medium · List |
| View settings › Layout (Gallery) | Card preview · Card size · Fit media · Card layout | as above + toggle | Page cover · Medium · off · List |
| View settings › Group | Hide empty groups · sort | toggle · Ascending/Descending | on |
| Database property (Status) | Display as | Select · Checkbox | Select |
| Global shortcut | Toggle dark mode | Ctrl/Cmd+Shift+L | — |
