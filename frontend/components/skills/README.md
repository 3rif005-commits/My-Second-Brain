# Settings → Skills

The skills editor (user decision, 2026-09-24: Notion-inspired, built so the
next addition has an obvious place). The page is `app/(brain)/brain/settings/skills/page.tsx`;
everything else is here.

## Map

| File | What it is |
| --- | --- |
| `SkillsWorkspace.tsx` | State: which skill (`?skill=` in the URL), its draft, save (⌘S), dialogs, the unsaved-changes guard |
| `SkillSidebar.tsx` | The list: search, **New**, skills grouped by where they run |
| `SkillPage.tsx` | One skill as a page: icon, title, property rows, tabs, save bar |
| `SkillMenu.tsx` | The **⋯** actions (list and page share it) |
| `NewSkillDialog.tsx` | Template gallery → name → create; also **Duplicate** |
| `IconPicker.tsx` | The emoji icon |
| `model.ts` | Pure logic — drafts, dirtiness, names, search, duplicate (tested in `model.test.ts`) |
| `lineDiff.ts` | The line diff behind **Compare with original** (tested) |
| `@/lib/skills.ts` | Types and the API client (backend: `backend/routers/skills_api.py`) |

## Adding something

Each of these is **one entry in a list**:

- **A new setting on a skill** → `properties.tsx` `PROPERTIES`. Add the field to
  `SkillDraft` in `lib/skills.ts`, `draftOf`/`isDirty` in `model.ts`, and the
  backend's `SkillPayload` + `_write_user_skill`. Only add settings the runtime
  actually honours — a setting that changes nothing misleads the user (this is
  why the stored-but-unused `model_tier` and `confirm` are not shown).
- **A new view of a skill** (test runs, history, usage…) → `tabs.tsx` `TABS`.
  A tab that holds its own unsaved work calls `reportDirty(tabId, dirty)`.
- **A new place a skill can run** → `groups.ts` `GROUPS` (and `WHERE` in
  `skills_api.py`, plus whatever surface offers it).
- **A new starting point for "New skill"** → `templates.ts` `TEMPLATES`.
- **A new action in ⋯** → `SkillMenu.tsx` `actions`, handled in
  `SkillsWorkspace.onAction`.
- **A new backend endpoint under a skill** (`/skills/{name}/…`) → nothing in
  the frontend's API routes: `app/api/skills/[name]/[...rest]/route.ts`
  forwards it. Add the call to `skillsApi`.
- **A new Settings section** → `components/settings/sections.ts`.

## Settings that exist today

- **Runs in**, **Command**, **Result**, **Shows up**, **Description**, **Version**.
- **Several sources** — the study guide only (E9): Automatic (chapter by
  chapter from 3 sources) · One pass · Chapter by chapter. Stored as
  `multi_source` in the user's copy; read at call time
  (`synthesis.resolve_method`). One run can choose too: `/study-guide deep` or
  `/study-guide quick`. The planner's instructions are a file of the skill
  (`reference/chapter-plan.md`, Files tab).

## Rules the design keeps

- Saving is explicit (⌘S / Save). Editing a built-in saves the user's own
  version; the original is never touched and **Reset** brings it back.
- A built-in keeps its place ("Runs in" is locked); the user's own skills can move.
- Edits take effect on the next run — no restart (the study guide reads its
  instructions at call time: `prompts/mastery_guide.py`, `note_synthesis*.py`).
- No native dialogs: `ConfirmDialog` for questions, toasts for results.
