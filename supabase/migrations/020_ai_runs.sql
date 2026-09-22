-- 020_ai_runs.sql — the run log behind the harness scoreboard.
--
-- Every model call the backend makes writes one row here: what asked for it,
-- which model answered, how many tokens each way, how long it took, and what
-- it cost. Without this table "is the harness better?" is an opinion; with it
-- the question is a query.
--
-- Deliberately NOT a foreign key on user_id → auth.users: eval runs have no
-- user, and a telemetry row must never be the reason a delete fails. note_id
-- does reference notes, with ON DELETE SET NULL, so deleting a note keeps its
-- spend history without dangling.
--
-- This migration mentions no vector types, so it needs no search_path dance
-- (see 013's notes) — but it still ends with a proof SELECT, because a
-- migration that reports success while rolling back has happened here before.

CREATE TABLE IF NOT EXISTS public.ai_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    user_id             uuid,

    -- who asked
    surface             text,          -- workspace | chat | ingest | inline | agent | eval
    job                 text,          -- summarize_text | chat | formula_ocr | vision | ...
    skill               text,          -- set once skills exist (H3)
    trigger             text,          -- user | auto | automation | eval
    note_id             uuid REFERENCES public.notes(id) ON DELETE SET NULL,

    -- who answered
    provider            text,
    model               text,

    -- how it went
    status              text NOT NULL DEFAULT 'ok',   -- ok | error
    error               text,
    latency_ms          integer,

    -- what it cost
    input_tokens        integer NOT NULL DEFAULT 0,
    output_tokens       integer NOT NULL DEFAULT 0,
    cache_read_tokens   integer NOT NULL DEFAULT 0,
    cache_write_tokens  integer NOT NULL DEFAULT 0,
    estimated_usd       numeric(12, 6),
    -- True when the provider reported usage. False means the numbers are this
    -- app's own estimate, and comparing an estimated run against a reported one
    -- is not a measurement — the eval runner refuses to mix them.
    usage_reported      boolean NOT NULL DEFAULT false,

    -- set only by backend/evals/run.py
    eval_case           text,
    eval_config         text
);

CREATE INDEX IF NOT EXISTS ai_runs_user_created_idx
    ON public.ai_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_runs_eval_idx
    ON public.ai_runs (eval_config, eval_case)
    WHERE eval_config IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_runs_note_idx
    ON public.ai_runs (note_id)
    WHERE note_id IS NOT NULL;

ALTER TABLE public.ai_runs ENABLE ROW LEVEL SECURITY;

-- The backend writes with the service role, which bypasses RLS. These policies
-- exist so a future client-side "AI activity" page can read a user's own runs
-- and nothing else.
DROP POLICY IF EXISTS ai_runs_select_own ON public.ai_runs;
CREATE POLICY ai_runs_select_own ON public.ai_runs
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS ai_runs_insert_own ON public.ai_runs;
CREATE POLICY ai_runs_insert_own ON public.ai_runs
    FOR INSERT WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE public.ai_runs IS
    'One row per model call. The harness scoreboard reads this; see HARNESS.md.';

SELECT 'migration 020 applied' AS status,
       EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'ai_runs') AS table_created,
       (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ai_runs') AS column_count,
       (SELECT count(*) FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'ai_runs') AS policy_count;
