# Send to Notion — progress ledger

> Research + design only. No feature code until the user approves (prompt: NOTION_SYNC_PROMPT.md).
> A fresh session resumes from this file, not from chat context.

| # | Artifact | Status | Notes |
|---|----------|--------|-------|
| 0 | Repo grounding (docs, memory, data inventory) | done | evidence/INVENTORY.md |
| 1 | RESEARCH.md | done (live tests T1-T10 pending token) | |
| 2 | FIDELITY_MATRIX.md | done | |
| 3 | DIVERGENCE_LEDGER.md | done (B1-B7, U1-U5 for user) | |
| 4 | DESIGN.md + mockups | done (mockups/index.html) | |
| 5 | ROBUSTNESS.md | done | |
| 6 | STATUS.md milestone plan | done — STOP, awaiting approval | |

## Facts established
- 2026-10-07: no Notion API integration in repo (grep for api.notion.com / @notionhq / notion-client outside venvs: zero hits; "notion" hits are "Notion-style" comments only).

## Decisions made by the user (2026-10-07)
- D1 = **Tree of databases** (collection page → inline "Notes" DB of its notes; sub-collections as child pages; root "Notes" DB for un-filed notes).
- D3 = **Formula + snapshot** property.
- Divergence fixes approved: **B1** (interactive blocks out of localStorage), **B3** (keep unknown blocks), **B2** (24-h capture URLs). B5 not chosen (Notion token still uses new encrypted storage).
- U1–U4: reviewed one by one, user chose the recommendation for each = **keep as-is** (no app changes).
- D2 = **deletes listed unchecked in the dry run; if ticked, page moved to `🗄 Deleted in Second Brain`** (never `in_trash`).
- D4 = **Notion is a trusted cloud destination (ceiling `personal`)**; private notes blocked, per-send "Send once anyway"; auto-sync never releases.
- D5 = **whole brain ON: collections, notes, databases, embedded files; OFF: workspace source files, chat threads, skills** (each a Settings toggle).
- Still open: throwaway test workspace token; explicit go-ahead to start M0 (no feature code until then).

## M0 build log
- 2026-10-07 B3 fixed (ba34f9c): unknown blocks kept via `unknownBlock` placeholder; 144/144 editor vitest pass. Live browser check NOT done yet.
- 2026-10-07 `services/secrets.py` (Fernet, rotation, fail-closed) + settings `secrets_key`, `notion_test_token`; 8/8 tests pass.
- NEXT: migration `030_notion_sync.sql` (DESIGN §5, proof SELECT at end, notion_connections with NO authenticated policy); user applies it in Supabase SQL editor. Then live tests T1–T10 once NOTION_TEST_TOKEN is in backend/.env. User still needs to add SECRETS_KEY to backend/.env.
