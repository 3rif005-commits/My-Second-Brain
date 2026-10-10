# Deploy Send to Notion to the fork (checklist)

Fork: `3rif005-commits/second-brain-webmcp`. Frontend on Vercel, backend on Render (`render.yaml`),
database = the fork's own Supabase project (not the one used for testing the feature).
No secret values belong in this file or in git.

## 0. Before you start
- [ ] This feature's PR is merged and you have synced its code into the fork (backend, frontend, `supabase/migrations/029_*` and `030_*`).
- [ ] `backend/requirements.txt` in the fork has `mcp==1.27.1` (pinned in this PR).
- [ ] In the fork's Supabase, migrations **001–028 are already applied**. 029 and 030 build on them. If unsure, compare the list in Supabase → Database → Migrations with `supabase/migrations/`.

## 1. Database (fork's Supabase, SQL editor, in this order)
- [ ] Run `029_privacy_routing.sql`.
- [ ] Run `030_notion_sync.sql` (6 new tables; only `notion_connections` has no policy, by design).
- [ ] Check: `select count(*) from information_schema.tables where table_name like 'notion_%';` → 6 or more rows. Re-running 030 is safe (it is idempotent).
- Do not run the 005 and 010 migrations again: they fail by design and are already applied.

## 2. Render (backend)
- [ ] Generate a key locally: `cd backend && python -m services.secrets generate`. Keep it somewhere safe (password manager). **Losing it means every saved Notion connection must be reconnected.**
- [ ] Render → the backend service → Environment: add `SECRETS_KEY` = that key. (Rotation later: put the new key first, keep the old one after a comma.)
- [ ] Optional: `BACKUP_ENABLED=true` and `BACKUP_DIR=<a persistent disk path>`. Render's disk is wiped on deploy unless you attach a persistent disk, so leave backups off, or attach one first.
- [ ] Do **not** set `NOTION_TEST_TOKEN` on Render. It is for tests only.
- [ ] Deploy the backend (push to the fork's deploy branch, or Manual Deploy). Wait for the health check to go green.

## 3. Vercel (frontend)
- [ ] No new env vars are needed. Check that `FASTAPI_URL` points at the Render service.
- [ ] Redeploy the frontend (push, or Redeploy without cache).

## 4. Smoke check on the live app (2 minutes)
- [ ] Open `/brain/settings/notion`: you see "Connect Notion" (not an error).
- [ ] Create a Notion internal integration, share one page with it, paste its token, Connect, pick the page.
- [ ] Note ••• → Send to Notion… → preview → Send → "Open in Notion" opens the page. Send again → "Nothing to send".

## 5. Tests to run afterward
From a checkout of the fork (use a **test** Notion workspace whose shared page is titled `SB-TEST-…`, never your real one):
- [ ] Backend, offline: `cd backend && PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -p asyncio tests/notion_sync tests/test_backup.py tests/test_storage_urls.py tests/test_secrets.py`
- [ ] Frontend: `cd frontend && npx tsc --noEmit && npx vitest run`
- [ ] Live, against the **fork's** backend with `NOTION_TEST_TOKEN` in your local `backend/.env`: `python -m evals.notion_canary`
- [ ] Browser: `npx playwright test --project=notion-sync-live` (needs `E2E_EMAIL` / `E2E_PASSWORD` of a throwaway user in the fork's Supabase; it refuses to run if Notion is already connected).

## 6. If something is wrong
- "Notion isn't available / secrets key" error → `SECRETS_KEY` missing or Render not redeployed.
- Relation "notion_…" does not exist → migration 030 not applied to this Supabase.
- Rollback: the feature is push-only. Settings → Notion → Disconnect stops it; nothing in your notes is changed by it. The new tables can stay.
