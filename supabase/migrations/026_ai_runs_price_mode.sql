-- 026 — say whether a run was paid at the normal price or the batch (half) price
--
-- Background jobs (harness 5.3, milestone 3) can go through a provider's batch
-- API at half price. `estimated_usd` on such a row is the discounted amount,
-- so the month total (and the monthly limit) is what was really paid; this
-- column says which kind of price it is.
--
-- Run in the Supabase SQL editor. Safe to run twice.

ALTER TABLE public.ai_runs
  ADD COLUMN IF NOT EXISTS price_mode text NOT NULL DEFAULT 'live'
  CHECK (price_mode IN ('live', 'batch'));

-- Check
SELECT 'column: ' || column_name AS applied
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'ai_runs' AND column_name = 'price_mode';
