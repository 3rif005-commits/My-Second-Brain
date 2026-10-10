# Send to Notion: user guide

Second Brain keeps a **one-way copy** of your brain in your Notion workspace. Nothing flows back: editing in Notion never changes
your notes. Everything below is also visible in the app; the words used here are the words the app uses.

## 1. Connect (about a minute)
1. In Notion create an *internal integration* and copy its token. Share one empty page with it ("Connections → add").
2. In Second Brain open **Settings → Notion**, paste the token, press connect, then choose that page. It becomes the **root**: everything
   is sent under it and nothing outside it is touched.
3. Use a test workspace first if you like. **Settings → Notion → Health → Pause all syncing** stops everything before the next request.

## 2. Sending: the review panel
Right-click a note, a folder or a database in the sidebar (⌘-click to select several), or press ⌘P and type "Send to Notion". The panel
shows a **dry run**: nothing is sent until you press **Send** (⌘/Ctrl + Enter). Esc or clicking outside cancels.

| Tab | Meaning |
|---|---|
| New | Not in Notion yet. |
| Changed | Changed here since the last send. |
| Unchanged | Already up to date. Sending again writes nothing. |
| Needs you | The page was edited in Notion. Nothing is overwritten until you decide (see §4). |
| Not sent | Private, paused, missing, or deleted here (see below). |

Untick a row to leave it out. Arrow keys move between rows, Space ticks, → opens the details. More than one item runs **in the
background**: you can close the panel and watch it in **Settings → Notion → Activity**.

Folders become pages with a **Notes** table inside; notes become rows/pages in it with topics, mastery and source as columns.
Mentions of other notes become real links. A note moved here is moved there. A note deleted here is moved, only if you tick it, to a
page called **"🗄 Deleted in Second Brain"** (never Notion's trash).

### Fidelity words
- **Exact**: Notion shows the same thing.
- **Approximated (n)**: shown, but a little differently (the panel says how, per item).
- **Lossy (n)**: something cannot be shown in Notion; the panel says what is lost. The original stays safe here.

### Known, declared losses
The hidden-looking **SB ID** column is visible in Notion (it makes crash recovery exact). Numbered lists always start at 1. Files inside
database properties are skipped. People, created-by, last-edited-by, verification and button properties are skipped. Formulas also get a
"(SB value)" column with the value Second Brain computed.

### Dots in the sidebar
Quiet by default. **Amber**: changed since the last send. **Red**: the last send failed. **Violet**: needs you (edited in Notion).
**Grey**: mirroring paused. **Lock**: private, never sent. A green ring appears on hover when in sync.

## 3. Private notes
Private notes are never sent. They show "Private: stays on this device". You can release one **for a single send** ("Send once anyway");
auto-sync can never do that.

## 4. When a page was edited in Notion
The row opens with a side-by-side diff (*In Notion now* / *What we would send*) and these choices:
- **Skip this time** — leave both as they are.
- **Overwrite with Second Brain…** — asks again, then replaces the Notion edit.
- **Keep both: send as a copy** — a new page; the edited one stays.
- **Create again** / **Forget it (leave Notion alone)** — for a page deleted in Notion: send it anew, or stop mirroring it.
- **Stop mirroring this page** — pauses this one note. Resume it from the note’s right-click menu in the sidebar ("Resume mirroring").
Second Brain never deletes a block it did not create.

## 5. Auto-sync (Settings → Notion → Auto-sync)
Whole brain: **Off / When it changes (after 10 minutes of quiet) / Once a day**. For one note, folder or database: right-click →
**Keep in sync**. Limits, by design: it never sends a private note, never overwrites a page edited in Notion (it waits under "Needs you"),
never archives deletes, and stops when syncing is paused. A 429 from Notion slows it by 20 % for 10 minutes.

**What "the whole brain" includes** is a set of switches in Settings → Notion → Mirror status: folders, notes, databases, files inside
notes (on); workspace source files, chat threads and skills (off by default).

## 6. Activity and Health
- **Activity**: every run, what it sent, what failed and why; **Retry failed**.
- **Health**: last successful send, failing items, rate-limit waits, the pinned API version, the daily check, and the connection state.
  "Notion disconnected this app" means the token was revoked: reconnect in Settings.

## 7. Local backup (independent of Notion)
A single `.sbz` file on this computer, readable without the app. **It includes private notes**: keep it where you keep them.
- **Settings → Notion → Health → Back up now**, or turn on a daily backup with `BACKUP_ENABLED=true` in `backend/.env`
  (folder `~/SecondBrainBackups` unless `BACKUP_DIR` is set; old ones are pruned).
- From a terminal in `backend/`:
  - `python -m tools.backup --out ~/SecondBrainBackups/now.sbz`  (writes and verifies)
  - `python -m tools.restore <file.sbz> --dry-run`  (what is inside and what would be created)
  - `python -m tools.restore <file.sbz> --apply --confirm`  (creates everything as **new** notes under a "Restored" folder; never overwrites or deletes). Database rows and files are in the archive but are not re-created.

## 8. If something looks wrong
Open Health. If the daily check is red, Notion changed something (see `NOTION_CHANGES.md`); unchanged block types keep working.
