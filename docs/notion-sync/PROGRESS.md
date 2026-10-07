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
- U1–U4: user wants to review one by one (presented in chat 2026-10-07; answers pending).
- Still open: D2 (deletes), D4 (privacy ceiling), D5 (whole-brain includes), test workspace token, overall approval to start M0.
