# Rotate every credential after the cloud session

The current (real) credentials were given to the cloud environment as secrets so it can run the browser spec.
Treat all of them as exposed. When the cloud session ends, and before using the app again:

- [ ] Supabase: reset the service-role key and JWT secret (Project Settings → API); rotate the anon key; change the DB password (→ `DATABASE_URL`); change the test user's password.
- [ ] `SECRETS_KEY`: do NOT just replace it, stored Notion tokens are encrypted with it. Re-encrypt or reconnect Notion after changing it.
- [ ] `NOTION_TEST_TOKEN` and any real Notion integration token: regenerate at notion.so/my-integrations.
- [ ] `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENROUTER_API_KEY`: revoke and recreate (also the leaked `HF_TOKEN`).
- [ ] `INTERNAL_API_KEY`: generate a new random value.
- [ ] Update `backend/.env`, `frontend/.env.local` and the deployed environment with the new values, then restart with `./app.sh`.
- [ ] Delete the secrets from the cloud environment settings.
- [ ] The spec ran against real data: look for stray notes/folders it created.
- [ ] The app login password was hardcoded in `frontend/e2e/setup/auth.setup.ts` and is in git history of the GitHub repo. Change it (Supabase Auth, or the app), then set `E2E_EMAIL`/`E2E_PASSWORD` in `frontend/.env.local` (the setup now reads them from the environment or that file).
- [ ] The old password is also written in: STATUS.md, frontend/e2e/phase2-sidepanel.spec.ts, frontend/e2e/auth-flow.spec.ts, docs/prompts/workspace-video-testing-prompt.md, docs/superpowers/plans/2026-05-18-phase2-three-doors.md. Remove it there too.
