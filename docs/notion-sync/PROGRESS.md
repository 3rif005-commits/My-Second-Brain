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
- 2026-10-07 migration `030_notion_sync.sql` written; verified in a throwaway postgres:16 container (stubbed profiles/auth.uid/authenticated): applies, re-applies idempotently, proof SELECT = 6 tables, RLS on, notion_connections 0 policies, others 1. Deviation from DESIGN §5: token_ciphertext is TEXT (Fernet output is ASCII; PostgREST bytea is hex-awkward) + token_hint, include, released columns added. **NOT applied to production yet: the user runs it in the Supabase SQL editor.**
- 2026-10-07 B3 LIVE-VERIFIED: `e2e/unknown-block-live.spec.ts` (project `unknown-block-live`) passes against the real app: placeholder shown, edit + autosave, stored `flashcard` block identical to the original (props + nested children), no `unknownBlock` persisted. Fixture note created and permanently deleted by the spec; checked 0 `SB-TEST` notes left. (First run timed out on a 69 s cold compile; spec timeout raised to 300 s; one leftover fixture from that run was cleaned up by hand.) Stack started for the test (backend+frontend only, no llama.cpp) and stopped again, as found.
- NEXT (needs user): apply 030 in Supabase; add SECRETS_KEY and NOTION_TEST_TOKEN to backend/.env; then live tests T1–T10 + cassette recording.
